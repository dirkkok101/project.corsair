import type { Command, Voyage, WorldState } from '@corsair/core';
import { shipStats } from '@corsair/data';
import type { ContentPack, PlacedSettlement } from '@corsair/data';
import { appetite, cargoUsed, closedTo, fleetHold, quote, tradeEdge, tradePreview } from './index';

// The First Voyage's port (docs/design/first-voyage.md): a building opens as she needs it. The rest stand shuttered,
// and what would be done in them is refused, so the sim and the screen agree.

export type PortService = 'merchant' | 'tavern' | 'governor' | 'shipwright';

const ALL: PortService[] = ['merchant', 'tavern', 'governor', 'shipwright'];
/** The buildings open at each step: none before she has something to bring them, then three, then the governor. */
const OPEN: Record<Voyage['step'], PortService[]> = {
  harbour: [],
  helm: [],
  salvage: [],
  prize: [],
  home: ['merchant', 'shipwright', 'tavern'],
  governor: ALL,
  done: ALL,
};

/** The building each port command is done in. */
const SERVICE: Partial<Record<Command['type'], PortService>> = {
  Buy: 'merchant',
  Sell: 'merchant',
  BuyGuns: 'shipwright',
  SellGuns: 'shipwright',
  Repair: 'shipwright',
  Careen: 'shipwright',
  BuyUpgrade: 'shipwright',
  BuyShip: 'shipwright',
  SellShip: 'shipwright',
  MakeFlagship: 'shipwright',
  ReclaimShip: 'shipwright',
  Recruit: 'tavern',
  DividePlunder: 'tavern',
  PayWages: 'tavern',
  BuyMapPiece: 'tavern',
  BuyMarque: 'governor',
  CollectBounties: 'governor',
  AcceptMission: 'governor',
  CallOnGovernor: 'governor',
};

/** Whether a building is open to her (always, off the voyage). */
export function voyageOpen(voyage: Voyage | undefined, service: PortService): boolean {
  return !voyage || OPEN[voyage.step].includes(service);
}

/** The shuttered building a command would be done in, if the voyage has it shut. */
export function voyageShut(voyage: Voyage | undefined, command: Command): PortService | undefined {
  const service = SERVICE[command.type];
  return service && !voyageOpen(voyage, service) ? service : undefined;
}

/**
 * The casks the cay's wreck gives up: enough that, sold at home, they cover `cover` times what a full battery costs
 * beyond her purse (at least `minUnits`), so the first sale fills her guns.
 */
export function salvageUnits(content: ContentPack, state: WorldState, home: PlacedSettlement): number {
  const sv = content.voyage.salvage;
  const ship = state.ships.player;
  if (!ship || !state.captain) return sv.minUnits;
  const { guns, maxGuns } = shipStats(content, ship);
  const lack = Math.max(0, (maxGuns - guns) * content.combat.port.gunGold - state.captain.gold);
  const sell = quote(content, home, sv.good, state.markets?.[home.id]?.[sv.good] ?? 0).sell;
  return Math.max(sv.minUnits, Math.ceil((lack * sv.cover) / Math.max(1, sell)));
}

/** A cargo to run: the good bought here, how many, at what each (on average), sold where for about what each. */
export interface TradeRun {
  good: string;
  units: number;
  buy: number;
  to: string;
  sell: number;
  profit: number;
}

/**
 * The First Voyage's trade commission: of the goods sold here, the run of up to `tradeUnits` (as many as her hold
 * takes and her purse pays for, the prices sliding as she buys and sells) that clears the most at an open port within
 * `tradeTiles`; undefined if nothing here pays to carry.
 */
export function suggestTrade(content: ContentPack, state: WorldState, town: PlacedSettlement, settlements: PlacedSettlement[]): TradeRun | undefined {
  const ship = state.ships.player;
  if (!ship || !state.captain) return undefined;
  const c = content.voyage.commissions;
  const room = Math.max(0, fleetHold(content, state, ship) - cargoUsed(ship));
  let best: TradeRun | undefined;
  for (const g of content.goods) {
    if (g.id === 'food') continue;
    const here = state.markets?.[town.id]?.[g.id] ?? 0;
    const bought = tradePreview(content, town, g.id, here, 'Buy', c.tradeUnits, { gold: state.captain.gold, room, held: 0, want: appetite(content, state, town, g.id, here, 'Buy') }, tradeEdge(content, state.captain, town.nation));
    if (!bought.units) continue;
    for (const s of settlements) {
      if (s.id === town.id || s.type === 'haven' || Math.hypot(s.x - town.x, s.y - town.y) > c.tradeTiles || closedTo(content, state, s)) continue;
      const there = state.markets?.[s.id]?.[g.id] ?? 0;
      const sold = tradePreview(content, s, g.id, there, 'Sell', bought.units, { gold: 0, room: 0, held: bought.units, want: appetite(content, state, s, g.id, there, 'Sell') }, tradeEdge(content, state.captain, s.nation));
      const profit = sold.total - bought.total;
      if (sold.units === bought.units && profit > (best?.profit ?? 0))
        best = { good: g.id, units: bought.units, buy: Math.round(bought.total / bought.units), to: s.id, sell: Math.round(sold.total / sold.units), profit };
    }
  }
  return best;
}
