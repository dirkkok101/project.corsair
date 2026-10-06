import { rngStream, seedRng } from '@corsair/core';
import type { AiCaptain, BattleResult, Command, RngState, Ship, Wind, WorldState } from '@corsair/core';
import { isLand, tileAt } from '@corsair/data';
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
}

/** A ball in flight: it lands at (tx, ty) after `t` seconds, and hits only if `hit`. */
export interface Shot {
  from: Side;
  x: number;
  y: number;
  tx: number;
  ty: number;
  t: number;
  flight: number;
  hit: boolean;
  ammo: Ammo;
}

/** Something for the view to draw for a moment: smoke at the guns, a splash, splinters. */
export interface BattleEffect {
  kind: 'smoke' | 'splash' | 'hit' | 'sail';
  x: number;
  y: number;
  /** Battle seconds when it happened. */
  at: number;
}

export interface BattleState {
  tick: number;
  /** Seconds the ships have been drawing apart beyond escape range; at battle.escapeSeconds one gets away. */
  parting: number;
  wind: Wind;
  ships: Record<Side, BattleShip>;
  shots: Shot[];
  effects: BattleEffect[];
  rng: RngState;
  result?: BattleResult;
}

export type BattleCommand =
  | Extract<Command, { type: 'SetHelm' | 'SetSails' | 'SetAssist' }>
  | { type: 'Fire'; side: Broadside }
  | { type: 'SetAmmo'; ammo: Ammo };

export interface BattleSetup {
  map: TileMap;
  wind: Wind;
  player: Ship;
  enemy: Ship;
  seed: number;
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
  // Battle pace: the same sailing model, slower, so a crossing takes long enough to fight in.
  const battleContent: ContentPack = {
    ...content,
    navigation: { ...content.navigation, tilesPerSecondPerSpeedPoint: c.battle.tilesPerSecondPerSpeedPoint },
  };
  const nav = createNavigationSystem(battleContent, setup.map, () => setup.wind);
  const water = (x: number, y: number) => !isLand(tileAt(setup.map, x, y));
  const rng0 = rngStream(seedRng(setup.seed, 'battle'));

  const arm = (ship: Ship, side: Side): BattleShip => {
    const cls = content.ships[ship.classId]!;
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
      hull: ship.hull ?? cls.hull,
      sailCondition: ship.sailCondition ?? 100,
      crew,
      hullMax: cls.hull,
      crewStart: crew,
      guns: cls.guns,
      reload: { port: 0, starboard: 0 },
      ammo: 'round',
      role: ship.ai?.role,
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
  let state: BattleState = {
    tick: 0,
    parting: 0,
    wind: setup.wind,
    ships: {
      player: { ...arm(setup.player, 'player'), x: mid.x, y: mid.y },
      enemy: { ...arm(setup.enemy, 'enemy'), ...enemyAt },
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
    // Short-handed, every broadside takes longer: the crew is split between the guns.
    const needed = (ship.guns * c.guns.crewPerGun) / 2;
    return c.guns.reloadSeconds * Math.max(1, needed / Math.max(1, ship.crew));
  };

  /** Whether a broadside can fire now, and if not, why: the HUD shows it so a refused shot never puzzles. */
  const aim = (side: Side, broadside: Broadside): Aim => {
    const ship = state.ships[side];
    const target = state.ships[side === 'player' ? 'enemy' : 'player'];
    if (ship.guns < 2) return 'no-guns';
    if (ship.reload[broadside] > 0) return 'loading';
    if (bears(ship, target) !== broadside) return 'no-target';
    if (distance() > (c.ammo[ship.ammo]!.short ? c.guns.grapeTiles : c.guns.rangeTiles)) return 'out-of-range';
    return 'ready';
  };

  const fire = (side: Side, broadside: Broadside, rng: ReturnType<typeof rngStream>) => {
    const ship = state.ships[side];
    const target = state.ships[side === 'player' ? 'enemy' : 'player'];
    const d = distance();
    if (aim(side, broadside) !== 'ready') return;
    // Raking fire runs along the target's length (bow or stern on), where a ball does the most harm.
    const along = Math.abs(Math.cos(((bearing(ship, target) - target.headingDeg) * Math.PI) / 180));
    const near = 1 - Math.min(1, d / c.guns.rangeTiles);
    const hitChance = Math.min(0.95, (c.guns.hitFar + (c.guns.hitNear - c.guns.hitFar) * near) * (1 + c.guns.rakeBonus * along));
    const shots: Shot[] = [];
    const flight = d / c.guns.shotTilesPerSecond;
    for (let g = 0; g < Math.floor(ship.guns / 2); g++) {
      const hit = rng.float() < hitChance;
      // Misses fall short, long or wide by up to a tile and a half.
      const spread = hit ? 0.4 : 1.5;
      shots.push({
        from: side,
        x: ship.x,
        y: ship.y,
        tx: target.x + (rng.float() - 0.5) * 2 * spread,
        ty: target.y + (rng.float() - 0.5) * 2 * spread,
        t: flight,
        flight,
        hit,
        ammo: ship.ammo,
      });
    }
    state = {
      ...state,
      ships: { ...state.ships, [side]: { ...ship, reload: { ...ship.reload, [broadside]: reloadSeconds(ship) } } },
      shots: [...state.shots, ...shots],
      effects: [...state.effects, { kind: 'smoke', x: ship.x, y: ship.y, at: seconds() }],
    };
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
    else if (personality === 'aggressive' && me.crew > them.crew * 1.2) want = toThem; // close to board
    else if (d > c.guns.rangeTiles * 0.8) want = toThem;
    else if (personality === 'cautious' && d < c.guns.rangeTiles * 0.5) want = toThem + 180;
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
    const ammo: Ammo = personality === 'aggressive' ? (d <= c.guns.grapeTiles ? 'grape' : 'chain') : 'round';
    if (me.ammo !== ammo) cmds.push({ type: 'SetAmmo', ammo });
    const side2 = bears(me, them);
    if (side2) cmds.push({ type: 'Fire', side: side2 });
    return cmds;
  };

  const apply = (side: Side, cmd: BattleCommand, rng: ReturnType<typeof rngStream>) => {
    if (cmd.type === 'Fire') return fire(side, cmd.side, rng);
    if (cmd.type === 'SetAmmo') {
      const ship = state.ships[side];
      if (ship.ammo === cmd.ammo) return;
      // Drawing the loads costs a reload on both broadsides.
      const r = reloadSeconds(ship);
      state = { ...state, ships: { ...state.ships, [side]: { ...ship, ammo: cmd.ammo, reload: { port: r, starboard: r } } } };
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
      x: s.x,
      y: s.y,
      headingDeg: s.headingDeg,
    });
    state = { ...state, result: { outcome, player: strip(state.ships.player), enemy: strip(state.ships.enemy) } };
  };

  return {
    get state() {
      return state;
    },
    send(cmd: BattleCommand) {
      queue.push(cmd);
    },
    result: () => state.result,
    /** The player's broadside: ready to fire, or why not. */
    aim: (broadside: Broadside) => aim('player', broadside),
    /** Advance `ticks` thirtieths of a second. `autopilot` steers the player too (the headless runner). */
    step(ticks = 1, autopilot?: 'runner' | 'cautious' | 'aggressive') {
      for (let i = 0; i < ticks && !state.result; i++) {
        const rng = rngStream(state.rng);
        for (const cmd of queue.splice(0)) apply('player', cmd, rng);
        if (state.tick % AI_THINK_TICKS === 0) {
          const enemyRole = state.ships.enemy.role ?? 'merchant';
          for (const cmd of steer('enemy', c.personality[enemyRole])) apply('enemy', cmd, rng);
          if (autopilot) for (const cmd of steer('player', autopilot)) apply('player', cmd, rng);
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

        // Balls land: a hit does its ammo's damage, a miss throws up a splash.
        const flying: Shot[] = [];
        const effects = state.effects.filter((e) => seconds() - e.at < EFFECT_SECONDS);
        for (const shot of state.shots) {
          const t = shot.t - DT;
          if (t > 0) {
            flying.push({ ...shot, t });
            continue;
          }
          const victimSide: Side = shot.from === 'player' ? 'enemy' : 'player';
          if (!shot.hit) {
            effects.push({ kind: 'splash', x: shot.tx, y: shot.ty, at: seconds() });
            continue;
          }
          const v = state.ships[victimSide];
          const a = c.ammo[shot.ammo]!;
          const guns = shot.ammo === 'round' && rng.float() < c.gunLoss ? Math.max(0, v.guns - 1) : v.guns;
          state = {
            ...state,
            ships: {
              ...state.ships,
              [victimSide]: {
                ...v,
                hull: v.hull - a.hull,
                sailCondition: Math.max(0, v.sailCondition - a.sails),
                crew: Math.max(0, v.crew - a.crew),
                guns,
              },
            },
          };
          effects.push({ kind: a.sails > a.hull ? 'sail' : 'hit', x: shot.tx, y: shot.ty, at: seconds() });
        }
        state = { ...state, shots: flying, effects };

        const p = state.ships.player;
        const e = state.ships.enemy;
        if (e.hull <= 0) end('sunk');
        else if (p.hull <= 0) end('lost');
        else if (distance() <= c.battle.boardTiles) {
          // Boarding: crews with their fighting spirit; the stronger side carries the deck, both bleed.
          const ps = p.crew * c.boarding.player;
          const es = e.crew * c.boarding[e.role ?? 'merchant'];
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
          // Once a second a beaten enemy may haul down her colours.
          const beaten = e.hull < e.hullMax * c.strike.hull || e.crew < e.crewStart * c.strike.crew;
          if (beaten && rng.float() < c.strike.chance) end('struck');
        }
        state = { ...state, rng: rng.state() };
      }
    },
  };
}

export type Battle = ReturnType<typeof createBattle>;
