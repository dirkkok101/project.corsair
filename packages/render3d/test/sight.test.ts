import { loadContent, tickAtHour } from '@corsair/data';
import { describe, expect, it } from 'vitest';
import { hullDown, sightTiles } from '../src/index';

const content = loadContent();

describe('fog of war', () => {
  it('a ship shows whole within sight, comes up over the horizon at its edge, and is gone beyond it', () => {
    const sight = content.traffic.sightTiles;
    expect(hullDown(10, sight)).toBe(1);
    expect(hullDown(sight - 6, sight)).toBe(1);
    const edge = hullDown(sight - 2.5, sight);
    expect(edge).toBeGreaterThan(0.2);
    expect(edge).toBeLessThan(0.8);
    expect(hullDown(sight, sight)).toBe(0);
    expect(hullDown(sight + 10, sight)).toBe(0);
  });

  it("by day her lookouts see the traffic's full sight", () => {
    const noon = tickAtHour(content.calendar, 12, 0);
    expect(sightTiles(content, noon)).toBe(content.traffic.sightTiles);
  });
});
