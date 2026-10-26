import type { Captain } from '@corsair/core';
import { describe, expect, it } from 'vitest';
import { appetite, estatePrice } from '@corsair/systems-economy';
import { content, settlements, world } from '../test/fixtures';
import { voyageProbe } from '../test/probe';

// A captain's own wealth over a long career (the late-game gold sink, docs/reference/onboarding/reward-systems-research.md):
// a frigate trading the Port Royal-Tortuga run makes a steady income, and the governors' estates (an admiral's to buy,
// each lot dearer than the last) are what it buys late on: the first lot within a voyage's profit and better for her
// name than the gold kept, the lots after it dearer, until the gold kept is worth more. The log line is the measure
// of the trade's own pace: a year of the best run, in wealth points, against the highest fate.
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
    const score = content.politics.career.score;
    // A lot's worth to her name: its acres' points (and its rent besides), against the same gold kept in her purse.
    const lotPoints = e.acres / score.acresPer;
    const legend = content.politics.career.fates.at(-1)!.score;
    console.log('WEALTH', m.margin.good, 'units', units, 'margin', m.margin.now, 'per voyage', Math.round(perVoyage), 'voyages a year', voyagesPerYear.toFixed(1), 'a year', Math.round(year), 'its wealth points', Math.round(year / score.goldPer), 'legend at', legend, 'lots it buys', lots);
    // The first lot is within a voyage's profit, and is worth more to her name than the gold it costs kept.
    expect(perVoyage).toBeGreaterThan(0);
    expect(e.gold).toBeLessThanOrEqual(perVoyage);
    expect(lotPoints / e.gold).toBeGreaterThan(1 / score.goldPer);
    // Each lot dearer: a year's trade buys far fewer lots than it made voyages, and the last of them is worth less to
    // her name than its gold kept (the sink has a bottom: past it, rent is what still pays).
    expect(lots).toBeLessThan(voyagesPerYear);
    expect(lotPoints / estatePrice(content, captain)).toBeLessThan(1 / score.goldPer);
  }, 600_000);
});
