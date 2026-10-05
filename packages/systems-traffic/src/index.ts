import { rngStream, seedRng } from '@corsair/core';
import type { AiCaptain, EmittedEvent, Nation, Ship, Sighting, System, Wind, WorldState } from '@corsair/core';
import { isLand, tileAt } from '@corsair/data';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';
import { newsAt, normalStock, quote } from '@corsair/systems-economy';
import { angleOffWind, bestUpwindDeg, normalizeDeg, targetSpeed } from '@corsair/systems-navigation';
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
/** Pirates lurk this far along the lane toward their mark, then turn for home. */
const LURK_AT = 0.6;
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
      const marks = settlements.filter((s) => !isHaven(s) && reachable(s));
      return { to: marks[Math.floor(rng.float() * marks.length)], good: undefined };
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
      const stop = routeLength(route) * LURK_AT;
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
      // Lurked long enough on the lane: head back the way it came, to the haven it left.
      const back = [...ai.route].reverse();
      return {
        state,
        ship: { ...ship, speed: 0, ai: { ...ai, to: ai.from, route: back, along: 0, offset: 0, waitUntil: wait } },
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
  const sail = (state: WorldState, ship: Ship, dt: number): Ship => {
    const ai = ship.ai!;
    const total = routeLength(ai.route);
    const lane = pointAlong(ai.route, ai.along);
    const wind = windAt(state, ship.x, ship.y);
    const best = bestUpwind.get(content.ships[ship.classId]!.polar) ?? 45;
    const off = angleOffWind(lane.deg, wind.fromDeg);
    let { offset, tackSign } = ai;
    let heading = lane.deg;
    if (off < best) {
      // Close-hauled on the current tack: the course `best` off the wind on that side of the lane.
      heading = normalizeDeg(wind.fromDeg + tackSign * best);
    } else if (offset !== 0) {
      // Back onto the lane at a gentle angle once it frees.
      heading = normalizeDeg(lane.deg - Math.sign(offset) * 15);
    }
    const speed = targetSpeed(content, { ...ship, headingDeg: heading, sails: 'full' }, wind);
    const rel = ((heading - lane.deg) * Math.PI) / 180;
    const along = Math.min(total, ai.along + Math.max(0, Math.cos(rel)) * speed * dt);
    offset += Math.sin(rel) * speed * dt;
    if (off >= best && Math.abs(offset) < speed * dt) offset = 0;
    const at = pointAlong(ai.route, along);
    // Right of the lane in compass terms: the lane's direction turned 90 degrees clockwise.
    const nr = (at.deg * Math.PI) / 180;
    let x = at.x + Math.cos(nr) * offset;
    let y = at.y + Math.sin(nr) * offset;
    if (Math.abs(offset) >= t.tackTiles || !water(x, y)) {
      // Come about: at the edge of the corridor, or about to touch land.
      tackSign = tackSign === 1 ? -1 : 1;
      offset = Math.max(-t.tackTiles, Math.min(t.tackTiles, offset)) * (water(x, y) ? 1 : 0.5);
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

  /** Close on the player: straight at them where the wind allows, tacking toward them where it doesn't; never onto land. */
  const pursue = (state: WorldState, ship: Ship, player: Ship, dt: number): Ship => {
    const wind = windAt(state, ship.x, ship.y);
    const best = bestUpwind.get(content.ships[ship.classId]!.polar) ?? 45;
    let heading = normalizeDeg((Math.atan2(player.x - ship.x, -(player.y - ship.y)) * 180) / Math.PI);
    if (angleOffWind(heading, wind.fromDeg) < best) {
      const a = normalizeDeg(wind.fromDeg + best);
      const b = normalizeDeg(wind.fromDeg - best);
      const off = (h: number) => Math.abs(((h - heading + 540) % 360) - 180);
      heading = off(a) <= off(b) ? a : b;
    }
    for (const swing of [0, 30, -30, 60, -60, 90, -90]) {
      const h = normalizeDeg(heading + swing);
      const speed = targetSpeed(content, { ...ship, headingDeg: h, sails: 'full' }, wind);
      const r = (h * Math.PI) / 180;
      const x = ship.x + Math.sin(r) * speed * dt;
      const y = ship.y - Math.cos(r) * speed * dt;
      if (water(x, y)) return { ...ship, x, y, headingDeg: h, speed, sails: 'full' };
    }
    return { ...ship, speed: 0 };
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
    const route = best ? [here, ...ai.route.slice(best.k)] : [here, ...ai.route.slice(-1)];
    return { ...ship, ai: { ...ai, chasing: false, route, along: 0, offset: 0 } };
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
        const inPort = other.ai.waitUntil !== undefined && !other.ai.route.length;
        if (player.docked || inPort || Math.hypot(other.x - player.x, other.y - player.y) > t.hailTiles) {
          return { state, events: [{ type: 'AttackRefused', entityIds: [player.id, other.id], payload: {} }] };
        }
        // Firing on a nation's ship costs standing with that nation; pirates are fair game.
        let next = state;
        const nation = other.ai.nation;
        if (nation !== 'pirate' && state.captain) {
          const standing = { ...state.captain.standing, [nation]: Math.max(-100, standingWith(state, nation) + cb.standing.attack) };
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
        // Beaten, the player is let go afloat: a pirate takes the cargo and half the gold, a patrol fines half.
        const beaten = outcome === 'lost';
        if (beaten) {
          if (other.ai.role === 'pirate') cargo = {};
          captain = { ...captain, gold: Math.floor(captain.gold / 2) };
        }
        ships[player.id] = {
          ...player,
          cargo,
          paid: beaten && other.ai.role === 'pirate' ? {} : player.paid,
          hull: Math.max(beaten ? Math.ceil(cls.hull * 0.1) : 1, mine.hull),
          sailCondition: Math.max(beaten ? 20 : 0, mine.sailCondition),
          crew: Math.max(beaten ? Math.ceil(cls.minCrew / 2) : 1, mine.crew),
        };
        if (outcome === 'escaped' || beaten) {
          // She sails on, mauled, and leaves the player be a while.
          const calmUntil = state.tick + Math.round(cb.chase.calmDays * tpd);
          ships[other.id] = { ...other, ...theirs, ai: { ...other.ai, chasing: false, calmUntil } };
        } else {
          // Sunk or taken: she's gone from the sea. A prize's gold and cargo (what the hold can take) come aboard.
          delete ships[other.id];
          if (outcome !== 'sunk') {
            captain = { ...captain, gold: captain.gold + (other.ai.purse ?? 0) };
            const room = () => cls.cargo - Object.values(cargo).reduce((a, b) => a + b, 0);
            cargo = { ...cargo };
            for (const [good, units] of Object.entries(other.cargo)) {
              const take = Math.min(units, room());
              if (take > 0) cargo[good] = (cargo[good] ?? 0) + take;
            }
            ships[player.id] = { ...ships[player.id]!, cargo };
          }
          if (other.ai.nation === 'pirate') {
            const standing = { ...captain.standing };
            for (const n of ['spain', 'england', 'france', 'netherlands'] as const) standing[n] = Math.min(100, (standing[n] ?? 0) + cb.standing.pirate);
            captain = { ...captain, standing };
          }
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
        const ship = ships[id]!;
        if (!ship.ai) continue;
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
          if (ship.ai.chasing && (p.docked || calm || d > cb.chase.giveUpTiles || !hunts(next, ship))) {
            ships = { ...ships, [id]: rejoin(ship) };
            continue;
          }
          if (!p.docked && !calm && (ship.ai.chasing || sighted)) {
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
        for (const [id, seen] of Object.entries(captain.sightings ?? {})) if (ships[id]) sightings[id] = seen;
        for (const s of Object.values(ships)) {
          if (!s.ai || Math.hypot(s.x - player.x, s.y - player.y) > sight) continue;
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
