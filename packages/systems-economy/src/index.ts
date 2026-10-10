import { rngStream, seedRng } from '@corsair/core';
import type { Captain, Deed, EmittedEvent, FamousPirate, FleetShip, Hoard, KnownPrices, NewsItem, Ship, System, TownState, Wind, WorldState } from '@corsair/core';

type WindAt = (state: WorldState, x: number, y: number) => Wind;
import { angleOffWind, conditionFactor, polarAt } from '@corsair/systems-navigation';
import { atWar, enemiesOf } from '@corsair/systems-politics';
import { isLand, shipStats, tileAt } from '@corsair/data';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';

// Markets per settlement (PRD section 6). Each town keeps a stock S and a normal stock T per good;
// price = base * (T / max(S, 1)) ^ elasticity, and every unit traded moves S, so a glut in one port
// crashes its price and trade routes limit themselves. Towns produce and consume weekly.

/** How close (in tiles) a ship must be to a settlement to dock there: about 7.5 km. */
export const DOCK_RANGE = 3;

type Settlement = Pick<PlacedSettlement, 'id' | 'type' | 'size' | 'x' | 'y' | 'nation'>;

/** The demand level the price is measured against: the same for every settlement of a size. */
export function referenceStock(content: ContentPack, s: Settlement, good: string): number {
  return (content.economy.normalStock[good] ?? 0) * (content.economy.sizeStock[s.size] ?? 1);
}

/** How strongly a settlement makes or needs a good: its strongest profile rate (0 to 1). Making wins. */
function lean(content: ContentPack, s: Pick<Settlement, 'id'>, good: string): { side: 'exports' | 'wants'; rate: number } | undefined {
  const e = content.economy;
  const profiles = (e.settlementProfiles[s.id] ?? []).map((p) => e.profiles[p]!);
  const makes = Math.max(0, ...profiles.map((p) => p.produces[good] ?? 0));
  if (makes > 0) return { side: 'exports', rate: Math.min(1, makes) };
  const needs = Math.max(0, ...profiles.map((p) => p.consumes[good] ?? 0));
  if (needs > 0) return { side: 'wants', rate: Math.min(1, needs) };
  return undefined;
}

/**
 * Whether a port is known for making a good (sells it cheap) or needing it (pays well). Only a
 * strong lean counts: a town that uses a little sugar isn't a sugar market.
 */
export function tradeLean(content: ContentPack, s: Pick<Settlement, 'id'>, good: string): 'exports' | 'wants' | undefined {
  if (content.goods.find((g) => g.id === good)?.staple) return undefined;
  const l = lean(content, s, good);
  return l && l.rate >= content.economy.notableLean ? l.side : undefined;
}

/** What a port is known for: common knowledge, shown before the player has ever called there. */
export function portTrade(content: ContentPack, s: Pick<Settlement, 'id'>): { exports: string[]; wants: string[] } {
  const ids = content.goods.map((g) => g.id);
  return {
    exports: ids.filter((g) => tradeLean(content, s, g) === 'exports'),
    wants: ids.filter((g) => tradeLean(content, s, g) === 'wants'),
  };
}

/** The stock a market drifts back to: above the reference where the good is made, below where it is needed. */
export function normalStock(content: ContentPack, s: Settlement, good: string): number {
  const e = content.economy;
  // The stock leans in proportion to how much the town makes or needs: a full producer holds
  // producerStock x the reference, a full consumer consumerStock x, a light one somewhere between.
  const l = lean(content, s, good);
  const full = !l ? 1 : l.side === 'exports' ? e.producerStock : e.consumerStock;
  return referenceStock(content, s, good) * (1 + (full - 1) * (l?.rate ?? 0));
}

/** A port's people when it is neither growing nor shrinking: by its size, more at a capital. */
export function basePeople(content: ContentPack, s: Pick<Settlement, 'size' | 'type'>): number {
  const t = content.economy.towns;
  return Math.round((t.people[s.size] ?? t.people.town!) * (s.type === 'capital' ? t.capitalPeople : 1));
}

/** The gold a port's merchant has to buy with when his purse is full: so much a head. */
export function purseFull(content: ContentPack, people: number): number {
  return Math.round(people * content.economy.towns.purse.perPerson);
}

/** A port's people, purse and trend (a world from before ports lived reads as a steady port of its size). */
export function townOf(content: ContentPack, state: WorldState, s: Pick<Settlement, 'id' | 'size' | 'type'>): TownState {
  const people = basePeople(content, s);
  return state.towns?.[s.id] ?? { people, cash: purseFull(content, people), trend: 0 };
}

/**
 * What a port makes and eats of a good a day, by its people and profile: a port that makes a good adds
 * netShare x pull x its usual stock a day (so with no merchant calling it sits that share above its usual);
 * one that needs it eats as much. A chained good (rum, cloth) is made only from its input in store.
 */
export function dailyFlow(content: ContentPack, state: WorldState, s: Settlement, good: string): { makes: number; eats: number } {
  const t = content.economy.towns;
  const l = lean(content, s, good);
  if (!l) return { makes: 0, eats: 0 };
  const per = l.rate * t.netShare * t.pull * usualStock(content, state, s, good);
  return l.side === 'exports' ? { makes: per, eats: 0 } : { makes: 0, eats: per };
}

/** The stock a market drifts back to today: its usual for a port of its size, scaled by its people, moved by a shock. */
export function usualStock(content: ContentPack, state: WorldState, s: Settlement, good: string): number {
  const scale = townOf(content, state, s).people / basePeople(content, s);
  return normalStock(content, s, good) * scale * shockFactor(content, state, s.id, good);
}

/** A blockaded port gets this share of its usual supply from the wider world. */
const BLOCKADE_PULL = 0.25;

/** The most a market holds: maxStock times its usual stock for a port of its size, scaled by its people. */
export function stockCap(content: ContentPack, state: WorldState, s: Settlement, good: string): number {
  return normalStock(content, s, good) * content.economy.maxStock * (townOf(content, state, s).people / basePeople(content, s));
}

/** Local mid price for one unit at a stock level, before the buy/sell spread. */
export function midPrice(content: ContentPack, s: Settlement, good: string, stock: number): number {
  const g = content.goods.find((x) => x.id === good)!;
  const [lo, hi] = content.economy.priceClamp;
  const ratio = referenceStock(content, s, good) / Math.max(stock, 1);
  return g.basePrice * Math.min(hi, Math.max(lo, ratio ** g.elasticity));
}

/** What the merchant charges and pays for one unit right now, in whole gold. */
export function quote(content: ContentPack, s: Settlement, good: string, stock: number): { buy: number; sell: number } {
  const spread = content.economy.spread[s.type] ?? 0.12;
  const mid = midPrice(content, s, good, stock);
  const sell = Math.max(1, Math.round(mid * (1 - spread)));
  // Whole gold rounds cheap goods' spread away; the merchant always keeps at least one.
  return { buy: Math.max(sell + 1, Math.round(mid * (1 + spread))), sell };
}

/**
 * What a trade of up to `qty` units would come to here, unit by unit as Buy and Sell price it (each unit
 * moves the stock): how many units go, the gold in total, and the price after it. `gold`, `room` and `held`
 * stop it where the trade itself would stop.
 */
export function tradePreview(
  content: ContentPack,
  s: Settlement,
  good: string,
  stock: number,
  side: 'Buy' | 'Sell',
  qty: number,
  limits: { gold: number; room: number; held: number; cash?: number },
): { units: number; total: number; after: number } {
  let units = 0;
  let total = 0;
  for (; units < qty; units++) {
    const q = quote(content, s, good, stock);
    if (side === 'Buy') {
      if (stock < 1 || limits.gold - total < q.buy || units >= limits.room) break;
      total += q.buy;
      stock--;
    } else {
      // The merchant buys only what his purse covers.
      if (units >= limits.held || (limits.cash !== undefined && limits.cash - total < q.sell)) break;
      total += q.sell;
      stock++;
    }
  }
  const after = quote(content, s, good, stock);
  return { units, total, after: side === 'Buy' ? after.buy : after.sell };
}

/**
 * Why a price is what it is: the market's stock against its usual, whether that makes the good cheap or dear
 * here, its usual prices, and the news behind a shock if one is moving it.
 */
export function priceStory(content: ContentPack, state: WorldState, s: Settlement & { name?: string }, good: string) {
  const stock = state.markets?.[s.id]?.[good] ?? 0;
  const usualStock = normalStock(content, s, good) * (townOf(content, state, s).people / basePeople(content, s));
  const now = quote(content, s, good, stock);
  const usual = quote(content, s, good, usualStock);
  const ratio = (now.buy + now.sell) / Math.max(1, usual.buy + usual.sell);
  const level: 'cheap' | 'usual' | 'dear' = ratio > 1.15 ? 'dear' : ratio < 0.87 ? 'cheap' : 'usual';
  const shock = activeShock(state, s.id, good);
  const name = content.goods.find((g) => g.id === good)?.name.toLowerCase() ?? good;
  const news = shock ? content.economy.shocks.kinds[shock.kind]?.news.replaceAll('{good}', name).replaceAll('{town}', s.name ?? s.id) : undefined;
  // What the port makes and eats of it a day, and the days its stock would last at that rate.
  const flow = dailyFlow(content, state, s, good);
  const days = flow.eats > 0 ? stock / flow.eats : undefined;
  return { stock: Math.round(stock), usualStock: Math.round(usualStock), level, usual, news, makes: flow.makes, eats: flow.eats, days };
}

const DEPTH_CAP = 999;

/**
 * Market depth: how many units a market takes before its sell price falls by a quarter. A small
 * market crashes after a handful, so "sells well" there pays only for a small cargo.
 */
export function sellDepth(content: ContentPack, s: Settlement, good: string, stock: number): number {
  const floor = quote(content, s, good, stock).sell * 0.75;
  let n = 0;
  while (n < DEPTH_CAP && quote(content, s, good, stock + n + 1).sell >= floor) n++;
  return n;
}

/** Governors sit in towns and cities; hamlets and pirate havens have none (nor a governor's house in the harbour). */
export function hasGovernor(s: Pick<PlacedSettlement, 'size' | 'type' | 'nation'>): boolean {
  return s.size !== 'hamlet' && s.type !== 'haven' && s.nation !== 'pirate';
}

/**
 * What a governor asks for a letter of marque: the full price at neutral standing, falling to nothing
 * once the captain is trusted (freeAt), dearer when he is disliked; refused (undefined) to an enemy.
 */
export function marquePrice(content: ContentPack, state: WorldState, nation: PlacedSettlement['nation']): number | undefined {
  const m = content.politics.marque;
  const standing = state.captain?.standing?.[nation] ?? 0;
  if (standing <= content.combat.standing.hostile) return undefined;
  return Math.max(0, Math.round(m.price * (1 - standing / m.freeAt)));
}

/**
 * The bounties a nation's governor pays: every pirate taken or sunk (more where pirates are pressing his
 * nation hard), and ships of the nations he is at war with now. Deeds he won't pay wait for another.
 */
export function bountiesOwed(content: ContentPack, state: WorldState, nation: PlacedSettlement['nation']) {
  const b = content.politics.bounty;
  const piracy = state.politics?.piracy[nation] ?? 0;
  const pay: Deed[] = [];
  const kept: Deed[] = [];
  let total = 0;
  for (const d of state.captain?.deeds ?? []) {
    if (d.captive) {
      // A famous pirate handed over in irons: any governor pays the price on her head.
      pay.push(d);
      total += content.pirates.rules.bounty;
    } else if (d.nation === 'pirate') {
      pay.push(d);
      total += Math.round(b.pirate * (1 + piracy / b.piracyScale));
    } else if (atWar(content, state, nation, d.nation)) {
      pay.push(d);
      total += b[d.role === 'patrol' ? 'patrol' : 'merchant'];
    } else kept.push(d);
  }
  return { pay, kept, total };
}

/**
 * Where a famous pirate buries her hoard (treasure.json), placed when the captain gets the first piece of its map:
 * a coastal land tile some way from one of her haunts and clear of the towns, by a landmark, holding a share of her
 * wealth. Drawn from its own stream (the tick and her id), so a replay places it alike and moves nothing else.
 */
export function placeHoard(content: ContentPack, map: TileMap, settlements: Pick<PlacedSettlement, 'id' | 'x' | 'y'>[], id: string, wealth: number, tick: number): Hoard | undefined {
  const def = content.pirates.captains.find((c) => c.id === id);
  const haunts = (def?.haunts ?? []).flatMap((h) => settlements.filter((s) => s.id === h));
  if (!haunts.length) return undefined;
  const t = content.treasure;
  const draw = rngStream(seedRng(tick, `hoard:${id}`));
  const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let tries = 0; tries < 2000; tries++) {
    const port = haunts[Math.floor(draw.float() * haunts.length)]!;
    const a = draw.float() * Math.PI * 2;
    const d = draw.range(t.placeTiles[0], t.placeTiles[1]);
    const tx = Math.floor(port.x + Math.sin(a) * d);
    const ty = Math.floor(port.y - Math.cos(a) * d);
    if (!isLand(tileAt(map, tx, ty)) || tx < 1 || ty < 1 || tx >= map.width - 1 || ty >= map.height - 1) continue;
    if (settlements.some((s) => Math.hypot(s.x - tx, s.y - ty) < t.clearOfTownsTiles)) continue;
    const side = SIDES.find(([dx, dy]) => !isLand(tileAt(map, tx + dx, ty + dy)));
    if (!side) continue;
    const oa = draw.float() * Math.PI * 2;
    const od = draw.float() * (t.ringTiles[0]! / 2) * t.ringOffset;
    return {
      x: tx + 0.5,
      y: ty + 0.5,
      landing: [tx + 0.5 + side[0], ty + 0.5 + side[1]],
      landmark: t.landmarks[Math.floor(draw.float() * t.landmarks.length)]!,
      value: Math.round(wealth * t.hoardShare),
      dx: Math.round(Math.sin(oa) * od * 10) / 10,
      dy: Math.round(-Math.cos(oa) * od * 10) / 10,
      near: port.id,
    };
  }
  return undefined;
}

/** The chart's search ring for a hoard with `pieces` of its map held: smaller with each piece, always about the spot. */
export function hoardRing(content: ContentPack, hoard: Hoard, pieces: number): { x: number; y: number; r: number } {
  const rings = content.treasure.ringTiles;
  const d = rings[Math.max(0, Math.min(rings.length, pieces) - 1)]!;
  const k = d / rings[0]!;
  return { x: hoard.x + hoard.dx * k, y: hoard.y + hoard.dy * k, r: d / 2 };
}

/** A famous pirate's record (pirates.json wealth until the world has one). */
export function famousOf(content: ContentPack, state: WorldState, id: string): FamousPirate {
  return state.famous?.[id] ?? { wealth: content.pirates.captains.find((c) => c.id === id)?.wealth ?? 0 };
}

/**
 * A piece of a famous pirate's map comes to the captain (a prisoner's, a survivor's, the tavern stranger's): one more
 * held, up to the whole map; the first places the hoard. `given` is false when the map was whole already.
 */
export function givePiece(
  content: ContentPack,
  map: TileMap | undefined,
  settlements: Pick<PlacedSettlement, 'id' | 'x' | 'y'>[],
  state: WorldState,
  id: string,
  tick: number,
): { state: WorldState; given: boolean; pieces: number } {
  const held = state.captain?.mapPieces?.[id] ?? 0;
  if (!state.captain || held >= content.pirates.rules.mapPieces) return { state, given: false, pieces: held };
  let next: WorldState = { ...state, captain: { ...state.captain, mapPieces: { ...state.captain.mapPieces, [id]: held + 1 } } };
  const f = famousOf(content, state, id);
  if (!f.hoard && map) {
    const hoard = placeHoard(content, map, settlements, id, f.wealth, tick);
    if (hoard) next = { ...next, famous: { ...next.famous, [id]: { ...f, hoard } } };
  }
  return { state: next, given: true, pieces: held + 1 };
}

/** What a piece of a famous pirate's map costs the tavern stranger's way: a share of what the hoard holds. */
export function piecePrice(content: ContentPack, state: WorldState, id: string): number {
  const f = famousOf(content, state, id);
  const s = content.treasure.stranger;
  return Math.max(s.minPrice, Math.round((f.hoard?.value ?? f.wealth * content.treasure.hoardShare) * s.priceShare));
}

/**
 * The shady stranger in a town's tavern this week (treasure.json), and the piece he sells: likelier while the
 * captain holds an unfinished map, and a pirate near this town or with an unfinished map likelier to be his.
 * Pure (the town and the week decide it), so the port screen may ask every frame. None in hamlets, none bought twice.
 */
export function strangerOffer(
  content: ContentPack,
  state: WorldState,
  town: Pick<PlacedSettlement, 'id' | 'x' | 'y' | 'size'>,
  settlements: Pick<PlacedSettlement, 'id' | 'x' | 'y'>[],
): { pirateId: string; price: number; key: string } | undefined {
  if (town.size === 'hamlet' || !state.captain) return undefined;
  const s = content.treasure.stranger;
  const week = Math.floor(state.tick / (content.economy.daysPerWeek * content.calendar.ticksPerDay));
  const key = `${town.id}:${week}`;
  if (state.captain.strangerDeals?.includes(key)) return undefined;
  const whole = content.pirates.rules.mapPieces;
  const held = (id: string) => state.captain?.mapPieces?.[id] ?? 0;
  const open = content.pirates.captains.filter((c) => held(c.id) < whole);
  if (!open.length) return undefined;
  const unfinished = open.some((c) => held(c.id) > 0);
  let h = 2166136261;
  for (let i = 0; i < town.id.length; i++) h = Math.imul(h ^ town.id.charCodeAt(i), 16777619);
  const draw = rngStream(seedRng(week * 7919 + (h >>> 0) % 7907, 'stranger'));
  if (draw.float() >= (unfinished ? s.unfinishedChance : s.chance)) return undefined;
  const near = (c: (typeof open)[number]) =>
    [c.haven, ...c.haunts].some((id) => {
      const p = settlements.find((x) => x.id === id);
      return p !== undefined && Math.hypot(p.x - town.x, p.y - town.y) <= s.nearTiles;
    });
  const weights = Object.fromEntries(open.map((c) => [c.id, (held(c.id) > 0 ? s.unfinishedWeight : 1) * (near(c) ? s.nearWeight : 1)]));
  const pirateId = draw.weighted(weights);
  return { pirateId, price: piecePrice(content, state, pirateId), key };
}

/** The rest of the player's fleet (the flagship aside). */
export function fleetOf(state: WorldState): FleetShip[] {
  return state.captain?.fleet ?? [];
}

/** The fleet's hold: the flagship's and every other ship's, counted as one. */
export function fleetHold(content: ContentPack, state: WorldState, ship: Ship): number {
  return fleetOf(state).reduce((n, f) => n + content.ships[f.classId]!.cargo, content.ships[ship.classId]!.cargo);
}

/** The fleet's berths: the men it can carry. */
export function fleetBerths(content: ContentPack, state: WorldState, ship: Ship): number {
  return fleetOf(state).reduce((n, f) => n + shipStats(content, f).maxCrew, shipStats(content, { ...ship, fleetSpeed: undefined }).maxCrew);
}

/** The men the fleet needs to sail at all: every ship's minimum crew. */
export function fleetMinCrew(content: ContentPack, fleet: Pick<FleetShip, 'classId'>[], ship: Pick<Ship, 'classId'>): number {
  return fleet.reduce((n, f) => n + content.ships[f.classId]!.minCrew, content.ships[ship.classId]!.minCrew);
}

/** The flagship with her fleet's pace: the slowest other ship's speed (none with no fleet). */
/**
 * The pace a ship of the fleet keeps: her class's speed, slowed as the flagship's is at sea by shot-through
 * sails and a hull below 30%, until a shipwright mends her.
 */
export function fleetShipPace(content: ContentPack, f: Pick<FleetShip, 'classId' | 'guns' | 'upgrades'> & { hull?: number; sailCondition?: number }): number {
  return Math.round(shipStats(content, f).speed * conditionFactor(content, f) * 10) / 10;
}

export function withFleetPace(content: ContentPack, ship: Ship, fleet: FleetShip[]): Ship {
  const fleetSpeed = fleet.length ? Math.min(...fleet.map((f) => fleetShipPace(content, f))) : undefined;
  return fleetSpeed === undefined ? (({ fleetSpeed: _, ...rest }) => rest)(ship) : { ...ship, fleetSpeed };
}

/** The ships a port's shipwright builds, for sale (none at a hamlet). */
export function shipsForSale(content: ContentPack, port: Pick<PlacedSettlement, 'size'>): string[] {
  const y = content.combat.shipyard;
  return port.size === 'city' ? y.city : port.size === 'town' ? y.town : [];
}

/** What a shipwright pays for a ship of the fleet: a share of her class's price, by her hull and, less, her sails. */
export function shipValue(content: ContentPack, f: Pick<FleetShip, 'classId' | 'hull' | 'sailCondition' | 'upgrades' | 'guns'>): number {
  const cls = content.ships[f.classId]!;
  const hull = Math.max(0, Math.min(1, f.hull / shipStats(content, f).hullMax));
  return Math.round(cls.price * content.combat.fleet.sellShare * hull * (0.75 + 0.25 * (f.sailCondition / 100)));
}

/** Men aboard: a ship from before crews were counted sails with the career's starting crew. */
export function crewOf(content: ContentPack, ship: Ship): number {
  return ship.crew ?? Math.round(content.ships[ship.classId]!.maxCrew * content.combat.startCrew);
}

/** The crew's morale, 0 to 100 (a save from before the crew slice reads as a new career's). */
export function moraleOf(content: ContentPack, state: WorldState): number {
  return state.captain?.morale ?? content.crew.morale.start;
}

/** How the crew feels, in a word, from their morale. */
export function moraleWord(content: ContentPack, morale: number): string {
  const m = content.crew.morale;
  return morale >= 75 ? 'Happy' : morale >= m.grumbling ? 'Content' : morale >= m.deserting ? 'Grumbling' : morale >= m.mutinous ? 'Ready to desert' : 'Mutinous';
}

/** Food the crew eats a day, in units. */
export function rationPerDay(content: ContentPack, ship: Ship): number {
  return crewOf(content, ship) / content.crew.rationMenPerUnit;
}

/** Days the food in the hold will last. */
export function foodDays(content: ContentPack, ship: Ship): number {
  const ration = rationPerDay(content, ship);
  return ration > 0 ? (ship.cargo.food ?? 0) / ration : Infinity;
}

/** Whole days since the crew was last paid (the plunder divided, or wages). */
export function daysUnpaid(content: ContentPack, state: WorldState): number {
  return Math.max(0, Math.floor((state.tick - (state.captain?.paidTick ?? 0)) / content.calendar.ticksPerDay));
}

/** Wages for every man for every day since the crew was last paid. */
export function wagesOwed(content: ContentPack, state: WorldState, ship: Ship): number {
  return Math.ceil(crewOf(content, ship) * daysUnpaid(content, state) * content.crew.wagesPerManDay);
}

/** Dividing the plunder chest now: the captain's cut, the crew's, and each man's share. */
export function plunderShares(content: ContentPack, state: WorldState, ship: Ship) {
  const chest = state.captain?.chest ?? 0;
  const captain = Math.floor(chest * content.crew.captainShare);
  const crew = chest - captain;
  return { chest, captain, crew, perHead: crew / Math.max(1, crewOf(content, ship)) };
}

/**
 * The mood the crew's morale heads toward, day by day (Pirates! 1987: their eyes are on gold, and they
 * are impatient): better the more gold per head the chest holds, worse every day past the grace since
 * they were last paid. A small crew is easier to please, as each man's share is larger.
 */
export function crewMood(content: ContentPack, state: WorldState, ship: Ship): number {
  const m = content.crew.morale.mood;
  const fromShares = m.fromShares * Math.min(1, plunderShares(content, state, ship).perHead / m.perHeadForFull);
  const unpaid = Math.max(0, daysUnpaid(content, state) - m.graceDays) * m.perDayUnpaid;
  return Math.max(0, Math.min(100, m.base + fromShares - unpaid));
}

/** Repair bill: hull points and sail condition short of sound, at the shipwright's rates. */
/** What the shipwright asks to make one ship sound: her hull and her sails. */
export function shipRepairCost(content: ContentPack, s: Pick<Ship, 'classId' | 'hull' | 'sailCondition' | 'upgrades' | 'guns'>): number {
  const p = content.combat.port;
  const hullMax = shipStats(content, s).hullMax;
  return Math.ceil(hullMax - (s.hull ?? hullMax)) * p.hullGold + Math.ceil(100 - (s.sailCondition ?? 100)) * p.sailGold;
}

export function repairCost(content: ContentPack, ship: Ship, fleet: FleetShip[] = []): number {
  const one = (s: Pick<Ship, 'classId' | 'hull' | 'sailCondition' | 'upgrades' | 'guns'>) => {
    return shipRepairCost(content, s);
  };
  // The whole fleet, as the shipwright mends it.
  return fleet.reduce((n, f) => n + one(f), one(ship));
}

/** Whether a port's shipwright sells cannon: every one but a hamlet's. */
export function sellsGuns(port: { size: string }): boolean {
  return port.size !== 'hamlet';
}

/** Whether a port's shipwright sells an upgrade: by the settlement's size (upgrades.json sizes). */
export function sellsUpgrade(content: ContentPack, port: { size: string }, upgradeId: string): boolean {
  return content.upgrades[upgradeId]?.sizes.includes(port.size as 'hamlet' | 'town' | 'city') ?? false;
}

export function cargoUsed(ship: Ship): number {
  return Object.values(ship.cargo).reduce((a, b) => a + b, 0);
}

/** Starting markets and purse. Stocks start near normal, varied by the economy's own RNG stream. */
export function withEconomy(world: WorldState, content: ContentPack, settlements: Settlement[], seed: number): WorldState {
  const rng = rngStream(seedRng(seed, 'economy'));
  const markets: Record<string, Record<string, number>> = {};
  for (const s of settlements) {
    markets[s.id] = Object.fromEntries(
      content.goods.map((g) => [g.id, Math.round(normalStock(content, s, g.id) * rng.range(0.7, 1.3))]),
    );
  }
  const captain: Captain = { gold: content.economy.startingGold, knownPrices: {}, chest: 0, morale: content.crew.morale.start, paidTick: world.tick, mess: 0 };
  // The player's ship sails with a few days' food aboard.
  const ships = Object.fromEntries(
    Object.entries(world.ships).map(([id, s]) => [id, s.ai || s.cargo.food ? s : { ...s, cargo: { ...s.cargo, food: content.crew.startFood } }]),
  );
  const towns = Object.fromEntries(
    settlements.map((s) => {
      const people = basePeople(content, s);
      return [s.id, { people, cash: purseFull(content, people), trend: 0 as const }];
    }),
  );
  return { ...world, ships, markets, towns, captain, rng: { ...world.rng, economy: rng.state() } };
}

const activeShock = (state: WorldState, settlementId: string, good: string) =>
  (state.shocks ?? []).find((x) => x.settlementId === settlementId && x.good === good);

/** How a shock in force moves a good's usual stock at a town: 1 when there is none. */
export function shockFactor(content: ContentPack, state: WorldState, settlementId: string, good: string): number {
  const shock = activeShock(state, settlementId, good);
  return shock ? content.economy.shocks.kinds[shock.kind]!.stock : 1;
}

/** Whether plague has shut a port now. */
export function plagued(state: WorldState, settlementId: string): boolean {
  return (state.towns?.[settlementId]?.plague ?? 0) > state.tick;
}

/** A famine on now at a town (a famine shock on a staple). */
export function famine(content: ContentPack, state: WorldState, settlementId: string): boolean {
  return (state.shocks ?? []).some((x) => x.settlementId === settlementId && x.kind === 'famine' && x.endTick > state.tick);
}

/**
 * Plague breaks out at a town for `weeks`: the port is shut, and the news of it starts out from there.
 * The weekly draw, a ship that brings it, and the debug command all come through here.
 */
export function startPlague(content: ContentPack, state: WorldState, s: Pick<Settlement, 'id' | 'size' | 'type'>, tick: number, weeks: number): { state: WorldState; events: EmittedEvent[] } {
  const ticksPerWeek = content.economy.daysPerWeek * content.calendar.ticksPerDay;
  const n = state.nextNewsId ?? 0;
  const news = { id: `news.${n}`, tick, settlementId: s.id, kind: 'plague', good: '', delayDays: 0 };
  return {
    state: {
      ...state,
      towns: { ...state.towns, [s.id]: { ...townOf(content, state, s), plague: tick + weeks * ticksPerWeek } },
      news: [...(state.news ?? []), news],
      nextNewsId: n + 1,
    },
    events: [{ type: 'Plague', entityIds: [s.id], payload: { weeks } }],
  };
}

/** The contracts open now whose news has reached a town (or the captain has heard). */
export function contractsAt(content: ContentPack, state: WorldState, settlements: Settlement[], townId: string) {
  const known = new Set(newsAt(content, state, settlements, townId).map((n) => n.id));
  return (state.contracts ?? []).filter((c) => c.endTick > state.tick && known.has(c.newsId));
}

/**
 * Starts a shock: the market jumps part of the way to its shocked stock at once, and the news of it
 * starts out from the town. The weekly draw, storm damage and the debug command all come through here.
 */
function startShock(
  content: ContentPack,
  state: WorldState,
  s: Settlement,
  good: string,
  kind: string,
  tick: number,
  rng: ReturnType<typeof rngStream>,
): { state: WorldState; events: EmittedEvent[] } {
  const e = content.economy;
  const k = e.shocks.kinds[kind]!;
  const ticksPerWeek = e.daysPerWeek * content.calendar.ticksPerDay;
  const weeks = Math.floor(rng.range(k.weeks[0], k.weeks[1] + 1));
  const delayDays = Math.floor(rng.range(e.news.delayDays[0], e.news.delayDays[1] + 1));
  const n = state.nextNewsId ?? 0;
  const shock = { id: `shock.${n}`, kind, settlementId: s.id, good, startTick: tick, endTick: tick + weeks * ticksPerWeek };
  const news = { id: `news.${n}`, tick, settlementId: s.id, kind, good, delayDays };
  const usual = normalStock(content, s, good);
  const stock = state.markets?.[s.id]?.[good] ?? 0;
  const jolted = Math.round(Math.max(0, Math.min(usual * e.maxStock, stock + (usual * k.stock - stock) * e.shocks.jolt)));
  const c = e.contracts;
  const contracts = c.kinds.includes(kind)
    ? (() => {
        const units = Math.max(c.units[0], Math.min(c.units[1], Math.round((c.share * referenceStock(content, s, good)) / 5) * 5));
        const base = content.goods.find((g) => g.id === good)?.basePrice ?? 0;
        const reward = Math.round((units * Math.max(c.minPerUnit, base * c.perUnit)) / 10) * 10;
        return [...(state.contracts ?? []), { id: `contract.${n}`, settlementId: s.id, good, units, delivered: 0, reward, endTick: shock.endTick, newsId: news.id }];
      })()
    : state.contracts;
  return {
    state: {
      ...state,
      shocks: [...(state.shocks ?? []), shock],
      ...(contracts ? { contracts } : {}),
      news: [...(state.news ?? []), news],
      nextNewsId: n + 1,
      markets: { ...state.markets, [s.id]: { ...state.markets?.[s.id], [good]: jolted } },
    },
    events: [{ type: 'MarketShock', entityIds: [s.id], payload: { kind, good, weeks, stock: jolted } }],
  };
}

/** The tick news of an item reaches a town: at once where it happened, later the further away. */
export function newsArrives(content: ContentPack, item: NewsItem, origin: Pick<Settlement, 'x' | 'y'>, town: Pick<Settlement, 'x' | 'y'>): number {
  const days = Math.hypot(origin.x - town.x, origin.y - town.y) / content.economy.news.tilesPerDay;
  return item.tick + Math.ceil((days > 0 ? days + item.delayDays : 0) * content.calendar.ticksPerDay);
}

/** News a town has heard by now, newest first. */
export function newsAt(content: ContentPack, state: WorldState, settlements: Settlement[], townId: string): NewsItem[] {
  const town = settlements.find((s) => s.id === townId);
  if (!town) return [];
  return (state.news ?? [])
    .filter((n) => {
      const origin = settlements.find((s) => s.id === n.settlementId);
      return origin && newsArrives(content, n, origin, town) <= state.tick;
    })
    .reverse();
}

/** The rumour as told, from the shock kind's template. */
const NATION_ADJECTIVE: Record<string, string> = { spain: 'Spanish', england: 'English', france: 'French', netherlands: 'Dutch', pirate: 'pirate' };
const NATION_NAME: Record<string, string> = { spain: 'Spain', england: 'England', france: 'France', netherlands: 'the Netherlands', pirate: 'the pirates' };

/** The rumour as told: from a market shock's template, or a sea fight's (combat.json news). */
export function newsText(content: ContentPack, item: NewsItem, townName: string): string {
  const good = (content.goods.find((g) => g.id === item.good)?.name ?? item.good).toLowerCase();
  const text =
    content.economy.shocks.kinds[item.kind]?.news ??
    (item.kind === 'plague' ? content.economy.plague.news : undefined) ??
    content.combat.news[item.kind] ?? content.politics.news[item.kind] ?? '{town}: {good}';
  // War and peace name the nations themselves ("England and Spain"); fights use the adjective ("the Spanish San Felipe").
  const nationWords = item.kind === 'war' || item.kind === 'peace' ? NATION_NAME : NATION_ADJECTIVE;
  return text
    .replaceAll('{town}', townName)
    .replaceAll('{good}', good)
    .replaceAll('{ship}', item.ship ?? 'a ship')
    .replaceAll('{nation}', nationWords[item.nation ?? ''] ?? '')
    .replaceAll('{other}', nationWords[item.other ?? ''] ?? '')
    .replaceAll('{vessel}', item.vessel ?? 'a ship')
    .replaceAll('{captain}', item.captain ?? 'a pirate')
    .replace(/^./, (c) => c.toUpperCase());
}

const SEAWARD_LOOK_TILES = 12;

/**
 * The heading that leads out of a harbour: of 32 headings, the one with the longest run of open
 * water ahead (up to 12 tiles, about 30 km), leaning away from the town, then toward the current one.
 */
export function seawardHeading(
  map: TileMap,
  ship: Pick<Ship, 'x' | 'y'>,
  town: Pick<Settlement, 'x' | 'y'>,
  currentDeg: number,
  /** Headings she can actually sail on this wind; out of irons beats straight out to sea. */
  canSail: (deg: number) => boolean = () => true,
): number {
  // Headings are compass degrees: 0 north (up, -y), 90 east (+x).
  const away = Math.atan2(ship.x - town.x, -(ship.y - town.y));
  const all = Array.from({ length: 32 }, (_, i) => i * 11.25);
  const sailable = all.filter(canSail);
  let best = { deg: currentDeg, score: -Infinity };
  for (const deg of sailable.length ? sailable : all) {
    const rad = (deg * Math.PI) / 180;
    let clear = 0;
    while (clear < SEAWARD_LOOK_TILES && !isLand(tileAt(map, ship.x + Math.sin(rad) * (clear + 1), ship.y - Math.cos(rad) * (clear + 1)))) clear++;
    const offCurrent = Math.abs((((deg - currentDeg) % 360) + 540) % 360 - 180);
    const score = clear + Math.cos(rad - away) * 2 - offCurrent / 1000;
    if (score > best.score) best = { deg, score };
  }
  return best.deg;
}

/** `map` lets a ship cast off pointing out to sea; without one (some tests) it keeps its heading. */
export function createEconomySystem(content: ContentPack, settlements: Settlement[], map?: TileMap, windAt?: WindAt): System {
  const e = content.economy;
  const byId = new Map(settlements.map((s) => [s.id, s]));
  const ticksPerWeek = e.daysPerWeek * content.calendar.ticksPerDay;
  const capacity = (state: WorldState, ship: Ship) => fleetHold(content, state, ship);

  const seen = (state: WorldState, s: Settlement, market: Record<string, number>): Record<string, KnownPrices> => ({
    ...state.captain!.knownPrices,
    [s.id]: {
      day: Math.floor(state.tick / content.calendar.ticksPerDay),
      prices: Object.fromEntries(
        content.goods.map((g) => {
          const stock = market[g.id] ?? 0;
          return [g.id, { ...quote(content, s, g.id, stock), depth: sellDepth(content, s, g.id, stock) }];
        }),
      ),
    },
  });

  const refuse = (state: WorldState, ship: Ship, reason: string, extra: Record<string, unknown> = {}) => ({
    state,
    events: [{ type: 'TradeRefused', entityIds: [ship.id], payload: { reason, ...extra } }] as EmittedEvent[],
  });

  /**
   * A day at sea for the player's crew: they eat the day's rations from the hold (the part-units carried
   * over in `mess`), and their morale heads toward their mood, falling fast while they starve. In port the
   * clock stands still, so nothing here runs there.
   */
  const messDay = (state: WorldState, tick: number): { state: WorldState; events: EmittedEvent[] } => {
    const ship = Object.values(state.ships).find((s) => !s.ai);
    if (!ship || ship.docked || !state.captain) return { state, events: [] };
    const need = rationPerDay(content, ship) + (state.captain.mess ?? 0);
    const want = Math.floor(need);
    const food = ship.cargo.food ?? 0;
    const eaten = Math.min(want, food);
    const starving = eaten < want;
    const cargo: Record<string, number> = { ...ship.cargo, food: food - eaten };
    if (!cargo.food) delete cargo.food;
    // What's left of the food keeps its share of what it cost.
    const paid = ship.paid ? { ...ship.paid } : undefined;
    if (paid?.food && food) paid.food = Math.round(paid.food * ((food - eaten) / food));
    if (paid && !cargo.food) delete paid.food;
    const m = content.crew.morale;
    const before = moraleOf(content, state);
    const mood = crewMood(content, state, ship);
    const morale = Math.max(0, Math.min(100, before + (mood - before) * m.approachPerDay - (starving ? m.starvingPerDay : 0)));
    const events: EmittedEvent[] = starving ? [{ type: 'Starving', entityIds: [ship.id], payload: { tick } }] : [];
    return {
      state: {
        ...state,
        ships: { ...state.ships, [ship.id]: { ...ship, cargo, ...(paid ? { paid } : {}) } },
        captain: { ...state.captain, morale, mess: starving ? 0 : need - want },
      },
      events,
    };
  };

  // Ports near enough for coasting craft, at peace or not decided day by day.
  const neighbours = settlements.flatMap((a, i) =>
    settlements.slice(i + 1).filter((b) => Math.hypot(a.x - b.x, a.y - b.y) <= e.towns.coasters.tiles).map((b) => [a, b] as const),
  );

  /**
   * A day in the life of the ports (PRD section 6): people make and eat goods, chained goods are made from
   * their inputs in store, the wider world closes `pull` of each gap to the usual stock, coasting craft
   * between neighbours at peace even out their stock, and each merchant's purse refills.
   */
  const liveDay = (state: WorldState): WorldState => {
    if (!state.markets) return state;
    const t = e.towns;
    const markets: Record<string, Record<string, number>> = {};
    const usual: Record<string, Record<string, number>> = {};
    // Blockaded: an enemy warship lies off the port. Little gets in from the wider world, and no coaster.
    const lying = Object.values(state.ships).filter((x) => x.ai?.blockadeOf && (x.ai.waitUntil ?? 0) > state.tick);
    const blockaded = new Set(
      settlements
        .filter((s) => lying.some((x) => x.ai!.blockadeOf === s.id && Math.hypot(x.x - s.x, x.y - s.y) <= content.traffic.blockade.tiles))
        .map((s) => s.id),
    );
    for (const s of settlements) {
      const market = { ...state.markets[s.id] };
      const pull = t.pull * (blockaded.has(s.id) ? BLOCKADE_PULL : 1);
      usual[s.id] = {};
      // Chained goods first, from the store as the day begins: today's distilling uses yesterday's sugar.
      const goods = [...content.goods].sort((x, y) => Number(Boolean(e.chains[y.id])) - Number(Boolean(e.chains[x.id])));
      for (const g of goods) {
        const u = usualStock(content, state, s, g.id);
        usual[s.id]![g.id] = u;
        const flow = dailyFlow(content, state, s, g.id);
        let makes = flow.makes;
        const input = e.chains[g.id];
        if (input && makes > 0) {
          makes = Math.min(makes, market[input] ?? 0);
          market[input] = (market[input] ?? 0) - makes;
        }
        const stock = market[g.id] ?? 0;
        const after = stock + makes - Math.min(stock, flow.eats) + pull * (u - stock);
        market[g.id] = Math.max(0, Math.min(stockCap(content, state, s, g.id), after));
      }
      markets[s.id] = market;
    }
    for (const [a, b] of neighbours) {
      if (atWar(content, state, a.nation, b.nation) || blockaded.has(a.id) || blockaded.has(b.id) || plagued(state, a.id) || plagued(state, b.id)) continue;
      // The nearer, the busier the craft: two towns on one island trade almost as one market.
      const near = t.coasters.tiles / Math.max(3, Math.hypot(a.x - b.x, a.y - b.y));
      const share = Math.min(0.9, t.coasters.share * near);
      const cap = t.coasters.max * near;
      for (const g of content.goods) {
        // Carried from where it is cheap to where it is dear: stock against each town's demand, which sets the price.
        const ua = referenceStock(content, a, g.id);
        const ub = referenceStock(content, b, g.id);
        const ra = markets[a.id]![g.id]! / Math.max(1, ua);
        const rb = markets[b.id]![g.id]! / Math.max(1, ub);
        const raw = (share * (ra - rb) * Math.min(ua, ub)) / 2;
        const move = Math.sign(raw) * Math.min(cap, Math.abs(raw));
        if (Math.abs(move) < 0.01) continue;
        const [from, to] = move > 0 ? [a, b] : [b, a];
        // No more than she has, nor than the other has room for.
        const n = Math.max(0, Math.min(Math.abs(move), markets[from.id]![g.id]!, stockCap(content, state, to, g.id) - markets[to.id]![g.id]!));
        markets[from.id]![g.id]! -= n;
        markets[to.id]![g.id]! += n;
      }
    }
    const towns: Record<string, TownState> = {};
    for (const s of settlements) {
      const town = townOf(content, state, s);
      const full = purseFull(content, town.people);
      const { blockaded: _was, ...rest } = town;
      towns[s.id] = { ...rest, cash: Math.round(town.cash + (full - town.cash) * t.purse.refill), ...(blockaded.has(s.id) ? { blockaded: true } : {}) };
    }
    return { ...state, markets, towns };
  };

  /** Weekly growth: needs met (stock against usual, food counting double) let a port grow slowly; starved, it shrinks fast. */
  const grow = (state: WorldState): Record<string, TownState> => {
    const g = e.towns.growth;
    const towns: Record<string, TownState> = {};
    for (const s of settlements) {
      const town = townOf(content, state, s);
      let met = 0;
      let weight = 0;
      for (const good of content.goods) {
        if (dailyFlow(content, state, s, good.id).eats <= 0) continue;
        const w = good.staple ? 2 : 1;
        met += w * Math.min(1, (state.markets?.[s.id]?.[good.id] ?? 0) / Math.max(1, usualStock(content, state, s, good.id)));
        weight += w;
      }
      const share = weight ? met / weight : 1;
      const base = basePeople(content, s);
      // A famine or plague thins the people whatever is in the market (a famine's usual stock is already low).
      const sick = plagued(state, s.id);
      const trend: TownState['trend'] = sick || famine(content, state, s.id) ? -1 : share >= g.satisfied ? 1 : share < g.starved ? -1 : 0;
      const down = g.down + (sick ? e.plague.down : 0);
      const people = Math.round(Math.max(base * g.min, Math.min(base * g.max, town.people * (trend > 0 ? 1 + g.up : trend < 0 ? 1 - down : 1))));
      towns[s.id] = { ...town, people, trend: people === town.people && trend > 0 ? 0 : trend };
    }
    return towns;
  };

  return {
    name: 'economy',
    command(state, command) {
      if (!state.markets || !state.captain) return undefined;
      if (command.type === 'Dock') {
        const ship = state.ships[command.shipId];
        const s = byId.get(command.settlementId);
        if (!ship || !s) return undefined;
        if (ship.docked) return refuse(state, ship, 'already-docked');
        if (Math.hypot(ship.x - s.x, ship.y - s.y) > DOCK_RANGE) return refuse(state, ship, 'too-far', { settlementId: s.id });
        // A nation the player has made an enemy of shuts its ports to them (pirate havens never do).
        if (s.nation !== 'pirate' && (state.captain.standing?.[s.nation] ?? 0) <= content.combat.standing.refused) {
          return refuse(state, ship, 'hostile', { settlementId: s.id, nation: s.nation });
        }
        if (plagued(state, s.id)) return refuse(state, ship, 'plague', { settlementId: s.id });
        // Drop anchor: stopped, helm and assist cleared.
        const { assist: _assist, ...rest } = ship;
        let docked: Ship = { ...rest, docked: s.id, speed: 0, helm: 0 };
        const events: EmittedEvent[] = [{ type: 'Docked', entityIds: [ship.id, s.id], payload: {} }];
        // A crew this unhappy slips ashore when she makes port, and doesn't come back.
        const morale = moraleOf(content, state);
        const m = content.crew.morale;
        if (!ship.ai && morale < m.deserting) {
          const crew = crewOf(content, ship);
          const gone = Math.round(crew * (morale < m.mutinous ? m.desertShare.mutinous : m.desertShare.deserting));
          if (gone > 0) {
            docked = { ...docked, crew: crew - gone };
            events.push({ type: 'Deserted', entityIds: [ship.id, s.id], payload: { count: gone, morale } });
          }
        }
        return {
          state: {
            ...state,
            ships: { ...state.ships, [ship.id]: docked },
            captain: { ...state.captain, knownPrices: seen(state, s, state.markets[s.id]!) },
          },
          events,
        };
      }
      if (command.type === 'Undock') {
        const ship = state.ships[command.shipId];
        if (!ship?.docked) return undefined;
        const { docked, ...rest } = ship;
        // Cast off pointing out to sea, so the ship sails clear of the harbour rather than into the quay.
        const town = byId.get(docked);
        // Only on a heading with real drive, so a ship never casts off into irons.
        const wind = windAt?.(state, ship.x, ship.y);
        const polar = content.polars[content.ships[ship.classId]!.polar]!;
        const canSail = (deg: number) => !wind || polarAt(polar, angleOffWind(deg, wind.fromDeg)) >= 0.5;
        const headingDeg = map && town ? seawardHeading(map, ship, town, ship.headingDeg, canSail) : ship.headingDeg;
        return {
          state: { ...state, ships: { ...state.ships, [ship.id]: { ...rest, headingDeg } } },
          events: [{ type: 'Undocked', entityIds: [ship.id, docked], payload: {} }],
        };
      }
      if (command.type === 'BuyMarque' || command.type === 'CollectBounties') {
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        if (!ship.docked) return refuse(state, ship, 'not-docked');
        const s = byId.get(ship.docked)!;
        if (!hasGovernor(s)) return refuse(state, ship, 'no-governor');
        const nation = s.nation;
        if (command.type === 'BuyMarque') {
          const price = marquePrice(content, state, nation);
          if ((state.captain.marques ?? []).includes(nation)) return refuse(state, ship, 'already-held');
          if (!enemiesOf(content, state, nation).some((n) => n !== 'pirate')) return refuse(state, ship, 'at-peace');
          if (price === undefined) return refuse(state, ship, 'unwelcome');
          if (state.captain.gold < price) return refuse(state, ship, 'not-enough-gold');
          return {
            state: { ...state, captain: { ...state.captain, gold: state.captain.gold - price, marques: [...(state.captain.marques ?? []), nation] } },
            events: [{ type: 'MarqueBought', entityIds: [ship.id, s.id], payload: { nation, gold: price } }],
          };
        }
        const { pay, kept, total } = bountiesOwed(content, state, nation);
        if (!pay.length) return refuse(state, ship, 'nothing-owed');
        // A famous pirate handed over counts for more with the governor's nation; she sails again only after
        // her time in his jail (pirates.json returnDays from now).
        const r = content.pirates.rules;
        const captives = pay.filter((d) => d.captive);
        const gain = pay.length - captives.length + captives.length * r.bountyStanding;
        const standing = { ...state.captain.standing, [nation]: Math.min(100, (state.captain.standing?.[nation] ?? 0) + gain) };
        let famous = state.famous;
        for (const d of captives) {
          const f = famous?.[d.captive!] ?? { wealth: content.pirates.captains.find((c) => c.id === d.captive)?.wealth ?? 0 };
          const free = state.tick + Math.round(r.returnDays * content.calendar.ticksPerDay);
          famous = { ...famous, [d.captive!]: { ...f, returnAt: Math.max(f.returnAt ?? 0, free) } };
        }
        return {
          // Bounties are plunder: they go into the chest the crew sails for.
          state: { ...state, captain: { ...state.captain, chest: (state.captain.chest ?? 0) + total, deeds: kept, standing }, ...(famous ? { famous } : {}) },
          events: [{ type: 'BountiesPaid', entityIds: [ship.id, s.id], payload: { count: pay.length, gold: total, captives: captives.map((d) => d.captive) } }],
        };
      }
      if (command.type === 'BuyMapPiece') {
        // The tavern's shady stranger sells a piece of a famous pirate's map: the first places her hoard.
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        if (!ship.docked) return refuse(state, ship, 'not-docked');
        const town = byId.get(ship.docked);
        const offer = town && strangerOffer(content, state, town, settlements);
        if (!offer || offer.pirateId !== command.pirateId) return refuse(state, ship, 'no-offer');
        if (state.captain.gold < offer.price) return refuse(state, ship, 'not-enough-gold');
        const given = givePiece(content, map, settlements, state, offer.pirateId, state.tick);
        if (!given.given) return refuse(state, ship, 'map-whole');
        const captain = { ...given.state.captain!, gold: state.captain.gold - offer.price, strangerDeals: [...(state.captain.strangerDeals ?? []), offer.key].slice(-20) };
        return {
          state: { ...given.state, captain },
          events: [{ type: 'MapPieceBought', entityIds: [ship.id, town!.id], payload: { pirateId: offer.pirateId, gold: offer.price, pieces: given.pieces } }],
        };
      }
      if (command.type === 'Recruit') {
        // The tavern: men sign on for a bounty each, up to the berths the fleet has.
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        if (!ship.docked) return refuse(state, ship, 'not-docked');
        const berths = fleetBerths(content, state, ship);
        const crew = crewOf(content, ship);
        const price = content.combat.port.recruitGold;
        const count = Math.min(Math.floor(command.count), berths - crew, price > 0 ? Math.floor(state.captain.gold / price) : Infinity);
        if (!(count > 0)) return refuse(state, ship, crew >= berths ? 'berths-full' : 'not-enough-gold');
        return {
          state: {
            ...state,
            ships: { ...state.ships, [ship.id]: { ...ship, crew: crew + count } },
            captain: { ...state.captain, gold: state.captain.gold - count * price },
          },
          events: [{ type: 'Recruited', entityIds: [ship.id, ship.docked], payload: { count, gold: count * price } }],
        };
      }
      if (command.type === 'DividePlunder' || command.type === 'PayWages') {
        // The tavern, where the crew is paid: their share of the chest, or wages from the captain's purse.
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        if (!ship.docked) return refuse(state, ship, 'not-docked');
        const crewMorale = content.crew.morale;
        if (command.type === 'DividePlunder') {
          const share = plunderShares(content, state, ship);
          if (share.chest <= 0) return refuse(state, ship, 'chest-empty');
          const morale = Math.round(
            Math.max(
              crewMorale.afterDivision.min,
              Math.min(crewMorale.afterDivision.max, crewMorale.afterDivision.base + crewMorale.afterDivision.fromShare * Math.min(1, share.perHead / crewMorale.mood.perHeadForFull)),
            ),
          );
          return {
            state: { ...state, captain: { ...state.captain, gold: state.captain.gold + share.captain, chest: 0, morale, paidTick: state.tick } },
            events: [{ type: 'PlunderDivided', entityIds: [ship.id, ship.docked], payload: { captain: share.captain, perHead: Math.round(share.perHead), morale } }],
          };
        }
        const owed = wagesOwed(content, state, ship);
        if (owed <= 0) return refuse(state, ship, 'nothing-owed');
        if (state.captain.gold < owed) return refuse(state, ship, 'not-enough-gold');
        const morale = Math.max(moraleOf(content, state), crewMorale.afterWages);
        return {
          state: { ...state, captain: { ...state.captain, gold: state.captain.gold - owed, morale, paidTick: state.tick } },
          events: [{ type: 'WagesPaid', entityIds: [ship.id, ship.docked], payload: { gold: owed, morale } }],
        };
      }
      if (command.type === 'Repair') {
        // The shipwright: every ship of the fleet (or just the one asked for), the flagship first, hull then sails,
        // as far as the purse reaches.
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        if (!ship.docked) return refuse(state, ship, 'not-docked');
        const p = content.combat.port;
        let gold = state.captain.gold;
        let mended = false;
        const mend = <T extends { classId: string; hull?: number; sailCondition?: number; upgrades?: string[]; guns?: number }>(s: T): T => {
          const hullMax = shipStats(content, { ...s, fleetSpeed: undefined }).hullMax;
          let hull = s.hull ?? hullMax;
          let sails = s.sailCondition ?? 100;
          const hullFix = Math.max(0, Math.min(Math.ceil(hullMax - hull), p.hullGold > 0 ? Math.floor(gold / p.hullGold) : Infinity));
          hull = Math.min(hullMax, hull + hullFix);
          gold -= hullFix * p.hullGold;
          const sailFix = Math.max(0, Math.min(Math.ceil(100 - sails), p.sailGold > 0 ? Math.floor(gold / p.sailGold) : Infinity));
          sails = Math.min(100, sails + sailFix);
          gold -= sailFix * p.sailGold;
          if (hullFix > 0 || sailFix > 0) mended = true;
          return { ...s, hull, sailCondition: sails };
        };
        const one = command.only;
        const flagship = !one || one === ship.id ? mend(ship) : ship;
        const fleet = fleetOf(state).map((f) => (!one || one === f.id ? mend(f) : f));
        if (!mended) {
          const sound = [ship, ...fleetOf(state)].every((s) => (s.hull ?? Infinity) >= shipStats(content, { ...s, fleetSpeed: undefined }).hullMax && (s.sailCondition ?? 100) >= 100);
          return refuse(state, ship, sound ? 'sound' : 'not-enough-gold');
        }
        return {
          state: {
            ...state,
            // Mended sails let the fleet make its pace again.
            ships: { ...state.ships, [ship.id]: withFleetPace(content, flagship, fleet) },
            captain: { ...state.captain, gold, ...(state.captain.fleet ? { fleet } : {}) },
          },
          events: [{ type: 'Repaired', entityIds: [ship.id, ship.docked], payload: { gold: state.captain.gold - gold } }],
        };
      }
      if (command.type === 'BuyShip') {
        // A new ship from the yard: her class's price, sound, with part of her battery; she joins the fleet.
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        if (!ship.docked) return refuse(state, ship, 'not-docked');
        const port = byId.get(ship.docked)!;
        const cls = content.ships[command.classId];
        if (!cls || !shipsForSale(content, port).includes(command.classId)) return refuse(state, ship, 'not-built-here');
        const fleet = fleetOf(state);
        if (fleet.length + 2 > content.combat.fleet.maxShips) return refuse(state, ship, 'fleet-full');
        if (crewOf(content, ship) < fleetMinCrew(content, [...fleet, { classId: cls.id }], ship)) return refuse(state, ship, 'too-few-men');
        if (state.captain.gold < cls.price) return refuse(state, ship, 'not-enough-gold');
        // Named from her builders' list, the next name not already in the fleet.
        const names = content.traffic.names[port.nation] ?? content.traffic.names.pirate!;
        const taken = new Set([...fleet.map((f) => f.name), ship.name]);
        const name = names.find((x) => !taken.has(x)) ?? `${names[0]} ${fleet.length + 2}`;
        // Time stands still in port, so the id comes from the world's ship count, not the tick.
        const n = state.nextShipId ?? 0;
        const bought = {
          id: `ai.${n}`,
          name,
          classId: cls.id,
          hull: cls.hull,
          sailCondition: 100,
          guns: Math.floor(cls.guns * content.combat.shipyard.gunsShare),
        };
        const fleetAfter = [...fleet, bought];
        return {
          state: {
            ...state,
            ships: { ...state.ships, [ship.id]: withFleetPace(content, ship, fleetAfter) },
            captain: { ...state.captain, gold: state.captain.gold - cls.price, fleet: fleetAfter },
            nextShipId: n + 1,
          },
          events: [{ type: 'ShipBought', entityIds: [ship.id, port.id], payload: { classId: cls.id, gold: cls.price, name } }],
        };
      }
      if (command.type === 'ReclaimShip') {
        // A ship of the player's retaken from pirates, laid up here: she rejoins the fleet, salvage paid.
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        if (!ship.docked) return refuse(state, ship, 'not-docked');
        const laidUp = state.captain.laidUp ?? [];
        const laid = laidUp.find((l) => l.id === command.laidUpId && l.settlementId === ship.docked);
        if (!laid) return refuse(state, ship, 'not-here');
        const { settlementId: _at, fee, ...back } = laid;
        const fleet = fleetOf(state);
        if (fleet.length + 2 > content.combat.fleet.maxShips) return refuse(state, ship, 'fleet-full');
        if (crewOf(content, ship) < fleetMinCrew(content, [...fleet, back], ship)) return refuse(state, ship, 'too-few-men');
        if (state.captain.gold < fee) return refuse(state, ship, 'not-enough-gold');
        const fleetAfter = [...fleet, back];
        return {
          state: {
            ...state,
            ships: { ...state.ships, [ship.id]: withFleetPace(content, ship, fleetAfter) },
            captain: { ...state.captain, gold: state.captain.gold - fee, fleet: fleetAfter, laidUp: laidUp.filter((l) => l !== laid) },
          },
          events: [{ type: 'ShipReclaimed', entityIds: [ship.id, ship.docked], payload: { laidUpId: laid.id, fee } }],
        };
      }
      if (command.type === 'SellShip' || command.type === 'MakeFlagship') {
        // The shipwright and the fleet: sell a ship, or shift the flag to her. A sale is refused when what is
        // left couldn't carry the cargo aboard or berth the crew.
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        if (!ship.docked) return refuse(state, ship, 'not-docked');
        const fleet = fleetOf(state);
        const sold = fleet.find((f) => f.id === command.fleetId);
        if (!sold) return refuse(state, ship, 'no-such-ship');
        const rest = fleet.filter((f) => f !== sold);
        if (command.type === 'SellShip') {
          const after = { ...state, captain: { ...state.captain, fleet: rest } };
          if (fleetHold(content, after, ship) < cargoUsed(ship)) return refuse(state, ship, 'cargo-wont-fit');
          if (fleetBerths(content, after, ship) < crewOf(content, ship)) return refuse(state, ship, 'crew-wont-fit');
          const gold = shipValue(content, sold);
          return {
            state: {
              ...state,
              ships: { ...state.ships, [ship.id]: withFleetPace(content, ship, rest) },
              captain: { ...state.captain, gold: state.captain.gold + gold, fleet: rest },
            },
            events: [{ type: 'ShipSold', entityIds: [ship.id, ship.docked], payload: { name: sold.name, classId: sold.classId, gold } }],
          };
        }
        // The flag shifts: she becomes the flagship (where the flagship lies), and the old flagship sails in the fleet.
        const old: FleetShip = {
          id: `fleet.${state.tick}.${ship.classId}`,
          name: ship.name ?? `Your ${ship.classId.replace(/^ship\./, '')}`,
          classId: ship.classId,
          hull: ship.hull ?? shipStats(content, { ...ship, fleetSpeed: undefined }).hullMax,
          sailCondition: ship.sailCondition ?? 100,
          ...(ship.guns !== undefined ? { guns: ship.guns } : {}),
          ...(ship.upgrades ? { upgrades: ship.upgrades } : {}),
        };
        const fleetAfter = [...rest, old];
        const { guns: _g, upgrades: _u, ...hull } = ship;
        const flagship = withFleetPace(
          content,
          { ...hull, classId: sold.classId, name: sold.name, hull: sold.hull, sailCondition: sold.sailCondition, ...(sold.guns !== undefined ? { guns: sold.guns } : {}), ...(sold.upgrades ? { upgrades: sold.upgrades } : {}) },
          fleetAfter,
        );
        return {
          state: { ...state, ships: { ...state.ships, [ship.id]: flagship }, captain: { ...state.captain, fleet: fleetAfter } },
          events: [{ type: 'FlagShifted', entityIds: [ship.id, ship.docked], payload: { name: sold.name, classId: sold.classId } }],
        };
      }
      if (command.type === 'BuyProvisions') {
        // A ship spoken at sea sells food from her spare stores, dear; a pirate, or a ship of a nation that hunts
        // the captain, won't. Bought up to what she can spare, the hold holds and the purse pays.
        const ship = state.ships[command.shipId];
        const other = state.ships[command.targetId];
        if (!ship || !other?.ai) return undefined;
        if (ship.docked) return refuse(state, ship, 'in-port');
        if (Math.hypot(other.x - ship.x, other.y - ship.y) > content.traffic.hailTiles) return refuse(state, ship, 'too-far');
        const sp = content.economy.seaProvisions;
        const nation = other.ai.nation;
        if (nation === 'pirate' || (state.captain.standing?.[nation as keyof NonNullable<typeof state.captain.standing>] ?? 0) <= sp.refuseBelow) return refuse(state, ship, 'wont-sell');
        const price = Math.ceil((content.goods.find((g) => g.id === 'food')?.basePrice ?? 2) * sp.markup);
        const room = Math.max(0, fleetHold(content, state, ship) - cargoUsed(ship));
        const sold = state.captain.provisionsFrom?.[other.id] ?? 0;
        const units = Math.min(Math.floor(command.units), sp.spare - sold, room, Math.floor(state.captain.gold / price));
        if (!(units > 0)) return refuse(state, ship, room <= 0 ? 'hold-full' : sold >= sp.spare ? 'none-to-spare' : 'not-enough-gold');
        return {
          state: {
            ...state,
            ships: { ...state.ships, [ship.id]: { ...ship, cargo: { ...ship.cargo, food: (ship.cargo.food ?? 0) + units } } },
            captain: { ...state.captain, gold: state.captain.gold - units * price, provisionsFrom: { ...state.captain.provisionsFrom, [other.id]: sold + units } },
          },
          events: [{ type: 'ProvisionsBought', entityIds: [ship.id, other.id], payload: { units, gold: units * price } }],
        };
      }
      if (command.type === 'BuyGuns' || command.type === 'SellGuns') {
        // The shipwright mounts cannon up to her gun deck, or buys them back at half.
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        if (!ship.docked) return refuse(state, ship, 'not-docked');
        if (!sellsGuns(byId.get(ship.docked)!)) return refuse(state, ship, 'not-sold-here');
        const { guns, maxGuns } = shipStats(content, ship);
        const p = content.combat.port;
        const buying = command.type === 'BuyGuns';
        const count = buying
          ? Math.min(Math.floor(command.count), maxGuns - guns, p.gunGold > 0 ? Math.floor(state.captain.gold / p.gunGold) : Infinity)
          : Math.min(Math.floor(command.count), guns);
        if (!(count > 0)) return refuse(state, ship, buying ? (guns >= maxGuns ? 'battery-full' : 'not-enough-gold') : 'no-guns');
        const gold = buying ? -count * p.gunGold : count * p.gunSellGold;
        return {
          state: {
            ...state,
            ships: { ...state.ships, [ship.id]: { ...ship, guns: guns + (buying ? count : -count) } },
            captain: { ...state.captain, gold: state.captain.gold + gold },
          },
          events: [{ type: buying ? 'GunsBought' : 'GunsSold', entityIds: [ship.id, ship.docked], payload: { count, gold: Math.abs(gold) } }],
        };
      }
      if (command.type === 'BuyUpgrade') {
        const ship = state.ships[command.shipId];
        const upgrade = content.upgrades[command.upgradeId];
        if (!ship || !upgrade) return undefined;
        if (!ship.docked) return refuse(state, ship, 'not-docked');
        if (ship.upgrades?.includes(upgrade.id)) return refuse(state, ship, 'installed');
        if (!sellsUpgrade(content, byId.get(ship.docked)!, upgrade.id)) return refuse(state, ship, 'not-sold-here');
        if (state.captain.gold < upgrade.price) return refuse(state, ship, 'not-enough-gold');
        return {
          state: {
            ...state,
            ships: { ...state.ships, [ship.id]: { ...ship, upgrades: [...(ship.upgrades ?? []), upgrade.id] } },
            captain: { ...state.captain, gold: state.captain.gold - upgrade.price },
          },
          events: [{ type: 'UpgradeBought', entityIds: [ship.id, ship.docked], payload: { upgradeId: upgrade.id, gold: upgrade.price } }],
        };
      }
      if (command.type === 'HearNews') {
        const ship = state.ships[command.shipId];
        if (!ship?.docked) return ship ? refuse(state, ship, 'not-docked') : undefined;
        const heard = state.captain.heard ?? [];
        const fresh = newsAt(content, state, settlements, ship.docked).filter((n) => !heard.includes(n.id));
        if (!fresh.length) return { state, events: [] };
        return {
          state: { ...state, captain: { ...state.captain, heard: [...heard, ...fresh.map((n) => n.id).reverse()] } },
          events: [{ type: 'NewsHeard', entityIds: [ship.docked], payload: { ids: fresh.map((n) => n.id) } }],
        };
      }
      if (command.type === 'SpawnShock') {
        const s = byId.get(command.settlementId);
        if (!s || !content.economy.shocks.kinds[command.kind] || !content.goods.some((g) => g.id === command.good)) return undefined;
        const rng = rngStream(state.rng?.economy ?? seedRng(0, 'economy'));
        const r = startShock(content, state, s, command.good, command.kind, state.tick, rng);
        return { state: { ...r.state, rng: { ...r.state.rng, economy: rng.state() } }, events: r.events };
      }
      if (command.type === 'SpawnPlague') {
        const s = byId.get(command.settlementId);
        if (!s) return undefined;
        return startPlague(content, state, s, state.tick, e.plague.weeks[0]);
      }
      if (command.type === 'Buy' || command.type === 'Sell') {
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        if (!ship.docked) return refuse(state, ship, 'not-docked');
        const s = byId.get(ship.docked)!;
        if (!content.goods.some((g) => g.id === command.good)) return refuse(state, ship, 'unknown-good');
        const qty = Math.floor(command.quantity);
        if (!(qty > 0)) return refuse(state, ship, 'bad-quantity');
        let stock = state.markets[s.id]![command.good] ?? 0;
        let gold = state.captain.gold;
        const town = townOf(content, state, s);
        // The merchant's purse: what he pays out for the player's goods, filled by what she buys from him.
        let cash = town.cash;
        let held = ship.cargo[command.good] ?? 0;
        let used = cargoUsed(ship);
        let done = 0;
        let total = 0;
        // Selling prize cargo fills the plunder chest, not the captain's purse: it is the crew's as much as his.
        const plunderHeld = command.type === 'Sell' ? (ship.plunder?.[command.good] ?? 0) : 0;
        let chestGain = 0;
        // Unit by unit: every unit moves the stock, so a big trade gets dearer (or cheaper) as it goes.
        for (; done < qty; done++) {
          const q = quote(content, s, command.good, stock);
          if (command.type === 'Buy') {
            if (stock < 1 || gold < q.buy || used >= capacity(state, ship)) break;
            stock--;
            gold -= q.buy;
            cash += q.buy;
            held++;
            used++;
            total += q.buy;
          } else {
            if (held < 1 || cash < q.sell) break;
            cash -= q.sell;
            stock++;
            if (done < plunderHeld) chestGain += q.sell;
            else gold += q.sell;
            held--;
            used--;
            total += q.sell;
          }
        }
        if (done === 0) {
          const reason =
            command.type === 'Sell' ? (held < 1 ? 'none-in-hold' : 'merchant-out-of-gold') : stock < 1 ? 'sold-out' : used >= capacity(state, ship) ? 'hold-full' : 'not-enough-gold';
          return refuse(state, ship, reason, { good: command.good });
        }
        const market = { ...state.markets[s.id]!, [command.good]: stock };
        const cargo = { ...ship.cargo, [command.good]: held };
        if (held === 0) delete cargo[command.good];
        // What the hold cost: buying adds the gold spent; selling takes out the average cost of the units sold.
        const before = ship.paid?.[command.good] ?? 0;
        const heldBefore = ship.cargo[command.good] ?? 0;
        const cost = command.type === 'Buy' ? before + total : heldBefore > 0 ? before * (held / heldBefore) : 0;
        const paid = { ...ship.paid, [command.good]: Math.round(cost) };
        if (held === 0) delete paid[command.good];
        const plunder = { ...ship.plunder };
        if (plunderHeld) {
          const left = Math.max(0, plunderHeld - done);
          if (left) plunder[command.good] = left;
          else delete plunder[command.good];
        }
        const next = {
          ...state,
          markets: { ...state.markets, [s.id]: market },
          towns: { ...state.towns, [s.id]: { ...town, cash: Math.round(cash) } },
          ships: { ...state.ships, [ship.id]: { ...ship, cargo, paid, ...(ship.plunder ? { plunder } : {}) } },
        };
        const events: EmittedEvent[] = [
          { type: command.type === 'Buy' ? 'Bought' : 'Sold', entityIds: [ship.id, s.id], payload: { good: command.good, quantity: done, gold: total } },
        ];
        // A contract here for this good: what she sells counts toward it, and the last unit in earns the
        // reward and ends the shortage (the town is supplied).
        const deal = command.type === 'Sell' ? (state.contracts ?? []).find((c) => c.settlementId === s.id && c.good === command.good && c.endTick > state.tick) : undefined;
        let contracts = state.contracts;
        let shocks = state.shocks;
        if (deal) {
          const delivered = Math.min(deal.units, deal.delivered + done);
          if (delivered < deal.units) contracts = contracts!.map((c) => (c === deal ? { ...c, delivered } : c));
          else {
            contracts = contracts!.filter((c) => c !== deal);
            shocks = (shocks ?? []).filter((x) => !(x.settlementId === s.id && x.good === command.good));
            gold += deal.reward;
            events.push({ type: 'ContractFilled', entityIds: [ship.id, s.id], payload: { good: deal.good, units: deal.units, reward: deal.reward } });
          }
        }
        // The rest of the captain (standing, marques, deeds, news heard, the crew's side) stays as it was.
        const captain = { ...state.captain, gold, knownPrices: seen(next, s, market), ...(chestGain ? { chest: (state.captain.chest ?? 0) + chestGain } : {}) };
        return { state: { ...next, captain, ...(contracts ? { contracts } : {}), ...(shocks ? { shocks } : {}) }, events };
      }
      return undefined;
    },
    tick(state) {
      if (!state.markets) return { state, events: [] };
      const tick = state.tick + 1;
      const storms = state.weather?.storms ?? [];
      const weekly = tick % ticksPerWeek === 0;
      const daily = tick % content.calendar.ticksPerDay === 0;
      if (!weekly && !daily && storms.length === 0) return { state, events: [] };
      const rng = rngStream(state.rng?.economy ?? seedRng(0, 'economy'));
      let next = state;
      const events: EmittedEvent[] = [];
      if (daily) {
        const fed = messDay(next, tick);
        next = fed.state;
        events.push(...fed.events);
        next = liveDay(next);
      }
      const shock = (s: Settlement, good: string, kind: string) => {
        const r = startShock(content, next, s, good, kind, tick, rng);
        next = r.state;
        events.push(...r.events);
      };

      // A storm's eye over a town wrecks what it makes. Checked every tick while storms are out, as a
      // daily look could miss a fast storm crossing a town; an active shock stops it repeating.
      for (const storm of storms) {
        for (const s of settlements) {
          if (Math.hypot(storm.x - s.x, storm.y - s.y) > storm.radius) continue;
          for (const g of content.goods) {
            // The crops in the fields, not what the distilleries and looms make of them.
            if (tradeLean(content, s, g.id) === 'exports' && !e.chains[g.id] && !activeShock(next, s.id, g.id)) shock(s, g.id, 'storm');
          }
        }
      }

      if (weekly) {
        // Shocks that have run their course end, and news too old to matter is forgotten.
        const keepFrom = tick - e.news.keepWeeks * ticksPerWeek;
        next = {
          ...next,
          shocks: (next.shocks ?? []).filter((x) => x.endTick > tick),
          contracts: (next.contracts ?? []).filter((x) => x.endTick > tick),
          news: (next.news ?? []).filter((n) => n.tick >= keepFrom),
          // Deeds no governor has paid for lapse with the news of them.
          captain: next.captain?.deeds ? { ...next.captain, deeds: next.captain.deeds.filter((d) => d.tick >= keepFrom) } : next.captain,
        };
        // New shocks somewhere in the Caribbean: two draws a week at half the weekly rate each.
        const kinds = Object.fromEntries(Object.entries(e.shocks.kinds).map(([id, k]) => [id, k.weight]));
        for (let i = 0; i < 2; i++) {
          if (rng.float() >= e.shocks.perWeek / 2) continue;
          const kind = rng.weighted(kinds);
          const s = settlements[Math.floor(rng.float() * settlements.length)]!;
          const on = e.shocks.kinds[kind]!.on;
          const goods = content.goods.filter((g) => (on === 'staple' ? g.staple : tradeLean(content, s, g.id) === on) && !activeShock(next, s.id, g.id));
          if (goods.length) shock(s, goods[Math.floor(rng.float() * goods.length)]!.id, kind);
        }
        // Plague: outbreaks somewhere in a big enough town, two draws a week at half the weekly rate each.
        for (let i = 0; i < 2; i++) {
          if (rng.float() >= e.plague.perWeek / 2) continue;
          const s = settlements[Math.floor(rng.float() * settlements.length)]!;
          const weeks = Math.floor(rng.range(e.plague.weeks[0], e.plague.weeks[1] + 1));
          if (plagued(next, s.id) || townOf(content, next, s).people < e.plague.minPeople) continue;
          const r = startPlague(content, next, s, tick, weeks);
          next = r.state;
          events.push(...r.events);
        }
        // Weekly, towns grow or shrink by how well their needs were met: slowly up, fast down.

        next = { ...next, towns: grow(next) };
        events.push({ type: 'MarketsTurned', entityIds: [], payload: { week: tick / ticksPerWeek } });
      }
      return { state: { ...next, rng: { ...next.rng, economy: rng.state() } }, events };
    },
  };
}
