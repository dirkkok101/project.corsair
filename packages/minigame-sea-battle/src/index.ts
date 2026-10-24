import { rngStream, seedRng } from '@corsair/core';
import type { AiCaptain, BattleResult, Command, RngState, Ship, Wind, WorldState } from '@corsair/core';
import { crewQualityOf, isLand, shipStats, tileAt } from '@corsair/data';
import type { ContentPack, DifficultyLevel, TileMap } from '@corsair/data';
import { weigh } from './captain';
export type { Intent, Mind } from './captain';
import type { Mind } from './captain';
import { angleOffWind, atTheOars, bestUpwindDeg, createNavigationSystem, normalizeDeg, targetSpeed } from '@corsair/systems-navigation';

// The sea battle (PRD section 9.1): two ships on a local map cut from the world where they met, in
// the world's wind. The player steers and fires broadsides; the enemy is steered by her captain's
// personality. Movement reuses the navigation system at battle pace, so a ship handles as she does
// on the world map. Every number is in combat.json. Deterministic from its seed, so the headless
// runner can play thousands of fights (section 9.6) and replays hold.

export type Side = 'player' | 'enemy';
export type Ammo = 'round' | 'chain' | 'grape';
export type Broadside = 'port' | 'starboard';
export type Aim = 'ready' | 'loading' | 'no-target' | 'out-of-range' | 'running-out' | 'no-guns';

export interface BattleShip extends Ship {
  hull: number;
  sailCondition: number;
  crew: number;
  hullMax: number;
  crewStart: number;
  guns: number;
  /** Seconds until each broadside can fire again. */
  reload: Record<Broadside, number>;
  /**
   * Seconds each broadside's guns have been run out (loaded, and bearing within reach): at battle.tellSeconds they
   * can fire. The other ship sees them go out, the tell to turn away on.
   */
  runOut: Record<Broadside, number>;
  /** A broadside ordered to fire while her guns were still running out: it goes off the moment they are out. */
  firing?: Broadside;
  /** A stern rake jammed her rudder: until then (battle seconds) her helm bites only raking.rudderTurn of the time. */
  rudderUntil?: number;
  ammo: Ammo;
  /** Enemy only: her role, which sets how she fights and how hard she boards. */
  role?: AiCaptain['role'];
  /** Her guns' reach and reload as multiples of combat.json's (bronze cannon, fine-grain powder; light guns load quicker). */
  rangeMult: number;
  /** A pirate captain's temperament (combat.json tactics): how soon she boards and how soon she runs. */
  temperament?: string;
  /** Her crew's spirit, 0 to 100: the player's from the career, an AI crew's by her role (crew.json). */
  morale: number;
  reloadMult: number;
  /** Her crew and captain (combat.json crewQuality, skill): scatter and boarding as multiples, and ticks between decisions. */
  spreadMult: number;
  boardMult: number;
  thinkTicks: number;
  /** What she fires (combat.json doctrines): round at the hull, chain at the rigging, or a pirate's chain then grape. */
  doctrine: 'round' | 'chain' | 'pirate';
  /** Soldiers aboard: her boarding strength as a multiple (a Spanish guarda costa's). */
  boardingDefence: number;
  /** Her captain's resolve (0-100, 50 when unset): how long she holds out once beaten. */
  resolve: number;
  /** Swivel guns mounted, and chasers at each end (her class's and her fit's). */
  swivels: number;
  chasers: number;
  /** Her fit (upgrades.json): canvas wear, guns that overheat (with when she last fired), boarding nettings. */
  sailWear: number;
  overheats: boolean;
  firedAt: number[];
  nettings: boolean;
  /** A famous pirate (pirates.json id): he may call on the player to strike, sooner by his terror. */
  famous?: string;
  terror: number;
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
  /** Down her length, from bow or stern (combat.json raking): more harm, the most from astern. */
  rake?: boolean;
  /** Raked from astern, in at her stern windows. */
  stern?: boolean;
  /** And it jammed her rudder. */
  rudder?: boolean;
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
  /** Her force by the range she was fired at (combat.json guns.pointBlank, longShotPower): 1 close in. */
  power?: number;
  /** Fired from above at a ship under her guns: it goes through her rigging, sparing her hull, men and masts. */
  high?: boolean;
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
  /** A broadside's smoke: how many guns fired. */
  guns?: number;
  /** A splash close by her: a near miss. */
  near?: boolean;
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
  /** The enemy means to board: she is closing for the grapples (only a ship that means to board throws them). */
  enemyBoarding?: boolean;
  /** Battle seconds until which the enemy, her boarders repelled, sheers off rather than close again. */
  sheerUntil?: number;
  /** What each boarding captain has in mind, and how much she wants each choice (captain.ts): for tuning, and her next tick. */
  minds?: Partial<Record<Side, Mind>>;
  /** The player's repel this grapple (one try a grapple), and when: shown for a moment. */
  repel?: { result: 'repelled' | 'missed'; at: number };
  /** Boarders repelled this fight: each narrows the next window (boarding.repelFade). */
  repels?: number;
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
  | { type: 'Board' }
  /** Repel boarders: in the grapple's last moments (repelWindow), cut her grapples; too soon, and they come over. */
  | { type: 'Repel' }
  /** Strike her colours, when a famous pirate calls on her to (`demands`): she keeps her ship and men. */
  | { type: 'Strike' };

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
  /**
   * A fair start (she was attacked while under way): the two lie across the wind, neither holding the weather
   * gauge, close (combat.json battle.fairApart) on courses drawing apart downwind (fairAngle off the line between
   * them), so the attacker must come round to board and she has time for broadsides first: measured against a
   * pirate brigantine, near four before the grapple where meeting as they lay gave one. Unset, they start as they
   * met (her own attack, or caught napping).
   */
  fair?: boolean;
  /** The career's difficulty (combat.json difficulty): a veering wind, the player's near misses forgiven. Neutral when unset. */
  difficulty?: DifficultyLevel;
}

const TPS = 30;
const DT = 1 / TPS;
const EFFECT_SECONDS = 0.6;


/**
 * The weather gauge: the ship to windward of the other (by more than `margin` of the distance between them) can
 * choose when to close; within it, neither has it.
 */
/** Sailing in a fight: battle pace and handling, and torn sails that all but stop her. */
function battleNavigation(content: ContentPack): ContentPack {
  const b = content.combat.battle;
  return {
    ...content,
    navigation: {
      ...content.navigation,
      tilesPerSecondPerSpeedPoint: b.tilesPerSecondPerSpeedPoint,
      accelPerSecond: b.accelPerSecond,
      decelPerSecond: b.decelPerSecond,
      turnDegPerSecondPerPoint: b.turnDegPerSecondPerPoint,
      tornSailsFloor: b.tornSailsFloor,
      // A fight's click-to-sail goes where she is told, as it was tuned.
      course: undefined,
    },
  };
}

/** Whether a side is making her way at the oars (her sails can't drive her as fast on this wind). */
export function rowing(content: ContentPack, state: Pick<BattleState, 'wind' | 'ships'>, side: 'player' | 'enemy'): boolean {
  return atTheOars(battleNavigation(content), state.ships[side] as unknown as Ship, state.wind);
}

export function weatherGauge(state: Pick<BattleState, 'wind' | 'ships'>, margin = 0.35): 'player' | 'enemy' | undefined {
  const { player, enemy } = state.ships;
  const rad = (state.wind.fromDeg * Math.PI) / 180;
  const [wx, wy] = [Math.sin(rad), -Math.cos(rad)];
  const dx = enemy.x - player.x;
  const dy = enemy.y - player.y;
  const apart = Math.max(1e-6, Math.hypot(dx, dy));
  const windward = (dx * wx + dy * wy) / apart;
  return windward > margin ? 'enemy' : windward < -margin ? 'player' : undefined;
}

/** What her round shot does to their hull and men, by her guns' weight and their timbers (combat.json shotHarm). */
export function shotHarmOf(content: ContentPack, from: string, to: string): number {
  const s = content.combat.styles;
  return content.combat.shotHarm[s[content.ships[from]!.style].shot][s[content.ships[to]!.style].timbers];
}

export function createBattle(content: ContentPack, setup: BattleSetup) {
  const c = content.combat;
  // Battle pace and handling: the same sailing model, slower, so a crossing takes long enough to fight
  // in, and a ship that keeps her way through a tack.
  const battleContent = battleNavigation(content);
  // The fight's own wind: the world's where they met, veering through the fight on the harder levels.
  const nav = createNavigationSystem(battleContent, setup.map, () => state.wind);
  const water = (x: number, y: number) => !isLand(tileAt(setup.map, x, y));
  const rng0 = rngStream(seedRng(setup.seed, 'battle'));

  const arm = (ship: Ship, side: Side): BattleShip => {
    const cls = content.ships[ship.classId]!;
    const stats = shipStats(content, ship);
    const crew = ship.crew ?? Math.round(cls.maxCrew * c.startCrew);
    // Who sails her: a drilled crew reloads faster and shoots straighter; a good captain thinks quicker.
    const quality = crewQualityOf(content, ship.ai);
    // What she fires and who is aboard, by her role and, for a patrol, her nation's ways.
    const role = ship.ai?.role;
    const ways = role === 'patrol' ? c.doctrines.patrolNations[ship.ai!.nation] : undefined;
    const doctrine = role ? { ...c.doctrines[role], ...ways } : { ammo: 'round' as const };
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
      reloadMult: stats.reloadMult * quality.reload * c.styles[cls.style].reload,
      spreadMult: quality.spread,
      boardMult: quality.boarding,
      thinkTicks: quality.thinkTicks,
      doctrine: ship.ai?.doctrine ?? doctrine.ammo ?? 'round',
      boardingDefence: doctrine.boardingDefence ?? 1,
      resolve: ship.ai?.captain?.resolve ?? 50,
      swivels: stats.swivels,
      chasers: stats.chasers,
      sailWear: stats.sailWear,
      overheats: stats.overheats,
      firedAt: [],
      nettings: stats.nettings,
      terror: ship.ai?.terror ?? 1,
      ...(ship.ai?.famous ? { famous: ship.ai.famous } : {}),
      reload: { port: 0, starboard: 0 },
      runOut: { port: 0, starboard: 0 },
      ammo: 'round',
      role: ship.ai?.role,
      // A famous pirate's veterans (pirates.json) fight in better heart than any other crew.
      morale:
        side === 'player'
          ? (setup.playerMorale ?? content.crew.morale.start)
          : ship.ai?.famous
            ? content.pirates.rules.morale
            : (content.crew.enemyMorale[ship.ai?.role ?? 'merchant'] ?? 50),
      masts: cls.masts.map(() => 100),
    };
  };

  // The player where she met the enemy; the enemy along the bearing she lay at (across the wind for a fair
  // start, on the side nearer that bearing), on open water.
  const mid = { x: setup.player.x, y: setup.player.y };
  const from = setup.wind.fromDeg;
  const across = [normalizeDeg(from + 90), normalizeDeg(from - 90)].sort(
    (a, b) => Math.abs(((a - setup.bearingDeg + 540) % 360) - 180) - Math.abs(((b - setup.bearingDeg + 540) % 360) - 180),
  );
  // Open water for her: a fair start tries the two bearings across the wind first; then round from the bearing she lay at.
  const candidates = [...(setup.fair ? across : []), ...Array.from({ length: 24 }, (_, k) => setup.bearingDeg + k * 15)];
  let enemyAt = { x: mid.x, y: mid.y };
  let line = setup.bearingDeg;
  for (const deg of candidates) {
    const rad = (deg * Math.PI) / 180;
    const far = setup.fair ? c.battle.fairApart : c.battle.startApart;
    const at = { x: mid.x + Math.sin(rad) * far, y: mid.y - Math.cos(rad) * far };
    if (!water(at.x, at.y)) continue;
    enemyAt = at;
    line = normalizeDeg(deg);
    break;
  }
  // Fair: each heads fairAngle off the line to the other, turned downwind (never in irons; 90 is side by side on
  // the same course), under way at least at fighting pace.
  const downwind = normalizeDeg(from + 180);
  const off = (a: number) => Math.abs(((a - downwind + 540) % 360) - 180);
  const turn = c.battle.fairAngle;
  const toward = (bearing: number) => [normalizeDeg(bearing + turn), normalizeDeg(bearing - turn)].sort((a, b) => off(a) - off(b))[0]!;
  const fairPlayer = setup.fair ? { headingDeg: toward(line), speed: Math.max(setup.player.speed, c.battle.fairSpeed) } : {};
  const fairEnemy = setup.fair ? { headingDeg: toward(normalizeDeg(line + 180)), speed: Math.max(setup.enemy.speed, c.battle.fairSpeed) } : {};
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
      player: { ...arm(setup.player, 'player'), x: mid.x, y: mid.y, ...fairPlayer },
      enemy: { ...arm(setup.enemy, 'enemy'), ...enemyAt, ...fairEnemy, ...(temperament ? { temperament } : {}) },
    },
    shots: [],
    effects: [],
    rng: rng0.state(),
  };
  const queue: BattleCommand[] = [];

  const seconds = () => state.tick / TPS;
  /** A ship's size in the fight (ships.json size, times battle.shipScale): what balls are aimed at and strike. */
  const sizeOf = (classId: string) => {
    const s = content.ships[classId]!.size;
    const k = c.battle.shipScale;
    return { length: s.length * k, beam: s.beam * k, rail: s.rail * k, mast: s.mast * k, yard: s.yard * k };
  };
  const distance = () => Math.hypot(state.ships.enemy.x - state.ships.player.x, state.ships.enemy.y - state.ships.player.y);
  /** The other lies under her guns: within underGuns.tiles of her side, and she stands underGuns.tallerBy higher. */
  const under = (ship: BattleShip, target: BattleShip) => {
    const mine = sizeOf(ship.classId);
    const theirs = sizeOf(target.classId);
    const gap = Math.hypot(target.x - ship.x, target.y - ship.y) - mine.beam - theirs.beam;
    return gap <= c.underGuns.tiles && mine.rail >= theirs.rail * c.underGuns.tallerBy;
  };
  const bearing = (from: BattleShip, to: BattleShip) => normalizeDeg((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI);
  /** Which broadside bears on the target, if either: within arcDeg of the beam. */
  const bears = (ship: BattleShip, target: BattleShip): Broadside | undefined => {
    const rel = ((bearing(ship, target) - ship.headingDeg + 540) % 360) - 180;
    if (Math.abs(rel - 90) <= c.guns.arcDeg) return 'starboard';
    if (Math.abs(rel + 90) <= c.guns.arcDeg) return 'port';
    return undefined;
  };
  /** Her crew over the men a broadside needs (crewPerGun at each gun on the side). */
  const manningOf = (ship: BattleShip) => Math.max(1, ship.crew) / Math.max(1, (ship.guns * c.guns.crewPerGun) / 2);
  /**
   * Short-handed, she can't work every gun on the side nor load those she does as fast: both by the square root of
   * her manning, so her weight of shot a minute still falls in proportion to her men, in smaller, slower broadsides.
   */
  const gunsManned = (ship: BattleShip) => {
    const n = Math.floor(ship.guns / 2);
    return Math.min(n, Math.max(1, Math.round(n * Math.sqrt(Math.min(1, manningOf(ship))))));
  };
  /** And what guns she works scatter wider, her best gunners fallen (combat.json shortHandedSpread). */
  const unsteady = (ship: BattleShip) => 1 + c.guns.shortHandedSpread * (1 - Math.min(1, manningOf(ship)));
  const reloadSeconds = (ship: BattleShip) => {
    // With hands to spare she loads faster, up to reloadBonus at fullManning (Pirates! 2004: more crew means
    // faster reloads).
    const manning = manningOf(ship);
    const m = content.crew.manning;
    const factor = manning < 1 ? 1 / Math.sqrt(manning) : 1 - m.reloadBonus * Math.min(1, (manning - 1) / (m.fullManning - 1));
    // Her men at the sweeps aren't at the guns; bronze guns fired three times running must cool.
    const rowing = atTheOars(battleContent, ship, state.wind) ? c.upgrades.rowingReload : 1;
    const hot = ship.overheats && ship.firedAt.filter((t) => seconds() - t <= c.upgrades.overheatSeconds).length >= 3 ? c.upgrades.overheatReload : 1;
    return c.guns.reloadSeconds * ship.reloadMult * factor * rowing * hot;
  };
  /** Boarding strength from morale: a happy crew fights like lions (crew.json boarding, at 0 and at 100). */
  const spirit = (ship: BattleShip) => content.crew.boarding.at0 + ((content.crew.boarding.at100 - content.crew.boarding.at0) * ship.morale) / 100;
  /** How far a ship's guns reach: round and chain to rangeTiles, grape shorter, both stretched by her guns. */
  const reach = (ship: BattleShip, ammo: Ammo = ship.ammo) => (c.ammo[ammo]!.short ? c.guns.grapeTiles : c.guns.rangeTiles) * ship.rangeMult;

  /** Whether a broadside can fire now, and if not, why: the HUD shows it so a refused shot never puzzles. */
  const aim = (side: Side, broadside: Broadside): Aim => {
    const ship = state.ships[side];
    const target = state.ships[side === 'player' ? 'enemy' : 'player'];
    // A sunk ship fires nothing more, whatever she had loaded.
    if (ship.guns < 2 || (side === 'enemy' && state.wreck)) return 'no-guns';
    if (ship.reload[broadside] > 0) return 'loading';
    if (bears(ship, target) !== broadside) return 'no-target';
    if (distance() > reach(ship)) return 'out-of-range';
    if (ship.runOut[broadside] < c.battle.tellSeconds - 1e-6) return 'running-out';
    return 'ready';
  };

  /** A ball's force at this range: full within pointBlank of her reach, falling to longShotPower at its end. */
  const power = (ship: BattleShip, d: number) => {
    const full = reach(ship) * c.guns.pointBlank;
    if (d <= full) return 1;
    return Math.max(c.guns.longShotPower, 1 - ((1 - c.guns.longShotPower) * (d - full)) / Math.max(1e-6, reach(ship) - full));
  };

  /**
   * Her chasers: a round shot from each gun at her head (or stern) when the other ship lies within the chasers'
   * arc of it and within reach, scattering as a broadside's does.
   */
  const chase = (side: Side, rng: ReturnType<typeof rngStream>) => {
    const ship = state.ships[side];
    const target = state.ships[side === 'player' ? 'enemy' : 'player'];
    const d = distance();
    if (!ship.chasers || d > reach(ship, 'round')) return;
    const toThem = bearing(ship, target);
    const off = Math.abs(((toThem - ship.headingDeg + 540) % 360) - 180);
    const end = off <= c.chasers.arcDeg ? 1 : off >= 180 - c.chasers.arcDeg ? -1 : 0;
    if (!end) return;
    const size = sizeOf(ship.classId);
    const theirs = sizeOf(target.classId);
    const r = (ship.headingDeg * Math.PI) / 180;
    const flight = d / c.guns.shotTilesPerSecond;
    const tr = (target.headingDeg * Math.PI) / 180;
    const lead = [target.x + Math.sin(tr) * target.speed * flight, target.y - Math.cos(tr) * target.speed * flight] as const;
    // Scattered in proportion to the ships' size in the fight, so a bigger target is no likelier hit.
    const sigma = (c.guns.spread + c.guns.spreadPerTile * d) * ship.spreadMult * unsteady(ship) * c.battle.shipScale;
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rng.float()))) * Math.cos(2 * Math.PI * rng.float());
    const shots: Shot[] = [];
    for (let g = 0; g < ship.chasers; g++) {
      const x = ship.x + Math.sin(r) * size.length * 0.5 * end;
      const y = ship.y - Math.cos(r) * size.length * 0.5 * end;
      const shot = { from: side, x, y, tx: lead[0] + gauss() * sigma, ty: lead[1] + gauss() * sigma, t: flight, flight, h0: size.rail * 0.6, h1: theirs.rail * 0.55, rise: d * c.guns.arcPerTile, ammo: 'round' as Ammo, power: power(ship, d) };
      shots.push({ ...shot, at: shotAt(shot, 0) });
    }
    state = { ...state, shots: [...state.shots, ...shots], effects: [...state.effects, { kind: 'smoke', x: ship.x, y: ship.y, at: seconds() }] };
  };

  /** Her swivels sweep the other ship's deck when she lies within their reach: men fall, no ball flies. */
  const swivel = (side: Side, rng: ReturnType<typeof rngStream>) => {
    const ship = state.ships[side];
    const victim: Side = side === 'player' ? 'enemy' : 'player';
    const v = state.ships[victim];
    if (!ship.swivels || distance() > c.swivels.tiles || ship.crew < 1) return;
    const want = ship.swivels * c.swivels.crewPer;
    const fell = Math.floor(want) + (rng.float() < want % 1 ? 1 : 0);
    state = {
      ...state,
      ships: { ...state.ships, [victim]: { ...v, crew: Math.max(0, v.crew - fell) } },
      effects: [...state.effects, { kind: 'grape', x: v.x, y: v.y, at: seconds(), ship: victim, place: { along: 0, part: 'deck', up: sizeOf(v.classId).rail, across: 0 } }],
    };
  };

  const fire = (side: Side, broadside: Broadside, rng: ReturnType<typeof rngStream>) => {
    const ship = state.ships[side];
    const target = state.ships[side === 'player' ? 'enemy' : 'player'];
    const d = distance();
    if (aim(side, broadside) !== 'ready') return;
    // One ball a gun on this side, each from its own port along her side. Her gunners lead the target (where she
    // will be when the ball gets there, at her present course and pace) and aim for her hull, or her rigging with
    // chain, or her deck with grape; each ball scatters about that point, more the longer the range.
    const size = sizeOf(ship.classId);
    const theirs = sizeOf(target.classId);
    const r = (ship.headingDeg * Math.PI) / 180;
    const fwd = [Math.sin(r), -Math.cos(r)] as const;
    const stbd = [Math.cos(r), Math.sin(r)] as const;
    const out = broadside === 'starboard' ? 1 : -1;
    const tr = (target.headingDeg * Math.PI) / 180;
    const flight = d / c.guns.shotTilesPerSecond;
    const lead = [target.x + Math.sin(tr) * target.speed * flight, target.y - Math.cos(tr) * target.speed * flight] as const;
    // Close under the side of a much taller ship, her guns can't depress far enough: round and grape fly high into
    // the other's rigging (the Speedy under El Gamo's guns).
    const high = ship.ammo !== 'chain' && under(ship, target);
    const aimH = ship.ammo === 'chain' || high ? (theirs.rail + theirs.mast) * 0.45 : ship.ammo === 'grape' ? theirs.rail * 1.05 : theirs.rail * 0.55;
    // Grape leaves the muzzle as a tight cone of small shot: it holds together over its short reach.
    // Scattered in proportion to the ships' size in the fight (battle.shipScale), so a bigger target is no likelier hit.
    const sigma = (c.guns.spread + c.guns.spreadPerTile * d) * (ship.ammo === 'grape' ? c.guns.grapeSpread : 1) * ship.spreadMult * unsteady(ship) * c.battle.shipScale;
    // A normal scatter from two uniform draws (Box-Muller).
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rng.float()))) * Math.cos(2 * Math.PI * rng.float());
    const shots: Shot[] = [];
    const n = gunsManned(ship);
    for (let g = 0; g < n; g++) {
      const along = ((g + 0.5) / n - 0.5) * size.length * 0.6;
      const x = ship.x + fwd[0] * along + stbd[0] * size.beam * out;
      const y = ship.y + fwd[1] * along + stbd[1] * size.beam * out;
      const tx = lead[0] + gauss() * sigma;
      const ty = lead[1] + gauss() * sigma;
      const shot = { from: side, x, y, tx, ty, t: flight, flight, h0: size.rail * 0.55, h1: aimH, rise: d * c.guns.arcPerTile, ammo: ship.ammo, power: power(ship, d), ...(high ? { high } : {}) } as Omit<Shot, 'at'>;
      shots.push({ ...shot, at: shotAt(shot, 0) });
    }
    state = {
      ...state,
      ships: { ...state.ships, [side]: { ...ship, firedAt: [...ship.firedAt.slice(-3), seconds()], reload: { ...ship.reload, [broadside]: reloadSeconds({ ...ship, firedAt: [...ship.firedAt.slice(-3), seconds()] }) } } },
      shots: [...state.shots, ...shots],
      effects: [...state.effects, { kind: 'smoke', x: ship.x, y: ship.y, at: seconds(), guns: n }],
    };
  };

  /**
   * A boarder's course, and whether she means to board now (her grapples go out only then). What she does is her
   * mind's (captain.ts: board, duel, stalk or run, weighed by her temperament, combat.json tactics); once grappled she holds
   * on, and with her boarders thrown back she sheers off for a while and works her guns before closing again. Stalking,
   * she keeps a station off the other's bow or stern and rakes her.
   */
  const pirate = (side: Side, me: BattleShip, them: BattleShip, d: number, toThem: number, ready: Broadside, sheering: boolean): { want: number; board: boolean } => {
    const t = c.tactics.temperaments[me.temperament ?? 'bold'] ?? Object.values(c.tactics.temperaments)[0]!;
    // The other's broadside on my side of her: just fired, it's a while reloading.
    const rel = ((bearing(them, me) - them.headingDeg + 540) % 360) - 180;
    const facing: Broadside = rel > 0 ? 'starboard' : 'port';
    const gauge = weatherGauge(state);
    const mind = weigh(
      {
        hull: me.hull / me.hullMax,
        crew: me.crew / Math.max(1, me.crewStart),
        menRatio: me.crew / Math.max(1, them.crew),
        firepower: (me.guns * me.hull) / Math.max(1, them.guns * them.hull),
        theirSails: them.sailCondition,
        opening: d <= reach(me, 'round') && them.reload[facing] > reloadSeconds(them) * c.tactics.openingReload,
        apart: d,
        gauge: gauge === undefined ? undefined : gauge === side ? 'mine' : 'theirs',
        // The enemy fights her ship; the player's autopilot (tests and probes) fights every ship as it always has.
        ...(side === 'enemy' ? { canRun: canRun(me, them) } : {}),
      },
      t,
      c.tactics.utility,
      state.minds?.[side]?.intent,
      c.tactics.styles[side === 'enemy' ? content.ships[me.classId]!.style : 'cruiser'],
    );
    if (state.grappling > 0) mind.intent = 'board';
    else if (sheering && mind.intent === 'board') mind.intent = mind.wants.flee > mind.wants.stalk ? 'flee' : 'stalk';
    state = { ...state, minds: { ...state.minds, [side]: mind } };
    if (mind.intent === 'board') return { want: toThem, board: true };
    if (mind.intent === 'flee') return { want: toThem + 180, board: false };
    // Trading broadsides: in to most of her guns' reach, then the loaded broadside to bear.
    if (mind.intent === 'duel') return { want: d > reach(me, 'round') * 0.8 ? toThem : ready === 'starboard' ? toThem - 90 : toThem + 90, board: false };
    return { want: stalk(me, them, toThem, ready), board: false };
  };

  /** Stalking: to a station off her bow or stern (the nearer), where her broadsides can't bear; there, rake her. */
  const stalk = (me: BattleShip, them: BattleShip, toThem: number, ready: Broadside) => {
    const standoff = reach(me, 'round') * c.tactics.standoffShare;
    const r = (them.headingDeg * Math.PI) / 180;
    const ends = [1, -1].map((k) => ({ x: them.x + Math.sin(r) * k * standoff, y: them.y - Math.cos(r) * k * standoff }));
    const station = ends.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0]!;
    if (Math.hypot(station.x - me.x, station.y - me.y) > c.tactics.stationTiles) return normalizeDeg((Math.atan2(station.x - me.x, -(station.y - me.y)) * 180) / Math.PI);
    // On station: turn the loaded broadside on her, raking her end on.
    return ready === 'starboard' ? toThem - 90 : toThem + 90;
  };

  /**
   * Her best pace on this wind, on whatever heading suits her: everything navigation weighs (her fit, torn canvas,
   * hull, hands, a foul bottom), and her oars in a calm. Pointing (which way the other lies) is not weighed.
   */
  const topSpeed = (s: BattleShip) =>
    Math.max(...Array.from({ length: 12 }, (_, k) => targetSpeed(battleContent, { ...s, headingDeg: k * 30, sails: 'full' } as unknown as Ship, state.wind)));
  /** She can get away from the other: at least tactics.runSpeedShare of the other's best pace. */
  const canRun = (me: BattleShip, them: BattleShip) => topSpeed(me) >= topSpeed(them) * c.tactics.runSpeedShare;

  /** Steering for an AI captain (the enemy, or the player under autopilot in the headless runner). */
  const steer = (side: Side, personality: 'runner' | 'cautious' | 'aggressive'): BattleCommand[] => {
    const me = state.ships[side];
    const them = state.ships[side === 'player' ? 'enemy' : 'player'];
    const d = distance();
    const toThem = bearing(me, them);
    const ready: Broadside = me.reload.starboard <= me.reload.port ? 'starboard' : 'port';
    let want: number;
    // How her kind of ship fights (the enemy's; the player's autopilot fights as it always has), and a trader who
    // can't outrun the other doesn't show her stern within reach of her guns: she turns and fights. She chases no
    // one: out of reach, she runs on.
    const style = side === 'enemy' ? content.ships[me.classId]!.style : 'cruiser';
    if (personality === 'runner' && side === 'enemy' && d <= reach(me, 'round') && !canRun(me, them)) personality = 'cautious';
    if (personality === 'runner') want = toThem + 180;
    else if (personality === 'aggressive') {
      const plan = pirate(side, me, them, d, toThem, ready, side === 'enemy' && seconds() < (state.sheerUntil ?? 0));
      want = plan.want;
      state = side === 'enemy' ? { ...state, enemyBoarding: plan.board } : { ...state, boarding: plan.board };
    }
    // A raider keeps off the other's broadside and rakes her from bow or stern.
    else if (style === 'raider') want = stalk(me, them, toThem, ready);
    // A fortress presents her broadside within her reach, closes to it from a little beyond, and never follows far:
    // past fortressChase times her reach she lies with her side to the other and lets her come, or go.
    else if (style === 'fortress') want = d > reach(me, 'round') * 0.95 && d <= reach(me, 'round') * c.tactics.fortressChase ? toThem : ready === 'starboard' ? toThem - 90 : toThem + 90;
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
    // Her doctrine's shot; the player's autopilot fires as its personality would (a boarder's chain and grape).
    const doctrine = side === 'enemy' ? me.doctrine : personality === 'aggressive' ? 'pirate' : 'round';
    const ammo: Ammo = doctrine === 'pirate' ? (d <= reach(me, 'grape') ? 'grape' : 'chain') : doctrine;
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
  /**
   * Boarding nettings (upgrades.json): the side being boarded stands stiffer behind them, the side going over is
   * slowed a little by its own. The player is the one boarding when she closed to board (G); else the enemy is.
   */
  const nets = (ship: BattleShip, side: Side) => {
    if (!ship.nettings) return 1;
    const boarding = (side === 'player') === state.boarding;
    return boarding ? c.upgrades.nettingsBoarding : c.upgrades.nettingsDefence;
  };
  /** The player's chance to carry her deck if the boarders went over now (the boarding roll's odds). */
  const boardingOdds = () => {
    const p = state.ships.player;
    const e = state.ships.enemy;
    const ps = p.crew * c.boarding.player * spirit(p) * p.boardMult * p.boardingDefence * nets(p, 'player');
    const es = e.crew * c.boarding[e.role ?? 'merchant'] * spirit(e) * e.boardMult * e.boardingDefence * nets(e, 'enemy');
    return ps / Math.max(1e-6, ps + es);
  };

  /**
   * How long before her boarders go over the player can repel them (seconds): wider the likelier her own boarders
   * would carry the deck (her crew, its spirit, her nettings). Only when the enemy is the one boarding.
   */
  const repelWindow = () => {
    const [low, high] = c.boarding.repelSeconds;
    const tired = Math.pow(c.boarding.repelFade, state.repels ?? 0);
    const window = state.enemyBoarding && !state.boarding && state.ships.player.crew > 0 ? (low + (high - low) * boardingOdds()) * tired : 0;
    // Too tired to: narrower than a couple of frames is no window a hand could hit.
    return window >= 2 * DT ? window : 0;
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
    if (cmd.type === 'Repel') {
      // One try a grapple: in the window the grapples are cut and she sheers off; too soon, they come over.
      const window = repelWindow();
      if (side !== 'player' || state.grappling <= 0 || state.repel || !window) return;
      if (state.grappling < c.battle.grappleSeconds - window) {
        state = { ...state, repel: { result: 'missed', at: seconds() } };
        return;
      }
      const p = state.ships.player;
      state = {
        ...state,
        grappling: 0,
        enemyBoarding: false,
        sheerUntil: seconds() + c.boarding.sheerSeconds,
        repel: { result: 'repelled', at: seconds() },
        repels: (state.repels ?? 0) + 1,
        ships: { ...state.ships, player: { ...p, crew: Math.max(0, p.crew - Math.round(p.crew * c.boarding.repelLosses)) } },
      };
      return;
    }
    if (cmd.type === 'Strike') {
      // Only when called on to: a captain doesn't haul down her colours to a ship that hasn't asked.
      if (side === 'player' && demands()) end('yielded');
      return;
    }
    // Taking the helm by hand drops "close to board".
    if (cmd.type === 'SetHelm' && side === 'player' && !byAi && state.boarding) state = { ...state, boarding: false };
    if (cmd.type === 'Fire') {
      const sides = ['port', 'starboard'] as const;
      const broadside = cmd.side ?? sides.find((b) => aim(side, b) === 'ready') ?? sides.find((b) => aim(side, b) === 'running-out');
      if (!broadside) return;
      // Guns still running out: the order stands, and she fires the moment they are out.
      if (aim(side, broadside) === 'running-out') state = { ...state, ships: { ...state.ships, [side]: { ...state.ships[side], firing: broadside } } };
      else fire(side, broadside, rng);
      return;
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
  /** Her men and guns, as a captain weighs the odds. */
  const might = (s: BattleShip) => Math.max(1, s.crew) * (1 + s.guns / 10);
  /**
   * The chance a beaten ship strikes this second (strike.chance at the usual): a captain of resolve holds out
   * longer, a crew in better heart than her role's usual too, and the worse the odds against her the sooner she
   * gives up.
   */
  const strikeChance = (e: BattleShip, p: BattleShip) => {
    const s = c.strike;
    const lean = (e.resolve - 50) / 50;
    const usual = content.crew.enemyMorale[e.role ?? 'merchant'] ?? 50;
    const heart = (usual + 30) / (e.morale + 30);
    const odds = Math.pow(Math.min(2, Math.max(0.5, might(p) / might(e))), s.oddsWeight);
    return Math.min(1, s.chance * (1 - (s.resolve / 2) * lean) * heart * odds);
  };
  /**
   * A famous pirate calls on the player to strike: her boarders would lose, or her hull is going, and he is close.
   * Striking gives up the chest and the hold and keeps the ship and her men.
   */
  const demands = () => {
    const p = state.ships.player;
    const e = state.ships.enemy;
    return Boolean(e.famous) && !state.result && !state.wreck && distance() <= c.strike.demandTiles && (boardingOdds() < c.strike.demandOdds * e.terror || p.hull < p.hullMax * c.strike.demandHull * e.terror);
  };
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
    /** Seconds before her boarders go over in which R repels them (0: nothing to repel). */
    repelWindow: () => repelWindow(),
    /** She may strike any moment now (shown to the player, so a surrender can be worked for). */
    wavering: () => !state.result && !state.wreck && (beaten(state.ships.enemy) || yields(state.ships.enemy, state.ships.player)),
    /** A famous pirate is calling on the player to strike (Strike yields: she keeps her ship and men). */
    demands,
    /** The player's broadside: ready to fire, or why not. */
    aim: (broadside: Broadside) => aim('player', broadside),
    /** The enemy's guns, for her arcs on the water: her reach with the shot loaded, and each broadside's aim. */
    /** Each ship lies under the other's guns: hers fly high over the player, or the player's over her. */
    underGuns: () => ({ player: under(state.ships.enemy, state.ships.player), enemy: under(state.ships.player, state.ships.enemy) }),
    enemyGuns: () => ({ rangeTiles: reach(state.ships.enemy), port: aim('enemy', 'port'), starboard: aim('enemy', 'starboard') }),
    /** The player's guns now: a broadside's reload, how far the shot loaded reaches, and how many guns she can work. */
    gunnery: () => ({ reloadSeconds: reloadSeconds(state.ships.player), rangeTiles: reach(state.ships.player), guns: gunsManned(state.ships.player) }),
    /** Advance `ticks` thirtieths of a second. `autopilot` steers the player too (the headless runner). */
    step(ticks = 1, autopilot?: 'runner' | 'cautious' | 'aggressive') {
      for (let i = 0; i < ticks && !state.result; i++) {
        const rng = rngStream(state.rng);
        // A veering wind (the harder levels): a new slant every windShiftSeconds, drawn only when the level veers it.
        const veer = setup.difficulty?.windShiftDeg ?? 0;
        if (veer && state.tick > 0 && state.tick % Math.round(c.difficulty.windShiftSeconds * TPS) === 0) {
          state = { ...state, wind: { ...state.wind, fromDeg: normalizeDeg(setup.wind.fromDeg + rng.range(-veer, veer)) } };
        }
        for (const cmd of queue.splice(0)) apply('player', cmd, rng);
        if (state.result) break;
        // Each captain rethinks at her own pace (her seamanship); the player's helpers at a steady eight ticks.
        if (state.tick % state.ships.enemy.thinkTicks === 0) {
          const enemyRole = state.ships.enemy.role ?? 'merchant';
          if (!state.wreck) for (const cmd of steer('enemy', c.personality[enemyRole])) apply('enemy', cmd, rng, true);
        }
        if (state.tick % state.ships.player.thinkTicks === 0) {
          if (autopilot) for (const cmd of steer('player', autopilot)) apply('player', cmd, rng, true);
          else if (state.boarding && !state.wreck) for (const cmd of closeToBoard()) apply('player', cmd, rng, true);
        }

        // Sail: the world's navigation at battle pace. A jammed rudder answers the helm only rudderTurn of the ticks,
        // so she comes round that much slower; her helm stays where it was put.
        const apartBefore = distance();
        const bites = (s: BattleShip) => s.rudderUntil === undefined || seconds() >= s.rudderUntil || Math.floor((state.tick + 1) * c.raking.rudderTurn) > Math.floor(state.tick * c.raking.rudderTurn);
        const steering = { player: state.ships.player, enemy: state.ships.enemy };
        const helmed = { player: bites(steering.player) ? steering.player : { ...steering.player, helm: 0 as const }, enemy: bites(steering.enemy) ? steering.enemy : { ...steering.enemy, helm: 0 as const } };
        const moved = nav.tick({ tick: state.tick, wind: state.wind, ships: helmed } as unknown as WorldState, DT);
        const ships = moved.state.ships as Record<Side, BattleShip>;
        for (const side of ['player', 'enemy'] as const) ships[side] = { ...ships[side], helm: steering[side].helm };
        for (const side of ['player', 'enemy'] as const) {
          const s = ships[side];
          const reload = { port: Math.max(0, s.reload.port - DT), starboard: Math.max(0, s.reload.starboard - DT) };
          // Her guns run out while that broadside is loaded and bears within reach, and are run in when it doesn't:
          // a ship coming into range always shows the tell before she fires.
          const other = ships[side === 'player' ? 'enemy' : 'player'];
          const facing = Math.hypot(other.x - s.x, other.y - s.y) <= reach(s) ? bears(s, other) : undefined;
          const out = (b: Broadside) => (facing === b && reload[b] === 0 ? s.runOut[b] + DT : 0);
          ships[side] = { ...s, reload, runOut: { port: out('port'), starboard: out('starboard') } };
        }
        state = { ...state, tick: state.tick + 1, ships };
        // An order to fire given while her guns ran out: now they are, or it lapses if she no longer bears.
        for (const side of ['player', 'enemy'] as const) {
          const b = state.ships[side].firing;
          if (!b) continue;
          const now = aim(side, b);
          if (now === 'running-out') continue;
          state = { ...state, ships: { ...state.ships, [side]: { ...state.ships[side], firing: undefined } } };
          if (now === 'ready') fire(side, b, rng);
        }
        // Beyond escape range the parting clock runs while the gap widens and holds while it closes;
        // back within range it starts over, so a wide turn never ends a fight by accident.
        const apart = distance();
        if (apart <= c.battle.escapeTiles) state = { ...state, parting: 0 };
        else if (apart > apartBefore) state = { ...state, parting: state.parting + DT };
        // Hulls together: the grapples go out at boardTiles and hold until the ships part past breakTiles.
        // Lashed together, both are dragged down to grappleDrag of their way, so cutting free takes a
        // deliberate run before the boarders go over.
        if (apart > c.battle.breakTiles) state = { ...state, grappling: 0 };
        else if ((apart <= c.battle.boardTiles && (state.boarding || state.enemyBoarding)) || state.grappling > 0) {
          const drag = (s: BattleShip) => ({ ...s, speed: Math.min(s.speed, content.ships[s.classId]!.speed * c.battle.tilesPerSecondPerSpeedPoint * c.battle.grappleDrag) });
          state = {
            ...state,
            grappling: state.grappling + DT,
            // A fresh grapple: a fresh try at repelling it.
            ...(state.grappling === 0 ? { repel: undefined } : {}),
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
          const sz = sizeOf(vs.classId);
          const vr = (vs.headingDeg * Math.PI) / 180;
          const rx = at[0] - vs.x;
          const ry = at[1] - vs.y;
          const along = rx * Math.sin(vr) - ry * Math.cos(vr);
          const across = rx * Math.cos(vr) + ry * Math.sin(vr);
          const half = sz.length / 2;
          // Her waterline narrows toward bow and stern.
          // The easy levels forgive the player's near misses: her hull stands that much wider and taller to his balls.
          const slack = shot.from === 'player' ? (setup.difficulty?.nearMissTiles ?? 0) * c.battle.shipScale : 0;
          const width = sz.beam * Math.sqrt(Math.max(0, 1 - (along / (half + slack)) ** 2)) + 0.04 + slack;
          const inHull = Math.abs(along) <= half + slack && Math.abs(across) <= width && at[2] <= sz.rail + slack && at[2] > -0.05;
          const inRig = !state.wreck && Math.abs(along) <= half * 0.85 && Math.abs(across) <= sz.yard && at[2] > sz.rail && at[2] <= sz.mast;
          if (!inHull && !inRig) {
            // A near miss, within a hull's length of her, throws up a tall plume: she sees how close it came.
            if (at[2] <= 0 || k > 2) effects.push({ kind: 'splash', x: at[0], y: at[1], at: seconds(), ...(Math.hypot(rx, ry) <= sz.length ? { near: true } : {}) });
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
          // Raking: the ball flies down her length, from bow or stern, through everything in its way.
          const dx = shot.tx - shot.x;
          const dy = shot.ty - shot.y;
          const raking = Math.abs((dx * Math.sin(vr) - dy * Math.cos(vr)) / Math.max(1e-6, Math.hypot(dx, dy))) >= c.raking.cos;
          // From astern the ball flies the way she sails, in at her stern windows: the worst rake of all.
          const stern = raking && dx * Math.sin(vr) - dy * Math.cos(vr) > 0;
          if (raking) place.rake = true;
          if (stern) place.stern = true;
          const harm = (shot.power ?? 1) * (stern ? c.raking.sternDamage : raking ? c.raking.damage : 1);
          // A round shot through her stern may carry away her tiller ropes: her rudder jams for a while.
          if (stern && shot.ammo === 'round' && rng.float() < c.raking.rudderChance) place.rudder = true;
          // Canvas taken in is canvas spared: her sails and masts take the share her sail setting leaves.
          const rigHarm = harm * c.battle.sailHarm[v.sails];
          // Weight of shot against her timbers: a light ball barely marks a fortress's side, a heavy one guts a sloop's.
          // Fired down from a tall side at a ship under her guns, a ball through her rigging spares her hull, men and
          // masts (underGuns.harm); her canvas takes it as ever.
          const spared = shot.high && place.part === 'rigging' ? c.underGuns.harm : 1;
          const weight = (shot.ammo === 'round' ? shotHarmOf(content, state.ships[shot.from].classId, v.classId) : 1) * spared;
          let hurt: BattleShip = {
            ...v,
            hull: v.hull - a.hull * harm * weight,
            sailCondition: Math.max(0, v.sailCondition - a.sails * rigHarm * v.sailWear),
            crew: Math.max(0, v.crew - a.crew * harm * weight),
            guns,
            ...(place.rudder ? { rudderUntil: seconds() + c.raking.rudderSeconds } : {}),
          };
          effects.push({ kind: shot.ammo === 'grape' ? 'grape' : place.part === 'rigging' ? 'sail' : 'hit', x: at[0], y: at[1], at: seconds(), ship: victimSide, place });
          // Into her rigging: the nearest standing mast takes it, and may go by the board.
          if (place.part === 'rigging') {
            const at = content.ships[v.classId]!.masts;
            const standing = hurt.masts.map((m, i) => (m > 0 ? i : -1)).filter((i) => i >= 0);
            const i = standing.sort((p, q) => Math.abs(at[p]! - place.along) - Math.abs(at[q]! - place.along))[0];
            if (i !== undefined) {
              const masts = [...hurt.masts];
              masts[i] = Math.max(0, masts[i]! - c.masts.damage[shot.ammo]! * c.battle.sailHarm[v.sails] * spared);
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
        // Swivels and chasers fire on their own clocks.
        if (!state.wreck && !state.result) {
          const every = (sec: number) => state.tick % Math.round(sec * TPS) === 0;
          if (every(c.swivels.everySeconds)) for (const side of ['player', 'enemy'] as const) swivel(side, rng);
          if (every(c.chasers.everySeconds)) for (const side of ['player', 'enemy'] as const) chase(side, rng);
        }

        const p = state.ships.player;
        const e = state.ships.enemy;
        if (state.wreck) {
          // Picking over the wreck: nothing more to fight, until the time is up or nothing is left.
          const wreck = salvage(state.wreck, p);
          state = { ...state, wreck, grappling: 0, parting: 0 };
          if (seconds() >= wreck.until || (!wreck.barrels.length && !wreck.survivors.length)) end('sunk');
        } else if (e.hull <= 0) sink(e, rng);
        else if (p.hull <= 0) end('lost');
        // (Less a hair: the grapple's seconds are summed a frame at a time.)
        else if (state.grappling >= c.battle.grappleSeconds - 1e-6) {
          // Boarding: crews with their fighting spirit; the stronger side carries the deck, both bleed.
          const ps = p.crew * c.boarding.player * spirit(p) * p.boardMult * p.boardingDefence * nets(p, 'player');
          const es = e.crew * c.boarding[e.role ?? 'merchant'] * spirit(e) * e.boardMult * e.boardingDefence * nets(e, 'enemy');
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
          else if (beaten(e) && rng.float() < strikeChance(e, p)) end('struck');
        }
        state = { ...state, rng: rng.state() };
      }
    },
  };
}

export type Battle = ReturnType<typeof createBattle>;
