import { describe, expect, it } from 'vitest';
import { loadContent, sightTiles, tickAtHour } from '../src';

const content = loadContent();
const noon = tickAtHour(content.calendar, 12, 0);
const at = { x: 100, y: 100 };

describe('sight', () => {
  it('reaches furthest in light airs and closes in as the wind rises', () => {
    const by = (strength: string) => sightTiles(content, noon, { strength }, at);
    expect(by('light')).toBeGreaterThan(by('fresh'));
    expect(by('fresh')).toBeGreaterThan(by('strong'));
    expect(by('strong')).toBeGreaterThan(by('gale'));
    expect(by('fresh')).toBeCloseTo(content.traffic.sightTiles * content.traffic.sightByWind.fresh!);
  });

  it('closes to stormSight deep in a storm, and is clear of it well outside', () => {
    const storm = { x: at.x, y: at.y, radius: 40 };
    const clear = sightTiles(content, noon, { strength: 'fresh' }, at);
    expect(sightTiles(content, noon, { strength: 'fresh' }, at, [storm])).toBeCloseTo(clear * content.traffic.stormSight);
    expect(sightTiles(content, noon, { strength: 'fresh' }, at, [{ ...storm, x: at.x + 80 }])).toBeCloseTo(clear);
  });
});
