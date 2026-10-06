import type { EmittedEvent, Ship, System, Tack, Wind, WorldState } from '@corsair/core';
import { isLand, shipStats, startOf, tileAt } from '@corsair/data';
import type { ContentPack, MapDef, Polar, TileMap } from '@corsair/data';

export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Smallest angle between heading and the wind's FROM direction: 0 = head to wind, 180 = running. */
export function angleOffWind(headingDeg: number, windFromDeg: number): number {
  const d = Math.abs(normalizeDeg(headingDeg - windFromDeg));
  return d > 180 ? 360 - d : d;
}

/** Linear interpolation over the polar table, which spans 0 to 180 degrees. */
export function polarAt(polar: Polar, offWindDeg: number): number {
  const pos = offWindDeg / polar.stepDeg;
  const i = Math.min(Math.floor(pos), polar.values.length - 2);
  const t = pos - i;
  return polar.values[i]! * (1 - t) + polar.values[i + 1]! * t;
}

export function pointOfSail(content: ContentPack, offWindDeg: number) {
  const points = content.navigation.pointsOfSail;
  return points.find((p) => offWindDeg <= p.maxDeg) ?? points[points.length - 1]!;
}

/**
 * Speed the ship settles at on its current heading, in tiles per second (PRD section 4):
 * v = v_base * P(theta) * W_s * sail setting. Hull, crew, load and current are not modelled yet.
 */
/** How a ship's condition slows her (PRD section 7): shot-through sails draw less, and a hull below 30% drags. */
export function conditionFactor(content: ContentPack, ship: Ship): number {
  const sails = 0.3 + 0.7 * ((ship.sailCondition ?? 100) / 100);
  const hull = ship.hull !== undefined && ship.hull < shipStats(content, ship).hullMax * 0.3 ? 0.8 : 1;
  return sails * hull;
}

export function targetSpeed(content: ContentPack, ship: Ship, wind: Wind): number {
  const nav = content.navigation;
  const cls = content.ships[ship.classId]!;
  const stats = shipStats(content, ship);
  // Better sails (upwindDeg) draw as if she were that much further off the wind, up to a beam reach.
  const off = angleOffWind(ship.headingDeg, wind.fromDeg);
  const drawn = off < 90 ? Math.min(90, off + stats.upwindDeg) : off;
  return (
    stats.speed *
    nav.tilesPerSecondPerSpeedPoint *
    polarAt(content.polars[cls.polar]!, drawn) *
    nav.windStrength[wind.strength]! *
    nav.sailSettings[ship.sails]! *
    conditionFactor(content, ship)
  );
}

/**
 * The angle off the wind that makes the most ground toward it (best velocity made good).
 * Holding this course on alternate tacks is the fastest way to windward.
 */
export function bestUpwindDeg(polar: Polar): number {
  let best = { deg: 90, vmg: 0 };
  for (let deg = 0; deg <= 90; deg += 0.5) {
    const vmg = polarAt(polar, deg) * Math.cos((deg * Math.PI) / 180);
    if (vmg > best.vmg) best = { deg, vmg };
  }
  return best.deg;
}

/** Which tack a ship is on in this wind. */
export function tackOf(headingDeg: number, windFromDeg: number): Tack {
  const rel = normalizeDeg(windFromDeg - headingDeg);
  return rel <= 180 ? 'starboard' : 'port';
}

/** Tiles per second on the ship class's 1-10 speed scale, for the HUD. */
export function toSpeedPoints(content: ContentPack, tilesPerSecond: number): number {
  return tilesPerSecond / content.navigation.tilesPerSecondPerSpeedPoint;
}

/** Speed on the ship class's 1-10 scale, for the HUD. */
export function speedPoints(content: ContentPack, ship: Ship): number {
  return ship.speed / content.navigation.tilesPerSecondPerSpeedPoint;
}

/**
 * Each tick a ship eases toward `targetSpeed`, turns by its helm, and moves; land stops or slides it.
 * Shallows are drawn but don't block; draft checks come with the real map.
 */
export function createNavigationSystem(
  content: ContentPack,
  map: TileMap,
  windAt: (state: WorldState, x: number, y: number) => Wind = (state) => state.wind,
): System {
  const nav = content.navigation;
  const bestUpwind = new Map<string, number>();
  const upwindOf = (polarId: string) => {
    if (!bestUpwind.has(polarId)) bestUpwind.set(polarId, bestUpwindDeg(content.polars[polarId]!));
    return bestUpwind.get(polarId)!;
  };

  const sail = (ship: Ship, state: WorldState, dt: number): { ship: Ship; events: EmittedEvent[] } => {
    // A ship in port stays put until it undocks.
    if (ship.docked) return { ship, events: [] };
    const cls = content.ships[ship.classId]!;
    const wind = windAt(state, ship.x, ship.y);
    const target = targetSpeed(content, ship, wind);
    // Way is gathered at accelPerSecond and, where set, lost more slowly: a ship carries her way.
    const rate = target < ship.speed ? (nav.decelPerSecond ?? nav.accelPerSecond) : nav.accelPerSecond;
    const speed = ship.speed + (target - ship.speed) * Math.min(1, rate * dt);
    const turnRate = cls.turn * nav.turnDegPerSecondPerPoint * nav.rigTurnFactor[cls.rig]!;
    let headingDeg = normalizeDeg(ship.headingDeg + ship.helm * turnRate * dt);
    if (ship.assist) {
      // Steer toward the best upwind course on the chosen tack at the normal turn rate, so the
      // ship follows the wind as it shifts. Starboard tack keeps the wind on the starboard side.
      const off = upwindOf(cls.polar);
      const goal = ship.assist.tack === 'starboard' ? wind.fromDeg - off : wind.fromDeg + off;
      const diff = ((normalizeDeg(goal - ship.headingDeg) + 540) % 360) - 180;
      const step = turnRate * dt;
      headingDeg = normalizeDeg(ship.headingDeg + Math.max(-step, Math.min(step, diff)));
    }

    const rad = (headingDeg * Math.PI) / 180;
    const dx = Math.sin(rad) * speed * dt;
    const dy = -Math.cos(rad) * speed * dt;
    const water = (px: number, py: number) => !isLand(tileAt(map, px, py));
    if (water(ship.x + dx, ship.y + dy)) {
      // Contact ends only once land is no longer just ahead; otherwise a ship nosing the coast
      // would flip in and out of contact every tick and repeat ShipBlocked.
      const blocked = ship.blocked && !water(ship.x + dx + Math.sin(rad) * 0.5, ship.y + dy - Math.cos(rad) * 0.5);
      return { ship: { ...ship, x: ship.x + dx, y: ship.y + dy, headingDeg, speed, blocked }, events: [] };
    }

    // Against land the ship slides along the coast on whichever axis is still water. Stopping dead
    // instead softlocks a ship whose only seaward headings are in irons. Speed stays the speed
    // through the water; only the blocked component of the move is lost.
    // Try the axis with the larger move first. In a concave corner of the tile coast both are
    // land and the ship holds position until it turns away.
    const axes: [number, number][] = Math.abs(dx) >= Math.abs(dy) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
    const free = axes.find(([ax, ay]) => (ax !== 0 || ay !== 0) && water(ship.x + ax, ship.y + ay));
    const [x, y] = free ? [ship.x + free[0], ship.y + free[1]] : [ship.x, ship.y];
    const events: EmittedEvent[] = ship.blocked
      ? []
      : [{ type: 'ShipBlocked', entityIds: [ship.id], payload: { x, y, headingDeg } }];
    return { ship: { ...ship, x, y, headingDeg, speed, blocked: true }, events };
  };

  return {
    name: 'navigation',
    command(state, command) {
      if (command.type === 'SetWind') {
        const wind = { fromDeg: normalizeDeg(command.fromDeg), strength: command.strength };
        return { state: { ...state, wind }, events: [{ type: 'WindChanged', entityIds: [], payload: { ...wind } }] };
      }
      if (command.type === 'SetHelm') {
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        // Steering by hand takes over from the assist.
        const { assist, ...rest } = ship;
        const next = command.helm === 0 ? { ...ship, helm: 0 as const } : { ...rest, helm: command.helm };
        const events: EmittedEvent[] =
          assist && command.helm !== 0 ? [{ type: 'AssistEnded', entityIds: [ship.id], payload: {} }] : [];
        return { state: { ...state, ships: { ...state.ships, [ship.id]: next } }, events };
      }
      if (command.type === 'SetAssist') {
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        const { assist: _previous, ...rest } = ship;
        if (command.assist === 'off') {
          return { state: { ...state, ships: { ...state.ships, [ship.id]: rest } }, events: [] };
        }
        const current: Tack = ship.assist?.tack ?? tackOf(ship.headingDeg, windAt(state, ship.x, ship.y).fromDeg);
        const tack: Tack = command.assist === 'tack' ? (current === 'port' ? 'starboard' : 'port') : current;
        const next = { ...rest, helm: 0 as const, assist: { mode: 'beat' as const, tack } };
        return {
          state: { ...state, ships: { ...state.ships, [ship.id]: next } },
          events: [{ type: 'AssistSet', entityIds: [ship.id], payload: { assist: command.assist, tack } }],
        };
      }
      if (command.type === 'Teleport') {
        const ship = state.ships[command.shipId];
        if (!ship || ship.docked || isLand(tileAt(map, command.x, command.y))) return undefined;
        const moved = { ...ship, x: command.x, y: command.y, speed: 0, blocked: false };
        return { state: { ...state, ships: { ...state.ships, [ship.id]: moved } }, events: [{ type: 'Teleported', entityIds: [ship.id], payload: {} }] };
      }
      if (command.type === 'SetSails') {
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        const ships = { ...state.ships, [ship.id]: { ...ship, sails: command.sails } };
        return { state: { ...state, ships }, events: [{ type: 'SailsSet', entityIds: [ship.id], payload: { sails: command.sails } }] };
      }
      return undefined;
    },
    tick(state, dt) {
      const ships: Record<string, Ship> = {};
      const events: EmittedEvent[] = [];
      for (const id of Object.keys(state.ships).sort()) {
        // AI ships follow sea lanes; the traffic system moves them.
        if (state.ships[id]!.ai) {
          ships[id] = state.ships[id]!;
          continue;
        }
        const result = sail(state.ships[id]!, state, dt);
        ships[id] = result.ship;
        events.push(...result.events);
      }
      return { state: { ...state, ships }, events };
    },
  };
}

/** Initial world for a map: the player's ship at the map's start, at rest. */
export function createWorld(def: MapDef): WorldState {
  const { start, wind } = def;
  const at = startOf(def);
  const ship: Ship = {
    id: start.shipId,
    classId: start.classId,
    x: at.x,
    y: at.y,
    headingDeg: start.headingDeg,
    speed: 0,
    helm: 0,
    sails: 'full',
    blocked: false,
    cargo: {},
    ...(start.guns !== undefined ? { guns: start.guns } : {}),
  };
  return { tick: 0, wind: { ...wind }, ships: { [ship.id]: ship } };
}
