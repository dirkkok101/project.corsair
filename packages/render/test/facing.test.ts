import { describe, expect, it } from 'vitest';
import { facingIndex } from '../src/facing';

describe('facingIndex', () => {
  it.each([
    [0, 0],
    [11.24, 0],
    [11.25, 1],
    [90, 4],
    [180, 8],
    [270, 12],
    [348.74, 15],
    [350, 0],
    [359.9, 0],
  ])('heading %s maps to f%s', (heading, facing) => {
    expect(facingIndex(heading)).toBe(facing);
  });

  it.each([
    [0, 0],
    [5.6, 0],
    [5.625, 1],
    [90, 8],
    [354.3, 31],
    [354.4, 0],
  ])('heading %s maps to f%s of 32', (heading, facing) => {
    expect(facingIndex(heading, 32)).toBe(facing);
  });
});
