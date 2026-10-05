import { rngStream, seedRng } from '@corsair/core';
import type { Captain, EmittedEvent, KnownPrices, NewsItem, Ship, System, WorldState } from '@corsair/core';
import { isLand, tileAt } from '@corsair/data';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';

// Markets per settlement (PRD section 6). Each town keeps a stock S and a normal stock T per good;
// price = base * (T / max(S, 1)) ^ elasticity, and every unit traded moves S, so a glut in one port
// crashes its price and trade routes limit themselves. Towns produce and consume weekly.

/** How close (in tiles) a ship must be to a settlement to dock there: about 7.5 km. */
export const DOCK_RANGE = 3;

type Settlement = Pick<PlacedSettlement, 'id' | 'type' | 'size' | 'x' | 'y'>;

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
  const captain: Captain = { gold: content.economy.startingGold, knownPrices: {} };
  return { ...world, markets, captain, rng: { ...world.rng, economy: rng.state() } };
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
export function newsText(content: ContentPack, item: NewsItem, townName: string): string {
  const good = (content.goods.find((g) => g.id === item.good)?.name ?? item.good).toLowerCase();
  const text = content.economy.shocks.kinds[item.kind]?.news ?? '{town}: {good}';
  return text.replaceAll('{town}', townName).replaceAll('{good}', good);
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
): number {
  // Headings are compass degrees: 0 north (up, -y), 90 east (+x).
  const away = Math.atan2(ship.x - town.x, -(ship.y - town.y));
  let best = { deg: currentDeg, score: -Infinity };
  for (let i = 0; i < 32; i++) {
    const deg = i * 11.25;
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
export function createEconomySystem(content: ContentPack, settlements: Settlement[], map?: TileMap): System {
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
        // Drop anchor: stopped, helm and assist cleared.
        const { assist: _assist, ...rest } = ship;
        const docked: Ship = { ...rest, docked: s.id, speed: 0, helm: 0 };
        return {
          state: {
            ...state,
            ships: { ...state.ships, [ship.id]: docked },
            captain: { ...state.captain, knownPrices: seen(state, s, state.markets[s.id]!) },
          },
          events: [{ type: 'Docked', entityIds: [ship.id, s.id], payload: {} }],
        };
      }
      if (command.type === 'Undock') {
        const ship = state.ships[command.shipId];
        if (!ship?.docked) return undefined;
        const { docked, ...rest } = ship;
        // Cast off pointing out to sea, so the ship sails clear of the harbour rather than into the quay.
        const town = byId.get(docked);
        const headingDeg = map && town ? seawardHeading(map, ship, town, ship.headingDeg) : ship.headingDeg;
        return {
          state: { ...state, ships: { ...state.ships, [ship.id]: { ...rest, headingDeg } } },
          events: [{ type: 'Undocked', entityIds: [ship.id, docked], payload: {} }],
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
            gold += q.sell;
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
        const next = {
          ...state,
          markets: { ...state.markets, [s.id]: market },
          ships: { ...state.ships, [ship.id]: { ...ship, cargo, paid } },
        };
        return {
          state: { ...next, captain: { gold, knownPrices: seen(next, s, market) } },
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
      if (!weekly && storms.length === 0) return { state, events: [] };
      const rng = rngStream(state.rng?.economy ?? seedRng(0, 'economy'));
      let next = state;
      const events: EmittedEvent[] = [];
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
