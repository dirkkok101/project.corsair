import { rngStream, seedRng } from '@corsair/core';
import type { AiCaptain, BattleResult, Command, RngState, Ship, Wind, WorldState } from '@corsair/core';
import { isLand, shipStats, tileAt } from '@corsair/data';
import type { ContentPack, TileMap } from '@corsair/data';
import { angleOffWind, bestUpwindDeg, createNavigationSystem, normalizeDeg } from '@corsair/systems-navigation';

// The sea battle (PRD section 9.1): two ships on a local map cut from the world where they met, in
// the world's wind. The player steers and fires broadsides; the enemy is steered by her captain's
// personality. Movement reuses the navigation system at battle pace, so a ship handles as she does
// on the world map. Every number is in combat.json. Deterministic from its seed, so the headless
// runner can play thousands of fights (section 9.6) and replays hold.

export type Side = 'player' | 'enemy';
export type Ammo = 'round' | 'chain' | 'grape';
export type Broadside = 'port' | 'starboard';
export type Aim = 'ready' | 'loading' | 'no-target' | 'out-of-range' | 'no-guns';

export interface BattleShip extends Ship {
  hull: number;
  sailCondition: number;
  crew: number;
  hullMax: number;
  crewStart: number;
  guns: number;
  /** Seconds until each broadside can fire again. */
  reload: Record<Broadside, number>;
  ammo: Ammo;
  /** Enemy only: her role, which sets how she fights and how hard she boards. */
  role?: AiCaptain['role'];
  /** Her guns' reach and reload as multiples of combat.json's (bronze cannon, fine-grain powder). */
  rangeMult: number;
  /** A pirate captain's temperament (combat.json tactics): how soon she boards and how soon she runs. */
  temperament?: string;
  /** Her crew's spirit, 0 to 100: the player's from the career, an AI crew's by her role (crew.json). */
  morale: number;
  reloadMult: number;
  /** Each mast's strength, fore to aft (her class's masts), 100 sound .. 0 gone by the board. */
  masts: number[];
}

/**
 * Where a ball struck her: along her length (from the middle, bow positive, -0.5 .. 0.5), and in what; how high
 * (tiles above the water) and how far out from her centreline (tiles, starboard positive) it went in.
 */
export interface HitPlace {
  along: number;
  part: 'hull' | 'rigging' | 'deck';
  up: number;
  across: number;
}

/**
 * A ball in flight, really flying: from her gun port (x, y, at height `h0`) toward where her gunners aimed (tx,
 * ty, at height `h1`), rising `rise` at the top of its arc, over `flight` seconds; `t` seconds of that are left
 * (it flies on past its aim point and falls into the sea if nothing stops it). Each step it is tested against
 * the other ship as she is then: a ship that has turned or changed her pace since the broadside was fired may
 * not be where the ball goes. `at` is where it is now (x, y, height).
 */
export interface Shot {
  from: Side;
  x: number;
  y: number;
  tx: number;
  ty: number;
  t: number;
  flight: number;
  h0: number;
  h1: number;
  rise: number;
  at: [number, number, number];
  ammo: Ammo;
}

/** Where a ball is `k` of the way along its flight (0 at the gun, 1 at its aim point, on beyond). */
export function shotAt(s: Pick<Shot, 'x' | 'y' | 'tx' | 'ty' | 'h0' | 'h1' | 'rise'>, k: number): [number, number, number] {
  return [s.x + (s.tx - s.x) * k, s.y + (s.ty - s.y) * k, s.h0 + (s.h1 - s.h0) * k + s.rise * 4 * k * (1 - k)];
}

/** Something for the view to draw for a moment: smoke at the guns, a splash, splinters, a mast going. */
export interface BattleEffect {
  /**
   * hit: round shot's splinters; sail: chain shot's torn canvas; grape: a spray of small shot on her deck;
   * mast: one of her masts goes by the board.
   */
  kind: 'smoke' | 'splash' | 'hit' | 'sail' | 'grape' | 'mast';
  x: number;
  y: number;
  /** Battle seconds when it happened. */
  at: number;
  /** A hit's ship and place on her. */
  ship?: Side;
  place?: HitPlace;
  /** A falling mast: which (fore to aft), and the way it falls (degrees, the way the shot was going). */
  mast?: number;
  towardDeg?: number;
}

export interface BattleState {
  tick: number;
  /** Seconds the ships have been drawing apart beyond escape range; at battle.escapeSeconds one gets away. */
  parting: number;
  /** Seconds the hulls have lain together with grapples out; at battle.grappleSeconds the boarders go over. */
  grappling: number;
  wind: Wind;
  ships: Record<Side, BattleShip>;
  shots: Shot[];
  effects: BattleEffect[];
  rng: RngState;
  /** The player has ordered "close to board": her helm runs alongside the enemy until the grapples hold. */
  boarding?: boolean;
  /**
   * She has gone down: barrels of her purse and her men in the water, to sail over and pick up until
   * `until` (battle seconds), or until the player leaves the wreck. What's picked up so far is kept here.
   */
  wreck?: Wreck;
  result?: BattleResult;
}

export interface Wreck {
  until: number;
  barrels: { x: number; y: number }[];
  survivors: { x: number; y: number; men: number }[];
  gold: number;
  men: number;
}

export type BattleCommand =
  | Extract<Command, { type: 'SetHelm' | 'SetSails' | 'SetAssist' }>
  /** Fire a broadside; with no side, whichever bears and is loaded (one fire key for the player). */
  | { type: 'Fire'; side?: Broadside }
  | { type: 'SetAmmo'; ammo: Ammo }
  /** Done picking over the wreck: the fight ends now. */
  | { type: 'LeaveWreck' }
  /** Close to board: the helm steers alongside her and holds there for the grapples (again, or any helm, to stop). */
  | { type: 'Board' };

export interface BattleSetup {
  map: TileMap;
  wind: Wind;
  player: Ship;
  enemy: Ship;
  seed: number;
  /** The player's crew's morale (crew.json's start when unset). */
  playerMorale?: number;
  /** Seat the enemy this far apart along this bearing from the player, in battle tiles. */
  bearingDeg: number;
}

const TPS = 30;
const DT = 1 / TPS;
const EFFECT_SECONDS = 0.6;
const AI_THINK_TICKS = 8;

/**
 * The battle map: the world itself, drawn bigger (combat.json battle.tileSize). A battle tile is a
 * world tile, so the ships fight where they met with the real coasts around them and open sea beyond.
 */
export function battleMap(content: ContentPack, world: TileMap): TileMap {
  return { ...world, tileSize: content.combat.battle.tileSize };
}

export function createBattle(content: ContentPack, setup: BattleSetup) {
  const c = content.combat;
  // Battle pace and handling: the same sailing model, slower, so a crossing takes long enough to fight
  // in, and a ship that keeps her way through a tack.
  const battleContent: ContentPack = {
    ...content,
    navigation: {
      ...content.navigation,
      tilesPerSecondPerSpeedPoint: c.battle.tilesPerSecondPerSpeedPoint,
      accelPerSecond: c.battle.accelPerSecond,
      decelPerSecond: c.battle.decelPerSecond,
    },
  };
  const nav = createNavigationSystem(battleContent, setup.map, () => setup.wind);
  const water = (x: number, y: number) => !isLand(tileAt(setup.map, x, y));
  const rng0 = rngStream(seedRng(setup.seed, 'battle'));

  const arm = (ship: Ship, side: Side): BattleShip => {
    const cls = content.ships[ship.classId]!;
    const stats = shipStats(content, ship);
    const crew = ship.crew ?? Math.round(cls.maxCrew * c.startCrew);
    return {
      ...ship,
      id: side,
      // Not an AI lane-follower here: navigation skips ships with `ai`, and the battle steers her itself.
      ai: undefined,
      helm: 0,
      assist: undefined,
      docked: undefined,
      blocked: false,
      sails: 'full',
      hull: ship.hull ?? stats.hullMax,
      sailCondition: ship.sailCondition ?? 100,
      crew,
      hullMax: stats.hullMax,
      crewStart: crew,
      guns: stats.guns,
      rangeMult: stats.rangeMult,
      reloadMult: stats.reloadMult,
      reload: { port: 0, starboard: 0 },
      ammo: 'round',
      role: ship.ai?.role,
      morale: side === 'player' ? (setup.playerMorale ?? content.crew.morale.start) : (content.crew.enemyMorale[ship.ai?.role ?? 'merchant'] ?? 50),
      masts: cls.masts.map(() => 100),
    };
  };

  // The player where she met the enemy; the enemy along the bearing she lay at, on open water.
  const mid = { x: setup.player.x, y: setup.player.y };
  let enemyAt = { x: mid.x, y: mid.y };
  for (let turn = 0; turn < 360; turn += 15) {
    const rad = ((setup.bearingDeg + turn) * Math.PI) / 180;
    const at = { x: mid.x + Math.sin(rad) * c.battle.startApart, y: mid.y - Math.cos(rad) * c.battle.startApart };
    if (water(at.x, at.y)) {
      enemyAt = at;
      break;
    }
  }
  // A pirate captain's temperament: the one she sails under on the map (that weighed the odds before she
  // came on), else drawn from the battle's seed by share.
  const temperament = (() => {
    if (setup.enemy.ai?.role !== 'pirate') return undefined;
    if (setup.enemy.ai.temperament) return setup.enemy.ai.temperament;
    const pick = rngStream(seedRng(setup.seed, 'temperament'));
    return pick.weighted(Object.fromEntries(Object.entries(c.tactics.temperaments).map(([k, v]) => [k, v.share])));
  })();
  let state: BattleState = {
    tick: 0,
    parting: 0,
    grappling: 0,
    wind: setup.wind,
    ships: {
      player: { ...arm(setup.player, 'player'), x: mid.x, y: mid.y },
      enemy: { ...arm(setup.enemy, 'enemy'), ...enemyAt, ...(temperament ? { temperament } : {}) },
    },
    shots: [],
    effects: [],
    rng: rng0.state(),
  };
  const queue: BattleCommand[] = [];

  const seconds = () => state.tick / TPS;
  const distance = () => Math.hypot(state.ships.enemy.x - state.ships.player.x, state.ships.enemy.y - state.ships.player.y);
  const bearing = (from: BattleShip, to: BattleShip) => normalizeDeg((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI);
  /** Which broadside bears on the target, if either: within arcDeg of the beam. */
  const bears = (ship: BattleShip, target: BattleShip): Broadside | undefined => {
    const rel = ((bearing(ship, target) - ship.headingDeg + 540) % 360) - 180;
    if (Math.abs(rel - 90) <= c.guns.arcDeg) return 'starboard';
    if (Math.abs(rel + 90) <= c.guns.arcDeg) return 'port';
    return undefined;
  };
  const reloadSeconds = (ship: BattleShip) => {
    // Manning: her crew over the men a broadside needs. Short-handed, every broadside takes longer (the crew
    // is split between the guns); with hands to spare it goes faster, up to reloadBonus at fullManning
    // (Pirates! 2004: more crew means faster reloads).
    const needed = (ship.guns * c.guns.crewPerGun) / 2;
    const manning = Math.max(1, ship.crew) / Math.max(1, needed);
    const m = content.crew.manning;
    const factor = manning < 1 ? 1 / manning : 1 - m.reloadBonus * Math.min(1, (manning - 1) / (m.fullManning - 1));
    return c.guns.reloadSeconds * ship.reloadMult * factor;
  };
  /** Boarding strength from morale: a happy crew fights like lions (crew.json boarding, at 0 and at 100). */
  const spirit = (ship: BattleShip) => content.crew.boarding.at0 + ((content.crew.boarding.at100 - content.crew.boarding.at0) * ship.morale) / 100;
  /** How far a ship's guns reach: round and chain to rangeTiles, grape shorter, both stretched by her guns. */
  const reach = (ship: BattleShip, ammo: Ammo = ship.ammo) => (c.ammo[ammo]!.short ? c.guns.grapeTiles : c.guns.rangeTiles) * ship.rangeMult;

  /** Whether a broadside can fire now, and if not, why: the HUD shows it so a refused shot never puzzles. */
  const aim = (side: Side, broadside: Broadside): Aim => {
    const ship = state.ships[side];
    const target = state.ships[side === 'player' ? 'enemy' : 'player'];
    if (ship.guns < 2) return 'no-guns';
    if (ship.reload[broadside] > 0) return 'loading';
    if (bears(ship, target) !== broadside) return 'no-target';
    if (distance() > reach(ship)) return 'out-of-range';
    return 'ready';
  };

  const fire = (side: Side, broadside: Broadside, rng: ReturnType<typeof rngStream>) => {
    const ship = state.ships[side];
    const target = state.ships[side === 'player' ? 'enemy' : 'player'];
    const d = distance();
    if (aim(side, broadside) !== 'ready') return;
    // One ball a gun on this side, each from its own port along her side. Her gunners lead the target (where she
    // will be when the ball gets there, at her present course and pace) and aim for her hull, or her rigging with
    // chain, or her deck with grape; each ball scatters about that point, more the longer the range.
    const size = content.ships[ship.classId]!.size;
    const theirs = content.ships[target.classId]!.size;
    const r = (ship.headingDeg * Math.PI) / 180;
    const fwd = [Math.sin(r), -Math.cos(r)] as const;
    const stbd = [Math.cos(r), Math.sin(r)] as const;
    const out = broadside === 'starboard' ? 1 : -1;
    const tr = (target.headingDeg * Math.PI) / 180;
    const flight = d / c.guns.shotTilesPerSecond;
    const lead = [target.x + Math.sin(tr) * target.speed * flight, target.y - Math.cos(tr) * target.speed * flight] as const;
    const aimH = ship.ammo === 'chain' ? (theirs.rail + theirs.mast) * 0.45 : ship.ammo === 'grape' ? theirs.rail * 1.05 : theirs.rail * 0.55;
    const sigma = c.guns.spread + c.guns.spreadPerTile * d;
    // A normal scatter from two uniform draws (Box-Muller).
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rng.float()))) * Math.cos(2 * Math.PI * rng.float());
    const shots: Shot[] = [];
    const n = Math.floor(ship.guns / 2);
    for (let g = 0; g < n; g++) {
      const along = ((g + 0.5) / n - 0.5) * size.length * 0.6;
      const x = ship.x + fwd[0] * along + stbd[0] * size.beam * out;
      const y = ship.y + fwd[1] * along + stbd[1] * size.beam * out;
      const tx = lead[0] + gauss() * sigma;
      const ty = lead[1] + gauss() * sigma;
      const shot = { from: side, x, y, tx, ty, t: flight, flight, h0: size.rail * 0.55, h1: aimH, rise: d * c.guns.arcPerTile, ammo: ship.ammo } as Omit<Shot, 'at'>;
      shots.push({ ...shot, at: shotAt(shot, 0) });
    }
    state = {
      ...state,
      ships: { ...state.ships, [side]: { ...ship, reload: { ...ship.reload, [broadside]: reloadSeconds(ship) } } },
      shots: [...state.shots, ...shots],
      effects: [...state.effects, { kind: 'smoke', x: ship.x, y: ship.y, at: seconds() }],
    };
  };

  /**
   * A pirate's heading, by phase (combat.json tactics): hold on once grappled; run when badly hurt; close
   * to board when the other is crippled or out-crewed, or, if bold, the moment the other's broadside facing
   * her has just fired; otherwise stalk from a station off the other's bow or stern and rake her.
   */
  const pirate = (me: BattleShip, them: BattleShip, d: number, toThem: number, ready: Broadside): number => {
    const t = c.tactics.temperaments[me.temperament ?? 'bold'] ?? Object.values(c.tactics.temperaments)[0]!;
    if (state.grappling > 0) return toThem;
    if (me.hull < me.hullMax * t.fleeBelowHull || me.crew < me.crewStart * t.fleeBelowCrew) return toThem + 180;
    // The other's broadside on my side of her: just fired, it's a while reloading.
    const rel = ((bearing(them, me) - them.headingDeg + 540) % 360) - 180;
    const facing: Broadside = rel > 0 ? 'starboard' : 'port';
    const opening = t.seizeOpenings && d <= reach(me, 'round') && them.reload[facing] > reloadSeconds(them) * c.tactics.openingReload;
    if (them.sailCondition < t.boardBelowSails || me.crew > them.crew * t.boardCrewRatio || opening) return toThem;
    // Stalk: a station off her bow or stern (the nearer), where her broadsides can't bear.
    const standoff = reach(me, 'round') * c.tactics.standoffShare;
    const r = (them.headingDeg * Math.PI) / 180;
    const ends = [1, -1].map((k) => ({ x: them.x + Math.sin(r) * k * standoff, y: them.y - Math.cos(r) * k * standoff }));
    const station = ends.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0]!;
    if (Math.hypot(station.x - me.x, station.y - me.y) > c.tactics.stationTiles) {
      return normalizeDeg((Math.atan2(station.x - me.x, -(station.y - me.y)) * 180) / Math.PI);
    }
    // On station: turn the loaded broadside on her, raking her end on.
    return ready === 'starboard' ? toThem - 90 : toThem + 90;
  };

  /** Steering for an AI captain (the enemy, or the player under autopilot in the headless runner). */
  const steer = (side: Side, personality: 'runner' | 'cautious' | 'aggressive'): BattleCommand[] => {
    const me = state.ships[side];
    const them = state.ships[side === 'player' ? 'enemy' : 'player'];
    const d = distance();
    const toThem = bearing(me, them);
    const ready: Broadside = me.reload.starboard <= me.reload.port ? 'starboard' : 'port';
    let want: number;
    if (personality === 'runner') want = toThem + 180;
    else if (personality === 'aggressive') want = pirate(me, them, d, toThem, ready);
    else if (d > reach(me, 'round') * 0.8) want = toThem;
    else if (personality === 'cautious' && d < reach(me, 'round') * 0.5) want = toThem + 180;
    // Put the loaded broadside to bear: the target abeam on that side.
    else want = ready === 'starboard' ? toThem - 90 : toThem + 90;
    want = normalizeDeg(want);
    // Never into irons: hold the nearest course the rig can sail.
    const best = bestUpwindDeg(content.polars[content.ships[me.classId]!.polar]!);
    if (angleOffWind(want, state.wind.fromDeg) < best) {
      const a = normalizeDeg(state.wind.fromDeg + best);
      const b = normalizeDeg(state.wind.fromDeg - best);
      const off = (h: number) => Math.abs(((h - want + 540) % 360) - 180);
      want = off(a) <= off(b) ? a : b;
    }
    // Shy off land ahead: try the course, then swing either way until it is clear for three tiles.
    const clearAhead = (h: number) => {
      const r = (h * Math.PI) / 180;
      for (let k = 1; k <= 3; k++) if (!water(me.x + Math.sin(r) * k, me.y - Math.cos(r) * k)) return false;
      return true;
    };
    for (const swing of [0, 30, -30, 60, -60, 90, -90, 135, -135]) {
      if (clearAhead(normalizeDeg(want + swing))) {
        want = normalizeDeg(want + swing);
        break;
      }
    }
    const diff = ((want - me.headingDeg + 540) % 360) - 180;
    const helm = Math.abs(diff) < 6 ? 0 : diff > 0 ? 1 : -1;
    const cmds: BattleCommand[] = [{ type: 'SetHelm', shipId: side, helm }];
    if (me.sails !== 'full') cmds.push({ type: 'SetSails', shipId: side, sails: 'full' });
    // Ammo: pirates cripple with chain, then sweep the deck with grape before boarding; others fire round shot.
    const ammo: Ammo = personality === 'aggressive' ? (d <= reach(me, 'grape') ? 'grape' : 'chain') : 'round';
    if (me.ammo !== ammo) cmds.push({ type: 'SetAmmo', ammo });
    const side2 = bears(me, them);
    if (side2) cmds.push({ type: 'Fire', side: side2 });
    return cmds;
  };

  /**
   * "Close to board": steer for where she will be (leading her by the time it takes to get there), full sail,
   * and once alongside match her heading so the hulls stay together while the grapples take.
   */
  const closeToBoard = (): BattleCommand[] => {
    const me = state.ships.player;
    const them = state.ships.enemy;
    const d = distance();
    let want: number;
    if (d <= c.battle.boardTiles * 1.2) want = them.headingDeg;
    else {
      const eta = Math.min(20, d / Math.max(0.5, me.speed));
      const r = (them.headingDeg * Math.PI) / 180;
      want = bearing(me, { x: them.x + Math.sin(r) * them.speed * eta, y: them.y - Math.cos(r) * them.speed * eta } as BattleShip);
    }
    const best = bestUpwindDeg(content.polars[content.ships[me.classId]!.polar]!);
    if (angleOffWind(want, state.wind.fromDeg) < best) {
      const a = normalizeDeg(state.wind.fromDeg + best);
      const b = normalizeDeg(state.wind.fromDeg - best);
      const off = (h: number) => Math.abs(((h - want + 540) % 360) - 180);
      want = off(a) <= off(b) ? a : b;
    }
    const diff = ((want - me.headingDeg + 540) % 360) - 180;
    const cmds: BattleCommand[] = [{ type: 'SetHelm', shipId: 'player', helm: Math.abs(diff) < 6 ? 0 : diff > 0 ? 1 : -1 }];
    if (me.sails !== 'full') cmds.push({ type: 'SetSails', shipId: 'player', sails: 'full' });
    return cmds;
  };
  /** The player's chance to carry her deck if the boarders went over now (the boarding roll's odds). */
  const boardingOdds = () => {
    const p = state.ships.player;
    const e = state.ships.enemy;
    const ps = p.crew * c.boarding.player * spirit(p);
    const es = e.crew * c.boarding[e.role ?? 'merchant'] * spirit(e);
    return ps / Math.max(1e-6, ps + es);
  };

  /** `byAi`: the command came from an AI captain's steering (the enemy, or the headless autopilot). */
  const apply = (side: Side, cmd: BattleCommand, rng: ReturnType<typeof rngStream>, byAi = false) => {
    if (cmd.type === 'LeaveWreck') {
      if (state.wreck) end('sunk');
      return;
    }
    if (cmd.type === 'Board') {
      state = { ...state, boarding: !state.boarding };
      return;
    }
    // Taking the helm by hand drops "close to board".
    if (cmd.type === 'SetHelm' && side === 'player' && !byAi && state.boarding) state = { ...state, boarding: false };
    if (cmd.type === 'Fire') {
      const broadside = cmd.side ?? (['port', 'starboard'] as const).find((b) => aim(side, b) === 'ready');
      return broadside ? fire(side, broadside, rng) : undefined;
    }
    if (cmd.type === 'SetAmmo') {
      // For the player, switching shot is instant: loaded guns take the new shot at once (choosing it is
      // the fun part). AI gun crews still draw the loads, a reload on both broadsides, so a pirate can't
      // pour in chain then grape without a pause and board before the fight has begun.
      const ship = state.ships[side];
      if (ship.ammo === cmd.ammo) return;
      const reload = byAi ? { port: reloadSeconds(ship), starboard: reloadSeconds(ship) } : ship.reload;
      state = { ...state, ships: { ...state.ships, [side]: { ...ship, ammo: cmd.ammo, reload } } };
      return;
    }
    const world = { tick: state.tick, wind: state.wind, ships: state.ships } as unknown as WorldState;
    const r = nav.command?.(world, { ...cmd, shipId: side } as Command);
    if (r) state = { ...state, ships: r.state.ships as Record<Side, BattleShip> };
  };

  const end = (outcome: BattleResult['outcome']) => {
    const strip = (s: BattleShip) => ({
      hull: Math.max(0, Math.round(s.hull)),
      sailCondition: Math.max(0, Math.round(s.sailCondition)),
      crew: Math.max(0, Math.round(s.crew)),
      guns: s.guns,
    });
    const salvage = state.wreck ? { salvage: { gold: state.wreck.gold, men: state.wreck.men } } : {};
    state = { ...state, result: { outcome, player: strip(state.ships.player), enemy: strip(state.ships.enemy), ...salvage } };
  };

  /** Beaten enough that she may strike: each second, at strike.chance. */
  const beaten = (e: BattleShip) => e.hull < e.hullMax * c.strike.hull || e.crew < e.crewStart * c.strike.crew;
  /**
   * A merchant gives up outright: her sails shot away (she can't run), or outmanned odds to one with the
   * player close enough to board (Pirates! 2004: a demasted ship strikes, and merchants give up sooner).
   */
  const yields = (e: BattleShip, p: BattleShip) =>
    (e.role ?? 'merchant') === 'merchant' && (e.sailCondition < 100 * c.strike.merchantSails || (p.crew >= e.crew * c.strike.odds && distance() <= c.strike.oddsTiles));

  /** She goes down: her purse floats off in barrels and her men take to the water around the wreck. */
  const sink = (e: BattleShip, rng: ReturnType<typeof rngStream>) => {
    const s = c.salvage;
    const around = () => {
      const a = rng.float() * Math.PI * 2;
      const r = s.spreadTiles * (0.4 + 0.6 * rng.float());
      return { x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r };
    };
    const barrels = Array.from({ length: s.barrels }, around).filter((b) => water(b.x, b.y));
    const men = Math.round(e.crew * s.survivors);
    const groups = men >= 2 ? [Math.ceil(men / 2), Math.floor(men / 2)] : men ? [men] : [];
    const survivors = groups.map((m) => ({ ...around(), men: m })).filter((g) => water(g.x, g.y));
    state = {
      ...state,
      grappling: 0,
      parting: 0,
      ships: { ...state.ships, enemy: { ...e, hull: 0, speed: 0, sails: 'furled' } },
      wreck: { until: seconds() + s.seconds, barrels, survivors, gold: 0, men: 0 },
    };
  };
  /** Sailing over the wreckage: a barrel is her gold, a knot of men in the water are hands. */
  const salvage = (w: Wreck, p: BattleShip): Wreck => {
    const near = (o: { x: number; y: number }) => Math.hypot(o.x - p.x, o.y - p.y) <= c.salvage.pickupTiles;
    const gotBarrels = w.barrels.filter(near).length;
    const gotMen = w.survivors.filter(near).reduce((n, g) => n + g.men, 0);
    if (!gotBarrels && !gotMen) return w;
    return {
      ...w,
      barrels: w.barrels.filter((b) => !near(b)),
      survivors: w.survivors.filter((g) => !near(g)),
      gold: w.gold + gotBarrels * c.salvage.barrelGold,
      men: w.men + gotMen,
    };
  };

  return {
    get state() {
      return state;
    },
    send(cmd: BattleCommand) {
      queue.push(cmd);
    },
    result: () => state.result,
    /** The player's chance to carry her deck if the boarders went over now. */
    boardingOdds: () => boardingOdds(),
    /** She may strike any moment now (shown to the player, so a surrender can be worked for). */
    wavering: () => !state.result && !state.wreck && (beaten(state.ships.enemy) || yields(state.ships.enemy, state.ships.player)),
    /** The player's broadside: ready to fire, or why not. */
    aim: (broadside: Broadside) => aim('player', broadside),
    /** The player's guns now: a broadside's reload, and how far the shot loaded reaches. */
    gunnery: () => ({ reloadSeconds: reloadSeconds(state.ships.player), rangeTiles: reach(state.ships.player) }),
    /** Advance `ticks` thirtieths of a second. `autopilot` steers the player too (the headless runner). */
    step(ticks = 1, autopilot?: 'runner' | 'cautious' | 'aggressive') {
      for (let i = 0; i < ticks && !state.result; i++) {
        const rng = rngStream(state.rng);
        for (const cmd of queue.splice(0)) apply('player', cmd, rng);
        if (state.result) break;
        if (state.tick % AI_THINK_TICKS === 0) {
          const enemyRole = state.ships.enemy.role ?? 'merchant';
          if (!state.wreck) for (const cmd of steer('enemy', c.personality[enemyRole])) apply('enemy', cmd, rng, true);
          if (autopilot) for (const cmd of steer('player', autopilot)) apply('player', cmd, rng, true);
          else if (state.boarding && !state.wreck) for (const cmd of closeToBoard()) apply('player', cmd, rng, true);
        }

        // Sail: the world's navigation at battle pace.
        const apartBefore = distance();
        const moved = nav.tick({ tick: state.tick, wind: state.wind, ships: state.ships } as unknown as WorldState, DT);
        const ships = moved.state.ships as Record<Side, BattleShip>;
        for (const side of ['player', 'enemy'] as const) {
          const s = ships[side];
          ships[side] = { ...s, reload: { port: Math.max(0, s.reload.port - DT), starboard: Math.max(0, s.reload.starboard - DT) } };
        }
        state = { ...state, tick: state.tick + 1, ships };
        // Beyond escape range the parting clock runs while the gap widens and holds while it closes;
        // back within range it starts over, so a wide turn never ends a fight by accident.
        const apart = distance();
        if (apart <= c.battle.escapeTiles) state = { ...state, parting: 0 };
        else if (apart > apartBefore) state = { ...state, parting: state.parting + DT };
        // Hulls together: the grapples go out at boardTiles and hold until the ships part past breakTiles.
        // Lashed together, both are dragged down to grappleDrag of their way, so cutting free takes a
        // deliberate run before the boarders go over.
        if (apart > c.battle.breakTiles) state = { ...state, grappling: 0 };
        else if (apart <= c.battle.boardTiles || state.grappling > 0) {
          const drag = (s: BattleShip) => ({ ...s, speed: Math.min(s.speed, content.ships[s.classId]!.speed * c.battle.tilesPerSecondPerSpeedPoint * c.battle.grappleDrag) });
          state = {
            ...state,
            grappling: state.grappling + DT,
            ships: { player: drag(state.ships.player), enemy: drag(state.ships.enemy) },
          };
        }

        // Balls fly on: each is tested against the other ship as she is now (her hull up to the rail, her
        // rigging up to her masts' tops and out to her yards' ends). A ball that meets her strikes there; one
        // that meets nothing falls into the sea.
        const flying: Shot[] = [];
        const effects = state.effects.filter((e) => seconds() - e.at < EFFECT_SECONDS);
        for (const shot of state.shots) {
          const t = shot.t - DT;
          const k = 1 - t / shot.flight;
          const at = shotAt(shot, k);
          const victimSide: Side = shot.from === 'player' ? 'enemy' : 'player';
          const vs = state.ships[victimSide];
          const sz = content.ships[vs.classId]!.size;
          const vr = (vs.headingDeg * Math.PI) / 180;
          const rx = at[0] - vs.x;
          const ry = at[1] - vs.y;
          const along = rx * Math.sin(vr) - ry * Math.cos(vr);
          const across = rx * Math.cos(vr) + ry * Math.sin(vr);
          const half = sz.length / 2;
          // Her waterline narrows toward bow and stern.
          const width = sz.beam * Math.sqrt(Math.max(0, 1 - (along / half) ** 2)) + 0.04;
          const inHull = Math.abs(along) <= half && Math.abs(across) <= width && at[2] <= sz.rail && at[2] > -0.05;
          const inRig = !state.wreck && Math.abs(along) <= half * 0.85 && Math.abs(across) <= sz.yard && at[2] > sz.rail && at[2] <= sz.mast;
          if (!inHull && !inRig) {
            if (at[2] <= 0 || k > 2) effects.push({ kind: 'splash', x: at[0], y: at[1], at: seconds() });
            else flying.push({ ...shot, t, at });
            continue;
          }
          if (victimSide === 'enemy' && state.wreck) continue;
          const place: HitPlace = {
            along: Math.max(-0.5, Math.min(0.5, along / sz.length)),
            part: inRig ? 'rigging' : shot.ammo === 'grape' ? 'deck' : 'hull',
            up: at[2],
            across,
          };
          const v = state.ships[victimSide];
          const a = c.ammo[shot.ammo]!;
          const guns = shot.ammo === 'round' && rng.float() < c.gunLoss ? Math.max(0, v.guns - 1) : v.guns;
          let hurt: BattleShip = {
            ...v,
            hull: v.hull - a.hull,
            sailCondition: Math.max(0, v.sailCondition - a.sails),
            crew: Math.max(0, v.crew - a.crew),
            guns,
          };
          effects.push({ kind: shot.ammo === 'grape' ? 'grape' : place.part === 'rigging' ? 'sail' : 'hit', x: at[0], y: at[1], at: seconds(), ship: victimSide, place });
          // Into her rigging: the nearest standing mast takes it, and may go by the board.
          if (place.part === 'rigging') {
            const at = content.ships[v.classId]!.masts;
            const standing = hurt.masts.map((m, i) => (m > 0 ? i : -1)).filter((i) => i >= 0);
            const i = standing.sort((p, q) => Math.abs(at[p]! - place.along) - Math.abs(at[q]! - place.along))[0];
            if (i !== undefined) {
              const masts = [...hurt.masts];
              masts[i] = Math.max(0, masts[i]! - c.masts.damage[shot.ammo]!);
              hurt = { ...hurt, masts };
              if (masts[i] === 0) {
                // Gone: her canvas on that mast with it (never more than her standing masts can carry), and the
                // men under it.
                const share = 100 / masts.length;
                const up = masts.filter((m) => m > 0).length;
                hurt = {
                  ...hurt,
                  sailCondition: Math.max(0, Math.min(hurt.sailCondition - share, up * share)),
                  crew: Math.max(0, hurt.crew - c.masts.crewLoss),
                };
                const towardDeg = normalizeDeg((Math.atan2(shot.tx - shot.x, -(shot.ty - shot.y)) * 180) / Math.PI);
                effects.push({ kind: 'mast', x: v.x, y: v.y, at: seconds(), ship: victimSide, mast: i, towardDeg });
              }
            }
          }
          state = { ...state, ships: { ...state.ships, [victimSide]: hurt } };
        }
        state = { ...state, shots: flying, effects };

        const p = state.ships.player;
        const e = state.ships.enemy;
        if (state.wreck) {
          // Picking over the wreck: nothing more to fight, until the time is up or nothing is left.
          const wreck = salvage(state.wreck, p);
          state = { ...state, wreck, grappling: 0, parting: 0 };
          if (seconds() >= wreck.until || (!wreck.barrels.length && !wreck.survivors.length)) end('sunk');
        } else if (e.hull <= 0) sink(e, rng);
        else if (p.hull <= 0) end('lost');
        else if (state.grappling >= c.battle.grappleSeconds) {
          // Boarding: crews with their fighting spirit; the stronger side carries the deck, both bleed.
          const ps = p.crew * c.boarding.player * spirit(p);
          const es = e.crew * c.boarding[e.role ?? 'merchant'] * spirit(e);
          const won = rng.float() < ps / (ps + es);
          const pLoss = Math.round(p.crew * c.boarding.losses * (es / (ps + es)));
          const eLoss = Math.round(e.crew * c.boarding.losses * (ps / (ps + es)));
          state = { ...state, ships: { player: { ...p, crew: p.crew - pLoss }, enemy: { ...e, crew: e.crew - eLoss } } };
          end(won ? 'boarded' : 'lost');
        } else if (state.parting >= c.battle.escapeSeconds) {
          // If the player was sailing away from her, the player broke off; otherwise she got away.
          const rad = (p.headingDeg * Math.PI) / 180;
          const toward = (Math.sin(rad) * (e.x - p.x) - Math.cos(rad) * (e.y - p.y)) / distance();
          end(p.speed * toward < 0 ? 'fled' : 'escaped');
        } else if (seconds() >= c.battle.maxSeconds) end('escaped');
        else if (state.tick % TPS === 0) {
          // Once a second: a merchant that can't run or can't fight gives up; a beaten enemy may haul down
          // her colours.
          if (yields(e, p)) end('struck');
          else if (beaten(e) && rng.float() < c.strike.chance) end('struck');
        }
        state = { ...state, rng: rng.state() };
      }
    },
  };
}

export type Battle = ReturnType<typeof createBattle>;
