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
 * v = v_base * P(theta) * W_s * sail setting, slowed by shot-through sails, a hull below 30% and too few hands
 * (conditionFactor). Load and current are not modelled yet.
 */
/** How a ship's condition slows her (PRD section 7): shot-through sails draw less, and a hull below 30% drags. */
export function conditionFactor(content: ContentPack, ship: Pick<Ship, 'classId' | 'sailCondition' | 'hull' | 'crew' | 'guns' | 'upgrades' | 'fouling'>): number {
  const floor = content.navigation.tornSailsFloor;
  const sails = floor + (1 - floor) * ((ship.sailCondition ?? 100) / 100);
  const hull = ship.hull !== undefined && ship.hull < shipStats(content, ship).hullMax * 0.3 ? 0.8 : 1;
  // A foul bottom drags (economy.json fouling): careening cleans it.
  return sails * hull * handsFactor(content, ship) * (1 - (ship.fouling ?? 0));
}

/**
 * Short-handed: below her class's minimum crew a ship sails and turns slower, in proportion, down to
 * crew.json's floor (Pirates!: fewer men than she needs, and she is slower). A ship with no count has her crew.
 */
export function handsFactor(content: ContentPack, ship: Pick<Ship, 'classId' | 'crew'>): number {
  const min = content.ships[ship.classId]!.minCrew;
  if (ship.crew === undefined || ship.crew >= min) return 1;
  return Math.max(content.crew.shortHandedFloor, ship.crew / min);
}

export function targetSpeed(content: ContentPack, ship: Ship, wind: Wind): number {
  const nav = content.navigation;
  const stats = shipStats(content, ship);
  // Better sails (upwindDeg) draw as if she were that much further off the wind, up to a beam reach.
  const off = angleOffWind(ship.headingDeg, wind.fromDeg);
  const drawn = off < 90 ? Math.min(90, off + stats.upwindDeg) : off;
  const sailing = stats.speed * nav.tilesPerSecondPerSpeedPoint * windShare(content, ship, drawn, wind) * nav.sailSettings[ship.sails]! * conditionFactor(content, ship);
  // Oars: in a calm, or dead into the wind, her men row her at a steady share of her top speed (as many as she has hands for).
  return Math.max(sailing, rowingSpeed(content, ship));
}

/**
 * Her pace under oars (her class's, or sweeps): a share of her top speed, with full pace wanting crew.json rowers'
 * share of her full crew at the oars, slower in proportion with fewer (none: she can't row).
 */
export function rowingSpeed(content: ContentPack, ship: Ship): number {
  const stats = shipStats(content, ship);
  if (!stats.oars) return 0;
  const rowers = Math.min(1, (ship.crew ?? stats.maxCrew) / Math.max(1, stats.maxCrew * content.crew.rowers.share));
  return stats.speed * content.navigation.tilesPerSecondPerSpeedPoint * stats.oars * rowers;
}

/** Whether she is making her way at the oars: they drive her faster than her sails on this wind. */
export function atTheOars(content: ContentPack, ship: Ship, wind: Wind): boolean {
  return rowingSpeed(content, ship) > sailingSpeed(content, ship, wind);
}

/** Her pace under sail alone on this wind (rowing aside): whether her men are at the sweeps rather than the guns. */
export function sailingSpeed(content: ContentPack, ship: Ship, wind: Wind): number {
  const nav = content.navigation;
  const stats = shipStats(content, ship);
  const off = angleOffWind(ship.headingDeg, wind.fromDeg);
  const drawn = off < 90 ? Math.min(90, off + stats.upwindDeg) : off;
  return stats.speed * nav.tilesPerSecondPerSpeedPoint * windShare(content, ship, drawn, wind) * nav.sailSettings[ship.sails]! * conditionFactor(content, ship);
}

/**
 * The wind's share of her top speed: by her point of sail (`drawn` degrees off it) and its strength; lifted for a
 * captain who sails with the gentle wind (navigation.json gentleWind), so any heading and a calm still make way.
 */
function windShare(content: ContentPack, ship: Ship, drawn: number, wind: Wind): number {
  const nav = content.navigation;
  const polar = polarAt(content.polars[content.ships[ship.classId]!.polar]!, drawn);
  const strength = nav.windStrength[wind.strength]!;
  if (!ship.gentleWind) return polar * strength;
  const g = nav.gentleWind;
  return (g.polarFloor + (1 - g.polarFloor) * polar) * Math.max(g.strengthFloor, strength);
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

/** Her best angle off the wind for making way dead downwind (VMG): a broad reach, gybing, beats a dead run. */
export function bestDownwindDeg(polar: Polar): number {
  let best = { deg: 180, vmg: 0 };
  for (let deg = 90; deg <= 180; deg += 0.5) {
    const vmg = polarAt(polar, deg) * -Math.cos((deg * Math.PI) / 180);
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
const PORT_ARRIVE_TILES = 4.4;
/** How far ahead an assisted course looks for land to steer around. */
const COAST_LOOK_TILES = 8;
/** A course pressed against land this long (3 s) hands back the helm. */
const COURSE_AGROUND_TICKS = 90;
/** A waypoint counts as passed this near. */
const WAYPOINT_TILES = 3;
const LAST_WAYPOINT_TILES = 1;
/**
 * An intercept shortens sail from this far off, down to the other ship's own speed alongside her (inside hailing
 * range, traffic.json hailTiles): she comes up with her and stays there, rather than overshooting at full sail.
 */
const INTERCEPT_EASE_TILES = 8;
const ALONGSIDE_TILES = 2.2;

/** A hull's outline, as [along, across] in fractions of navigation.json hull: bow to stern down her keel, and her sides. */
const HULL: [number, number][] = [
  [1, 0],
  [0.5, 0],
  [-0.5, 0],
  [-1, 0],
  [0.5, 1],
  [0.5, -1],
  [0, 1],
  [0, -1],
  [-0.5, 1],
  [-0.5, -1],
];

export function createNavigationSystem(
  content: ContentPack,
  map: TileMap,
  windAt: (state: WorldState, x: number, y: number) => Wind = (state) => state.wind,
  /** The ports, whose harbours she may work close in (navigation.json hull). */
  harbours: readonly { x: number; y: number }[] = [],
): System {
  const nav = content.navigation;
  const bestUpwind = new Map<string, number>();
  const bestDownwind = new Map<string, number>();
  const downwindOf = (polarId: string) => {
    if (!bestDownwind.has(polarId)) bestDownwind.set(polarId, bestDownwindDeg(content.polars[polarId]!));
    return bestDownwind.get(polarId)!;
  };
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

  /**
   * Where her boats tow her, if anywhere: in tight harbour water with the point she makes for upwind in clear water,
   * where she can't beat. In her destination's harbour that is its berth (her route's end); leaving a harbour on the
   * leg that began in it, her next waypoint, but only where land closes both her tacks (warped out of a narrow
   * harbour mouth, as Cumaná's into a west wind: in open water she beats out under sail).
   */
  const towTo = (ship: Ship, wind: Wind): [number, number] | undefined => {
    const a = ship.assist;
    if (a?.mode !== 'course' || a.x === undefined || a.y === undefined) return undefined;
    const near = (h: { x: number; y: number }, [x, y]: readonly [number, number]) => Math.hypot(h.x - x, h.y - y) <= nav.hull.harbourTiles;
    const arriving = a.portId && near({ x: a.x, y: a.y }, [ship.x, ship.y]);
    const leaving = a.from && a.route?.length && harbours.some((h) => near(h, [ship.x, ship.y]) && near(h, a.from!));
    const to = arriving ? (a.route?.at(-1) ?? [a.x, a.y]) : leaving ? a.route![0]! : undefined;
    if (!to) return undefined;
    const off = Math.max(0, upwindOf(content.ships[ship.classId]!.polar) - shipStats(content, ship).upwindDeg);
    const roomToBeat = [wind.fromDeg - off, wind.fromDeg + off].some((h) => {
      const r = (h * Math.PI) / 180;
      for (let k = 1; k <= COAST_LOOK_TILES; k++) if (isLand(tileAt(map, ship.x + Math.sin(r) * k, ship.y - Math.cos(r) * k))) return false;
      return true;
    });
    if (!arriving && roomToBeat) return undefined;
    // Towed straight: only with clear water all the way (round a point, she sails her route).
    return angleOffWind(bearingTo(ship, to[0], to[1]), wind.fromDeg) < off && lineClear(ship, to) ? to : undefined;
  };

  const sail = (ship: Ship, state: WorldState, dt: number): { ship: Ship; events: EmittedEvent[] } => {
    // A ship in port stays put until it undocks.
    if (ship.docked) return { ship, events: [] };
    const cls = content.ships[ship.classId]!;
    const wind = windAt(state, ship.x, ship.y);
    // In or out of a harbour with the way upwind: her boats tow her (she can't beat in tight water).
    const course = nav.course;
    const towTarget = course ? towTo(ship, wind) : undefined;
    const towing = Boolean(towTarget);
    // Coming in to her port she shortens sail: down to approachShare of her speed at the berth (navigation.json course).
    const a = ship.assist;
    const toPort = course && a?.mode === 'course' && a.portId && a.x !== undefined && a.y !== undefined ? Math.hypot(a.x - ship.x, a.y - ship.y) : Infinity;
    const shortened = course && toPort < course.approachTiles ? course.approachShare + (1 - course.approachShare) * (toPort / course.approachTiles) : 1;
    // Coming up with the ship she intercepts: no faster than her once alongside, easing down to it on the way in.
    const quarry = a?.mode === 'intercept' && a.targetId ? state.ships[a.targetId] : undefined;
    const apart = quarry ? Math.hypot(quarry.x - ship.x, quarry.y - ship.y) : Infinity;
    const full = targetSpeed(content, ship, wind) * shortened;
    const eased = quarry && apart < INTERCEPT_EASE_TILES ? quarry.speed + (full - quarry.speed) * Math.max(0, (apart - ALONGSIDE_TILES) / (INTERCEPT_EASE_TILES - ALONGSIDE_TILES)) : full;
    const target = towing ? course!.towTilesPerSecond : Math.min(full, Math.max(0, eased));
    // Way is gathered at accelPerSecond and, where set, lost more slowly: a ship carries her way.
    const rate = target < ship.speed ? (nav.decelPerSecond ?? nav.accelPerSecond) : nav.accelPerSecond;
    const speed = ship.speed + (target - ship.speed) * Math.min(1, rate * dt);
    // Her sails help bring her round as much as her rudder: shot through, she answers the helm slowly.
    const sails = nav.tornSailsTurnFloor + (1 - nav.tornSailsTurnFloor) * ((ship.sailCondition ?? 100) / 100);
    const turnRate = cls.turn * nav.turnDegPerSecondPerPoint * nav.rigTurnFactor[cls.rig]! * handsFactor(content, ship) * sails;
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
      // The point she is making for, where she has one (a corridor is measured to it).
      let aimAt: [number, number] | undefined;
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
          // Alongside her: said once (the game hails her), and again only after she has drawn well away.
          if (left <= ALONGSIDE_TILES && !assist.alongside) {
            assist = { ...assist, alongside: true };
            events.push({ type: 'InterceptAlongside', entityIds: [ship.id, them.id], payload: {} });
          } else if (left > ALONGSIDE_TILES * 2 && assist.alongside) assist = { ...assist, alongside: false };
        }
      } else if (assist.mode === 'course' && assist.x !== undefined && assist.y !== undefined) {
        const [tx, ty, portId] = [assist.x, assist.y, assist.portId];
        // Waypoints first: on to the next one once she's close, or as soon as she has a clear line past it.
        let route = assist.route ?? [];
        // The last waypoint (a port's berth) must be reached, not just neared: from there the town is in reach.
        const passed = (n: number) => (n > 1 ? WAYPOINT_TILES : LAST_WAYPOINT_TILES);
        // The leg she is on began at the waypoint she last passed, or where she was when the course was set.
        let from = assist.from ?? ([ship.x, ship.y] as [number, number]);
        while (route.length && (Math.hypot(route[0]![0] - ship.x, route[0]![1] - ship.y) <= passed(route.length) || (route.length > 1 && lineClear(ship, route[1]!)))) {
          from = route[0]!;
          route = route.slice(1);
        }
        if (route !== assist.route || from !== assist.from) assist = { ...assist, route, from };
        left = Math.hypot(tx - ship.x, ty - ship.y);
        // Bound for a port, she has arrived the moment it's in reach, whatever waypoints are left: beating up
        // to a berth to windward she may pass it on every board without ever touching it.
        if (portId && left <= PORT_ARRIVE_TILES) route = [];
        if (route.length) {
          aimAt = route[0]!;
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
        } else {
          aimAt = [tx, ty];
          want = bearingTo(ship, tx, ty);
        }
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
        if (towTarget) {
          goal = bearingTo(ship, towTarget[0], towTarget[1]);
        } else {
          // Running before the wind on a course, a seaman broad-reaches and gybes (the best way down for her rig);
          // only out of a harbour's tight water.
          const harbour = harbours.some((h) => Math.hypot(h.x - ship.x, h.y - ship.y) <= nav.hull.harbourTiles);
          const down = downwindOf(cls.polar);
          const running = Boolean(course) && assist.mode === 'course' && !harbour && angleOffWind(aim, wind.fromDeg) > down;
          if (!running && angleOffWind(aim, wind.fromDeg) >= off) goal = aim;
          else {
            // Beating (or running): on the tack she holds, at her best angle to the wind, until the way lies well
            // over on the other side (about 20 degrees past dead up- or downwind), so a near mark doesn't set her
            // tacking back and forth; as any sailor would, she goes about early when the coast closes in ahead and the
            // other tack is open (never onto a tack the shore already blocks: that would fight the shore rule and
            // leave her in irons).
            const edge = running ? down : off;
            const onTack = (t: Tack) => normalizeDeg(t === 'starboard' ? wind.fromDeg - edge : wind.fromDeg + edge);
            const apart = (h: number) => Math.abs(((h - aim + 540) % 360) - 180);
            const other: Tack = assist.tack === 'port' ? 'starboard' : 'port';
            // Or a corridor's width off the leg she is on (navigation.json course), when the tack she is on carries her
            // further off it and the other brings her back: her boards keep near the way. Running, a narrower one: she
            // makes good ground on either gybe, and a wide board downwind can carry her behind an island.
            const leg = assist.from;
            let wide = false;
            if (course && aimAt && leg) {
              const [lx, ly] = [aimAt[0] - leg[0], aimAt[1] - leg[1]];
              // Signed: which side of the leg she lies, and which way a heading carries her across it.
              const side = (lx * (ship.y - leg[1]) - ly * (ship.x - leg[0])) / Math.max(1, Math.hypot(lx, ly));
              const drift = (h: number) => lx * -Math.cos((h * Math.PI) / 180) - ly * Math.sin((h * Math.PI) / 180);
              wide = Math.abs(side) > (running ? course.runCorridorTiles : course.corridorTiles) && Math.sign(drift(onTack(assist.tack))) === Math.sign(side) && Math.sign(drift(onTack(other))) === -Math.sign(side);
            }
            const better = (apart(onTack(other)) + 40 < apart(onTack(assist.tack)) || wide) && clear(onTack(other));
            const shoreAhead = !clear(onTack(assist.tack)) && clear(onTack(other));
            const tack = better || shoreAhead ? other : assist.tack;
            assist = { ...assist, tack };
            goal = onTack(tack);
          }
        }
        if (goal !== undefined && !clear(goal)) {
          // The nearest heading either way that is clear and that she can sail (never into irons).
          const g = goal;
          const sailable = (h: number) => angleOffWind(h, wind.fromDeg) >= off;
          goal =
            [15, -15, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90, 120, -120, 135, -135, 150, -150, 165, -165, 180]
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
    // The HUD says when her boats have her in tow.
    if (assist && Boolean(assist.towing) !== towing) assist = towing ? { ...assist, towing } : (({ towing: _t, ...rest }) => rest)(assist);
    const steered: Ship = assist ? { ...ship, assist } : (({ assist: _a, ...rest }) => rest)(ship);

    const rad = (headingDeg * Math.PI) / 180;
    const dx = Math.sin(rad) * speed * dt;
    const dy = -Math.cos(rad) * speed * dt;
    const water = (px: number, py: number) => !isLand(tileAt(map, px, py));
    // She is drawn far bigger than a point: her centre must stay on water, and no move may carry any part of her
    // hull's outline from water onto land (turning may, so she is never shut in: she turns, then sails clear).
    // Only at the helm: a course or an intercept keeps off the coast by its look-ahead and the lanes, and in a
    // harbour she works close in; there only her centre counts.
    const byHand = steered.assist?.mode !== 'course' && steered.assist?.mode !== 'intercept';
    const inHarbour = harbours.some((h) => Math.hypot(h.x - ship.x, h.y - ship.y) <= nav.hull.harbourTiles);
    const [bow, beam] = byHand && !inHarbour ? [nav.hull.bowTiles, nav.hull.beamTiles] : [0, 0];
    const [fx, fy, sx, sy] = [Math.sin(rad), -Math.cos(rad), Math.cos(rad), Math.sin(rad)];
    /** Which of her outline's points are on land, as bits. */
    const aground = (px: number, py: number) =>
      HULL.reduce((bits, [along, across], i) => (water(px + fx * along * bow + sx * across * beam, py + fy * along * bow + sy * across * beam) ? bits : bits | (1 << i)), 0);
    const now = aground(ship.x, ship.y);
    const room = (px: number, py: number) => water(px, py) && (aground(px, py) & ~now) === 0;
    if (room(ship.x + dx, ship.y + dy)) {
      // Contact ends only once land is no longer just ahead; otherwise a ship nosing the coast
      // would flip in and out of contact every tick and repeat ShipBlocked.
      const blocked = ship.blocked && !water(ship.x + dx + fx * (bow + 0.5), ship.y + dy + fy * (bow + 0.5));
      const free = steered.assist?.aground ? { ...steered, assist: { ...steered.assist, aground: 0 } } : steered;
      return { ship: { ...free, x: ship.x + dx, y: ship.y + dy, headingDeg, speed, blocked }, events };
    }

    // Against land the ship slides along the coast on whichever axis is still water. Stopping dead
    // instead softlocks a ship whose only seaward headings are in irons. Speed stays the speed
    // through the water; only the blocked component of the move is lost.
    // Try the axis with the larger move first. In a concave corner of the tile coast both are
    // land and the ship holds position until it turns away.
    const axes: [number, number][] = Math.abs(dx) >= Math.abs(dy) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
    const free = axes.find(([ax, ay]) => (ax !== 0 || ay !== 0) && room(ship.x + ax, ship.y + ay));
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
      if (command.type === 'SetGentleWind') {
        const ship = state.ships[command.shipId];
        if (!ship || Boolean(ship.gentleWind) === command.on) return undefined;
        const ships = { ...state.ships, [ship.id]: { ...ship, gentleWind: command.on || undefined } };
        return { state: { ...state, ships }, events: [{ type: 'GentleWindSet', entityIds: [ship.id], payload: { on: command.on } }] };
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
    ...(start.name ? { name: start.name } : {}),
    ...(start.guns !== undefined ? { guns: start.guns } : {}),
  };
  return { tick: 0, wind: { ...wind }, ships: { [ship.id]: ship } };
}

/**
 * The way she will sail a route in this wind, as a line to draw: a leg she can lay is a straight leg; one into the wind
 * becomes her boards, close-hauled on each tack in turn, each going about no more than `corridorTiles` off the leg (as
 * the course autopilot keeps near its way). `route` is the waypoints after `from`; so is the result.
 */
export function tackedLine(from: [number, number], route: [number, number][], windFromDeg: number, bestDeg: number, corridorTiles: number): [number, number][] {
  const out: [number, number][] = [];
  let [ax, ay] = from;
  for (const [bx, by] of route) {
    const [dx, dy] = [bx - ax, by - ay];
    const len = Math.hypot(dx, dy);
    const legDeg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    if (len < 1e-6 || angleOffWind(legDeg, windFromDeg) >= bestDeg) {
      out.push([bx, by]);
      [ax, ay] = [bx, by];
      continue;
    }
    // Her two close-hauled headings, and how far she sails on each to make the leg: (dx, dy) = a·v1 + b·v2.
    const unit = (deg: number): [number, number] => [Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180)];
    const v1 = unit(windFromDeg + bestDeg);
    const v2 = unit(windFromDeg - bestDeg);
    const det = v1[0] * v2[1] - v1[1] * v2[0];
    const a = (dx * v2[1] - dy * v2[0]) / det;
    const b = (v1[0] * dy - v1[1] * dx) / det;
    // How far each board on the first tack carries her off the leg: split into as many as keep it within the corridor.
    const off = Math.abs(a * (v1[0] * dy - v1[1] * dx)) / len;
    const n = Math.max(1, Math.ceil(off / corridorTiles));
    let [x, y] = [ax, ay];
    for (let k = 0; k < n; k++) {
      x += (v1[0] * a) / n;
      y += (v1[1] * a) / n;
      out.push([x, y]);
      x += (v2[0] * b) / n;
      y += (v2[1] * b) / n;
      out.push(k === n - 1 ? [bx, by] : [x, y]);
    }
    [ax, ay] = [bx, by];
  }
  return out;
}
