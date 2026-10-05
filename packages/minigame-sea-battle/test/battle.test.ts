import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Ship } from '@corsair/core';
import { decodeRasterMap, loadContent } from '@corsair/data';
import { describe, expect, it } from 'vitest';
import { battleMap, createBattle } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const world = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});
// Open water south of Jamaica, so fights here are about seamanship, not coastlines.
const { map } = battleMap(content, world, 880, 680);

const ship = (classId: string, role?: 'merchant' | 'patrol' | 'pirate', crewShare?: number): Ship => {
  const cls = content.ships[classId]!;
  return {
    id: 'x',
    classId,
    x: 0,
    y: 0,
    headingDeg: 90,
    speed: 0,
    helm: 0,
    sails: 'full',
    blocked: false,
    cargo: {},
    crew: crewShare === undefined ? undefined : Math.round(cls.maxCrew * crewShare),
    ai: role ? { nation: 'pirate', role, name: 'Test', from: 'a', to: 'b', route: [], along: 0, offset: 0, tackSign: 1, news: [] } : undefined,
  };
};

/** One fight to the end: the player's brig sails under `autopilot` (by default a gunner keeping her range). */
function fight(enemy: Ship, seed: number, autopilot: 'runner' | 'cautious' | 'aggressive' = 'cautious') {
  const battle = createBattle(content, {
    map,
    wind: { fromDeg: 70, strength: 'fresh' },
    player: ship('ship.brig', undefined, 0.5),
    enemy,
    seed,
    bearingDeg: 45 + seed * 37,
  });
  let guard = 0;
  while (!battle.result() && guard++ < 30 * 60 * 10) battle.step(30, autopilot);
  return battle;
}

describe('sea battle', () => {
  it('always ends, and replays exactly from its seed', () => {
    const a = fight(ship('ship.sloop', 'pirate', 0.8), 4);
    expect(a.result()).toBeDefined();
    const b = fight(ship('ship.sloop', 'pirate', 0.8), 4);
    expect(b.result()).toEqual(a.result());
    expect(b.state.tick).toBe(a.state.tick);
  });

  it('plays matchups with the outcomes the design intends (headless runner)', () => {
    const tally = (enemy: () => Ship, n = 40) => {
      const outcomes: Record<string, number> = {};
      let seconds = 0;
      for (let seed = 1; seed <= n; seed++) {
        const b = fight(enemy(), seed);
        outcomes[b.result()!.outcome] = (outcomes[b.result()!.outcome] ?? 0) + 1;
        seconds += b.state.tick / 30;
      }
      return { outcomes, seconds: Math.round(seconds / n) };
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
