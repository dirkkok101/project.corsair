import { describe, expect, it } from 'vitest';
import { createConsorts } from '../src/consorts';

describe('ships in company', () => {
  it('lie straight astern of a flagship that has only just sailed', () => {
    const c = createConsorts();
    // Heading east (90): astern is to the west.
    const [a, b] = c.stations('f', { x: 100, y: 100, headingDeg: 90 }, 2, 3);
    expect(a!.x).toBeCloseTo(97);
    expect(a!.y).toBeCloseTo(100);
    expect(b!.x).toBeCloseTo(94);
    expect(a!.headingDeg).toBeCloseTo(90);
  });

  it('follow her track round a turn, spacing apart along it, each heading the way it runs', () => {
    const c = createConsorts();
    // North 10 tiles, then east 10.
    for (let y = 100; y >= 90; y -= 0.1) c.stations('f', { x: 100, y, headingDeg: 0 }, 2, 3);
    let last: ReturnType<typeof c.stations> = [];
    for (let x = 100; x <= 102.01; x += 0.1) last = c.stations('f', { x, y: 90, headingDeg: 90 }, 2, 3);
    const [a, b] = last;
    // Two tiles east of the corner: the first a tile back up the northward leg, the second four.
    expect(a!.x).toBeCloseTo(100, 1);
    expect(a!.y).toBeCloseTo(91, 0);
    expect(a!.headingDeg).toBeCloseTo(0, 0);
    expect(b!.y).toBeCloseTo(94, 0);
  });

  it('come out of port one by one: none over the land astern, each as her track makes room for her', () => {
    const c = createConsorts();
    // Land west of x = 99: she sails east out of a harbour on the coast.
    const water = (x: number) => x >= 99;
    expect(c.stations('f', { x: 100, y: 100, headingDeg: 90 }, 2, 3, water)).toHaveLength(0);
    let out = c.stations('f', { x: 100, y: 100, headingDeg: 90 }, 2, 3, water);
    for (let x = 100; x <= 103.5; x += 0.1) out = c.stations('f', { x, y: 100, headingDeg: 90 }, 2, 3, water);
    expect(out).toHaveLength(1);
    expect(out[0]!.x).toBeGreaterThanOrEqual(99);
    for (let x = 103.5; x <= 107; x += 0.1) out = c.stations('f', { x, y: 100, headingDeg: 90 }, 2, 3, water);
    expect(out).toHaveLength(2);
    expect(out.every((s) => water(s.x))).toBe(true);
  });

  it('start afresh after a jump, rather than strung across the sea', () => {
    const c = createConsorts();
    for (let x = 100; x <= 110; x += 0.2) c.stations('f', { x, y: 100, headingDeg: 90 }, 1, 3);
    const [a] = c.stations('f', { x: 500, y: 500, headingDeg: 180 }, 1, 3);
    // Heading south: astern is north.
    expect(a!.x).toBeCloseTo(500);
    expect(a!.y).toBeCloseTo(497);
  });
});
