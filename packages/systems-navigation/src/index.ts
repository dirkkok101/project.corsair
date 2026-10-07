import { inPort } from '@corsair/core';
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
  return sails * hull * handsFactor(content, ship);
}

/**
 * Short-handed: below her class's minimum crew a ship sails and turns slower, in proportion, down to
 * crew.json's floor (Pirates!: fewer men than she needs, and she is slower). A ship with no count has her crew.
 */
export function handsFactor(content: ContentPack, ship: Ship): number {
  const min = content.ships[ship.classId]!.minCrew;
  if (ship.crew === undefined || ship.crew >= min) return 1;
  return Math.max(content.crew.shortHandedFloor, ship.crew / min);
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
/** A course to a point ends this near it; to a port (x, y the town, the route ending at its berth), within
 * docking range of the town, so the game can dock her. */
const COURSE_ARRIVE_TILES = 1.5;
const PORT_ARRIVE_TILES = 2.9;
/** How far ahead an assisted course looks for land to steer around. */
const COAST_LOOK_TILES = 8;
/** A course pressed against land this long (3 s) hands back the helm. */
const COURSE_AGROUND_TICKS = 90;
/** A waypoint counts as passed this near. */
const WAYPOINT_TILES = 3;
const LAST_WAYPOINT_TILES = 1;

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

  const bearingTo = (ship: Ship, x: number, y: number) => normalizeDeg((Math.atan2(x - ship.x, -(y - ship.y)) * 180) / Math.PI);
  /** Water all the way along the line, sampled every half tile. */
  const lineClear = (ship: Ship, [x, y]: [number, number]) => {
    const n = Math.ceil(Math.hypot(x - ship.x, y - ship.y) * 2);
    for (let i = 1; i <= n; i++) if (isLand(tileAt(map, ship.x + ((x - ship.x) * i) / n, ship.y + ((y - ship.y) * i) / n))) return false;
    return true;
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
    const turnRate = cls.turn * nav.turnDegPerSecondPerPoint * nav.rigTurnFactor[cls.rig]! * handsFactor(content, ship);
    let headingDeg = normalizeDeg(ship.headingDeg + ship.helm * turnRate * dt);
    let assist = ship.assist;
    const events: EmittedEvent[] = [];
    if (assist) {
      // Steer toward the best upwind course on the chosen tack at the normal turn rate, so the
      // ship follows the wind as it shifts. Starboard tack keeps the wind on the starboard side.
      // Better sails (upwindDeg) let her point that much higher.
      const off = Math.max(0, upwindOf(cls.polar) - shipStats(content, ship).upwindDeg);
      const closeHauled = (tack: Tack) => normalizeDeg(tack === 'starboard' ? wind.fromDeg - off : wind.fromDeg + off);
      let goal: number | undefined = closeHauled(assist.tack);
      // Where an intercept or a course wants to go, and how near counts as there.
      let want: number | undefined;
      let left = Infinity;
      if (assist.mode === 'intercept') {
        const them = assist.targetId ? state.ships[assist.targetId] : undefined;
        if (!them || inPort(them)) {
          // She's gone, or into port: hand the helm back.
          assist = undefined;
          goal = undefined;
          events.push({ type: 'AssistEnded', entityIds: [ship.id], payload: { reason: 'target-gone' } });
        } else {
          // Lead her: aim where she will be by the time we could get there, looking no more than a minute ahead.
          const eta = Math.min(60, Math.hypot(them.x - ship.x, them.y - ship.y) / Math.max(0.5, speed));
          const r = (them.headingDeg * Math.PI) / 180;
          const ax = them.x + Math.sin(r) * them.speed * eta;
          const ay = them.y - Math.cos(r) * them.speed * eta;
          want = bearingTo(ship, ax, ay);
          left = Math.hypot(them.x - ship.x, them.y - ship.y);
        }
      } else if (assist.mode === 'course' && assist.x !== undefined && assist.y !== undefined) {
        const [tx, ty, portId] = [assist.x, assist.y, assist.portId];
        // Waypoints first: on to the next one once she's close, or as soon as she has a clear line past it.
        let route = assist.route ?? [];
        // The last waypoint (a port's berth) must be reached, not just neared: from there the town is in reach.
        const passed = (n: number) => (n > 1 ? WAYPOINT_TILES : LAST_WAYPOINT_TILES);
        while (route.length && (Math.hypot(route[0]![0] - ship.x, route[0]![1] - ship.y) <= passed(route.length) || (route.length > 1 && lineClear(ship, route[1]!)))) {
          route = route.slice(1);
        }
        if (route !== assist.route) assist = { ...assist, route };
        left = Math.hypot(tx - ship.x, ty - ship.y);
        // Bound for a port, she has arrived the moment it's in reach, whatever waypoints are left: beating up
        // to a berth to windward she may pass it on every board without ever touching it.
        if (portId && left <= PORT_ARRIVE_TILES) route = [];
        if (route.length) {
          want = bearingTo(ship, route[0]![0], route[0]![1]);
          // Past a waypoint lies more sea, so the coast watch looks a little beyond it; past a port's berth
          // lies the town, which isn't a coast to steer off.
          const beyond = portId && route.length === 1 ? 0 : WAYPOINT_TILES * 2;
          left = Math.hypot(route[0]![0] - ship.x, route[0]![1] - ship.y) + beyond;
        } else if (left <= (portId ? PORT_ARRIVE_TILES : COURSE_ARRIVE_TILES)) {
          // Arrived: hold this heading and hand back the helm (the game docks her if it was a port).
          events.push({ type: 'CourseArrived', entityIds: [ship.id], payload: { x: tx, y: ty, portId } });
          assist = undefined;
          goal = undefined;
        } else want = bearingTo(ship, tx, ty);
      }
      if (assist && want !== undefined) {
        const aim = want;
        // Keep her off the coast: land within `look` tiles ahead on a heading (unless the goal is right there).
        const look = Math.min(COAST_LOOK_TILES, left - 1);
        const clear = (h: number) => {
          if (look < 1) return true;
          const r = (h * Math.PI) / 180;
          for (let k = 1; k <= look; k++) if (isLand(tileAt(map, ship.x + Math.sin(r) * k, ship.y - Math.cos(r) * k))) return false;
          return true;
        };
        if (angleOffWind(aim, wind.fromDeg) >= off) goal = aim;
        else {
          // Upwind of us: beat, holding the tack until the way lies well over on the other side of the wind
          // (about 20 degrees past dead upwind), so a near target doesn't set her tacking back and forth;
          // and, as any sailor would, go about early when the coast closes in ahead and the other tack is open.
          const apart = (h: number) => Math.abs(((h - aim + 540) % 360) - 180);
          const other: Tack = assist.tack === 'port' ? 'starboard' : 'port';
          // (Never onto a tack the shore already blocks: that would fight the shore rule and leave her in irons.)
          const better = apart(closeHauled(other)) + 40 < apart(closeHauled(assist.tack)) && clear(closeHauled(other));
          const shoreAhead = !clear(closeHauled(assist.tack)) && clear(closeHauled(other));
          const tack = better || shoreAhead ? other : assist.tack;
          assist = { ...assist, tack };
          goal = closeHauled(tack);
        }
        if (goal !== undefined && !clear(goal)) {
          // The nearest heading either way that is clear and that she can sail (never into irons).
          const g = goal;
          const sailable = (h: number) => angleOffWind(h, wind.fromDeg) >= off;
          goal =
            [15, -15, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90, 120, -120, 150, -150]
              .map((d) => normalizeDeg(g + d))
              .find((h) => sailable(h) && clear(h)) ?? g;
        }
      }
      if (goal !== undefined) {
        const diff = ((normalizeDeg(goal - ship.headingDeg) + 540) % 360) - 180;
        const step = turnRate * dt;
        headingDeg = normalizeDeg(ship.headingDeg + Math.max(-step, Math.min(step, diff)));
      }
    }
    const steered: Ship = assist ? { ...ship, assist } : (({ assist: _a, ...rest }) => rest)(ship);

    const rad = (headingDeg * Math.PI) / 180;
    const dx = Math.sin(rad) * speed * dt;
    const dy = -Math.cos(rad) * speed * dt;
    const water = (px: number, py: number) => !isLand(tileAt(map, px, py));
    if (water(ship.x + dx, ship.y + dy)) {
      // Contact ends only once land is no longer just ahead; otherwise a ship nosing the coast
      // would flip in and out of contact every tick and repeat ShipBlocked.
      const blocked = ship.blocked && !water(ship.x + dx + Math.sin(rad) * 0.5, ship.y + dy - Math.cos(rad) * 0.5);
      const free = steered.assist?.aground ? { ...steered, assist: { ...steered.assist, aground: 0 } } : steered;
      return { ship: { ...free, x: ship.x + dx, y: ship.y + dy, headingDeg, speed, blocked }, events };
    }

    // Against land the ship slides along the coast on whichever axis is still water. Stopping dead
    // instead softlocks a ship whose only seaward headings are in irons. Speed stays the speed
    // through the water; only the blocked component of the move is lost.
    // Try the axis with the larger move first. In a concave corner of the tile coast both are
    // land and the ship holds position until it turns away.
    const axes: [number, number][] = Math.abs(dx) >= Math.abs(dy) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
    const free = axes.find(([ax, ay]) => (ax !== 0 || ay !== 0) && water(ship.x + ax, ship.y + ay));
    const [x, y] = free ? [ship.x + free[0], ship.y + free[1]] : [ship.x, ship.y];
    if (!ship.blocked) events.push({ type: 'ShipBlocked', entityIds: [ship.id], payload: { x, y, headingDeg } });
    // A course that can't find its way (a channel too narrow to beat up) gives up rather than grind.
    if (steered.assist?.mode === 'course') {
      const aground = (steered.assist.aground ?? 0) + 1;
      if (aground > COURSE_AGROUND_TICKS) {
        const { assist: _gone, ...rest } = steered;
        events.push({ type: 'AssistEnded', entityIds: [ship.id], payload: { reason: 'aground' } });
        return { ship: { ...rest, x, y, headingDeg, speed, blocked: true }, events };
      }
      return { ship: { ...steered, assist: { ...steered.assist, aground }, x, y, headingDeg, speed, blocked: true }, events };
    }
    return { ship: { ...steered, x, y, headingDeg, speed, blocked: true }, events };
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
        if (command.assist === 'course') {
          if (command.x === undefined || command.y === undefined) return undefined;
          const course = {
            mode: 'course' as const,
            tack: current,
            x: command.x,
            y: command.y,
            ...(command.portId ? { portId: command.portId } : {}),
            ...(command.route?.length ? { route: command.route } : {}),
          };
          const next = { ...rest, helm: 0 as const, assist: course };
          return {
            state: { ...state, ships: { ...state.ships, [ship.id]: next } },
            events: [{ type: 'AssistSet', entityIds: [ship.id], payload: { assist: 'course', x: command.x, y: command.y, portId: command.portId } }],
          };
        }
        if (command.assist === 'intercept') {
          const them = command.targetId ? state.ships[command.targetId] : undefined;
          if (!them || them.id === ship.id) return undefined;
          const next = { ...rest, helm: 0 as const, assist: { mode: 'intercept' as const, tack: current, targetId: them.id } };
          return {
            state: { ...state, ships: { ...state.ships, [ship.id]: next } },
            events: [{ type: 'AssistSet', entityIds: [ship.id, them.id], payload: { assist: 'intercept' } }],
          };
        }
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
