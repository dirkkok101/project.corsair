import { describe, expect, it } from 'vitest';
import { isLand, tileAt } from '@corsair/data';
import { bearingWord, withVoyage } from '../src';
import { content, settlements, lanes, map, world } from './fixtures';

const capitals = (['england', 'spain', 'france', 'netherlands'] as const).map((n) => ({ nation: n, home: settlements.find((s) => s.nation === n && s.type === 'capital')! }));

describe('the First Voyage', () => {
  it('reads a bearing as a compass point, north up', () => {
    expect(bearingWord(0, -1)).toBe('north');
    expect(bearingWord(1, 0)).toBe('east');
    expect(bearingWord(1, 1)).toBe('south-east');
    expect(bearingWord(-1, 0)).toBe('west');
  });

  it.each(capitals)("lays a cay off $nation's capital: water by a shore, in range by sea, clear of every port", ({ nation, home }) => {
    for (const seed of [1, 2, 3]) {
      const w = withVoyage(world(seed).state, content, map, settlements, lanes, home.id, nation, seed);
      const v = w.captain!.voyage!;
      expect(v).toMatchObject({ step: 'harbour', home: home.id, cay: { name: content.voyage.cays[nation] } });
      const { x, y, tiles, bearing } = v.cay;
      expect(isLand(tileAt(map, x, y))).toBe(false);
      const berth = lanes.berth(home.id)!;
      expect(Math.hypot(x - berth[0], y - berth[1])).toBeGreaterThanOrEqual(content.voyage.cayTiles[0]);
      expect(tiles).toBeLessThanOrEqual(content.voyage.cayTiles[1]);
      expect(bearing).toBe(bearingWord(x - berth[0], y - berth[1]));
      for (const s of settlements) expect(Math.hypot(s.x - x, s.y - y)).toBeGreaterThanOrEqual(content.voyage.clearOfPortsTiles);
      // A sea path from home to it.
      expect(lanes.path(berth, [x, y])).toBeDefined();
    }
  });

  it('is the same cay for the same seed, and leaves the rest of the world as it was', () => {
    const { nation, home } = capitals[0]!;
    const a = withVoyage(world(5).state, content, map, settlements, lanes, home.id, nation, 5);
    const b = withVoyage(world(5).state, content, map, settlements, lanes, home.id, nation, 5);
    expect(a.captain!.voyage).toEqual(b.captain!.voyage);
    const { voyage: _v, ...rest } = a.captain!;
    expect(rest).toEqual(world(5).state.captain);
  });
});
