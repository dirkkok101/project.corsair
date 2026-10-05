import { rngStream, seedRng } from '@corsair/core';
import type { Captain, EmittedEvent, KnownPrices, Ship, System, WorldState } from '@corsair/core';
import type { ContentPack, PlacedSettlement } from '@corsair/data';

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

/** The stock a market drifts back to: above the reference where the good is made, below where it is needed. */
export function normalStock(content: ContentPack, s: Settlement, good: string): number {
  const e = content.economy;
  const profiles = (e.settlementProfiles[s.id] ?? []).map((p) => e.profiles[p]!);
  const makes = profiles.some((p) => (p.produces[good] ?? 0) > 0);
  const needs = profiles.some((p) => (p.consumes[good] ?? 0) > 0);
  const lean = makes ? e.producerStock : needs ? e.consumerStock : 1;
  return referenceStock(content, s, good) * lean;
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

export function createEconomySystem(content: ContentPack, settlements: Settlement[]): System {
  const e = content.economy;
  const byId = new Map(settlements.map((s) => [s.id, s]));
  const ticksPerWeek = e.daysPerWeek * content.calendar.ticksPerDay;
  const capacity = (ship: Ship) => content.ships[ship.classId]!.cargo;

  const seen = (state: WorldState, s: Settlement, market: Record<string, number>): Record<string, KnownPrices> => ({
    ...state.captain!.knownPrices,
    [s.id]: {
      day: Math.floor(state.tick / content.calendar.ticksPerDay),
      prices: Object.fromEntries(content.goods.map((g) => [g.id, quote(content, s, g.id, market[g.id] ?? 0)])),
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
        return {
          state: { ...state, ships: { ...state.ships, [ship.id]: rest } },
          events: [{ type: 'Undocked', entityIds: [ship.id, docked], payload: {} }],
        };
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
        const next = { ...state, markets: { ...state.markets, [s.id]: market }, ships: { ...state.ships, [ship.id]: { ...ship, cargo } } };
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
      if (tick % ticksPerWeek !== 0) return { state, events: [] };
      // Weekly market turn: each market closes part of the gap to its usual stock (production refills
      // what was bought, consumption eats what was dumped), shaken by a harvest.
      const rng = rngStream(state.rng?.economy ?? seedRng(0, 'economy'));
      const markets: Record<string, Record<string, number>> = {};
      for (const s of settlements) {
        const market = { ...state.markets[s.id] };
        for (const g of content.goods) {
          const usual = normalStock(content, s, g.id) * rng.range(e.harvest[0], e.harvest[1]);
          const stock = market[g.id] ?? 0;
          const next = stock + (usual - stock) * e.weeklyRecovery;
          market[g.id] = Math.round(Math.max(0, Math.min(normalStock(content, s, g.id) * e.maxStock, next)));
        }
        markets[s.id] = market;
      }
      return {
        state: { ...state, markets, rng: { ...state.rng, economy: rng.state() } },
        events: [{ type: 'MarketsTurned', entityIds: [], payload: { week: tick / ticksPerWeek } }],
      };
    },
  };
}
