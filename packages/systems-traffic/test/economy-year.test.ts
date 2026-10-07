import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim } from '@corsair/core';
import { decodeRasterMap, loadContent, placeSettlements } from '@corsair/data';
import { createEconomySystem, quote, usualStock, withEconomy } from '@corsair/systems-economy';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { createPoliticsSystem } from '@corsair/systems-politics';
import { createWeatherSystem, createWindField, withWeather } from '@corsair/systems-weather';
import { describe, expect, it } from 'vitest';
import { createSeaLanes, createTrafficSystem, withTraffic } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, { terrain: readFileSync(dir + def.layers.terrain), elevation: readFileSync(dir + def.layers.elevation), zones: readFileSync(dir + def.layers.zones) });
const settlements = placeSettlements(def, map, content.settlements);
const lanes = createSeaLanes(map, settlements, content.traffic.laneCell);

// The economy probe (PRD section 6): a year of the whole world (weather, politics, traffic, the ports
// living day by day) holds together. No good runs to nothing or to the ceiling across the map, people grow a
// little where they are supplied, the St Kitts loophole stays shut, and the routes a player sails still pay.
describe('a year of the economy', () => {
  it('holds together, keeps trade paying, and keeps St Kitts one market', () => {
    const windAt = createWindField(content, def, map);
    const w = withTraffic(withEconomy(withWeather(createWorld(def), content, def, 1), content, settlements, 1), content, settlements, lanes, 1);
    const sim = createSim(w, [
      createWeatherSystem(content, def, map),
      createEconomySystem(content, settlements, map),
      createPoliticsSystem(content, def.startDate, settlements),
      createTrafficSystem(content, settlements, lanes, map, windAt),
      createNavigationSystem(content, map, windAt),
    ]);
    const by = (id: string) => settlements.find((s) => s.id === id)!;
    const margin = (a: string, b: string, g: string) =>
      quote(content, by(b), g, sim.state.markets![b]![g]!).sell - quote(content, by(a), g, sim.state.markets![a]![g]!).buy;
    const people = () => Object.values(sim.state.towns!).reduce((n, t) => n + t.people, 0);
    const start = people();
    // A route's margin moves with the world, so it is judged month by month across the year.
    const routes: [string, string, string][] = [
      ['town.port_royal', 'town.santiago_de_cuba', 'luxuries'],
      ['town.bridgetown', 'town.port_royal', 'sugar'],
      ['town.basse_terre_st_kitts', 'town.old_road', 'luxuries'],
    ];
    const sums = routes.map(() => 0);
    for (let month = 0; month < 12; month++) {
      sim.step(30 * content.calendar.ticksPerDay);
      routes.forEach(([a, b, g], i) => (sums[i]! += margin(a, b, g) / 12));
    }
    if (process.env.ECONOMY_LOG) appendFileSync(process.env.ECONOMY_LOG, `average margins ${sums.map((x) => x.toFixed(0)).join(', ')} people ${start} -> ${people()}\n`);
    for (const g of content.goods) {
      const ratios = settlements.map((s) => sim.state.markets![s.id]![g.id]! / Math.max(1, usualStock(content, sim.state, s, g.id)));
      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      expect(mean, g.id).toBeGreaterThan(0.6);
      expect(mean, g.id).toBeLessThan(1.6);
      expect(ratios.filter((r) => r < 0.05).length, `${g.id} ports run dry`).toBeLessThanOrEqual(3);
    }
    // A few ports grow, none runs away.
    expect(people()).toBeGreaterThan(start);
    expect(people()).toBeLessThan(start * 1.2);
    // The trades a player sails still pay, on average across the year.
    expect(sums[0]).toBeGreaterThan(10);
    expect(sums[1]).toBeGreaterThan(5);
    // Two towns on one island trade as one market: buying at one and selling at the other doesn't pay.
    expect(sums[2]).toBeLessThan(10);
  }, 600_000);
});
