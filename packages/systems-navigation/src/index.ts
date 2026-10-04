import type { EmittedEvent, Ship, System, Wind, WorldState } from '@corsair/core';
import { isLand, startOf, tileAt } from '@corsair/data';
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
export function targetSpeed(content: ContentPack, ship: Ship, wind: Wind): number {
  const nav = content.navigation;
  const cls = content.ships[ship.classId]!;
  return (
    cls.speed *
    nav.tilesPerSecondPerSpeedPoint *
    polarAt(content.polars[cls.polar]!, angleOffWind(ship.headingDeg, wind.fromDeg)) *
    nav.windStrength[wind.strength]! *
    nav.sailSettings[ship.sails]!
  );
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
export function createNavigationSystem(content: ContentPack, map: TileMap): System {
  const nav = content.navigation;

  const sail = (ship: Ship, state: WorldState, dt: number): { ship: Ship; events: EmittedEvent[] } => {
    const cls = content.ships[ship.classId]!;
    const target = targetSpeed(content, ship, state.wind);
    const speed = ship.speed + (target - ship.speed) * Math.min(1, nav.accelPerSecond * dt);
    const turnRate = cls.turn * nav.turnDegPerSecondPerPoint * nav.rigTurnFactor[cls.rig]!;
    const headingDeg = normalizeDeg(ship.headingDeg + ship.helm * turnRate * dt);

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
        return { state: { ...state, ships: { ...state.ships, [ship.id]: { ...ship, helm: command.helm } } }, events: [] };
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
  };
  return { tick: 0, wind: { ...wind }, ships: { [ship.id]: ship } };
}
