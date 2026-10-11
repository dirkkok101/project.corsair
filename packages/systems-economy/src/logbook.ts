import type { GameEvent, LogEntry, System } from '@corsair/core';
import type { ContentPack, PlacedSettlement } from '@corsair/data';
import { newsText } from './index';

/** The log keeps this many lines, the oldest dropped first. */
export const LOGBOOK_SIZE = 200;

const ADJECTIVE: Record<string, string> = { spain: 'Spanish', england: 'English', france: 'French', netherlands: 'Dutch', pirate: 'pirate' };
const COUNTRY: Record<string, string> = { spain: 'Spain', england: 'England', france: 'France', netherlands: 'the Netherlands' };

/**
 * The captain's log (storyboard 6.1): it watches what the systems do and writes the captain's deeds and losses, and
 * the news he hears in taverns and from ships he hails, as dated lines. Sales of one good in one port on one day make one line.
 */
export function createLogbookSystem(content: ContentPack, settlements: Pick<PlacedSettlement, 'id' | 'name'>[]): System {
  const town = (id?: string) => settlements.find((s) => s.id === id)?.name ?? id ?? '';
  const good = (id: unknown) => (content.goods.find((g) => g.id === id)?.name ?? String(id)).toLowerCase();
  const kind = (classId: unknown) => String(classId).replace(/^ship\./, '').replace(/_/g, ' ');
  const gold = (n: unknown) => `${Math.round(Number(n)).toLocaleString('en-GB')} gold`;
  const day = (tick: number) => Math.floor(tick / content.calendar.ticksPerDay);

  const saleText = (sale: NonNullable<LogEntry['sale']>, at?: string) =>
    `Sold ${sale.quantity} ${good(sale.good)} at ${town(at)} for ${gold(sale.gold)}${
      sale.profit === undefined ? '' : `: ${sale.profit >= 0 ? '+' : '-'}${Math.abs(sale.profit).toLocaleString('en-GB')}`
    }.`;

  /** The line an event of the player's writes, or none. */
  const lineOf = (e: GameEvent): Omit<LogEntry, 'tick'> | undefined => {
    const p = e.payload;
    const at = e.entityIds[1];
    switch (e.type) {
      case 'BattleOver': {
        const her = `the ${ADJECTIVE[String(p.nation)] ?? ''} ${p.role === 'merchant' ? 'merchant' : p.role === 'patrol' ? 'man-of-war' : 'pirate'} ${p.ship}`.replace(/ +/g, ' ');
        const purse = Number(p.purse) ? `: ${gold(p.purse)} in her purse` : '';
        if (p.outcome === 'struck' || p.outcome === 'boarded') return { kind: 'deed', text: `Took ${her}${purse}.` };
        if (p.outcome === 'sunk') return { kind: 'deed', text: `Sank ${her}.` };
        if (p.outcome === 'escaped') return { kind: 'deed', text: `${her[0]!.toUpperCase()}${her.slice(1)} got away.` };
        if (p.outcome === 'fled') return { kind: 'loss', text: `Drew clear of ${her}.` };
        if (p.outcome === 'yielded') return { kind: 'loss', text: `Struck to ${p.ship} when called on: gave up the chest and the hold.` };
        return { kind: 'loss', text: `Beaten by ${her}.` };
      }
      case 'Sold': {
        const sale = { good: String(p.good), quantity: Number(p.quantity), gold: Number(p.gold), ...(p.paid === undefined ? {} : { profit: Math.round(Number(p.gold) - Number(p.paid)) }) };
        return { kind: 'deed', text: saleText(sale, at), place: at, sale };
      }
      case 'Promoted':
        return { kind: 'deed', text: `Made ${p.rank} by ${COUNTRY[String(p.nation)] ?? p.nation}.`, place: at };
      case 'MarqueBought':
        return { kind: 'deed', text: `Took ${p.nation === 'england' ? 'an' : 'a'} ${ADJECTIVE[String(p.nation)]} letter of marque at ${town(at)}.`, place: at };
      case 'BountiesPaid':
        return { kind: 'deed', text: `Collected ${gold(p.gold)} in bounties at ${town(at)}.`, place: at };
      case 'ContractFilled':
        return { kind: 'deed', text: `Filled the governor's contract for ${good(p.good)} at ${town(at)}: ${gold(p.reward)}.`, place: at };
      case 'MapPieceBought': {
        const name = content.pirates.captains.find((c) => c.id === p.pirateId)?.name ?? String(p.pirateId);
        return { kind: 'deed', text: `Bought a piece of ${name}'s map at ${town(at)}.`, place: at };
      }
      case 'HoardFound':
        return { kind: 'deed', text: `Dug up ${p.name}'s hoard: ${gold(p.gold)}.` };
      case 'ShipBought':
        return { kind: 'deed', text: `Bought the ${kind(p.classId)} ${p.name} at ${town(at)}.`, place: at };
      case 'ShipSold':
        return { kind: 'deed', text: `Sold the ${kind(p.classId)} ${p.name} at ${town(at)} for ${gold(p.gold)}.`, place: at };
      case 'Deserted':
        return { kind: 'loss', text: `${p.count} men deserted at ${town(at)}.`, place: at };
      case 'Retired':
        return { kind: 'deed', text: `Retired at ${town(at)}, with a score of ${p.score}.`, place: at };
      default:
        return undefined;
    }
  };

  return {
    name: 'logbook',
    tick: (state) => ({ state, events: [] }),
    observe(state, events) {
      if (!state.captain) return state;
      let log = state.captain.logbook ?? [];
      const write = (entry: LogEntry) => {
        // Selling a good in lots at one port on one day is one sale.
        const last = log[log.length - 1];
        if (last?.sale && entry.sale && last.sale.good === entry.sale.good && last.place === entry.place && day(last.tick) === day(entry.tick)) {
          const sale = {
            good: entry.sale.good,
            quantity: last.sale.quantity + entry.sale.quantity,
            gold: last.sale.gold + entry.sale.gold,
            ...(last.sale.profit === undefined && entry.sale.profit === undefined ? {} : { profit: (last.sale.profit ?? 0) + (entry.sale.profit ?? 0) }),
          };
          log = [...log.slice(0, -1), { ...entry, text: saleText(sale, entry.place), sale }];
          return;
        }
        log = [...log, entry];
      };
      for (const e of events) {
        // News heard in a tavern, or from a ship spoken at sea.
        if (e.type === 'NewsHeard' || e.type === 'Hailed') {
          for (const id of ((e.type === 'NewsHeard' ? e.payload.ids : e.payload.news) as string[]) ?? []) {
            const item = state.news?.find((n) => n.id === id);
            if (item) write({ tick: e.tick, kind: 'news', text: newsText(content, item, town(item.settlementId)), place: item.settlementId });
          }
          continue;
        }
        const line = lineOf(e);
        if (line) write({ tick: e.tick, ...line });
      }
      if (log === (state.captain.logbook ?? [])) return state;
      return { ...state, captain: { ...state.captain, logbook: log.slice(-LOGBOOK_SIZE) } };
    },
  };
}
