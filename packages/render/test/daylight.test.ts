import { describe, expect, it } from 'vitest';
import { parseGpl, Row, rowsAt } from '../src/daylight';

describe('rowsAt', () => {
  it('is full day at noon and full night at midnight', () => {
    expect(rowsAt(12)).toEqual({ from: Row.Day, to: Row.Day, t: 0 });
    expect(rowsAt(0)).toEqual({ from: Row.Night, to: Row.Night, t: 0 });
    expect(rowsAt(23.5)).toEqual({ from: Row.Night, to: Row.Night, t: 0 });
  });

  it('passes through dusk at dawn and sunset', () => {
    expect(rowsAt(5.5)).toEqual({ from: Row.Night, to: Row.Dusk, t: 0.5 });
    expect(rowsAt(6.25)).toEqual({ from: Row.Dusk, to: Row.Day, t: 0.25 });
    expect(rowsAt(17.5)).toEqual({ from: Row.Day, to: Row.Dusk, t: 0.5 });
    expect(rowsAt(18.75)).toEqual({ from: Row.Dusk, to: Row.Night, t: 0.75 });
  });
});

describe('parseGpl', () => {
  it('reads colour rows and skips headers', () => {
    const text = 'GIMP Palette\n#Palette Name: x\n#Colors: 2\nColumns: 16\n23\t32\t56\t172038\n37 58 94 253a5e\n';
    expect(parseGpl(text)).toEqual([
      [23, 32, 56],
      [37, 58, 94],
    ]);
  });
});
