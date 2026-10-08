import { inPort, rngStream, seedRng } from '@corsair/core';
import type { AiCaptain, EmittedEvent, FleetShip, Nation, NewsItem, Prize, Ship, Sighting, System, Wind, WorldState } from '@corsair/core';
import { isLand, shipStats, tileAt } from '@corsair/data';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';
import { crewOf, fleetBerths, fleetHold, fleetMinCrew, fleetOf, moraleOf, newsAt, normalStock, plagued, quote, shipValue, startPlague, withFleetPace } from '@corsair/systems-economy';
import { angleOffWind, bestUpwindDeg, normalizeDeg, targetSpeed } from '@corsair/systems-navigation';
import { atWar, legalTarget, NATIONS, raisePiracy } from '@corsair/systems-politics';
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
  /**
   * Under the guns of a port pirates fear (every port but a haven): within its harbour reach by size, and a
   * capital's further still. Pirates won't chase, fight or lie in wait there.
   */
  const piratesFear = (x: number, y: number) =>
    settlements.some(
      (s) =>
        !isHaven(s) &&
        Math.hypot(s.x - x, s.y - y) <= Math.max(content.combat.chase.harbourTiles[s.size] ?? 0, s.type === 'capital' ? content.combat.chase.capitalTiles : 0),
    );
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
      const weights = Object.fromEntries(marks.map((s) => [s.id, size[s.size] / (1 + Math.hypot(s.x - here.x, s.y - here.y) / t.pirateRangeTiles)]));
      const pick = marks.length ? rng.weighted(weights) : undefined;
      return { to: marks.find((s) => s.id === pick), good: undefined };
    }
    if (ai.role === 'patrol') {
      // At war, a patrol may go to blockade the nearest enemy port within reach.
      const enemy = settlements
        .filter((s) => s.nation !== 'pirate' && !isHaven(s) && reachable(s) && atWar(content, state, ai.nation, s.nation))
        .sort((a, b) => Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y));
      if (enemy.length && rng.float() < t.blockade.chance) return { to: enemy[0], good: undefined, blockade: true };
      // Otherwise to her own ports, the more merchants lost near one lately, the likelier.
      const own = settlements.filter((s) => s.nation === ai.nation && !isHaven(s) && reachable(s) && !plagued(state, s.id));
      const pool = own.length ? own : settlements.filter((s) => !isHaven(s) && reachable(s) && !plagued(state, s.id));
      const since = state.tick - t.patrolLosses.days * tpd;
      const losses = (id: string) => (state.news ?? []).filter((n) => n.tick >= since && n.settlementId === id && (n.kind === 'aiTaken' || n.kind === 'taken')).length;
      const pick = pool.length ? rng.weighted(Object.fromEntries(pool.map((s) => [s.id, 1 + t.patrolLosses.weight * losses(s.id)]))) : undefined;
      return { to: pool.find((s) => s.id === pick), good: undefined };
    }
    // Merchant: per-unit margin between here and each reachable port, skipping routes already busy.
    const busy = (to: string) =>
      Object.values(state.ships).filter((s) => s.ai?.role === 'merchant' && s.ai.from === here.id && s.ai.to === to && s.id !== ship.id).length;
    let best: { to: Settlement; good: string; margin: number } | undefined;
    for (const dest of settlements) {
      // A merchant never calls at the port of a nation at war with hers.
      // Nor at one shut by plague.
      if (isHaven(dest) || !reachable(dest) || busy(dest.id) >= t.maxPerRoute || atWar(content, state, ai.nation, dest.nation) || plagued(state, dest.id)) continue;
      for (const g of content.goods) {
        if (g.staple) continue;
        const buy = quote(content, here, g.id, state.markets?.[here.id]?.[g.id] ?? 0).buy;
        const sell = quote(content, dest, g.id, state.markets?.[dest.id]?.[g.id] ?? 0).sell;
        if (sell - buy > (best?.margin ?? 0)) best = { to: dest, good: g.id, margin: sell - buy };
      }
    }
    if (best) return best;
    // Nothing pays: sail on in ballast to look for trade elsewhere.
    const pool = settlements.filter((s) => !isHaven(s) && reachable(s) && !atWar(content, state, ai.nation, s.nation) && !plagued(state, s.id));
    return { to: pool[Math.floor(rng.float() * pool.length)], good: undefined };
  };

  /** A piece of news starting from a port now (a convoy due, a blockade), as a fight's news does. */
  const newsItem = (state: WorldState, settlementId: string, kind: string, tick: number, ship: string, nation: Nation, extra: Partial<NewsItem> = {}): WorldState => {
    const n = state.nextNewsId ?? 0;
    const item = { id: `news.${n}`, tick, settlementId, kind, good: '', delayDays: 0, ship, nation, ...extra };
    return { ...state, news: [...(state.news ?? []), item], nextNewsId: n + 1 };
  };

  // Ships that change hands (combat.json prizes): a pirate keeps the ships she takes in tow until she sells
  // them at her haven; beaten, she loses them, and they are free again.
  const pz = content.combat.prizes;
  /** An AI ship's hold: her own, and her prizes' in tow. */
  const aiHold = (s: Ship) => content.ships[s.classId]!.cargo + (s.ai?.prizes ?? []).reduce((n, p) => n + content.ships[p.classId]!.cargo, 0);
  /** "brig Swallow": a ship as the news names her. */
  const vessel = (f: { classId: string; name?: string }) => `${f.classId.replace(/^ship\./, '').replace(/_/g, ' ')}${f.name ? ` ${f.name}` : ''}`;
  /** A beaten ship taken in tow, to be sold at the haven some weeks on (when, drawn from her own stream). */
  const asPrize = (
    f: Pick<Ship, 'id' | 'classId' | 'hull' | 'sailCondition' | 'guns' | 'upgrades'> & { name?: string },
    takenFrom: Prize['takenFrom'],
    role: Prize['role'],
    tick: number,
  ): Prize => ({
    id: f.id,
    name: f.name ?? vessel(f),
    classId: f.classId,
    hull: Math.max(1, Math.round(f.hull ?? content.ships[f.classId]!.hull)),
    sailCondition: Math.round(f.sailCondition ?? 100),
    ...(f.guns !== undefined ? { guns: f.guns } : {}),
    ...(f.upgrades ? { upgrades: f.upgrades } : {}),
    takenFrom,
    role,
    sellAfter: tick + Math.round(rngStream(seedRng(tick, `prize:${f.id}`)).range(pz.sellDays[0], pz.sellDays[1]) * tpd),
  });
  /** A prize as a ship of a fleet again. */
  const asFleetShip = ({ takenFrom: _t, role: _r, sellAfter: _s, ...f }: Prize): FleetShip => f;
  /** A pirate with prizes makes for her haven, down the lane from the port nearest her. */
  const makeForHaven = (ship: Ship): Ship => {
    const haven = byId.get(ship.ai!.from);
    if (!haven || !isHaven(haven)) return ship;
    const route = lanes.route(nearestPort(ship.x, ship.y).id, haven.id);
    return route ? rejoin({ ...ship, ai: { ...ship.ai!, to: haven.id, route } }) : ship;
  };
  const nearestTo = <T extends { x: number; y: number }>(list: T[], at: { x: number; y: number }) =>
    list.reduce((a, b) => (Math.hypot(b.x - at.x, b.y - at.y) < Math.hypot(a.x - at.x, a.y - at.y) ? b : a));
  /**
   * Prizes set free (their pirate beaten by `by`): a nation's ship sails for her nearest home port; one of the
   * player's lies at the nearest port of `by`'s nation (or the nearest that will have the player) to be taken
   * back, for salvage when someone else freed her.
   */
  const free = (state: WorldState, prizes: Prize[], at: { x: number; y: number }, pirate: string, by: Nation | 'player', tick: number) => {
    let next = state;
    const ships = { ...state.ships };
    const events: EmittedEvent[] = [];
    const ports = settlements.filter((s) => lanes.mooring(s.id));
    for (const p of prizes) {
      if (p.takenFrom === 'player') {
        const welcome = ports.filter((s) => s.nation === 'pirate' || standingWith(next, s.nation) > cb.standing.refused);
        const theirs = ports.filter((s) => s.nation === by && !isHaven(s));
        const port = nearestTo(theirs.length ? theirs : welcome.length ? welcome : ports, at);
        const fee = by === 'player' ? 0 : Math.round(shipValue(content, p) * pz.salvage);
        if (next.captain) next = { ...next, captain: { ...next.captain, laidUp: [...(next.captain.laidUp ?? []), { ...asFleetShip(p), settlementId: port.id, fee }] } };
        if (by !== 'player' && by !== 'pirate') next = newsItem(next, port.id, 'yourShipRetaken', tick, pirate, by, { vessel: vessel(p) });
        events.push({ type: 'ShipLaidUp', entityIds: [p.id, port.id], payload: { by, fee } });
        continue;
      }
      const homes = ports.filter((s) => s.nation === p.takenFrom && !isHaven(s));
      if (!homes.length) continue;
      const home = nearestTo(homes, at);
      const from = nearestPort(at.x, at.y);
      const cls = content.ships[p.classId]!;
      const route = from.id === home.id ? undefined : lanes.route(from.id, home.id);
      const [mx, my] = lanes.mooring(home.id)!;
      const ship: Ship = {
        id: p.id,
        classId: p.classId,
        x: route ? at.x : mx,
        y: route ? at.y : my,
        headingDeg: 0,
        speed: 0,
        helm: 0,
        sails: route ? 'full' : 'furled',
        blocked: false,
        cargo: {},
        hull: p.hull,
        sailCondition: p.sailCondition,
        crew: cls.minCrew,
        ...(p.guns !== undefined ? { guns: p.guns } : {}),
        ai: {
          nation: p.takenFrom,
          role: p.role,
          name: p.name,
          from: route ? from.id : home.id,
          to: home.id,
          route: route ?? [],
          along: 0,
          offset: 0,
          tackSign: 1,
          news: [],
          purse: 0,
          calmUntil: tick + Math.round(cb.chase.calmDays * tpd),
          ...(route ? {} : { waitUntil: tick + tpd }),
        },
      };
      ships[p.id] = route ? rejoin(ship) : ship;
      next = newsItem({ ...next, ships }, from.id, 'prizeFreed', tick, pirate, p.takenFrom, { vessel: vessel(p) });
      events.push({ type: 'PrizeFreed', entityIds: [p.id], payload: { nation: p.takenFrom, by } });
    }
    return { state: { ...next, ships }, events };
  };
  /** At her haven, a pirate sells the prizes she has held long enough: the news of it, and the hulls gone. */
  const sellPrizes = (state: WorldState, ship: Ship, tick: number) => {
    const port = byId.get(ship.ai!.from);
    const due = (ship.ai!.prizes ?? []).filter((p) => p.sellAfter <= tick);
    if (!port || !isHaven(port) || !due.length) return { state, ship, events: [] as EmittedEvent[] };
    let next = state;
    for (const p of due) next = newsItem(next, port.id, 'prizeSold', tick, ship.ai!.name, 'pirate', { vessel: vessel(p) });
    const prizes = ship.ai!.prizes!.filter((p) => p.sellAfter > tick);
    return {
      state: next,
      ship: withFleetPace(content, { ...ship, ai: { ...ship.ai!, prizes: prizes.length ? prizes : undefined } }, prizes),
      events: due.map((p) => ({ type: 'PrizeSold', entityIds: [ship.id, port.id], payload: { prize: p.id, takenFrom: p.takenFrom } })) as EmittedEvent[],
    };
  };

  /**
   * A convoy sets out on her line's voyage: in from the Atlantic (or from her loading port, for the treasure
   * ship) bound for `to`, with her line's cargo and a rich purse, and her coming is news at her port.
   * Drawn from her own stream, so the timetable moves nothing else in the world.
   */
  const convoy = (state: WorldState, line: (typeof t.convoys.lines)[number], to: string, tick: number): { state: WorldState; ship: Ship } | undefined => {
    const dest = byId.get(to);
    const mooring = dest && lanes.mooring(dest.id);
    if (!dest || !mooring || plagued(state, dest.id)) return undefined;
    const route = line.from ? lanes.route(line.from, to) : lanes.path(t.convoys.entry, mooring);
    if (!route) return undefined;
    const n = state.nextShipId ?? 0;
    const draw = rngStream(seedRng(n, 'convoy'));
    const cls = content.ships[line.classId]!;
    const names = t.names[line.nation] ?? t.names.pirate!;
    const name = names[Math.floor(draw.float() * names.length)]!;
    const [x, y] = route[0]!;
    const ship: Ship = {
      id: `ai.${n}`,
      classId: line.classId,
      x,
      y,
      headingDeg: 270,
      speed: 0,
      helm: 0,
      sails: 'full',
      blocked: false,
      cargo: { ...line.brings },
      hull: cls.hull,
      sailCondition: 100,
      crew: Math.round(cls.maxCrew * 0.8),
      ai: {
        nation: line.nation,
        role: 'merchant',
        name,
        from: line.from ?? to,
        to,
        route,
        along: 0,
        offset: 0,
        tackSign: 1,
        news: [],
        purse: Math.round(draw.range(line.purse[0], line.purse[1])),
        convoy: { line: line.id, stage: 'inbound' },
      },
    };
    const told = newsItem({ ...state, nextShipId: n + 1 }, line.from ?? to, line.from ? 'treasureDue' : 'convoyDue', tick, name, line.nation);
    return { state: told, ship };
  };

  /** Set sail from her haven, a pirate first selling the prizes she has held long enough. */
  const depart = (state: WorldState, ship: Ship, tick: number, rng: Rng): { state: WorldState; ship: Ship; events: EmittedEvent[] } => {
    const sold = sellPrizes(state, ship, tick);
    const r = setSail(sold.state, sold.ship, tick, rng);
    return { ...r, events: [...sold.events, ...r.events] };
  };

  /** Set sail: take on news and (for a merchant) cargo, and start down the lane. */
  const setSail = (state: WorldState, ship: Ship, tick: number, rng: Rng): { state: WorldState; ship: Ship; events: EmittedEvent[] } => {
    const ai = ship.ai!;
    const { to, good, blockade } = orders(state, ship, rng) as ReturnType<typeof orders> & { blockade?: boolean };
    if (!to) return { state, ship: { ...ship, ai: { ...ai, waitUntil: tick + tpd } }, events: [] };
    let route = lanes.route(ai.from, to.id)!;
    if (blockade) {
      // Lie off the enemy port, within blockade reach of it, rather than sail in.
      const length = routeLength(route);
      const stop = Math.max(0, length - t.blockade.tiles * 0.6);
      const end = pointAlong(route, stop);
      const keep: [number, number][] = [route[0]!];
      let run = 0;
      for (let i = 1; i < route.length && run + legLength(route[i - 1]!, route[i]!) < stop; i++) {
        run += legLength(route[i - 1]!, route[i]!);
        keep.push(route[i]!);
      }
      route = [...keep, [end.x, end.y]];
    }
    if (ai.role === 'pirate') {
      // Out toward the mark only part way, to lurk on the lane: never under a port's guns, so a
      // spot that falls there is drawn back toward home.
      const length = routeLength(route);
      let stop = length * rng.range(LURK_AT[0], LURK_AT[1]);
      while (stop > length * LURK_AT[0] / 2 && piratesFear(pointAlong(route, stop).x, pointAlong(route, stop).y)) stop -= length * 0.05;
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
      ai: { ...ai, to: to.id, route, along: 0, offset: 0, waitUntil: undefined, news, carries: plagued(state, ai.from) || undefined, ...(blockade ? { blockading: to.id } : {}) },
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
    if (ai.blockading) {
      // Off the enemy port: lie there a while (the port is blockaded), then home the way she came.
      const days = tick + Math.round(rng.range(t.blockade.days[0], t.blockade.days[1]) * tpd);
      const back = [...ai.route].reverse();
      const port = byId.get(ai.blockading)!;
      const news = newsItem(state, port.id, 'blockade', tick, ship.ai!.name, ai.nation);
      return {
        state: news,
        ship: { ...ship, speed: 0, ai: { ...ai, to: ai.from, route: back, along: 0, offset: 0, waitUntil: days, blockading: undefined, blockadeOf: ai.blockading } as AiCaptain },
        events: [{ type: 'Blockade', entityIds: [ship.id, port.id], payload: { nation: ai.nation } }],
      };
    }
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
    // From a plagued port, she may bring it ashore. Drawn from its own stream, so nothing else moves.
    const spread: EmittedEvent[] = [];
    if (ai.carries && !plagued(next, dest.id)) {
      const draw = rngStream(seedRng(tick, `plague:${ship.id}`));
      const p = content.economy.plague;
      if (draw.float() < p.spread) {
        const r = startPlague(content, next, dest, tick, Math.floor(draw.range(p.weeks[0], p.weeks[1] + 1)));
        next = r.state;
        spread.push(...r.events.map((ev) => ({ ...ev, payload: { ...ev.payload, from: ai.from, ship: ship.id } })));
      }
    }
    if (ai.convoy) {
      // A convoy in from Europe (or the treasure ship): her settlers come ashore, she loads what her line
      // takes home, as far as the market has it, and after a day turns for the Atlantic.
      const line = t.convoys.lines.find((l) => l.id === ai.convoy!.line)!;
      const town = next.towns?.[dest.id];
      if (town && line.people) next = { ...next, towns: { ...next.towns, [dest.id]: { ...town, people: Math.round(town.people * (1 + line.people)) } } };
      const market = { ...next.markets?.[dest.id] };
      const cargo: Record<string, number> = {};
      for (const [good, units] of Object.entries(line.takes)) {
        const n = Math.min(units, Math.floor((market[good] ?? 0) * 0.6));
        if (n <= 0) continue;
        cargo[good] = n;
        market[good] = (market[good] ?? 0) - n;
      }
      next = { ...next, markets: { ...next.markets, [dest.id]: market } };
      const home = lanes.path([mx, my], t.convoys.entry) ?? [[mx, my], t.convoys.entry];
      return {
        state: next,
        ship: {
          ...ship,
          x: mx,
          y: my,
          speed: 0,
          cargo,
          sails: 'furled',
          ai: { ...ai, from: dest.id, route: home, along: 0, offset: 0, waitUntil: tick + tpd, convoy: { line: line.id, stage: 'homeward' } },
        },
        events: [...spread, { type: 'ConvoyArrived', entityIds: [ship.id, dest.id], payload: { line: line.id, brought: ship.cargo, takes: cargo } }],
      };
    }
    return {
      state: next,
      ship: {
        ...ship,
        x: mx,
        y: my,
        speed: 0,
        cargo: {},
        sails: 'furled',
        ai: { ...ai, from: dest.id, route: [], along: 0, offset: 0, waitUntil: wait, carries: undefined },
      },
      events: [...spread, { type: 'ShipArrived', entityIds: [ship.id, dest.id], payload: { role: ai.role, cargo: ship.cargo } }],
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
  /** What's left in the hold keeps its share of what it cost. */
  const paidFor = (ship: Ship, cargo: Record<string, number>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(ship.paid ?? {})
        .filter(([g]) => cargo[g])
        .map(([g, paid]) => [g, Math.round(paid * (cargo[g]! / Math.max(1, ship.cargo[g] ?? 1)))]),
    );
  /** Plunder marks can't outnumber what's left aboard. */
  const plunderFor = (ship: Ship, cargo: Record<string, number>): Record<string, number> =>
    Object.fromEntries(Object.entries(ship.plunder ?? {}).filter(([g]) => cargo[g]).map(([g, n]) => [g, Math.min(n, cargo[g]!)]));
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
    hunter.ai!.role === 'pirate'
      ? piratesFear(x, y)
      : settlements.some((s) => atWar(content, state, hunter.ai!.nation, s.nation) && Math.hypot(s.x - x, s.y - y) <= (cb.chase.harbourTiles[s.size] ?? 0));

  /** What a hunter goes after: pirates take merchants; patrols take pirates and their nation's enemies. */
  const isPrey = (state: WorldState, hunter: Ship, s: Ship) => {
    if (!s.ai || s.id === hunter.id || inPort(s) || sheltered(state, hunter, s.x, s.y)) return false;
    // A merchant already fighting off a pirate is that pirate's; a pirate on someone is fair game for a patrol.
    if (hunter.ai!.role === 'pirate') return s.ai.role === 'merchant' && !s.ai.skirmish;
    return s.ai.role === 'pirate' || atWar(content, state, hunter.ai!.nation, s.ai.nation);
  };
  /** A ship's fighting strength: her crew, and more for her guns (the same measure AI fights use). */
  const strength = (s: Ship) => crewOf(content, s) * (1 + shipStats(content, s).guns / 10);
  /** What a pirate stands to take from her: her cargo at base price and her purse; the player's ship counts more. */
  const worth = (s: Ship) =>
    Object.entries(s.cargo).reduce((n, [g, u]) => n + (content.goods.find((x) => x.id === g)?.basePrice ?? 0) * u, 0) +
    (s.ai ? (s.ai.purse ?? 0) : cb.hunt.playerValue);
  /**
   * The lookout: of every ship in sight, the player included, the one this hunter goes after. A pirate
   * weighs what each would yield against the odds, and lets be a ship too strong for her temperament; a
   * patrol takes on pirates (first one already on someone, to the rescue) and her nation's enemies.
   */
  const lookout = (state: WorldState, ships: Record<string, Ship>, hunter: Ship): Ship | undefined => {
    const pirate = hunter.ai!.role === 'pirate';
    const need = pirate ? (cb.tactics.temperaments[hunter.ai!.temperament ?? 'bold']?.attackOdds ?? 1) * (hunter.ai!.nerve ?? 1) : cb.hunt.patrolOdds;
    const mine = strength(hunter);
    const sight = cb.chase.chaseTiles;
    let best: { s: Ship; score: number } | undefined;
    for (const s of Object.values(ships)) {
      const eligible = s.ai ? isPrey(state, hunter, s) : !s.docked && hunts(state, hunter) && !sheltered(state, hunter, s.x, s.y);
      if (!eligible) continue;
      const d = Math.hypot(s.x - hunter.x, s.y - hunter.y);
      if (d > sight || !lanes.clear([hunter.x, hunter.y], [s.x, s.y])) continue;
      const odds = mine / Math.max(1, strength(s));
      if (odds < need) continue;
      const near = 1 / (1 + d / sight);
      const busy = s.ai?.role === 'pirate' && (s.ai.chasing || s.ai.target || s.ai.skirmish);
      const score = pirate ? worth(s) * Math.min(odds, 2) * near : (busy ? cb.hunt.rescueBonus : 1) * near;
      if (score > 0 && (!best || score > best.score)) best = { s, score };
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
    let prizes = winner.ai!.prizes ?? [];
    // Prizes the loser held, freed unless a pirate takes them on (as far as she has room in tow).
    let freed = loser.ai!.prizes ?? [];
    if (winner.ai!.role === 'pirate') {
      // She keeps the beaten ship in tow (a pirate she beats goes down), and any the loser had.
      const taken = loser.ai!.role === 'pirate' ? [] : [asPrize({ ...loser, name: loser.ai!.name }, loser.ai!.nation, loser.ai!.role, tick)];
      const all = [...prizes, ...taken, ...freed];
      prizes = all.slice(0, pz.max);
      freed = all.slice(pz.max);
      // Plunder: what her hold (and her prizes') takes, and the purse.
      cargo = { ...cargo };
      const hold = aiHold({ ...winner, ai: { ...winner.ai!, prizes } });
      const room = () => hold - Object.values(cargo).reduce((x, y) => x + y, 0);
      for (const [good, units] of Object.entries(loser.cargo)) {
        const take = Math.min(units, room());
        if (take > 0) cargo[good] = (cargo[good] ?? 0) + take;
      }
      purse += loser.ai!.purse ?? 0;
    }
    // A pirate with a prize makes for home (the lane back to her haven), at her prizes' pace, and lies low a week.
    const homeward = winner.ai!.role === 'pirate' && loser.ai!.role !== 'pirate';
    const sailor = withFleetPace(
      content,
      rejoin({
        ...winner,
        crew,
        cargo,
        ai: {
          ...winner.ai!,
          target: undefined,
          skirmish: undefined,
          purse,
          prizes: prizes.length ? prizes : undefined,
          calmUntil: homeward ? tick + Math.round(cb.chase.prizeCalmDays * tpd) : calmUntil,
        },
      }),
      prizes,
    );
    out[winner.id] = homeward ? makeForHaven(sailor) : sailor;
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
    const events: EmittedEvent[] = [
      { type: 'SeaFight', entityIds: [winner.id, loser.id], payload: { x: loser.x, y: loser.y, winner: winner.ai!.nation, loser: loser.ai!.nation } },
    ];
    if (!freed.length) return { state: next, ships: out, events };
    const holder = loser.ai!.prizes?.length ? loser.ai!.name : winner.ai!.name;
    const f = free({ ...next, ships: out }, freed, loser, holder, winner.ai!.nation, tick);
    return { state: f.state, ships: f.state.ships, events: [...events, ...f.events] };
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
        const { outcome, player: mine, enemy: theirs, salvage } = command.result;
        const cls = content.ships[player.classId]!;
        const nation = other.ai.nation;
        const taken = outcome === 'struck' || outcome === 'boarded';
        const won = taken || outcome === 'sunk';
        const beaten = outcome === 'lost';
        const before = state.captain;
        let captain = before;
        let cargo = player.cargo;
        const ships = { ...state.ships };
        // Beaten, the player is let go afloat. A pirate takes the plunder chest and what her own hold can carry
        // of the cargo, the most valuable first (never the rations); a nation's captain fines half the purse.
        // The captain's own purse is safe from pirates (as gold already divided is in Pirates! 2004). What the
        // victor takes she keeps, in her hold and purse: take her later and it comes back.
        const retaken: { name: string; classId: string }[] = [];
        const freedHere: Prize[] = [];
        const lost: { gold: number; chest: number; cargo: Record<string, number>; ship?: { name: string; classId: string }; men?: number; boundFor?: string } = {
          gold: 0,
          chest: 0,
          cargo: {},
        };
        let victor = other;
        // The fleet as the fight leaves it: a pirate may take a ship of it; beating a pirate may win ships back.
        let fleetAfter = fleetOf(state);
        if (beaten) {
          if (other.ai.role === 'pirate') {
            // She takes the most valuable ship of the fleet in tow (never the flagship), room allowing.
            let prizes = other.ai.prizes ?? [];
            if (fleetAfter.length && prizes.length < pz.max) {
              const best = [...fleetAfter].sort((a, b) => shipValue(content, b) - shipValue(content, a))[0]!;
              fleetAfter = fleetAfter.filter((f) => f !== best);
              prizes = [...prizes, asPrize(best, 'player', 'merchant', state.tick)];
              lost.ship = { name: best.name, classId: best.classId };
            }
            const theirHold: Record<string, number> = { ...other.cargo };
            let room = aiHold({ ...other, ai: { ...other.ai, prizes } }) - Object.values(theirHold).reduce((a, b) => a + b, 0);
            const worth = (g: string) => content.goods.find((x) => x.id === g)?.basePrice ?? 0;
            const left: Record<string, number> = { ...player.cargo };
            for (const g of Object.keys(left).filter((g) => g !== 'food').sort((a, b) => worth(b) - worth(a))) {
              const take = Math.max(0, Math.min(left[g]!, room));
              if (!take) continue;
              lost.cargo[g] = take;
              theirHold[g] = (theirHold[g] ?? 0) + take;
              left[g]! -= take;
              if (!left[g]) delete left[g];
              room -= take;
            }
            // What the rest of the fleet can't hold went with the ship she took: the cheapest first, the food last.
            const capacity = fleetHold(content, { ...state, captain: { ...before, fleet: fleetAfter } }, player);
            let over = Object.values(left).reduce((a, b) => a + b, 0) - capacity;
            for (const g of Object.keys(left).sort((a, b) => Number(a === 'food') - Number(b === 'food') || worth(a) - worth(b))) {
              if (over <= 0) break;
              const n = Math.min(left[g]!, Math.ceil(over));
              lost.cargo[g] = (lost.cargo[g] ?? 0) + n;
              theirHold[g] = (theirHold[g] ?? 0) + n;
              left[g]! -= n;
              if (!left[g]) delete left[g];
              over -= n;
            }
            lost.chest = before.chest ?? 0;
            cargo = left;
            captain = { ...captain, chest: 0 };
            victor = { ...other, cargo: theirHold, ai: { ...other.ai, purse: (other.ai.purse ?? 0) + Math.round(lost.chest), prizes: prizes.length ? prizes : undefined } };
          } else {
            lost.gold = Math.floor(before.gold / 2);
            captain = { ...captain, gold: before.gold - lost.gold };
            victor = { ...other, ai: { ...other.ai, purse: (other.ai.purse ?? 0) + lost.gold } };
          }
        }
        // The crew's spirits: a prize lifts them, a loss of men or the fight sinks them (crew.json morale).
        const cm = content.crew.morale;
        const crewBefore = crewOf(content, player);
        // Only the men aboard the flagship fought (her berths' worth of the fleet's crew): only they could fall.
        const fought = Math.min(crewBefore, shipStats(content, { ...player, fleetSpeed: undefined }).maxCrew);
        const menLost = Math.max(0, fought - mine.crew);
        const cheer = taken ? cm.taken : outcome === 'sunk' ? cm.sunk : beaten ? -cm.taken : 0;
        const moraleBefore = moraleOf(content, state);
        const morale = Math.max(0, Math.min(100, moraleBefore + cheer - (cm.lossFactor * menLost) / Math.max(1, crewBefore)));
        captain = { ...captain, morale };
        // The fight was virtual: each ship stays where they met. Guns knocked out stay lost.
        ships[player.id] = {
          ...player,
          guns: mine.guns,
          cargo,
          paid: beaten && other.ai.role === 'pirate' ? paidFor(player, cargo) : player.paid,
          plunder: beaten && other.ai.role === 'pirate' ? plunderFor(player, cargo) : player.plunder,
          hull: Math.max(beaten ? Math.ceil(cls.hull * 0.1) : 1, mine.hull),
          sailCondition: Math.max(beaten ? 20 : 0, mine.sailCondition),
          crew: Math.max(beaten ? Math.ceil(cls.minCrew / 2) : 1, crewBefore - menLost),
        };
        if (lost.ship) {
          // Her prize crew: the men the rest of the fleet can't berth went with her.
          const berths = fleetBerths(content, { ...state, captain: { ...before, fleet: fleetAfter } }, player);
          const crew = ships[player.id]!.crew!;
          if (crew > berths) {
            lost.men = crew - berths;
            ships[player.id] = { ...ships[player.id]!, crew: berths };
          }
        }
        // Picked from the wreck: the barrels' gold is plunder, the men out of the water sign on (berths allowing).
        let rescued = 0;
        if (salvage) {
          captain = { ...captain, chest: (captain.chest ?? 0) + salvage.gold };
          rescued = Math.max(0, Math.min(salvage.men, fleetBerths(content, state, player) - ships[player.id]!.crew!));
          ships[player.id] = { ...ships[player.id]!, crew: ships[player.id]!.crew! + rescued };
        }
        let prize: WorldState['prize'];
        let purse = 0;
        if (!won) {
          // She sails on, mauled, and leaves the player be a while.
          const calmUntil = state.tick + Math.round(cb.chase.calmDays * tpd);
          const mauled: Ship = { ...victor, ...theirs, ai: { ...victor.ai!, chasing: false, skirmish: undefined, calmUntil } };
          if (lost.ship) {
            // With a ship of the player's in tow she makes for her haven, at her prizes' pace.
            const away = makeForHaven(withFleetPace(content, mauled, mauled.ai!.prizes ?? []));
            ships[other.id] = away;
            lost.boundFor = byId.get(away.ai!.to)?.name ?? away.ai!.to;
          } else ships[other.id] = mauled;
        } else {
          // Sunk or taken: she's off the sea. Taken, her gold is plunder at once (it weighs nothing); her
          // cargo and the men who would sign on wait for the captain's word on the plunder screen (TakePlunder).
          delete ships[other.id];
          // Her prizes are free: the player's own rejoin the fleet as far as room and men allow (the rest lie
          // in the nearest port that will have the player); a nation's sail home.
          for (const p of other.ai.prizes ?? []) {
            const men = ships[player.id]!.crew ?? 0;
            if (p.takenFrom === 'player' && fleetAfter.length + 2 <= cb.fleet.maxShips && men >= fleetMinCrew(content, [...fleetAfter, p], player)) {
              fleetAfter = [...fleetAfter, asFleetShip(p)];
              retaken.push({ name: p.name, classId: p.classId });
            } else freedHere.push(p);
          }
          if (taken) {
            purse = other.ai.purse ?? 0;
            captain = { ...captain, chest: (captain.chest ?? 0) + purse };
            const share = other.ai.role === 'pirate' ? content.crew.volunteers.pirate : content.crew.volunteers.other;
            const berths = fleetBerths(content, state, player) - ships[player.id]!.crew!;
            const volunteers = Math.max(0, Math.min(berths, Math.round(theirs.crew * share)));
            prize = { ship: { ...other, ...theirs, ai: { ...other.ai, purse: 0, chasing: false, target: undefined, skirmish: undefined, prizes: undefined } }, volunteers };
          }
          const standing = { ...captain.standing };
          // A nation thinks the better of the captain who freed its ships.
          for (const p of freedHere) if (p.takenFrom !== 'player') standing[p.takenFrom] = Math.min(100, (standing[p.takenFrom] ?? 0) + cb.hunt.rescueStanding);
          if (nation === 'pirate') {
            // Everyone thinks the better of a pirate hunter, and a merchant's nation more, when she was on one of theirs.
            for (const n of NATIONS) standing[n] = Math.min(100, (standing[n] ?? 0) + cb.standing.pirate);
            const saved = other.ai.skirmish ? state.ships[other.ai.skirmish.with] : undefined;
            const theirs = saved?.ai?.nation;
            if (theirs && theirs !== 'pirate') standing[theirs] = Math.min(100, (standing[theirs] ?? 0) + cb.hunt.rescueStanding);
          } else {
            // Her nation's enemies approve (Pirates! 2004: twice over for a warship carried, not sunk).
            const gain = cb.standing.enemyWin * (taken && other.ai.role === 'patrol' ? cb.standing.warshipTaken : 1);
            for (const n of NATIONS) if (n !== nation && atWar(content, state, n, nation)) standing[n] = Math.min(100, (standing[n] ?? 0) + gain);
          }
          captain = { ...captain, standing };
          // A deed for a governor's bounty: any governor pays for pirates; enemies of his nation, too.
          const deed = { nation, role: other.ai.role, kind: outcome === 'sunk' ? ('sunk' as const) : ('taken' as const), tick: state.tick };
          captain = { ...captain, deeds: [...(captain.deeds ?? []), deed] };
        }
        // The after-action report: everything the fight changed, for the battle's last screen.
        const standingChange: Record<string, number> = {};
        for (const n of NATIONS) {
          const d = (captain.standing?.[n] ?? 0) - (before.standing?.[n] ?? 0);
          if (d) standingChange[n] = d;
        }
        const events: EmittedEvent[] = [
          {
            type: 'BattleOver',
            entityIds: [player.id, other.id],
            payload: {
              outcome,
              ship: other.ai.name,
              nation,
              role: other.ai.role,
              purse,
              salvageGold: salvage?.gold ?? 0,
              rescued,
              menLost,
              volunteers: prize?.volunteers ?? 0,
              moraleBefore: Math.round(moraleBefore),
              morale: Math.round(morale),
              standing: standingChange,
              lost,
              retaken,
              laidUp: [] as { name: string; classId: string; at: string }[],
            },
          },
        ];
        // The fleet changed hands: it sails at its slowest ship's pace.
        if (lost.ship || retaken.length) {
          ships[player.id] = withFleetPace(content, ships[player.id]!, fleetAfter);
          captain = { ...captain, fleet: fleetAfter };
        }
        // The fight is news, starting from the nearest port.
        let next: WorldState = { ...state, ships, captain, prize };
        // So is the ship she took: the pirate who has her.
        if (lost.ship) next = newsItem(next, nearestPort(other.x, other.y).id, 'yourShipTaken', state.tick, other.ai.name, 'pirate', { vessel: vessel(lost.ship) });
        if (freedHere.length) {
          const f = free(next, freedHere, other, other.ai.name, 'player', state.tick);
          next = f.state;
          events.push(...f.events);
          const laid = events[0]!.payload.laidUp as { name: string; classId: string; at: string }[];
          for (const e of f.events.filter((x) => x.type === 'ShipLaidUp')) {
            const p = freedHere.find((x) => x.id === e.entityIds[0])!;
            laid.push({ name: p.name, classId: p.classId, at: byId.get(e.entityIds[1]!)?.name ?? e.entityIds[1]! });
          }
        }
        if (won) {
          const kind = nation === 'pirate' && outcome === 'sunk' ? 'pirateSunk' : outcome === 'sunk' ? 'sunk' : 'taken';
          const rng = rngStream(state.rng?.traffic ?? seedRng(0, 'traffic'));
          const n = next.nextNewsId ?? 0;
          const item = {
            id: `news.${n}`,
            tick: state.tick,
            settlementId: nearestPort(other.x, other.y).id,
            kind,
            good: '',
            delayDays: Math.floor(rng.range(content.economy.news.delayDays[0], content.economy.news.delayDays[1] + 1)),
            ship: other.ai.name,
            nation,
          };
          next = { ...next, news: [...(next.news ?? []), item], nextNewsId: n + 1, rng: { ...next.rng, traffic: rng.state() } };
        }
        return { state: next, events };
      }
      if (command.type === 'TakePlunder') {
        // The plunder screen's word (Pirates! 2004): her goods the hold can take, the player's own thrown
        // over to make room, the volunteers signed on or put ashore, and the prize let go or sunk.
        const player = state.ships[command.shipId];
        const prize = state.prize;
        if (!player || !prize) return undefined;
        const cargo: Record<string, number> = { ...player.cargo };
        const plunder: Record<string, number> = { ...player.plunder };
        const paid: Record<string, number> = { ...player.paid };
        const jettisoned: Record<string, number> = {};
        for (const [good, n] of Object.entries(command.jettison ?? {})) {
          const held = cargo[good] ?? 0;
          const out = Math.max(0, Math.min(held, Math.floor(n)));
          if (!out) continue;
          jettisoned[good] = out;
          // What's left keeps its share of what it cost; plunder marks can't outnumber what's aboard.
          if (paid[good]) paid[good] = Math.round(paid[good] * ((held - out) / held));
          cargo[good] = held - out;
          if (plunder[good]) plunder[good] = Math.min(plunder[good], cargo[good]);
          if (!cargo[good]) {
            delete cargo[good];
            delete paid[good];
          }
          if (!plunder[good]) delete plunder[good];
        }
        // Keep her: she joins the fleet, if it has room (8 ships) and men enough to sail every ship.
        const fleet = fleetOf(state);
        const keep = Boolean(command.keep);
        if (keep) {
          const crewAfter = crewOf(content, player) + (command.volunteers ? prize.volunteers : 0);
          const whyNot =
            fleet.length + 2 > cb.fleet.maxShips ? 'fleet-full' : crewAfter < fleetMinCrew(content, [...fleet, prize.ship], player) ? 'too-few-men' : undefined;
          if (whyNot) return { state, events: [{ type: 'PlunderRefused', entityIds: [player.id, prize.ship.id], payload: { reason: whyNot } }] };
        }
        const capacity = fleetHold(content, state, player) + (keep ? content.ships[prize.ship.classId]!.cargo : 0);
        const room = () => capacity - Object.values(cargo).reduce((a, b) => a + b, 0);
        const theirs: Record<string, number> = { ...prize.ship.cargo };
        const took: Record<string, number> = {};
        for (const [good, n] of Object.entries(command.take)) {
          const take = Math.max(0, Math.min(Math.floor(n), theirs[good] ?? 0, room()));
          if (!take) continue;
          took[good] = take;
          cargo[good] = (cargo[good] ?? 0) + take;
          plunder[good] = (plunder[good] ?? 0) + take;
          theirs[good]! -= take;
          if (!theirs[good]) delete theirs[good];
        }
        const crew = crewOf(content, player);
        // She joins the fleet with her damage (her hold's contents come aboard as plunder above).
        const kept = prize.ship;
        const fleetAfter = keep
          ? [
              ...fleet,
              {
                id: kept.id,
                name: kept.ai!.name,
                classId: kept.classId,
                hull: Math.max(1, Math.round(kept.hull ?? content.ships[kept.classId]!.hull)),
                sailCondition: Math.round(kept.sailCondition ?? 100),
                ...(kept.guns !== undefined ? { guns: kept.guns } : {}),
              },
            ]
          : fleet;
        const berths = fleetBerths(content, { ...state, captain: state.captain && { ...state.captain, fleet: fleetAfter } }, player);
        const join = command.volunteers ? Math.max(0, Math.min(prize.volunteers, berths - crew)) : 0;
        const ships = { ...state.ships, [player.id]: withFleetPace(content, { ...player, cargo, plunder, paid, crew: crew + join }, fleetAfter) };
        // Her fate is talked of in her home ports: a merchant let go speaks well of you, one sunk after she
        // struck does not. A pirate let go just goes back to her trade.
        const nation = prize.ship.ai!.nation;
        let captain = state.captain;
        if (captain && nation !== 'pirate') {
          // Kept or sunk, she doesn't sail home: both are spoken of alike.
          const change = command.release && !keep ? cb.standing.mercy : cb.standing.scuttle;
          captain = { ...captain, standing: { ...captain.standing, [nation]: Math.max(-100, Math.min(100, standingWith(state, nation) + change)) } };
        }
        if (keep && captain) captain = { ...captain, fleet: fleetAfter };
        if (command.release && !keep) {
          // Let go with what's left in her hold; she keeps clear of the player a while.
          const calmUntil = state.tick + Math.round(cb.chase.calmDays * tpd);
          const left = prize.ship;
          ships[left.id] = { ...left, cargo: theirs, crew: Math.max(1, (left.crew ?? 0) - join), ai: { ...left.ai!, calmUntil } };
        }
        return {
          state: { ...state, ships, captain, prize: undefined },
          events: [{ type: 'PlunderTaken', entityIds: [player.id, prize.ship.id], payload: { took, jettisoned, volunteers: join, released: command.release && !keep, kept: keep } }],
        };
      }
      if (command.type === 'Teleport' && state.ships[command.shipId]?.ai) {
        // Debug: an AI ship moved by hand picks up her lane from where she is put (the player's ship is the
        // navigation system's).
        const ship = state.ships[command.shipId]!;
        if (!water(command.x, command.y)) return undefined;
        const moved = rejoin({ ...ship, x: command.x, y: command.y, speed: 0, ai: { ...ship.ai!, waitUntil: undefined } });
        return { state: { ...state, ships: { ...state.ships, [ship.id]: moved } }, events: [{ type: 'Teleported', entityIds: [ship.id], payload: {} }] };
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
        const p = ships.player;
        // At sea: under way, or a pirate lying in wait on a lane (in port a ship has no route).
        const atSea = ship.ai.waitUntil === undefined || ship.ai.route.length > 0;
        // Hove to in a fight the player can see: until it's settled, or her foe is gone (the player took a
        // hand, or a patrol came up), when she goes on her way.
        if (ship.ai.skirmish) {
          const foe = ships[ship.ai.skirmish.with];
          if (!foe?.ai || foe.ai.skirmish?.with !== id) {
            ships = { ...ships, [id]: rejoin({ ...ship, ai: { ...ship.ai, skirmish: undefined, target: undefined } }) };
          } else if (tick >= ship.ai.skirmish.until) {
            // Settled: the hunter's fight, as one out of sight would have been.
            const [hunter, prey] = ship.ai.role === 'merchant' ? [foe, ship] : [ship, foe];
            const fought = seaFight(next, ships, hunter, prey, tick, rng);
            next = fought.state;
            ships = fought.ships;
            events.push(...fought.events);
          } else ships = { ...ships, [id]: { ...ship, speed: 0 } };
          continue;
        }
        // The hunt (pirates and patrols): a chase of the player closes to a sea battle; a chase of another
        // ship closes to a fight between them. Docking, distance, a feared port or a recent fight ends it.
        if (atSea && ship.ai.role !== 'merchant') {
          const calm = (ship.ai.calmUntil ?? 0) > tick;
          if (ship.ai.chasing) {
            const d = p ? Math.hypot(p.x - ship.x, p.y - ship.y) : Infinity;
            if (!p || p.docked || calm || sheltered(next, ship, p.x, p.y) || d > cb.chase.giveUpTiles || !hunts(next, ship)) {
              ships = { ...ships, [id]: rejoin(ship) };
            } else if (d <= cb.chase.contactTiles) {
              const calmUntil = tick + Math.round(cb.chase.calmDays * tpd);
              ships = { ...ships, [id]: rejoin({ ...ship, ai: { ...ship.ai, calmUntil } }) };
              events.push({ type: 'BattleJoined', entityIds: ['player', id], payload: { by: 'enemy' } });
            } else {
              const chased = pursue(next, ship, p, dt);
              ships = { ...ships, [id]: { ...chased, ai: { ...chased.ai!, chasing: true } } };
            }
            continue;
          }
          let prey = ship.ai.target ? ships[ship.ai.target] : undefined;
          // A pirate leaves a merchant another pirate has fallen on; a patrol presses on to the rescue.
          const taken = ship.ai.role === 'pirate' && prey?.ai?.skirmish && prey.ai.skirmish.with !== id;
          if (ship.ai.target && (!prey?.ai || inPort(prey) || taken || sheltered(next, ship, prey.x, prey.y) || Math.hypot(prey.x - ship.x, prey.y - ship.y) > cb.chase.giveUpTiles)) {
            ships = { ...ships, [id]: rejoin({ ...ship, ai: { ...ship.ai, target: undefined } }) };
            continue;
          }
          // Look about a few times a second, not every tick: the player and every other ship alike.
          if (!prey && !calm && (tick + Number(id.split('.')[1] ?? 0)) % LOOKOUT_TICKS === 0) {
            const seen = lookout(next, ships, ship);
            if (seen && !seen.ai) {
              const chased = pursue(next, ship, seen, dt);
              ships = { ...ships, [id]: { ...chased, ai: { ...chased.ai!, chasing: true, target: undefined } } };
              continue;
            }
            prey = seen;
          }
          if (prey) {
            if (Math.hypot(prey.x - ship.x, prey.y - ship.y) > cb.chase.contactTiles) {
              const chased = pursue(next, ship, prey, dt);
              ships = { ...ships, [id]: { ...chased, ai: { ...chased.ai!, target: prey.id } } };
            } else if (p && Math.hypot(prey.x - p.x, prey.y - p.y) <= t.sightTiles) {
              // Within the player's sight the fight plays out on the map for a while, and she can take a hand.
              const until = tick + Math.round((cb.hunt.skirmishHours / 24) * tpd);
              ships = {
                ...ships,
                [id]: { ...ship, speed: 0, ai: { ...ship.ai, target: undefined, skirmish: { with: prey.id, until } } },
                [prey.id]: { ...prey, speed: 0, ai: { ...prey.ai!, target: undefined, skirmish: { with: id, until } } },
              };
              events.push({ type: 'SkirmishBegun', entityIds: [id, prey.id], payload: { x: prey.x, y: prey.y } });
            } else {
              const fought = seaFight(next, ships, ship, prey, tick, rng);
              next = fought.state;
              ships = fought.ships;
              events.push(...fought.events);
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
        } else if (ship.ai.convoy?.stage === 'homeward' && ship.ai.along >= routeLength(ship.ai.route)) {
          // Home to Europe: she sails off the map.
          const { [id]: _gone, ...rest } = ships;
          ships = rest;
          events.push({ type: 'ConvoySailedHome', entityIds: [id], payload: { line: ship.ai.convoy.line, cargo: ship.cargo } });
          continue;
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

      // The convoys' timetable: each line sails every so many days, to its ports in turn.
      if (tick % tpd === 0) {
        const day = tick / tpd;
        for (const line of t.convoys.lines) {
          if (day < line.firstDay || (day - line.firstDay) % line.everyDays !== 0) continue;
          const voyage = (day - line.firstDay) / line.everyDays;
          const made = convoy({ ...next, ships }, line, line.to[voyage % line.to.length]!, tick);
          if (!made) continue;
          next = made.state;
          ships = { ...ships, [made.ship.id]: made.ship };
          events.push({ type: 'ConvoySailed', entityIds: [made.ship.id, made.ship.ai!.to], payload: { line: line.id } });
        }
      }

      // A ship a day per role tops the population up, so saves made before ships sailed fill too.
      if (tick % tpd === 0) {
        for (const role of ROLES) {
          // Prizes in tow are still hulls of their role: replaced only once sold.
          const have = Object.values(ships).reduce(
            (n, s) => n + (s.ai?.role === role && !s.ai.convoy ? 1 : 0) + (s.ai?.prizes ?? []).filter((p) => p.takenFrom !== 'player' && p.role === role).length,
            0,
          );
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
  const [lo, hi] = content.combat.crew[role];
  const [gold0, gold1] = content.combat.purse[role];
  // A pirate's temperament and nerve, and whether she sails a bigger ship (more likely the stronger the
  // player has grown), each from her own stream so drawing them moves nothing else.
  const temperaments = content.combat.tactics.temperaments;
  const temperament =
    role === 'pirate' ? rngStream(seedRng(n, 'temperament')).weighted(Object.fromEntries(Object.entries(temperaments).map(([k, v]) => [k, v.share]))) : undefined;
  const nerve = role === 'pirate' ? rngStream(seedRng(n, 'nerve')).range(content.combat.hunt.nerve[0], content.combat.hunt.nerve[1]) : undefined;
  const big = t.biggerPirates;
  const player = Object.values(state.ships).find((s) => !s.ai);
  const grown = player ? crewOf(content, player) * (1 + shipStats(content, player).guns / 10) : 0;
  const bigShare = big.maxShare * Math.max(0, Math.min(1, (grown - big.from) / (big.full - big.from)));
  const shipClass = role === 'pirate' && rngStream(seedRng(n, 'bigger')).float() < bigShare ? big.classId : classId;
  const cls = content.ships[shipClass]!;
  const ship: Ship = {
    id: `ai.${n}`,
    classId: shipClass,
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
      ...(temperament ? { temperament } : {}),
      ...(nerve !== undefined ? { nerve: Math.round(nerve * 100) / 100 } : {}),
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
