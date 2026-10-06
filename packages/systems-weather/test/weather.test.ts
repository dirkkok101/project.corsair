import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim, rngStream, seedRng } from '@corsair/core';
import type { Storm, WeatherSystem, WorldState } from '@corsair/core';
import { decodeRasterMap, loadContent, tileOf } from '@corsair/data';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { describe, expect, it } from 'vitest';
import {
  createBreezeField,
  createWeatherSystem,
  createWindField,
  seasonOf,
  stormWindAt,
  withWeather,
  zoneAt,
} from '../src';

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
  const windAt = createWindField(content, def, map);
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

  it('gives open water the wind of its zone, and a storm overrides it', () => {
    const sim = newSim(3);
    const windAt = createWindField(content, def, map);
    // Open Caribbean, far beyond any coastal breeze.
    const { x, y } = tileOf(def, -75, 15);
    const zone = zoneAt(content, map, x, y).id;
    // With no weather system overhead the zone's wind is the wind.
    const clear = { ...sim.state, weather: { ...sim.state.weather!, systems: [] } };
    expect(windAt(clear, x, y)).toEqual({
      fromDeg: sim.state.weather!.zones[zone]!.fromDeg,
      strength: sim.state.weather!.zones[zone]!.strength,
    });
    sim.send({ type: 'SpawnStorm', x: x + 5, y });
    sim.step();
    expect(['gale', 'strong']).toContain(windAt(sim.state, x, y).strength);
  });

  it('weather systems turn the wind around them, fade in and out, drift, and replay from the seed', () => {
    const windAt = createWindField(content, def, map);
    const sim = newSim(3);
    const { x, y } = tileOf(def, -75, 15);
    const zone = zoneAt(content, map, x, y).id;
    const trades = { fromDeg: 80, strength: 'fresh' as const };
    const low: WeatherSystem = { id: 'system.t', kind: 'low', x, y: y - 100, radius: 300, headingDeg: 90, speed: 50, strength: 'strong', startDay: -5, endDay: 50 };
    const sky = (systems: WeatherSystem[]) => ({ ...sim.state, weather: { ...sim.state.weather!, zones: { ...sim.state.weather!.zones, [zone]: trades }, systems } });
    // Due south of a low the wind turns westerly: the run east the trades deny.
    const under = windAt(sky([low]), x, y);
    expect(Math.abs(((under.fromDeg - 270 + 540) % 360) - 180)).toBeLessThan(45);
    // A high the other way round; past the edge, the trades.
    expect(Math.abs(((windAt(sky([{ ...low, kind: 'high' }]), x, y).fromDeg - 90 + 540) % 360) - 180)).toBeLessThan(45);
    expect(windAt(sky([{ ...low, y: y - 400 }]), x, y)).toEqual(trades);
    // Fading: a system just forming hardly moves the wind.
    const day = sim.state.tick / content.calendar.ticksPerDay;
    const forming = windAt(sky([{ ...low, startDay: day }]), x, y);
    expect(forming).toEqual(trades);
    // Systems drift and new ones form as old ones die; the same seed gives the same skies.
    const a = newSim(9);
    const b = newSim(9);
    a.step(content.calendar.ticksPerDay * 20);
    b.step(content.calendar.ticksPerDay * 20);
    expect(a.state.weather!.systems).toEqual(b.state.weather!.systems);
    expect(a.state.weather!.systems!.length).toBeGreaterThanOrEqual(content.weather.systems.count[0]);
    expect(a.events().some((e) => e.type === 'WeatherSystemFormed')).toBe(true);
  });

  describe('coastal breezes', () => {
    const breezes = createBreezeField(content, def, map);
    // Just off Jamaica's south coast, where land lies to the north.
    const off = tileOf(def, -77.0, 17.78);
    const at = (hour: number) => breezes.at(Math.round((hour / 24) * day), off.x, off.y);

    it('blows onshore in the afternoon and offshore before dawn', () => {
      const sea = at(15)!;
      const land = at(3)!;
      expect(sea.kind).toBe('sea');
      expect(sea.north).toBeGreaterThan(0); // toward the land to the north
      expect(land.kind).toBe('land');
      expect(land.north).toBeLessThan(0); // out to sea, southward
    });

    it('fades out at sea and dies away at the turn of the day', () => {
      const { x, y } = tileOf(def, -75, 15);
      expect(breezes.at(Math.round((15 / 24) * day), x, y)).toBeUndefined();
      expect(at(9)).toBeUndefined();
    });

    it('bends the zone wind near the coast', () => {
      const sim = newSim(3);
      const windAt = createWindField(content, def, map);
      const zone = sim.state.weather!.zones[zoneAt(content, map, off.x, off.y).id]!;
      const night = { ...sim.state, tick: Math.round((3 / 24) * day) };
      expect(windAt(night, off.x, off.y).fromDeg).not.toBeCloseTo(zone.fromDeg, 0);
    });
  });
});

describe('weather over time', () => {
  it('starts events within their spread, and variable spells keep changing direction', () => {
    const start = newSim(13).state;
    const zone = content.windZones.zones.find((z) => z.id === 'zone.caribbean_sea')!;
    // Every zone in a variable spell for the next ten days.
    const zones = Object.fromEntries(
      Object.entries(start.weather!.zones).map(([id, w]) => [id, { ...w, event: { id: 'variable', endDay: 10, variable: true } }]),
    );
    const sim = createSim({ ...start, weather: { ...start.weather!, zones } }, [createWeatherSystem(content, def, map)]);
    const seen = new Set<number>();
    for (let i = 0; i < 8; i++) {
      sim.step(Math.round((day * content.weather.checkEveryHours) / 24));
      seen.add(Math.round(sim.state.weather!.zones[zone.id]!.fromDeg));
    }
    expect(seen.size).toBeGreaterThan(4);
  });

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

  it('drops a storm on its end day even while it is still on the map', () => {
    const start = newSim(9).state;
    const storm: Storm = { id: 'storm.test', x: 800, y: 550, radius: 30, headingDeg: 270, speed: 1, endDay: 2 };
    const sim = createSim({ ...start, weather: { ...start.weather!, storms: [storm] } }, [
      createWeatherSystem(content, def, map),
    ]);
    sim.step(2 * day - 1);
    expect(sim.state.weather!.storms).toHaveLength(1);
    sim.step(1);
    expect(sim.state.weather!.storms).toHaveLength(0);
    const ended = sim.events().find((e) => e.type === 'StormDissipated')!;
    expect(ended.tick).toBe(2 * day);
    expect(ended.payload.x).toBeGreaterThan(700);
  });

  it('moves winds into the new season range when the season turns', () => {
    // 31 May into 1 June: every zone must sit inside its wet-season spread within a day.
    const may31 = { ...def, startDate: '1660-05-31' };
    const sim = createSim(withWeather(createWorld(may31), content, may31, 21), [
      createWeatherSystem(content, may31, map),
    ]);
    sim.step(2 * day);
    for (const zone of content.windZones.zones) {
      const w = sim.state.weather!.zones[zone.id]!;
      if (w.event) continue;
      const wet = zone.seasons.wet;
      const off = Math.abs(((((w.fromDeg - wet.fromDeg) % 360) + 540) % 360) - 180);
      expect(off).toBeLessThanOrEqual(wet.spreadDeg + 1e-9);
    }
  });

  it('replays hurricane season identically, storms and all', () => {
    // September with a certain daily spawn, so natural storms form during the run.
    const sept = { ...def, startDate: '1660-09-01' };
    const stormy = {
      ...content,
      weather: { ...content.weather, storms: { ...content.weather.storms, spawnChancePerDay: { '9': 1 } } },
    };
    const run = () => {
      const sim = createSim(withWeather(createWorld(sept), stormy, sept, 77), [
        createWeatherSystem(stormy, sept, map),
        createNavigationSystem(stormy, map, createWindField(stormy, def, map)),
      ]);
      const hashes: string[] = [];
      for (let t = 0; t < 3 * day + 5; t++) {
        sim.step();
        if (t % 90 === 0) hashes.push(sim.hash());
      }
      return { hashes, formed: sim.events().filter((e) => e.type === 'StormFormed').length };
    };
    const a = run();
    expect(a.formed).toBeGreaterThanOrEqual(2);
    expect(run()).toEqual(a);
  });

  it('moves storms along their heading and drops them once they end or leave the map', () => {
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
