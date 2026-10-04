import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim, rngStream, seedRng } from '@corsair/core';
import type { Storm, WorldState } from '@corsair/core';
import { decodeRasterMap, loadContent, tileOf } from '@corsair/data';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { describe, expect, it } from 'vitest';
import { createWeatherSystem, createWindField, seasonOf, stormWindAt, withWeather, zoneAt } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});
const day = content.calendar.ticksPerDay;

function newSim(seed: number, start: WorldState = createWorld(def)) {
  const windAt = createWindField(content, map);
  return createSim(withWeather(start, content, def, seed), [
    createWeatherSystem(content, def, map),
    createNavigationSystem(content, map, windAt),
  ]);
}

describe('rng', () => {
  it('repeats for the same seed and stream, and differs between streams', () => {
    const a = rngStream(seedRng(7, 'weather'));
    const b = rngStream(seedRng(7, 'weather'));
    const c = rngStream(seedRng(7, 'ai'));
    const draws = Array.from({ length: 5 }, () => a.float());
    expect(Array.from({ length: 5 }, () => b.float())).toEqual(draws);
    expect(c.float()).not.toBe(draws[0]);
    expect(draws.every((d) => d >= 0 && d < 1)).toBe(true);
  });
});

describe('storm wind', () => {
  const storm: Storm = { id: 's', x: 100, y: 100, radius: 40, headingDeg: 280, speed: 100, endDay: 10 };

  it('turns counter-clockwise: east of the eye it blows north, north of it blows west', () => {
    // Blowing toward the north means coming FROM the south (180).
    expect(stormWindAt(storm, 120, 100)!.fromDeg).toBeCloseTo(180, 6);
    // North of the eye (smaller y) it blows west, so it comes from the east (90).
    expect(stormWindAt(storm, 100, 80)!.fromDeg).toBeCloseTo(90, 6);
  });

  it('is a gale near the eye, strong at the edge, nothing outside', () => {
    expect(stormWindAt(storm, 110, 100)!.strength).toBe('gale');
    expect(stormWindAt(storm, 135, 100)!.strength).toBe('strong');
    expect(stormWindAt(storm, 150, 100)).toBeUndefined();
  });
});

describe('zones and seasons', () => {
  it('follows the PRD seasons', () => {
    expect([12, 1, 5].map(seasonOf)).toEqual(['dry', 'dry', 'dry']);
    expect([6, 9, 11].map(seasonOf)).toEqual(['wet', 'wet', 'wet']);
  });

  it('finds the right zone on the real map', () => {
    const at = (lon: number, lat: number) => {
      const { x, y } = tileOf(def, lon, lat);
      return zoneAt(content, map, x, y).id;
    };
    expect(at(-92, 25)).toMatch(/gulf/);
    expect(at(-75, 15)).toBe('zone.caribbean_sea');
    expect(at(-61, 14)).toBe('zone.lesser_antilles');
  });

  it('gives a ship the wind of its zone, and a storm overrides it', () => {
    const sim = newSim(3);
    const windAt = createWindField(content, map);
    const ship = sim.state.ships.player!;
    const zone = zoneAt(content, map, ship.x, ship.y).id;
    expect(windAt(sim.state, ship.x, ship.y)).toEqual({
      fromDeg: sim.state.weather!.zones[zone]!.fromDeg,
      strength: sim.state.weather!.zones[zone]!.strength,
    });
    sim.send({ type: 'SpawnStorm', x: ship.x + 5, y: ship.y });
    sim.step();
    expect(['gale', 'strong']).toContain(windAt(sim.state, ship.x, ship.y).strength);
  });
});

describe('weather over time', () => {
  it('drifts zone winds within their season', () => {
    const sim = newSim(11);
    const before = JSON.stringify(sim.state.weather!.zones);
    sim.step(3 * day);
    expect(JSON.stringify(sim.state.weather!.zones)).not.toBe(before);
    for (const zone of content.windZones.zones) {
      const w = sim.state.weather!.zones[zone.id]!;
      if (w.event) continue;
      const prevailing = zone.seasons.dry;
      const off = Math.abs((((w.fromDeg - prevailing.fromDeg) % 360) + 540) % 360 - 180);
      expect(off).toBeLessThanOrEqual(prevailing.spreadDeg + 1e-9);
    }
  });

  it('moves storms along their heading and drops them when they end', () => {
    const sim = newSim(5);
    const { x, y } = tileOf(def, -65, 15);
    sim.send({ type: 'SpawnStorm', x, y });
    sim.step();
    const storm = sim.state.weather!.storms[0]!;
    sim.step(day);
    const moved = sim.state.weather!.storms[0]!;
    // Heading is west-north-west, so a day later the storm is further west.
    expect(moved.x).toBeLessThan(storm.x);
    sim.step((storm.endDay + 1) * day);
    expect(sim.state.weather!.storms).toHaveLength(0);
    expect(sim.events().some((e) => e.type === 'StormDissipated')).toBe(true);
  });

  it('replays to identical state hashes for the same seed, over several days with a storm', () => {
    const run = (seed: number) => {
      const sim = newSim(seed);
      const hashes: string[] = [];
      sim.send({ type: 'SpawnStorm', x: 1200, y: 600 });
      for (let t = 0; t < 4 * day; t++) {
        if (t === 300) sim.send({ type: 'SetHelm', shipId: 'player', helm: 1 });
        if (t === 400) sim.send({ type: 'SetHelm', shipId: 'player', helm: 0 });
        sim.step();
        if (t % 60 === 0) hashes.push(sim.hash());
      }
      return hashes;
    };
    const a = run(42);
    expect(run(42)).toEqual(a);
    expect(run(43)).not.toEqual(a);
  });
});
