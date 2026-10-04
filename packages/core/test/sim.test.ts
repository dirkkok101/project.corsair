import { describe, expect, it } from 'vitest';
import { createSim, hashState } from '../src';
import type { System, WorldState } from '../src';

const world: WorldState = { tick: 0, wind: { fromDeg: 0, strength: 'fresh' }, ships: {} };
const idle: System = { name: 'idle', tick: (state) => ({ state, events: [] }) };

describe('createSim', () => {
  it('advances the tick counter', () => {
    const sim = createSim(world, [idle]);
    sim.step(5);
    expect(sim.state.tick).toBe(5);
  });

  it('rejects a command no system owns, and still records it as input', () => {
    const sim = createSim(world, [idle]);
    sim.send({ type: 'SetHelm', shipId: 'nobody', helm: 1 });
    sim.step();
    expect(sim.events().map((e) => e.type)).toEqual(['CommandRejected']);
    expect(sim.inputs()).toEqual([{ tick: 1, command: { type: 'SetHelm', shipId: 'nobody', helm: 1 } }]);
  });
});

describe('hashState', () => {
  it('ignores key order and sub-micro float noise', () => {
    expect(hashState({ a: 1, b: 0.1 + 0.2 })).toBe(hashState({ b: 0.3, a: 1 }));
    expect(hashState({ a: 1 })).not.toBe(hashState({ a: 1.001 }));
  });
});
