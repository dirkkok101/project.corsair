import type { Captain } from '@corsair/core';
import { describe, expect, it } from 'vitest';
import { appetite, estatePrice, ladderPoints } from '@corsair/systems-economy';
import { content, settlements, world } from '../test/fixtures';
import { voyageProbe } from '../test/probe';

// A captain's own wealth over a long career (the late-game gold sink, docs/reference/onboarding/reward-systems-research.md):
// a frigate trading the Port Royal-Tortuga run makes a steady income, and the governors' estates (an admiral's to buy,
// each lot dearer than the last) are what it buys late on. Trade fame and wealth count on rising ladders, so the best
// run alone takes about five years to make a legend, not one.
describe("a captain's wealth", () => {
  it("a frigate's trade buys the first estate in a voyage, and each lot after costs more, until gold kept is worth more", () => {
    const frigate = content.ships['ship.frigate']!;
    const m = voyageProbe(['town.port_royal', 'town.tortuga'], { days: 60 });
    // Each voyage, as much of the best good as the merchants at both ends deal in near their price (their appetite,
    // economy.json) and her hold carries, at the margin as it stands after two months of the world's trade. A market
    // takes about a week to come back (economy.json pull), so the same run pays at most once a week.
    const state = world(1).state;
    const [from, to] = ['town.port_royal', 'town.tortuga'].map((id) => settlements.find((s) => s.id === id)!);
    const stock = (s: typeof from) => state.markets?.[s!.id]?.[m.margin.good] ?? 0;
    const units = Math.min(frigate.cargo, appetite(content, state, from!, m.margin.good, stock(from), 'Buy'), appetite(content, state, to!, m.margin.good, stock(to), 'Sell'));
    const perVoyage = m.margin.now * units;
    const voyagesPerYear = Math.min(52, (m.voyages * 365) / 60);
    const year = perVoyage * voyagesPerYear;
    let captain: Captain = { gold: year, knownPrices: {} };
    let lots = 0;
    for (let price = estatePrice(content, captain); captain.gold >= price; price = estatePrice(content, captain)) {
      captain = { ...captain, gold: captain.gold - price, estates: { england: (captain.estates?.england ?? 0) + content.politics.ranks.estate.acres } };
      lots++;
    }
    const e = content.politics.ranks.estate;
    const c = content.politics.career;
    // A lot's worth to her name: its acres' points (and its rent besides).
    const lotPoints = e.acres / c.score.acresPer;
    // Her name after years of the best run and nothing else: its trade fame and the gold kept, on their rising ladders.
    const named = (years: number) => ladderPoints(year * years, c.fame.trade.goldStep) + ladderPoints(year * years, c.score.goldStep);
    const fate = (title: string) => c.fates.find((f) => f.title.includes(title))!.score;
    console.log('WEALTH', m.margin.good, 'units', units, 'margin', m.margin.now, 'per voyage', Math.round(perVoyage), 'voyages a year', voyagesPerYear.toFixed(1), 'a year', Math.round(year), 'score after 1, 2, 5 years', named(1), named(2), named(5), 'lots a year buys', lots);
    // No one way of playing wins it alone, fast: a year of the best trade is short of the governor's council, and
    // five years of it come to about a legend.
    expect(named(1)).toBeLessThan(fate('council'));
    expect(named(5)).toBeGreaterThan(fate('Governor'));
    // The first lot is within a voyage's profit, and is worth more to her name than the first gold kept; each lot
    // after costs more than the last, so a year's best trade buys only a few.
    expect(perVoyage).toBeGreaterThan(0);
    expect(e.gold).toBeLessThanOrEqual(perVoyage);
    expect(lotPoints / e.gold).toBeGreaterThan(1 / c.score.goldStep);
    expect(lots).toBeLessThan(25);
  }, 600_000);
});
