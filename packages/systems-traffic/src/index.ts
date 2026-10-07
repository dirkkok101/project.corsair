import { inPort, rngStream, seedRng } from '@corsair/core';
import type { AiCaptain, EmittedEvent, Nation, Ship, Sighting, System, Wind, WorldState } from '@corsair/core';
import { isLand, shipStats, tileAt } from '@corsair/data';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';
import { crewOf, moraleOf, newsAt, normalStock, quote } from '@corsair/systems-economy';
import { angleOffWind, bestUpwindDeg, normalizeDeg, targetSpeed } from '@corsair/systems-navigation';
import { atWar, legalTarget, raisePiracy } from '@corsair/systems-politics';
import type { SeaLanes } from './lanes';

export { createSeaLanes } from './lanes';
export type { SeaLanes } from './lanes';

// Ships at sea (PRD sections 4 and 6). AI ships sail sea lanes between ports at the speed their
// polar gives in the local wind, tacking in a corridor about the lane where it runs to windward.
// Merchants buy where a good is cheap and carry it where it is dear, so their cargo really moves
// prices; patrols sail between their nation's ports; pirates slip out of the havens to lurk on the
// trade lanes and come back. The population tops itself up a ship a day, so old saves fill too.

type Settlement = PlacedSettlement;
type Rng = ReturnType<typeof rngStream>;
type Role = AiCaptain['role'];
const ROLES: Role[] = ['merchant', 'patrol', 'pirate'];
/** A chaser changes tack only when the other tack points this much nearer the player. */
const TACK_MARGIN_DEG = 25;
/** Hunters look about for prey every this many ticks. */
const LOOKOUT_TICKS = 10;
/** Pirates' interest in a port halves this far (in tiles) from their haven. */
const PIRATE_RANGE_TILES = 180;
/** Pirates lurk somewhere in this stretch of the lane toward their mark (as shares of it), then turn for home. */
const LURK_AT: [number, number] = [0.3, 0.8];
/** The news a ship picks up in port: the freshest few. */
const NEWS_CARRIED = 3;

const isHaven = (s: Settlement) => s.nation === 'pirate' || s.type === 'haven';
const legLength = ([x0, y0]: [number, number], [x1, y1]: [number, number]) => Math.hypot(x1 - x0, y1 - y0);
const routeLength = (route: [number, number][]) => route.slice(1).reduce((n, p, i) => n + legLength(route[i]!, p), 0);

/** Where `along` tiles down a route falls, and the compass heading of that leg. */
function pointAlong(route: [number, number][], along: number): { x: number; y: number; deg: number } {
  let left = along;
  for (let i = 1; i < route.length; i++) {
    const [x0, y0] = route[i - 1]!;
    const [x1, y1] = route[i]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const deg = normalizeDeg((Math.atan2(x1 - x0, -(y1 - y0)) * 180) / Math.PI);
    if (left <= len || i === route.length - 1) {
      const t = len > 0 ? Math.min(1, left / len) : 1;
      return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, deg };
    }
    left -= len;
  }
  const [x, y] = route[0]!;
  return { x, y, deg: 0 };
}

/** A ship's side of the lane, from -1 to 1: fixed by her id, so it needs no state and replays hold. */
function laneSide(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

export function createTrafficSystem(
  content: ContentPack,
  settlements: Settlement[],
  lanes: SeaLanes,
  map: TileMap,
  windAt: (state: WorldState, x: number, y: number) => Wind,
): System {
  const t = content.traffic;
  const tpd = content.calendar.ticksPerDay;
  const byId = new Map(settlements.map((s) => [s.id, s]));
  const water = (x: number, y: number) => !isLand(tileAt(map, x, y));
  const bestUpwind = new Map(Object.entries(content.polars).map(([id, p]) => [id, bestUpwindDeg(p)]));

  /** Where to next, and with what: a merchant takes the best margin it can find; others pick a port of their kind. */
  const orders = (state: WorldState, ship: Ship, rng: Rng) => {
    const ai = ship.ai!;
    const here = byId.get(ai.from)!;
    const reachable = (s: Settlement) => s.id !== here.id && Boolean(lanes.route(here.id, s.id));
    if (ai.role === 'pirate') {
      // Pirates stalk the lanes near home: bigger ports draw them, distance puts them off.
      const size = { hamlet: 1, town: 2, city: 4 } as const;
      const marks = settlements.filter((s) => !isHaven(s) && reachable(s));
      const weights = Object.fromEntries(marks.map((s) => [s.id, size[s.size] / (1 + Math.hypot(s.x - here.x, s.y - here.y) / PIRATE_RANGE_TILES)]));
      const pick = marks.length ? rng.weighted(weights) : undefined;
      return { to: marks.find((s) => s.id === pick), good: undefined };
    }
    if (ai.role === 'patrol') {
      const own = settlements.filter((s) => s.nation === ai.nation && !isHaven(s) && reachable(s));
      const pool = own.length ? own : settlements.filter((s) => !isHaven(s) && reachable(s));
      return { to: pool[Math.floor(rng.float() * pool.length)], good: undefined };
    }
    // Merchant: per-unit margin between here and each reachable port, skipping routes already busy.
    const busy = (to: string) =>
      Object.values(state.ships).filter((s) => s.ai?.role === 'merchant' && s.ai.from === here.id && s.ai.to === to && s.id !== ship.id).length;
    let best: { to: Settlement; good: string; margin: number } | undefined;
    for (const dest of settlements) {
      if (isHaven(dest) || !reachable(dest) || busy(dest.id) >= t.maxPerRoute) continue;
      for (const g of content.goods) {
        if (g.staple) continue;
        const buy = quote(content, here, g.id, state.markets?.[here.id]?.[g.id] ?? 0).buy;
        const sell = quote(content, dest, g.id, state.markets?.[dest.id]?.[g.id] ?? 0).sell;
        if (sell - buy > (best?.margin ?? 0)) best = { to: dest, good: g.id, margin: sell - buy };
      }
    }
    if (best) return best;
    // Nothing pays: sail on in ballast to look for trade elsewhere.
    const pool = settlements.filter((s) => !isHaven(s) && reachable(s));
    return { to: pool[Math.floor(rng.float() * pool.length)], good: undefined };
  };

  /** Set sail: take on news and (for a merchant) cargo, and start down the lane. */
  const depart = (state: WorldState, ship: Ship, tick: number, rng: Rng): { state: WorldState; ship: Ship; events: EmittedEvent[] } => {
    const ai = ship.ai!;
    const { to, good } = orders(state, ship, rng);
    if (!to) return { state, ship: { ...ship, ai: { ...ai, waitUntil: tick + tpd } }, events: [] };
    let route = lanes.route(ai.from, to.id)!;
    if (ai.role === 'pirate') {
      // Out toward the mark only part way, to lurk on the lane.
      const stop = routeLength(route) * rng.range(LURK_AT[0], LURK_AT[1]);
      const end = pointAlong(route, stop);
      const keep: [number, number][] = [route[0]!];
      let run = 0;
      for (let i = 1; i < route.length && run + legLength(route[i - 1]!, route[i]!) < stop; i++) {
        run += legLength(route[i - 1]!, route[i]!);
        keep.push(route[i]!);
      }
      route = [...keep, [end.x, end.y]];
    }
    let next = state;
    const cargo: Record<string, number> = {};
    if (good && ai.role === 'merchant') {
      // Buy unit by unit while a good margin lasts: a merchant skims the trade and leaves the rest.
      const here = byId.get(ai.from)!;
      const cap = Math.min(t.voyageUnits, content.ships[ship.classId]!.cargo);
      const sell = quote(content, to, good, state.markets?.[to.id]?.[good] ?? 0).sell;
      let stock = state.markets?.[here.id]?.[good] ?? 0;
      let units = 0;
      while (units < cap && stock >= 1 && quote(content, here, good, stock).buy * (1 + t.minMargin) <= sell) {
        stock--;
        units++;
      }
      if (units > 0) {
        cargo[good] = units;
        next = { ...state, markets: { ...state.markets, [here.id]: { ...state.markets?.[here.id], [good]: stock } } };
      }
    }
    const news = newsAt(content, next, settlements, ai.from)
      .slice(0, NEWS_CARRIED)
      .map((n) => n.id);
    const sailing: Ship = {
      ...ship,
      cargo,
      sails: 'full',
      ai: { ...ai, to: to.id, route, along: 0, offset: 0, waitUntil: undefined, news },
    };
    return {
      state: next,
      ship: sailing,
      events: [{ type: 'ShipDeparted', entityIds: [ship.id, ai.from, to.id], payload: { role: ai.role, cargo } }],
    };
  };

  /** Made port (or a pirate's lurking spot): a merchant sells its cargo into the market, then all lie a while. */
  const arrive = (state: WorldState, ship: Ship, tick: number, rng: Rng): { state: WorldState; ship: Ship; events: EmittedEvent[] } => {
    const ai = ship.ai!;
    const wait = tick + Math.round(rng.range(t.portDays[0], t.portDays[1]) * tpd);
    if (ai.role === 'pirate' && !isHaven(byId.get(ai.to)!)) {
      // On her lurking spot: lie in wait on the lane, then head back the way she came, to her haven.
      const lurk = tick + Math.round(rng.range(t.lurkDays[0], t.lurkDays[1]) * tpd);
      const back = [...ai.route].reverse();
      return {
        state,
        ship: { ...ship, speed: 0, ai: { ...ai, to: ai.from, route: back, along: 0, offset: 0, waitUntil: lurk } },
        events: [],
      };
    }
    let next = state;
    const dest = byId.get(ai.to)!;
    for (const [good, units] of Object.entries(ship.cargo)) {
      // A cargo only ever reaches its market if the ship does (PRD section 6: captured cargo never arrives).
      const stock = (next.markets?.[dest.id]?.[good] ?? 0) + units;
      const cap = Math.round(normalStock(content, dest, good) * content.economy.maxStock);
      next = { ...next, markets: { ...next.markets, [dest.id]: { ...next.markets?.[dest.id], [good]: Math.min(cap, stock) } } };
    }
    const [mx, my] = lanes.mooring(dest.id) ?? [ship.x, ship.y];
    return {
      state: next,
      ship: {
        ...ship,
        x: mx,
        y: my,
        speed: 0,
        cargo: {},
        sails: 'furled',
        ai: { ...ai, from: dest.id, route: [], along: 0, offset: 0, waitUntil: wait },
      },
      events: [{ type: 'ShipArrived', entityIds: [ship.id, dest.id], payload: { role: ai.role, cargo: ship.cargo } }],
    };
  };

  /** One tick down the lane: on the lane when the wind allows, tacking about it when the lane runs to windward. */
  /** Degrees a ship of this class turns in a second: the same rate the player's ship turns at. */
  const turnRate = (ship: Ship) => {
    const cls = content.ships[ship.classId]!;
    return cls.turn * content.navigation.turnDegPerSecondPerPoint * content.navigation.rigTurnFactor[cls.rig]!;
  };
  /** Swing from one heading toward another, no faster than `maxStep` degrees. */
  const steerToward = (from: number, to: number, maxStep: number) => {
    const diff = ((to - from + 540) % 360) - 180;
    return normalizeDeg(from + Math.max(-maxStep, Math.min(maxStep, diff)));
  };
  /** Land within `tiles` ahead on a heading. */
  const landAhead = (x: number, y: number, deg: number, tiles: number) => {
    const r = (deg * Math.PI) / 180;
    for (let k = 1; k <= tiles; k++) if (!water(x + Math.sin(r) * k, y - Math.cos(r) * k)) return true;
    return false;
  };

  /**
   * One tick down the lane: on the lane when the wind allows, tacking about it when the lane runs to
   * windward. Long boards (up to tackTiles off the lane, shorter where land is near), and the ship
   * turns at her class's rate, losing way as she comes through the wind, rather than snapping round.
   */
  const sail = (state: WorldState, ship: Ship, dt: number): Ship => {
    const ai = ship.ai!;
    const total = routeLength(ai.route);
    const lane = pointAlong(ai.route, ai.along);
    const wind = windAt(state, ship.x, ship.y);
    const best = bestUpwind.get(content.ships[ship.classId]!.polar) ?? 45;
    const off = angleOffWind(lane.deg, wind.fromDeg);
    let { offset, tackSign } = ai;
    const closeHauled = (sign: 1 | -1) => normalizeDeg(wind.fromDeg + sign * best);
    let desired = lane.deg;
    if (off < best) {
      // Come about at the edge of the corridor, or when the board would run her ashore.
      const atEdge = Math.abs(offset) >= t.tackTiles && Math.sign(offset) === Math.sign(Math.sin(((closeHauled(tackSign) - lane.deg) * Math.PI) / 180));
      if (atEdge || landAhead(ship.x, ship.y, closeHauled(tackSign), 2)) tackSign = tackSign === 1 ? -1 : 1;
      desired = closeHauled(tackSign);
    } else if (Math.abs(offset) > 0.05) {
      // Back onto the lane at a gentle angle once it frees.
      desired = normalizeDeg(lane.deg - Math.sign(offset) * 20);
    }
    const heading = steerToward(ship.headingDeg, desired, turnRate(ship) * dt);
    const speed = targetSpeed(content, { ...ship, headingDeg: heading, sails: 'full' }, wind);
    const rel = ((heading - lane.deg) * Math.PI) / 180;
    const along = Math.min(total, ai.along + Math.max(0, Math.cos(rel)) * speed * dt);
    offset += Math.sin(rel) * speed * dt;
    if (off >= best && Math.abs(offset) <= 0.05) offset = 0;
    const at = pointAlong(ai.route, along);
    // Right of the lane in compass terms: the lane's direction turned 90 degrees clockwise.
    const nr = (at.deg * Math.PI) / 180;
    // Each ship keeps her own line a little to one side of the lane, so ships on one lane sail side by
    // side rather than through each other. It fades in and out over the first and last tiles, so she
    // still leaves from and arrives at the mooring.
    const side = laneSide(ship.id) * t.laneSpreadTiles * Math.min(1, along, total - along);
    let x = at.x + Math.cos(nr) * (offset + side);
    let y = at.y + Math.sin(nr) * (offset + side);
    if (!water(x, y)) {
      // Touching land after all: pull in toward the lane (which is water) and stand off the other way.
      offset *= 0.5;
      tackSign = tackSign === 1 ? -1 : 1;
      x = at.x + Math.cos(nr) * offset;
      y = at.y + Math.sin(nr) * offset;
      if (!water(x, y)) [x, y, offset] = [at.x, at.y, 0];
    }
    return { ...ship, x, y, headingDeg: heading, speed, sails: 'full', ai: { ...ai, along, offset, tackSign } };
  };

  const cb = content.combat;
  const standingWith = (state: WorldState, nation: Nation) => state.captain?.standing?.[nation] ?? 0;
  /** Pirates hunt the player; a nation's patrols do too once the player has made it an enemy. */
  const hunts = (state: WorldState, ship: Ship) =>
    ship.ai!.role === 'pirate' || (ship.ai!.role === 'patrol' && standingWith(state, ship.ai!.nation) <= cb.standing.hostile);

  /**
   * Close on the player: straight at them where the wind allows, close-hauled toward them where it
   * doesn't. She holds her tack until the other is clearly better (no flip-flopping), turns at her
   * class's rate, and never sails onto land.
   */
  const pursue = (state: WorldState, ship: Ship, player: Ship, dt: number): Ship => {
    const ai = ship.ai!;
    const wind = windAt(state, ship.x, ship.y);
    const best = bestUpwind.get(content.ships[ship.classId]!.polar) ?? 45;
    const toPlayer = normalizeDeg((Math.atan2(player.x - ship.x, -(player.y - ship.y)) * 180) / Math.PI);
    const apart = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    let tackSign = ai.tackSign;
    let desired = toPlayer;
    if (angleOffWind(toPlayer, wind.fromDeg) < best) {
      const course = (sign: 1 | -1) => normalizeDeg(wind.fromDeg + sign * best);
      const other: 1 | -1 = tackSign === 1 ? -1 : 1;
      if (apart(course(other), toPlayer) + TACK_MARGIN_DEG < apart(course(tackSign), toPlayer)) tackSign = other;
      desired = course(tackSign);
    }
    // Land ahead: bear away until the way is clear.
    for (const swing of [0, 30, -30, 60, -60, 90, -90]) {
      if (!landAhead(ship.x, ship.y, normalizeDeg(desired + swing), 2)) {
        desired = normalizeDeg(desired + swing);
        break;
      }
    }
    const heading = steerToward(ship.headingDeg, desired, turnRate(ship) * dt);
    const speed = targetSpeed(content, { ...ship, headingDeg: heading, sails: 'full' }, wind);
    const r = (heading * Math.PI) / 180;
    const x = ship.x + Math.sin(r) * speed * dt;
    const y = ship.y - Math.cos(r) * speed * dt;
    if (!water(x, y)) return { ...ship, headingDeg: heading, speed: 0, ai: { ...ai, tackSign } };
    return { ...ship, x, y, headingDeg: heading, speed, sails: 'full', ai: { ...ai, tackSign } };
  };

  /** Back to her lane after a chase: join it at the nearest waypoint she can sail to in a straight line. */
  const rejoin = (ship: Ship): Ship => {
    const ai = ship.ai!;
    const here: [number, number] = [ship.x, ship.y];
    let best: { k: number; d: number } | undefined;
    ai.route.forEach((p, k) => {
      const d = Math.hypot(p[0] - ship.x, p[1] - ship.y);
      if (lanes.clear(here, p) && (!best || d < best.d)) best = { k, d };
    });
    if (best) return { ...ship, ai: { ...ai, chasing: false, route: [here, ...ai.route.slice(best.k)], along: 0, offset: 0 } };
    // Far off her lane with land in the way: make for the nearest anchorage she can see, and take
    // that port's lane on to where she was bound.
    const ports = settlements
      .map((s) => ({ s, at: lanes.mooring(s.id) }))
      .filter((m): m is { s: Settlement; at: [number, number] } => Boolean(m.at) && lanes.clear(here, m.at!))
      .sort((a, b) => Math.hypot(a.at[0] - ship.x, a.at[1] - ship.y) - Math.hypot(b.at[0] - ship.x, b.at[1] - ship.y));
    for (const { s, at } of ports) {
      const onward = s.id === ai.to ? [at] : lanes.route(s.id, ai.to);
      if (onward) return { ...ship, ai: { ...ai, chasing: false, route: [here, at, ...onward.slice(1)], along: 0, offset: 0 } };
    }
    // Nowhere in sight: lie where she is until the lane is found again (she arrives in place).
    return { ...ship, ai: { ...ai, chasing: false, route: [here, here], along: 0, offset: 0 } };
  };


  /**
   * Whether a ship at (x, y) lies under the guns of a port the hunter fears: pirates fear every port but
   * a haven, patrols the ports of nations they are at war with. A hunter won't chase or fight her there.
   */
  const sheltered = (state: WorldState, hunter: Ship, x: number, y: number) =>
    settlements.some((s) => {
      const fears = hunter.ai!.role === 'pirate' ? !isHaven(s) : atWar(content, state, hunter.ai!.nation, s.nation);
      return fears && Math.hypot(s.x - x, s.y - y) <= (cb.chase.harbourTiles[s.size] ?? 0);
    });

  /** What a hunter goes after: pirates take merchants; patrols take pirates and their nation's enemies. */
  const isPrey = (state: WorldState, hunter: Ship, s: Ship) => {
    if (!s.ai || s.id === hunter.id || inPort(s) || sheltered(state, hunter, s.x, s.y)) return false;
    if (hunter.ai!.role === 'pirate') return s.ai.role === 'merchant';
    return s.ai.role === 'pirate' || atWar(content, state, hunter.ai!.nation, s.ai.nation);
  };
  /** The nearest prey in sight, if any. */
  const sightPrey = (state: WorldState, ships: Record<string, Ship>, hunter: Ship): Ship | undefined => {
    let best: { s: Ship; d: number } | undefined;
    for (const s of Object.values(ships)) {
      if (!isPrey(state, hunter, s)) continue;
      const d = Math.hypot(s.x - hunter.x, s.y - hunter.y);
      if (d <= cb.chase.aiChaseTiles && (!best || d < best.d) && lanes.clear([hunter.x, hunter.y], [s.x, s.y])) best = { s, d };
    }
    return best?.s;
  };

  /**
   * Two AI ships fight it out: crew x (1 + guns / 10) x role decides it. The loser is gone from the
   * sea (a pirate takes a merchant's cargo and gold; a warship sinks a pirate or takes an enemy), the
   * winner is mauled and leaves off hunting a while, and it is news from the nearest port. Pirates
   * taking a nation's merchant raise its pirate pressure.
   */
  const seaFight = (state: WorldState, ships: Record<string, Ship>, a: Ship, b: Ship, tick: number, rng: Rng) => {
    const ar = cb.autoResolve;
    const strength = (s: Ship) => (s.crew ?? content.ships[s.classId]!.minCrew) * (1 + content.ships[s.classId]!.guns / 10) * ar[s.ai!.role];
    const sa = strength(a);
    const sb = strength(b);
    const [winner, loser] = rng.float() < sa / (sa + sb) ? [a, b] : [b, a];
    const out = { ...ships };
    delete out[loser.id];
    const calmUntil = tick + Math.round(cb.chase.calmDays * tpd);
    const crew = Math.max(content.ships[winner.classId]!.minCrew, Math.round((winner.crew ?? 0) * (1 - ar.losses)));
    let cargo = winner.cargo;
    let purse = winner.ai!.purse ?? 0;
    if (winner.ai!.role === 'pirate') {
      // Plunder: what the sloop's hold takes, and the purse.
      cargo = { ...cargo };
      const room = () => content.ships[winner.classId]!.cargo - Object.values(cargo).reduce((x, y) => x + y, 0);
      for (const [good, units] of Object.entries(loser.cargo)) {
        const take = Math.min(units, room());
        if (take > 0) cargo[good] = (cargo[good] ?? 0) + take;
      }
      purse += loser.ai!.purse ?? 0;
    }
    // A pirate with a prize makes for home (the lane back to her haven) and lies low a week.
    const homeward = winner.ai!.role === 'pirate' && loser.ai!.role === 'merchant';
    const sailor = rejoin({
      ...winner,
      crew,
      cargo,
      ai: { ...winner.ai!, target: undefined, purse, calmUntil: homeward ? tick + Math.round(cb.chase.prizeCalmDays * tpd) : calmUntil },
    });
    out[winner.id] = homeward && byId.get(winner.ai!.from) && isHaven(byId.get(winner.ai!.from)!)
      ? rejoin({ ...sailor, ai: { ...sailor.ai!, to: winner.ai!.from, route: lanes.route(nearestPort(winner.x, winner.y).id, winner.ai!.from) ?? sailor.ai!.route } })
      : sailor;
    let next = state;
    const kind = winner.ai!.role === 'pirate' ? 'aiTaken' : loser.ai!.role === 'pirate' ? 'aiPirateSunk' : 'warPrize';
    if (winner.ai!.role === 'pirate' && loser.ai!.role === 'merchant') {
      next = raisePiracy(content, next, settlements, loser.ai!.nation, Math.floor(rng.range(content.economy.news.delayDays[0], content.economy.news.delayDays[1] + 1)));
    }
    const n = next.nextNewsId ?? 0;
    const item = {
      id: `news.${n}`,
      tick,
      settlementId: nearestPort(loser.x, loser.y).id,
      kind,
      good: '',
      delayDays: Math.floor(rng.range(content.economy.news.delayDays[0], content.economy.news.delayDays[1] + 1)),
      ship: loser.ai!.name,
      nation: loser.ai!.nation,
      other: winner.ai!.nation,
    };
    next = { ...next, news: [...(next.news ?? []), item], nextNewsId: n + 1 };
    return {
      state: next,
      ships: out,
      events: [
        { type: 'SeaFight', entityIds: [winner.id, loser.id], payload: { x: loser.x, y: loser.y, winner: winner.ai!.nation, loser: loser.ai!.nation } },
      ] as EmittedEvent[],
    };
  };

  /** The port nearest a spot at sea, where news of what happened there starts out from. */
  const nearestPort = (x: number, y: number) =>
    settlements.reduce((a, b) => (Math.hypot(b.x - x, b.y - y) < Math.hypot(a.x - x, a.y - y) ? b : a));

  /** Ships of each role the world should have: the population split by share. */
  const target = (role: Role) => Math.round(t.population * t.roles[role].share);

  return {
    name: 'traffic',
    command(state, command) {
      if (command.type === 'Hail') {
        const player = state.ships[command.shipId];
        const other = state.ships[command.targetId];
        if (!player || !other?.ai) return undefined;
        const fail = (reason: string) => ({
          state,
          events: [{ type: 'HailRefused', entityIds: [player.id, other.id], payload: { reason } }] as EmittedEvent[],
        });
        if (player.docked) return fail('in-port');
        if (other.ai.waitUntil !== undefined && !other.ai.route.length) return fail('in-port');
        if (Math.hypot(other.x - player.x, other.y - player.y) > t.hailTiles) return fail('too-far');
        const heard = state.captain?.heard ?? [];
        const fresh = other.ai.news.filter((id) => !heard.includes(id));
        return {
          state: state.captain ? { ...state, captain: { ...state.captain, heard: [...heard, ...fresh] } } : state,
          events: [{ type: 'Hailed', entityIds: [player.id, other.id], payload: { news: fresh } }],
        };
      }
      if (command.type === 'Attack') {
        const player = state.ships[command.shipId];
        const other = state.ships[command.targetId];
        if (!player || !other?.ai) return undefined;
        if (player.docked || inPort(other) || Math.hypot(other.x - player.x, other.y - player.y) > t.hailTiles) {
          return { state, events: [{ type: 'AttackRefused', entityIds: [player.id, other.id], payload: {} }] };
        }
        // Firing on a nation's ship costs standing with that nation; pirates are fair game. Under a
        // letter of marque from her enemy it is lawful privateering, and the issuer thinks the better of you.
        let next = state;
        const nation = other.ai.nation;
        if (nation !== 'pirate' && state.captain) {
          const standing = { ...state.captain.standing, [nation]: Math.max(-100, standingWith(state, nation) + cb.standing.attack) };
          const issuer = legalTarget(content, state, state.captain, nation);
          if (issuer) standing[issuer] = Math.min(100, standingWith(state, issuer) + content.politics.marque.standingGain);
          next = { ...state, captain: { ...state.captain, standing } };
        }
        return { state: next, events: [{ type: 'BattleJoined', entityIds: [player.id, other.id], payload: { by: 'player' } }] };
      }
      if (command.type === 'BattleEnded') {
        const player = state.ships[command.shipId];
        const other = state.ships[command.targetId];
        if (!player || !other?.ai || !state.captain) return undefined;
        const { outcome, player: mine, enemy: theirs } = command.result;
        const cls = content.ships[player.classId]!;
        let captain = state.captain;
        let cargo = player.cargo;
        const ships = { ...state.ships };
        const events: EmittedEvent[] = [{ type: 'BattleOver', entityIds: [player.id, other.id], payload: { outcome } }];
        // Beaten, the player is let go afloat: a pirate takes the cargo and half the gold (and of the plunder
        // chest), a patrol fines half.
        const beaten = outcome === 'lost';
        if (beaten) {
          if (other.ai.role === 'pirate') cargo = {};
          captain = { ...captain, gold: Math.floor(captain.gold / 2), chest: Math.floor((captain.chest ?? 0) / 2) };
        }
        // The crew's spirits: a prize lifts them, a loss of men or the fight sinks them (crew.json morale).
        const cm = content.crew.morale;
        const crewBefore = crewOf(content, player);
        const lost = Math.max(0, crewBefore - mine.crew);
        const won = outcome === 'struck' || outcome === 'boarded' ? cm.taken : outcome === 'sunk' ? cm.sunk : beaten ? -cm.taken : 0;
        const morale = Math.max(0, Math.min(100, moraleOf(content, state) + won - (cm.lossFactor * lost) / Math.max(1, crewBefore)));
        captain = { ...captain, morale };
        // The fight was virtual: each ship stays where they met. Guns knocked out stay lost.
        ships[player.id] = {
          ...player,
          guns: mine.guns,
          cargo,
          paid: beaten && other.ai.role === 'pirate' ? {} : player.paid,
          plunder: beaten && other.ai.role === 'pirate' ? {} : player.plunder,
          hull: Math.max(beaten ? Math.ceil(cls.hull * 0.1) : 1, mine.hull),
          sailCondition: Math.max(beaten ? 20 : 0, mine.sailCondition),
          crew: Math.max(beaten ? Math.ceil(cls.minCrew / 2) : 1, mine.crew),
        };
        if (outcome === 'escaped' || outcome === 'fled' || beaten) {
          // She sails on, mauled, and leaves the player be a while.
          const calmUntil = state.tick + Math.round(cb.chase.calmDays * tpd);
          ships[other.id] = { ...other, ...theirs, ai: { ...other.ai, chasing: false, calmUntil } };
        } else {
          // Sunk or taken: she's gone from the sea. A prize's gold and cargo (what the hold can take) come aboard.
          delete ships[other.id];
          if (outcome !== 'sunk') {
            // Her gold is plunder: into the chest the crew sails for. Her cargo too, once sold.
            captain = { ...captain, chest: (captain.chest ?? 0) + (other.ai.purse ?? 0) };
            const room = () => cls.cargo - Object.values(cargo).reduce((a, b) => a + b, 0);
            cargo = { ...cargo };
            const plunder = { ...player.plunder };
            for (const [good, units] of Object.entries(other.cargo)) {
              const take = Math.min(units, room());
              if (take <= 0) continue;
              cargo[good] = (cargo[good] ?? 0) + take;
              plunder[good] = (plunder[good] ?? 0) + take;
            }
            // Some of her men sign on (pirates readily), as many as there are berths for.
            const share = other.ai.role === 'pirate' ? content.crew.volunteers.pirate : content.crew.volunteers.other;
            const berths = shipStats(content, player).maxCrew - ships[player.id]!.crew!;
            const join = Math.max(0, Math.min(berths, Math.round(theirs.crew * share)));
            if (join > 0) events.push({ type: 'Volunteers', entityIds: [player.id, other.id], payload: { count: join } });
            ships[player.id] = { ...ships[player.id]!, cargo, plunder, crew: ships[player.id]!.crew! + join };
          }
          if (other.ai.nation === 'pirate') {
            const standing = { ...captain.standing };
            for (const n of ['spain', 'england', 'france', 'netherlands'] as const) standing[n] = Math.min(100, (standing[n] ?? 0) + cb.standing.pirate);
            captain = { ...captain, standing };
          }
          // A deed for a governor's bounty: any governor pays for pirates; enemies of his nation, too.
          const deed = { nation: other.ai.nation, role: other.ai.role, kind: outcome === 'sunk' ? ('sunk' as const) : ('taken' as const), tick: state.tick };
          captain = { ...captain, deeds: [...(captain.deeds ?? []), deed] };
        }
        // The fight is news, starting from the nearest port.
        let next: WorldState = { ...state, ships, captain };
        if (outcome === 'sunk' || outcome === 'struck' || outcome === 'boarded') {
          const kind = other.ai.nation === 'pirate' && outcome === 'sunk' ? 'pirateSunk' : outcome === 'sunk' ? 'sunk' : 'taken';
          const rng = rngStream(state.rng?.traffic ?? seedRng(0, 'traffic'));
          const n = state.nextNewsId ?? 0;
          const item = {
            id: `news.${n}`,
            tick: state.tick,
            settlementId: nearestPort(other.x, other.y).id,
            kind,
            good: '',
            delayDays: Math.floor(rng.range(content.economy.news.delayDays[0], content.economy.news.delayDays[1] + 1)),
            ship: other.ai.name,
            nation: other.ai.nation,
          };
          next = { ...next, news: [...(next.news ?? []), item], nextNewsId: n + 1, rng: { ...next.rng, traffic: rng.state() } };
        }
        return { state: next, events };
      }
      if (command.type === 'SpawnShip') {
        const from = byId.get(command.from);
        const to = byId.get(command.to);
        const route = from && to ? lanes.route(from.id, to.id) : undefined;
        if (!from || !to || !route) return undefined;
        const rng = rngStream(state.rng?.traffic ?? seedRng(0, 'traffic'));
        const made = spawn(content, state, command.role, from, lanes.mooring(from.id)!, rng, state.tick);
        const ship: Ship = { ...made.ship, ai: { ...made.ship.ai!, to: to.id, route, waitUntil: undefined } };
        return {
          state: { ...made.state, ships: { ...made.state.ships, [ship.id]: ship }, rng: { ...made.state.rng, traffic: rng.state() } },
          events: [{ type: 'ShipSpawned', entityIds: [ship.id], payload: { role: command.role, debug: true } }],
        };
      }
      return undefined;
    },
    tick(state, dt) {
      const tick = state.tick + 1;
      const rng = rngStream(state.rng?.traffic ?? seedRng(0, 'traffic'));
      let next = state;
      const events: EmittedEvent[] = [];
      let ships = { ...state.ships };
      for (const id of Object.keys(ships).sort()) {
        // A ship taken or sunk earlier this tick is gone.
        const ship = ships[id];
        if (!ship?.ai) continue;
        let moved: Ship;
        // The hunt: a pirate (or hostile patrol) at sea that sights the player gives chase, and a chase
        // that closes to contact starts a sea battle. Docking, distance or a recent fight ends it.
        const p = ships.player;
        // At sea: under way, or a pirate lying in wait on a lane (in port a ship has no route).
        const atSea = ship.ai.waitUntil === undefined || ship.ai.route.length > 0;
        if (p && atSea && (ship.ai.chasing || hunts(next, ship))) {
          const d = Math.hypot(p.x - ship.x, p.y - ship.y);
          const calm = (ship.ai.calmUntil ?? 0) > tick;
          const sighted = d <= cb.chase.chaseTiles && lanes.clear([ship.x, ship.y], [p.x, p.y]);
          const safe = sheltered(next, ship, p.x, p.y);
          if (ship.ai.chasing && (p.docked || calm || safe || d > cb.chase.giveUpTiles || !hunts(next, ship))) {
            ships = { ...ships, [id]: rejoin(ship) };
            continue;
          }
          if (!p.docked && !calm && !safe && (ship.ai.chasing || sighted)) {
            if (d <= cb.chase.contactTiles) {
              const calmUntil = tick + Math.round(cb.chase.calmDays * tpd);
              ships = { ...ships, [id]: rejoin({ ...ship, ai: { ...ship.ai, calmUntil } }) };
              events.push({ type: 'BattleJoined', entityIds: ['player', id], payload: { by: 'enemy' } });
            } else {
              const chased = pursue(next, ship, p, dt);
              ships = { ...ships, [id]: { ...chased, ai: { ...chased.ai!, chasing: true } } };
            }
            continue;
          }
        }
        // Hunting other ships: a pirate after a merchant, a patrol after a pirate or an enemy nation's
        // ship. Contact settles it on the spot (no battle view: the player isn't there).
        if (atSea && ship.ai.role !== 'merchant' && (ship.ai.calmUntil ?? 0) <= tick) {
          let prey = ship.ai.target ? ships[ship.ai.target] : undefined;
          const gone = (s: Ship | undefined) =>
            !s?.ai || inPort(s) || sheltered(next, ship, s.x, s.y) || Math.hypot(s.x - ship.x, s.y - ship.y) > cb.chase.giveUpTiles;
          if (ship.ai.target && gone(prey)) {
            ships = { ...ships, [id]: rejoin({ ...ship, ai: { ...ship.ai, target: undefined } }) };
            continue;
          }
          // Look about a few times a second, not every tick.
          if (!prey && (tick + Number(id.split('.')[1] ?? 0)) % LOOKOUT_TICKS === 0) prey = sightPrey(next, ships, ship);
          if (prey) {
            if (Math.hypot(prey.x - ship.x, prey.y - ship.y) <= cb.chase.contactTiles) {
              const fought = seaFight(next, ships, ship, prey, tick, rng);
              next = fought.state;
              ships = fought.ships;
              events.push(...fought.events);
            } else {
              const chased = pursue(next, ship, prey, dt);
              ships = { ...ships, [id]: { ...chased, ai: { ...chased.ai!, target: prey.id } } };
            }
            continue;
          }
        }
        if (ship.ai.waitUntil !== undefined) {
          if (ship.ai.waitUntil > tick) continue;
          if (ship.ai.route.length) {
            // A pirate done lurking: its route home is already set.
            moved = { ...ship, ai: { ...ship.ai, waitUntil: undefined } };
          } else {
            const r = depart({ ...next, ships }, ship, tick, rng);
            next = r.state;
            moved = r.ship;
            events.push(...r.events);
          }
        } else if (ship.ai.along >= routeLength(ship.ai.route)) {
          const r = arrive({ ...next, ships }, ship, tick, rng);
          next = r.state;
          moved = r.ship;
          events.push(...r.events);
        } else {
          moved = sail(next, ship, dt);
        }
        ships = { ...ships, [id]: moved };
      }

      // A ship a day per role tops the population up, so saves made before ships sailed fill too.
      if (tick % tpd === 0) {
        for (const role of ROLES) {
          const have = Object.values(ships).filter((s) => s.ai?.role === role).length;
          if (have >= target(role)) continue;
          const home = homePorts(settlements, lanes, role);
          if (!home.length) continue;
          const port = home[Math.floor(rng.float() * home.length)]!;
          const made = spawn(content, { ...next, ships }, role, port, lanes.mooring(port.id)!, rng, tick);
          next = made.state;
          ships = { ...ships, [made.ship.id]: made.ship };
          events.push({ type: 'ShipSpawned', entityIds: [made.ship.id], payload: { role } });
        }
      }

      // What the player's lookouts see: ships within sight, halved at night. Sightings of ships gone are forgotten.
      const player = ships.player;
      let captain = next.captain;
      if (player && captain) {
        const hour = ((tick % tpd) / tpd) * 24;
        const sight = t.sightTiles * (hour < 6 || hour >= 19 ? t.nightSight : 1);
        const sightings: Record<string, Sighting> = {};
        // A ship that has gone into port is out of sight until she sails again.
        for (const [id, seen] of Object.entries(captain.sightings ?? {})) if (ships[id] && !inPort(ships[id])) sightings[id] = seen;
        for (const s of Object.values(ships)) {
          if (!s.ai || inPort(s) || Math.hypot(s.x - player.x, s.y - player.y) > sight) continue;
          sightings[s.id] = { x: s.x, y: s.y, tick, classId: s.classId, nation: s.ai.nation };
        }
        captain = { ...captain, sightings };
      }
      return { state: { ...next, ships, captain, rng: { ...next.rng, traffic: rng.state() } }, events };
    },
  };
}

/** Ports a role sets out from: havens for pirates, any other port with a lane for the rest. */
function homePorts(settlements: Settlement[], lanes: SeaLanes, role: Role): Settlement[] {
  return settlements.filter((s) => (role === 'pirate' ? isHaven(s) : !isHaven(s)) && lanes.mooring(s.id));
}

/** A new AI ship lying at a port's mooring, sailing on after a few days. */
function spawn(
  content: ContentPack,
  state: WorldState,
  role: Role,
  home: Settlement,
  at: [number, number],
  rng: Rng,
  tick: number,
): { state: WorldState; ship: Ship } {
  const t = content.traffic;
  const nation: Nation = role === 'pirate' ? 'pirate' : home.nation;
  const names = t.names[nation] ?? t.names.pirate!;
  const n = state.nextShipId ?? 0;
  const classId = t.roles[role].classId;
  const cls = content.ships[classId]!;
  const [lo, hi] = content.combat.crew[role];
  const [gold0, gold1] = content.combat.purse[role];
  const ship: Ship = {
    id: `ai.${n}`,
    classId,
    x: at[0],
    y: at[1],
    headingDeg: Math.floor(rng.float() * 32) * 11.25,
    speed: 0,
    helm: 0,
    sails: 'furled',
    blocked: false,
    cargo: {},
    hull: cls.hull,
    sailCondition: 100,
    crew: Math.max(cls.minCrew, Math.round(cls.maxCrew * rng.range(lo, hi))),
    ai: {
      nation,
      role,
      name: names[Math.floor(rng.float() * names.length)]!,
      from: home.id,
      to: home.id,
      route: [],
      along: 0,
      offset: 0,
      tackSign: rng.float() < 0.5 ? 1 : -1,
      waitUntil: tick + Math.round(rng.range(0, t.portDays[1]) * content.calendar.ticksPerDay),
      news: [],
      purse: Math.round(rng.range(gold0, gold1)),
    },
  };
  return { state: { ...state, nextShipId: n + 1 }, ship };
}

/** A new world's ships: the full population, moored at their home ports and setting out over the first days. */
export function withTraffic(world: WorldState, content: ContentPack, settlements: Settlement[], lanes: SeaLanes, seed: number): WorldState {
  const rng = rngStream(seedRng(seed, 'traffic'));
  let state = world;
  const ships = { ...world.ships };
  for (const role of ROLES) {
    const home = homePorts(settlements, lanes, role);
    const count = Math.round(content.traffic.population * content.traffic.roles[role].share);
    for (let i = 0; i < count && home.length; i++) {
      const port = home[Math.floor(rng.float() * home.length)]!;
      const made = spawn(content, state, role, port, lanes.mooring(port.id)!, rng, world.tick);
      state = made.state;
      ships[made.ship.id] = made.ship;
    }
  }
  return { ...state, ships, rng: { ...state.rng, traffic: rng.state() } };
}
