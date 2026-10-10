import type { WorldState } from '@corsair/core';
import { shipStats } from '@corsair/data';
import type { ContentPack, PlacedSettlement } from '@corsair/data';
import { crewOf, fleetBerths, fleetOf, hasGovernor } from '@corsair/systems-economy';
import { atWar, NATIONS } from '@corsair/systems-politics';
import { topTen } from './index';

// The captain's goals (slice 3 of docs/design/combat-model.md): the career's next steps, in order, each with its
// progress and where it gets done, read from the world as it stands. The Goals page in the log shows the first
// three not yet done; a trader and a fighter both always have a next step.

export interface Goal {
  id: string;
  title: string;
  /** What finishing it brings, in a few words. */
  why: string;
  have: number;
  of: number;
  /** How to read the progress ("guns", "gold"). */
  unit: string;
  done: boolean;
  /** Where it gets done: a port to sail for, or a page of the log. */
  port?: string;
  page?: 'top' | 'maps';
}

/** The career's goals, in order, from the state of the world. */
export function careerGoals(content: ContentPack, state: WorldState, settlements: PlacedSettlement[]): Goal[] {
  const ship = state.ships.player;
  const captain = state.captain;
  if (!ship || !captain) return [];
  const stats = shipStats(content, ship);
  const record = captain.record ?? {};
  const near = (keep: (s: PlacedSettlement) => boolean) =>
    settlements.filter(keep).sort((a, b) => Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0]?.id;
  const yard = near((s) => s.size === 'city' && s.nation !== 'pirate');
  const tavern = near((s) => s.size !== 'hamlet');
  // A governor whose nation is at war, who grants letters of marque.
  const governor = near((s) => hasGovernor(s) && NATIONS.some((n) => n !== s.nation && atWar(content, state, s.nation, n)));
  // Pirates of her own class's rung or bigger beaten.
  const rungOf = (classId: string) => content.traffic.danger.classRung[classId] ?? 2;
  const ownRung = rungOf(ship.classId);
  const matched = Object.entries(record.beaten ?? {}).reduce((n, [cls, k]) => n + (rungOf(cls) >= ownRung ? k : 0), 0);
  const fleet = fleetOf(state);
  const frigate = [ship, ...fleet].some((f) => content.ships[f.classId]?.family === 'frigate');
  const rank = topTen(content, state).findIndex((r) => r.player) + 1;
  const hoards = content.pirates.captains.filter((c) => state.famous?.[c.id]?.hoard?.found).length;
  const maps = content.pirates.captains.filter((c) => state.captain?.mapPieces?.[c.id]).length;
  const upgrades = ship.upgrades?.length ?? 0;
  const all = Object.keys(content.upgrades).length;
  const goal = (g: Omit<Goal, 'done'> & { done?: boolean }): Goal => ({ ...g, done: g.done ?? g.have >= g.of });
  return [
    goal({ id: 'guns', title: 'Mount a full battery', why: 'Pirates think twice', have: stats.guns, of: stats.maxGuns, unit: 'guns', port: yard }),
    goal({ id: 'crew', title: 'Sign on a full crew', why: 'Boarding becomes a plan, not a gamble', have: crewOf(content, ship), of: fleetBerths(content, state, ship), unit: 'men', port: tavern }),
    goal({ id: 'trade', title: 'Make 2,000 gold trading', why: "The shipwright's upgrades in reach", have: Math.max(0, record.tradeProfit ?? 0), of: 2000, unit: 'gold' }),
    goal({ id: 'prize', title: 'Take your first prize', why: 'Plunder and volunteers', have: record.prizes ?? 0, of: 1, unit: 'prizes' }),
    goal({ id: 'marque', title: 'Win a letter of marque', why: 'Lawful prizes and bounties', have: (captain.marques ?? []).length, of: 1, unit: 'letters', port: governor }),
    goal({ id: 'match', title: 'Beat a pirate of your own size', why: 'The famous pirates of your rung notice you', have: matched, of: 1, unit: 'beaten' }),
    goal({ id: 'fit', title: 'Fit out your ship', why: 'Ready for the Main', have: Math.min(upgrades, 2), of: 2, unit: 'upgrades', port: yard }),
    goal({ id: 'famous', title: 'Beat a famous pirate', why: 'His wealth, fame, and a map piece', have: record.famousBeaten ?? 0, of: 1, unit: 'beaten', page: 'top' }),
    goal({ id: 'fitted', title: 'Fit her out fully', why: 'The best a hull of her class can be', have: upgrades, of: all, unit: 'upgrades', port: yard }),
    goal({ id: 'frigate', title: 'Command a frigate', why: 'The treasure routes', have: frigate ? 1 : 0, of: 1, unit: 'frigates', port: yard }),
    goal({ id: 'topten', title: 'Enter the Top Ten', why: 'A name the whole Main knows', have: rank > 0 && rank <= 10 ? 1 : 0, of: 1, unit: '', page: 'top' }),
    goal({ id: 'hoard', title: 'Dig up a hoard', why: "A famous pirate's gold", have: hoards, of: 1, unit: 'hoards', page: 'maps', done: hoards > 0 || undefined }),
  ].map((g) => (g.id === 'hoard' && maps === 0 && !g.done ? { ...g, why: `${g.why}: find a map piece first` } : g));
}
