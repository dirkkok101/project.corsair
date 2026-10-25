import { describe, expect, it } from 'vitest';
import { createConsorts } from '../src/consorts';

/** A flagship sailing a way of points, one look a frame (dt), and the line as it stands after the last. */
const sail = (c: ReturnType<typeof createConsorts>, way: { x: number; y: number; headingDeg: number }[], count: number, spacing: number, water?: (x: number, y: number) => boolean) => {
  let out: ReturnType<typeof c.stations> = [];
  for (const at of way) out = c.stations('f', at, count, spacing, water, 1 / 30);
  return out;
};

describe('ships in company', () => {
  it('lie straight astern of a flagship that has only just sailed, each heading for the one ahead', () => {
    const c = createConsorts();
    // Heading east (90): astern is to the west.
    const [a, b] = c.stations('f', { x: 100, y: 100, headingDeg: 90 }, 2, 3);
    expect(a!.x).toBeCloseTo(97);
    expect(a!.y).toBeCloseTo(100);
    expect(b!.x).toBeCloseTo(94);
    expect(a!.headingDeg).toBeCloseTo(90);
  });

  it('swing round behind her when she turns hard, not left beside her on her old track', () => {
    const c = createConsorts();
    // North 10 tiles, then hard about: south 4 (a turn far tighter than their spacing).
    const way = [
      ...Array.from({ length: 100 }, (_, i) => ({ x: 100, y: 100 - i * 0.1, headingDeg: 0 })),
      ...Array.from({ length: 200 }, (_, i) => ({ x: 100.5, y: 90 + i * 0.02, headingDeg: 180 })),
    ];
    const [a, b] = sail(c, way, 2, 3);
    const flag = way.at(-1)!;
    // Astern of her now means north of her: both have come round, in line, and none lies alongside her.
    expect(a!.y).toBeLessThan(flag.y - 2);
    expect(b!.y).toBeLessThan(a!.y - 2);
    expect(Math.abs(a!.x - flag.x)).toBeLessThan(1);
    // Each heads for the ship ahead: south, as she does.
    expect(Math.abs(((a!.headingDeg - 180 + 540) % 360) - 180)).toBeLessThan(20);
  });

  it('come out of port one by one: none over the land astern, each as her station opens', () => {
    const c = createConsorts();
    // Land west of x = 99: she sails east out of a harbour on the coast.
    const water = (x: number) => x >= 99;
    expect(c.stations('f', { x: 100, y: 100, headingDeg: 90 }, 2, 3, water)).toHaveLength(0);
    let out = sail(c, Array.from({ length: 36 }, (_, i) => ({ x: 100 + i * 0.1, y: 100, headingDeg: 90 })), 2, 3, water);
    expect(out).toHaveLength(1);
    expect(out[0]!.x).toBeGreaterThanOrEqual(99);
    out = sail(c, Array.from({ length: 40 }, (_, i) => ({ x: 103.5 + i * 0.1, y: 100, headingDeg: 90 })), 2, 3, water);
    expect(out).toHaveLength(2);
    expect(out.every((s) => water(s.x))).toBe(true);
  });

  it('start afresh after a jump, rather than strung across the sea', () => {
    const c = createConsorts();
    sail(c, Array.from({ length: 50 }, (_, i) => ({ x: 100 + i * 0.2, y: 100, headingDeg: 90 })), 1, 3);
    const [a] = c.stations('f', { x: 500, y: 500, headingDeg: 180 }, 1, 3);
    // Heading south: astern is north.
    expect(a!.x).toBeCloseTo(500);
    expect(a!.y).toBeCloseTo(497);
  });

  it('a ship newly in company joins at the end of the line, astern of the last', () => {
    const c = createConsorts();
    const way = Array.from({ length: 100 }, (_, i) => ({ x: 100 + i * 0.1, y: 100, headingDeg: 90 }));
    sail(c, way, 1, 3);
    const [a, b] = c.stations('f', way.at(-1)!, 2, 3);
    expect(b!.x).toBeLessThan(a!.x - 2);
    expect(b!.y).toBeCloseTo(a!.y, 0);
  });
});
