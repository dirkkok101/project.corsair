import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim } from '@corsair/core';
import type { WorldState } from '@corsair/core';
import { decodeRasterMap, isLand, loadContent, placeSettlements, tileAt } from '@corsair/data';
import { createEconomySystem, normalStock, withEconomy } from '@corsair/systems-economy';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { createWeatherSystem, createWindField, withWeather } from '@corsair/systems-weather';
import { describe, expect, it } from 'vitest';
import { createSeaLanes, createTrafficSystem, withTraffic } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});
const settlements = placeSettlements(def, map, content.settlements);
const lanes = createSeaLanes(map, settlements, content.traffic.laneCell);
const windAt = createWindField(content, def, map);
const day = content.calendar.ticksPerDay;

function world(seed: number, start: WorldState = createWorld(def)) {
  const w = withTraffic(withEconomy(withWeather(start, content, def, seed), content, settlements, seed), content, settlements, lanes, seed);
  return createSim(w, [
    createWeatherSystem(content, def, map),
    createEconomySystem(content, settlements, map),
    createTrafficSystem(content, settlements, lanes, map, windAt),
    createNavigationSystem(content, map, windAt),
  ]);
}
const ai = (state: WorldState) => Object.values(state.ships).filter((s) => s.ai);

describe('ships at sea', () => {
  it('start with the full population moored at home ports, by role', () => {
    const sim = world(1);
    const ships = ai(sim.state);
    expect(ships).toHaveLength(content.traffic.population);
    const roles = (r: string) => ships.filter((s) => s.ai!.role === r).length;
    expect(roles('merchant')).toBe(18);
    expect(roles('patrol')).toBe(6);
    expect(roles('pirate')).toBe(6);
    for (const s of ships) expect(isLand(tileAt(map, s.x, s.y))).toBe(false);
    // Pirates sail from havens under their own flag; the rest under their port's.
    for (const s of ships.filter((x) => x.ai!.role === 'pirate')) expect(s.ai!.nation).toBe('pirate');
  });

  it('sail a season on water, making voyages, with markets in bounds, and replay exactly', () => {
    const run = () => {
      const sim = world(7);
      for (let d = 0; d < 90; d++) {
        sim.step(day);
        for (const s of ai(sim.state)) expect(isLand(tileAt(map, s.x, s.y)), `${s.id} ${s.ai!.role} on land at day ${d}`).toBe(false);
      }
      return sim;
    };
    const a = run();
    const departed = a.events().filter((e) => e.type === 'ShipDeparted');
    const arrived = a.events().filter((e) => e.type === 'ShipArrived');
    console.log('TRAFFIC voyages', departed.length, 'arrivals', arrived.length);
    expect(departed.length).toBeGreaterThan(60);
    expect(arrived.length).toBeGreaterThan(40);
    // Merchants really carried goods.
    expect(arrived.some((e) => Object.keys(e.payload.cargo as object).length > 0)).toBe(true);
    for (const s of settlements) {
      for (const g of content.goods) {
        expect(a.state.markets![s.id]![g.id]!).toBeLessThanOrEqual(Math.round(normalStock(content, s, g.id) * content.economy.maxStock));
        expect(a.state.markets![s.id]![g.id]!).toBeGreaterThanOrEqual(0);
      }
    }
    expect(ai(a.state).length).toBe(content.traffic.population);
    expect(run().hash()).toBe(a.hash());
  }, 60_000);

  it('the player sees ships within sight, remembers where, and can hail one alongside', () => {
    const sim = world(3);
    const pr = settlements.find((s) => s.id === 'town.port_royal')!;
    const to = settlements.find((s) => s.id === 'town.cartagena')!;
    sim.send({ type: 'SpawnShip', role: 'merchant', from: pr.id, to: to.id });
    sim.applyCommands();
    const id = Object.keys(sim.state.ships).at(-1)!;
    sim.step(1);
    const player = sim.state.ships.player!;
    const other = sim.state.ships[id]!;
    expect(sim.state.captain!.sightings![id]).toMatchObject({ classId: other.classId, nation: 'england' });

    // Bring the player alongside and hail.
    const alongside = { ...sim.state, ships: { ...sim.state.ships, player: { ...player, x: other.x + 1, y: other.y } } };
    const hailer = createSim(alongside, [createTrafficSystem(content, settlements, lanes, map, windAt)]);
    hailer.send({ type: 'Hail', shipId: 'player', targetId: id });
    hailer.applyCommands();
    expect(hailer.events().at(-1)!.type).toBe('Hailed');

    const far = { ...sim.state, ships: { ...sim.state.ships, player: { ...player, x: other.x + 20, y: other.y } } };
    const tooFar = createSim(far, [createTrafficSystem(content, settlements, lanes, map, windAt)]);
    tooFar.send({ type: 'Hail', shipId: 'player', targetId: id });
    tooFar.applyCommands();
    expect(tooFar.events().at(-1)!.payload.reason).toBe('too-far');
  });
});
