import type { Ship } from '@corsair/core';
import { shipStats } from '@corsair/data';
import { describe, expect, it } from 'vitest';
import { content, fight, ship } from '../test/fixtures';

// Balance: how fights come out over many seeds (pnpm verify:balance, before merging a change to combat tuning).
describe('battle balance', () => {
  it('who sails her: veterans under a good captain beat green men under a poor one', () => {
    const pirate = (crew?: 'green' | 'regular' | 'veteran', skill?: number): Ship => {
      const s = ship('ship.brigantine', 'pirate', 0.9);
      return { ...s, ai: { ...s.ai!, temperament: 'bold', ...(crew ? { crew } : {}), ...(skill !== undefined ? { captain: { gunnery: skill, seamanship: skill, boarding: skill, resolve: skill } } : {}) } };
    };
    const losses = (crew: 'green' | 'veteran', skill: number) => {
      let n = 0;
      for (let seed = 1; seed <= 30; seed++) if (fight(pirate(crew, skill), seed).result()!.outcome === 'lost') n++;
      return n;
    };
    const easy = losses('green', 20);
    const hard = losses('veteran', 90);
    expect(hard).toBeGreaterThan(easy + 5);
  }, 120_000);

  it('surrender: a captain of resolve holds out longer than a faint-hearted one', () => {
    const sloop = (resolve: number): Ship => {
      const s = ship('ship.sloop', 'pirate', 0.85);
      return { ...s, ai: { ...s.ai!, temperament: 'cautious', captain: { gunnery: 50, seamanship: 50, boarding: 50, resolve } } };
    };
    const struck = (resolve: number) => {
      let n = 0;
      for (let seed = 1; seed <= 30; seed++) if (fight(sloop(resolve), seed).result()!.outcome === 'struck') n++;
      return n;
    };
    expect(struck(5)).toBeGreaterThan(struck(95));
  }, 120_000);

  it('ten famous captains, each his own: harder by tier against an armed brig, and no two of a class alike', () => {
    const asHeSails = (c: (typeof content.pirates.captains)[number]): Ship => {
      const s = ship(c.classId, 'pirate');
      return {
        ...s,
        upgrades: c.upgrades,
        crew: shipStats(content, { classId: c.classId, upgrades: c.upgrades }).maxCrew,
        ai: { ...s.ai!, temperament: c.temperament, famous: c.id, crew: c.crew, captain: c.captain, ...(c.doctrine ? { doctrine: c.doctrine } : {}), ...(c.terror ? { terror: c.terror } : {}) },
      };
    };
    const losses = new Map<string, number>();
    const ends = new Map<string, string>();
    for (const c of content.pirates.captains) {
      let lost = 0;
      const seen: string[] = [];
      for (let seed = 1; seed <= 16; seed++) {
        const b = fight(asHeSails(c), seed, 'cautious', { crew: 120 });
        seen.push(`${b.result()!.outcome}:${b.state.tick}`);
        if (b.result()!.outcome === 'lost') lost++;
      }
      losses.set(c.id, lost);
      ends.set(c.id, seen.join(','));
    }
    const mean = (ids: string[]) => ids.reduce((n, id) => n + losses.get(id)!, 0) / ids.length;
    const top = mean(['morgan', 'lolonnais', 'mansvelt']);
    const middle = mean(['braziliano', 'degraaf', 'grammont']);
    const bottom = mean(['portugues', 'willems', 'coxon', 'legrand']);
    expect(top).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(bottom);
    // Captains of one class no longer fight seed for seed alike.
    expect(ends.get('morgan')).not.toBe(ends.get('lolonnais'));
    expect(ends.get('braziliano')).not.toBe(ends.get('grammont'));
    expect(ends.get('willems')).not.toBe(ends.get('coxon'));
  }, 300_000);

  it('outfitting pays: a stock 10-gun brig, a full battery, and a fully fitted brig against a pirate sloop', () => {
    const wins = (outfit: Partial<Ship>) => {
      let n = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const o = fight(ship('ship.sloop', 'pirate', 0.85), seed, 'cautious', outfit).result()!.outcome;
        if (o === 'sunk' || o === 'struck' || o === 'boarded') n++;
      }
      return n;
    };
    const stock = wins({ guns: 10 });
    const full = wins({});
    const fitted = wins({ upgrades: Object.keys(content.upgrades) });
    console.log('OUTFIT brig vs pirate sloop wins of 40: 10 guns', stock, '18 guns', full, 'fully fitted', fitted);
    expect(full).toBeGreaterThanOrEqual(stock);
    expect(fitted).toBeGreaterThanOrEqual(full);
  }, 120_000);

  it('a famous pirate is a hard fight: her veterans beat a stock 10-gun brig most times (the top of the list nearly always)', () => {
    const famous = (classId: string, temperament: string) => {
      const s = ship(classId, 'pirate', 1);
      return { ...s, ai: { ...s.ai!, famous: 'test', temperament } };
    };
    const tally: Record<string, number> = {};
    for (const c of content.pirates.captains) {
      let lost = 0;
      for (let seed = 1; seed <= 6; seed++) if (fight(famous(c.classId, c.temperament), seed, 'cautious', { guns: 10 }).result()!.outcome === 'lost') lost++;
      tally[c.id] = lost;
    }
    console.log('FAMOUS stock brig losses of 6 against each', JSON.stringify(tally));
    const losses = Object.values(tally).reduce((a, b) => a + b, 0);
    expect(losses).toBeGreaterThan(content.pirates.captains.length * 6 * 0.5);
  }, 300_000);

  it('plays matchups with the outcomes the design intends (headless runner)', () => {
    const tally = (enemy: () => Ship, n = 40) => {
      const outcomes: Record<string, number> = {};
      let seconds = 0;
      let volleys = 0;
      let beforeGrapple = 0;
      let grapples = 0;
      let broken = 0;
      const firsts: number[] = [];
      for (let seed = 1; seed <= n; seed++) {
        const b = fight(enemy(), seed);
        outcomes[b.result()!.outcome] = (outcomes[b.result()!.outcome] ?? 0) + 1;
        seconds += b.state.tick / 30;
        volleys += b.volleys;
        beforeGrapple += b.beforeGrapple;
        grapples += b.grapples;
        broken += b.broken;
        if (b.firstVolley !== undefined) firsts.push(b.firstVolley);
      }
      firsts.sort((a, b) => a - b);
      return {
        outcomes,
        seconds: Math.round(seconds / n),
        // Feel: seconds to the first broadside (median), and broadsides a minute across the fights.
        firstVolley: Math.round(firsts[Math.floor(firsts.length / 2)] ?? -1),
        volleysPerMinute: Math.round((volleys / (seconds / 60)) * 10) / 10,
        // Tension: broadsides before the first grapple (mean), and grapples thrown and cut free in all.
        volleysBeforeGrapple: Math.round((beforeGrapple / n) * 10) / 10,
        grapples,
        broken,
      };
    };
    const merchant = tally(() => ship('ship.fluyt', 'merchant', 0.55));
    const pirate = tally(() => ship('ship.sloop', 'pirate', 0.85));
    const frigate = tally(() => ship('ship.frigate', 'patrol', 0.85));
    console.log('BATTLE brig vs merchant fluyt', JSON.stringify(merchant));
    console.log('BATTLE brig vs pirate sloop', JSON.stringify(pirate));
    console.log('BATTLE brig vs frigate', JSON.stringify(frigate));
    const wins = (o: Record<string, number>) => (o.sunk ?? 0) + (o.struck ?? 0) + (o.boarded ?? 0);
    // A merchant is prey: the brig takes most of them; some run clear.
    expect(wins(merchant.outcomes)).toBeGreaterThanOrEqual(20);
    // A pirate sloop is a real fight, but a well-handled brig wins more often than not.
    expect(wins(pirate.outcomes)).toBeGreaterThanOrEqual(15);
    // A frigate outguns a brig: attacking one is a mistake.
    expect(frigate.outcomes.lost ?? 0).toBeGreaterThan(wins(frigate.outcomes));
  }, 120_000);
});
