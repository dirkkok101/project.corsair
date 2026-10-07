import { rngStream, seedRng } from '@corsair/core';
import type { Captain, Deed, EmittedEvent, KnownPrices, NewsItem, Ship, System, Wind, WorldState } from '@corsair/core';

type WindAt = (state: WorldState, x: number, y: number) => Wind;
import { angleOffWind, polarAt } from '@corsair/systems-navigation';
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
    if (d.nation === 'pirate') {
      pay.push(d);
      total += Math.round(b.pirate * (1 + piracy / b.piracyScale));
    } else if (atWar(content, state, nation, d.nation)) {
      pay.push(d);
      total += b[d.role === 'patrol' ? 'patrol' : 'merchant'];
    } else kept.push(d);
  }
  return { pay, kept, total };
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
export function repairCost(content: ContentPack, ship: Ship): number {
  const hullMax = shipStats(content, ship).hullMax;
  const p = content.combat.port;
  return Math.ceil(hullMax - (ship.hull ?? hullMax)) * p.hullGold + Math.ceil(100 - (ship.sailCondition ?? 100)) * p.sailGold;
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
  return { ...world, ships, markets, captain, rng: { ...world.rng, economy: rng.state() } };
}

const activeShock = (state: WorldState, settlementId: string, good: string) =>
  (state.shocks ?? []).find((x) => x.settlementId === settlementId && x.good === good);

/** How a shock in force moves a good's usual stock at a town: 1 when there is none. */
export function shockFactor(content: ContentPack, state: WorldState, settlementId: string, good: string): number {
  const shock = activeShock(state, settlementId, good);
  return shock ? content.economy.shocks.kinds[shock.kind]!.stock : 1;
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
  return {
    state: {
      ...state,
      shocks: [...(state.shocks ?? []), shock],
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
  const text = content.economy.shocks.kinds[item.kind]?.news ?? content.combat.news[item.kind] ?? content.politics.news[item.kind] ?? '{town}: {good}';
  // War and peace name the nations themselves ("England and Spain"); fights use the adjective ("the Spanish San Felipe").
  const nationWords = item.kind === 'war' || item.kind === 'peace' ? NATION_NAME : NATION_ADJECTIVE;
  return text
    .replaceAll('{town}', townName)
    .replaceAll('{good}', good)
    .replaceAll('{ship}', item.ship ?? 'a ship')
    .replaceAll('{nation}', nationWords[item.nation ?? ''] ?? '')
    .replaceAll('{other}', nationWords[item.other ?? ''] ?? '')
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
  const capacity = (ship: Ship) => content.ships[ship.classId]!.cargo;

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
        const standing = { ...state.captain.standing, [nation]: Math.min(100, (state.captain.standing?.[nation] ?? 0) + pay.length) };
        return {
          // Bounties are plunder: they go into the chest the crew sails for.
          state: { ...state, captain: { ...state.captain, chest: (state.captain.chest ?? 0) + total, deeds: kept, standing } },
          events: [{ type: 'BountiesPaid', entityIds: [ship.id, s.id], payload: { count: pay.length, gold: total } }],
        };
      }
      if (command.type === 'Recruit') {
        // The tavern: men sign on for a bounty each, up to the berths the ship has.
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        if (!ship.docked) return refuse(state, ship, 'not-docked');
        const berths = shipStats(content, ship).maxCrew;
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
        // The shipwright: hull first, then sails, as far as the purse reaches.
        const ship = state.ships[command.shipId];
        if (!ship) return undefined;
        if (!ship.docked) return refuse(state, ship, 'not-docked');
        const hullMax = shipStats(content, ship).hullMax;
        const p = content.combat.port;
        let gold = state.captain.gold;
        let hull = ship.hull ?? hullMax;
        let sails = ship.sailCondition ?? 100;
        const hullFix = Math.min(Math.ceil(hullMax - hull), p.hullGold > 0 ? Math.floor(gold / p.hullGold) : Infinity);
        hull = Math.min(hullMax, hull + hullFix);
        gold -= hullFix * p.hullGold;
        const sailFix = Math.min(Math.ceil(100 - sails), p.sailGold > 0 ? Math.floor(gold / p.sailGold) : Infinity);
        sails = Math.min(100, sails + sailFix);
        gold -= sailFix * p.sailGold;
        if (hullFix <= 0 && sailFix <= 0) return refuse(state, ship, hull >= hullMax && sails >= 100 ? 'sound' : 'not-enough-gold');
        return {
          state: { ...state, ships: { ...state.ships, [ship.id]: { ...ship, hull, sailCondition: sails } }, captain: { ...state.captain, gold } },
          events: [{ type: 'Repaired', entityIds: [ship.id, ship.docked], payload: { gold: state.captain.gold - gold } }],
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
            if (stock < 1 || gold < q.buy || used >= capacity(ship)) break;
            stock--;
            gold -= q.buy;
            held++;
            used++;
            total += q.buy;
          } else {
            if (held < 1) break;
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
            command.type === 'Sell' ? 'none-in-hold' : stock < 1 ? 'sold-out' : used >= capacity(ship) ? 'hold-full' : 'not-enough-gold';
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
          ships: { ...state.ships, [ship.id]: { ...ship, cargo, paid, ...(ship.plunder ? { plunder } : {}) } },
        };
        // The rest of the captain (standing, marques, deeds, news heard, the crew's side) stays as it was.
        const captain = { ...state.captain, gold, knownPrices: seen(next, s, market), ...(chestGain ? { chest: (state.captain.chest ?? 0) + chestGain } : {}) };
        return {
          state: { ...next, captain },
          events: [
            {
              type: command.type === 'Buy' ? 'Bought' : 'Sold',
              entityIds: [ship.id, s.id],
              payload: { good: command.good, quantity: done, gold: total },
            },
          ],
        };
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
            if (tradeLean(content, s, g.id) === 'exports' && !activeShock(next, s.id, g.id)) shock(s, g.id, 'storm');
          }
        }
      }

      if (weekly) {
        // Shocks that have run their course end, and news too old to matter is forgotten.
        const keepFrom = tick - e.news.keepWeeks * ticksPerWeek;
        next = {
          ...next,
          shocks: (next.shocks ?? []).filter((x) => x.endTick > tick),
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
          const goods = content.goods.filter((g) => tradeLean(content, s, g.id) === e.shocks.kinds[kind]!.on && !activeShock(next, s.id, g.id));
          if (goods.length) shock(s, goods[Math.floor(rng.float() * goods.length)]!.id, kind);
        }
        // Weekly market turn: each market closes part of the gap to its usual stock (production refills
        // what was bought, consumption eats what was dumped), shaken by a harvest. A shock moves the
        // usual stock, not the cap, so a glut can't ratchet stock upward week after week.
        const markets: Record<string, Record<string, number>> = {};
        for (const s of settlements) {
          const market = { ...next.markets![s.id] };
          for (const g of content.goods) {
            const usual = normalStock(content, s, g.id) * shockFactor(content, next, s.id, g.id) * rng.range(e.harvest[0], e.harvest[1]);
            const stock = market[g.id] ?? 0;
            const moved = stock + (usual - stock) * e.weeklyRecovery;
            market[g.id] = Math.round(Math.max(0, Math.min(normalStock(content, s, g.id) * e.maxStock, moved)));
          }
          markets[s.id] = market;
        }
        next = { ...next, markets };
        events.push({ type: 'MarketsTurned', entityIds: [], payload: { week: tick / ticksPerWeek } });
      }
      return { state: { ...next, rng: { ...next.rng, economy: rng.state() } }, events };
    },
  };
}
