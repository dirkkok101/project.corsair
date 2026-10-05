import { describe, expect, it } from 'vitest';
import { ambienceTargets } from '../src/mix';
import type { AudioInputs } from '../src/mix';

const calmSea: AudioInputs = { wind: 0.5, offWindDeg: 120, speed: 0.5, sailsSet: true, luffing: false, inStorm: false, coast: 0 };

describe('ambienceTargets', () => {
  it('swells the sea with the wind', () => {
    expect(ambienceTargets({ ...calmSea, wind: 1.1 }).waves).toBeGreaterThan(ambienceTargets({ ...calmSea, wind: 0.15 }).waves);
  });

  it('makes the rigging loudest and highest close-hauled, quiet running before the wind', () => {
    const close = ambienceTargets({ ...calmSea, offWindDeg: 50 });
    const running = ambienceTargets({ ...calmSea, offWindDeg: 175 });
    expect(close.wind).toBeGreaterThan(running.wind);
    expect(close.windPitch).toBeGreaterThan(running.windPitch);
  });

  it('rushes louder and brighter with speed, and is silent stopped', () => {
    expect(ambienceTargets({ ...calmSea, speed: 0 }).rush).toBe(0);
    const fast = ambienceTargets({ ...calmSea, speed: 1 });
    expect(fast.rush).toBeGreaterThan(ambienceTargets(calmSea).rush);
    expect(fast.rushTone).toBeGreaterThan(ambienceTargets(calmSea).rushTone);
  });

  it('flaps the sails only when they are set and luffing', () => {
    expect(ambienceTargets(calmSea).luff).toBe(0);
    expect(ambienceTargets({ ...calmSea, luffing: true }).luff).toBeGreaterThan(0);
    expect(ambienceTargets({ ...calmSea, luffing: true, sailsSet: false }).luff).toBe(0);
  });

  it('brings in surf near land and rain in a storm', () => {
    expect(ambienceTargets({ ...calmSea, coast: 1 }).surf).toBeGreaterThan(0);
    expect(ambienceTargets(calmSea).surf).toBe(0);
    expect(ambienceTargets({ ...calmSea, inStorm: true }).rain).toBeGreaterThan(0);
    expect(ambienceTargets(calmSea).rain).toBe(0);
  });
});
