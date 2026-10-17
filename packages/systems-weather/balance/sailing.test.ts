import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim, rngStream, seedRng } from '@corsair/core';
import type { Wind } from '@corsair/core';
import { decodeRasterMap, isLand, loadContent, tileAt } from '@corsair/data';
import { createWorld, polarAt } from '@corsair/systems-navigation';
import { describe, expect, it } from 'vitest';
import { createWeatherSystem, createWindField, withWeather } from '../src';

// The sailing measures (PRD section 4, fun over realism): over a year of weather across the open sea,
// how often the wind blows from the east, and how much longer a brig takes to make ground east than
// west. The trades are flavour, not a wall: a run east has to be a real option most weeks.

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});

/** Best speed made good toward a compass bearing, as a share of the brig's top speed in a fresh wind. */
function madeGood(wind: Wind, bearing: number) {
  const polar = content.polars[content.ships['ship.brig']!.polar]!;
  const strength = content.navigation.windStrength[wind.strength]!;
  let best = 0;
  for (let h = 0; h < 360; h += 2) {
    const off = Math.abs(((h - wind.fromDeg + 540) % 360) - 180);
    best = Math.max(best, polarAt(polar, off) * strength * Math.cos(((h - bearing) * Math.PI) / 180));
  }
  return best;
}

export function sailingMeasures(seed: number, days = 365, pack = content) {
  const windAt = createWindField(pack, def, map);
  const sim = createSim(withWeather(createWorld(def), pack, def, seed), [createWeatherSystem(pack, def, map)]);
  // Sample points: open sea tiles spread over the map, the same every run.
  const rng = rngStream(seedRng(seed, 'sailing-probe'));
  const points: [number, number][] = [];
  while (points.length < 150) {
    const x = rng.range(0, map.width);
    const y = rng.range(0, map.height);
    if (!isLand(tileAt(map, x, y))) points.push([x, y]);
  }
  let easterly = 0;
  let samples = 0;
  let east = 0;
  let west = 0;
  let strength = 0;
  const tpd = content.calendar.ticksPerDay;
  for (let d = 0; d < days; d++) {
    sim.step(tpd);
    for (const [x, y] of points) {
      const wind = windAt(sim.state, x, y);
      if (Math.abs(((wind.fromDeg - 90 + 540) % 360) - 180) <= 60) easterly++;
      samples++;
      strength += pack.navigation.windStrength[wind.strength]!;
      east += madeGood(wind, 90);
      west += madeGood(wind, 270);
    }
  }
  // Time to make a fixed distance goes as 1 / mean speed made good.
  return { easterlyShare: easterly / samples, eastOverWest: west / east, meanStrength: strength / samples };
}

describe('sailing measures', () => {
  it('the trades are flavour, not a wall: ground east is a real option', () => {
    const m = sailingMeasures(7);
    console.log('SAILING easterly share', m.easterlyShare.toFixed(2), 'east/west passage time', m.eastOverWest.toFixed(2), 'mean strength', m.meanStrength.toFixed(2));
    // Easterly about half the time (the trades still lead), and making ground east costs little more than west.
    expect(m.easterlyShare).toBeGreaterThan(0.45);
    expect(m.easterlyShare).toBeLessThan(0.65);
    expect(m.eastOverWest).toBeLessThan(1.25);
    // Systems turn the wind rather than kill it: as strong on average as the trades alone (0.79).
    expect(m.meanStrength).toBeGreaterThan(0.76);
  }, 300_000);
});
