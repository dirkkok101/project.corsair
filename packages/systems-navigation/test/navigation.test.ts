import { createSim, TICKS_PER_SECOND } from '@corsair/core';
import type { Command, WorldState } from '@corsair/core';
import { buildTileMap, isLand, loadContent, tileAt } from '@corsair/data';
import { describe, expect, it } from 'vitest';
import { angleOffWind, createNavigationSystem, createWorld, polarAt } from '../src';

const content = loadContent();
const map = buildTileMap(content.maps.placeholder);

function openSea(headingDeg: number, windFromDeg = 0): WorldState {
  const world = createWorld(content.maps.placeholder);
  // Open water far from the island, with room to sail 10 s at full speed in any direction.
  const ship = { ...world.ships.player!, x: 200, y: 200, headingDeg };
  return { ...world, wind: { fromDeg: windFromDeg, strength: 'fresh' }, ships: { player: ship } };
}

function speedAfter(state: WorldState, seconds: number): number {
  const sim = createSim(state, [createNavigationSystem(content, map)]);
  sim.step(seconds * TICKS_PER_SECOND);
  return sim.state.ships.player!.speed;
}

describe('angleOffWind', () => {
  it('measures the smaller angle either side of the wind', () => {
    expect(angleOffWind(0, 0)).toBe(0);
    expect(angleOffWind(180, 0)).toBe(180);
    expect(angleOffWind(350, 20)).toBe(30);
    expect(angleOffWind(20, 350)).toBe(30);
  });
});

describe('sailing model', () => {
  it('makes almost no way head to wind', () => {
    expect(speedAfter(openSea(0), 10)).toBeLessThan(0.01);
  });

  it('is fastest on a broad reach for a square rig', () => {
    const headings = Array.from({ length: 13 }, (_, i) => i * 15);
    const speeds = headings.map((h) => speedAfter(openSea(h), 10));
    const best = headings[speeds.indexOf(Math.max(...speeds))]!;
    expect(best).toBeGreaterThanOrEqual(105);
    expect(best).toBeLessThanOrEqual(135);
    expect(speeds[12]!).toBeLessThan(Math.max(...speeds));
  });

  it('scales speed by the sail setting and stops under bare poles', () => {
    const at = (sails: 'furled' | 'half' | 'full') => {
      const state = openSea(120);
      return speedAfter({ ...state, ships: { player: { ...state.ships.player!, sails } } }, 15);
    };
    const full = at('full');
    expect(at('half') / full).toBeCloseTo(content.navigation.sailSettings.half!, 2);
    expect(at('furled')).toBeLessThan(0.01);
  });

  it('applies a SetSails command and reports it', () => {
    const sim = createSim(openSea(120), [createNavigationSystem(content, map)]);
    sim.send({ type: 'SetSails', shipId: 'player', sails: 'half' });
    sim.step();
    expect(sim.state.ships.player!.sails).toBe('half');
    expect(sim.events().map((e) => e.type)).toContain('SailsSet');
  });

  it('turns to starboard on helm 1 and holds course on helm 0', () => {
    const sim = createSim(openSea(90), [createNavigationSystem(content, map)]);
    sim.send({ type: 'SetHelm', shipId: 'player', helm: 1 });
    sim.step(TICKS_PER_SECOND);
    const turned = sim.state.ships.player!.headingDeg;
    expect(turned).toBeGreaterThan(110);
    sim.send({ type: 'SetHelm', shipId: 'player', helm: 0 });
    sim.step(TICKS_PER_SECOND);
    expect(sim.state.ships.player!.headingDeg).toBeCloseTo(turned, 6);
  });

  it('stops at land, stays on water and reports the contact once', () => {
    const world = createWorld(content.maps.placeholder);
    // West of the island on its centre line, heading east into it, wind on the beam.
    const ship = { ...world.ships.player!, x: 30, y: 38.5, headingDeg: 90 };
    const sim = createSim({ ...world, wind: { fromDeg: 0, strength: 'fresh' }, ships: { player: ship } }, [
      createNavigationSystem(content, map),
    ]);
    sim.step(60 * TICKS_PER_SECOND);
    const end = sim.state.ships.player!;
    expect(isLand(tileAt(map, end.x, end.y))).toBe(false);
    expect(end.x).toBeGreaterThan(36);
    expect(sim.events().filter((e) => e.type === 'ShipBlocked')).toHaveLength(1);
  });

  it('slides along the coast instead of sticking when it meets land at an angle', () => {
    const world = createWorld(content.maps.placeholder);
    // Heading ENE onto the straight west face of the island (x = 42, rows 30 to 35).
    const ship = { ...world.ships.player!, x: 38, y: 34.5, headingDeg: 70 };
    const sim = createSim({ ...world, wind: { fromDeg: 180, strength: 'fresh' }, ships: { player: ship } }, [
      createNavigationSystem(content, map),
    ]);
    // Sail until it touches land, however fast the current wind tuning makes it.
    for (let t = 0; t < 30 * TICKS_PER_SECOND && !sim.state.ships.player!.blocked; t++) sim.step();
    expect(sim.state.ships.player!.blocked).toBe(true);
    const contactY = sim.state.ships.player!.y;
    sim.step(4 * TICKS_PER_SECOND);
    const end = sim.state.ships.player!;
    expect(isLand(tileAt(map, end.x, end.y))).toBe(false);
    expect(end.y).toBeLessThan(contactY - 2);
  });

  it('reports a fresh contact after sailing clear and coming back', () => {
    const world = createWorld(content.maps.placeholder);
    const start = { ...world.ships.player!, x: 38, y: 38.5, headingDeg: 90 };
    const sim = createSim({ ...world, wind: { fromDeg: 0, strength: 'fresh' }, ships: { player: start } }, [
      createNavigationSystem(content, map),
    ]);
    const blocked = () => sim.events().filter((e) => e.type === 'ShipBlocked').length;
    const ship = () => sim.state.ships.player!;
    const turn = (helm: 1 | 0) => sim.send({ type: 'SetHelm', shipId: 'player', helm });
    const steerTo = (headingDeg: number) => {
      turn(1);
      for (let t = 0; t < 30 * TICKS_PER_SECOND && Math.abs(angleOffWind(ship().headingDeg, headingDeg)) > 3; t++) sim.step();
      turn(0);
      sim.step();
    };
    const stepUntil = (done: () => boolean) => {
      for (let t = 0; t < 60 * TICKS_PER_SECOND && !done(); t++) sim.step();
    };

    stepUntil(() => ship().blocked);
    expect(blocked()).toBe(1);
    steerTo(270);
    sim.step(5 * TICKS_PER_SECOND);
    expect(ship().blocked).toBe(false);
    steerTo(90);
    stepUntil(() => ship().blocked);
    // Turning against a stepped tile coast makes and breaks contact a few times. A broken
    // once-per-contact rule would instead fire on most of the ~1,000 ticks this test runs.
    expect(blocked()).toBeGreaterThanOrEqual(2);
    expect(blocked()).toBeLessThan(12);
  });
});

describe('polarAt', () => {
  const square = content.polars['polar.square']!;
  it('hits the table at both ends and interpolates between points', () => {
    expect(polarAt(square, 0)).toBe(0);
    expect(polarAt(square, 180)).toBeCloseTo(0.7, 10);
    expect(polarAt(square, 54)).toBeCloseTo(0.2, 10);
  });
});

describe('determinism', () => {
  const script: Record<number, Command> = {
    10: { type: 'SetHelm', shipId: 'player', helm: 1 },
    95: { type: 'SetHelm', shipId: 'player', helm: 0 },
    150: { type: 'SetSails', shipId: 'player', sails: 'half' },
    200: { type: 'SetWind', fromDeg: 90, strength: 'strong' },
    260: { type: 'SetHelm', shipId: 'player', helm: -1 },
    400: { type: 'SetHelm', shipId: 'player', helm: 0 },
  };

  function run(): string[] {
    const sim = createSim(createWorld(content.maps.placeholder), [createNavigationSystem(content, map)]);
    const hashes: string[] = [];
    for (let t = 0; t < 600; t++) {
      const cmd = script[t];
      if (cmd) sim.send(cmd);
      sim.step();
      hashes.push(sim.hash());
    }
    return hashes;
  }

  it('gives the same state hash at every tick for the same commands', () => {
    const a = run();
    expect(run()).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(500);
  });

  it('replays a recorded input log to the same final state', () => {
    const live = createSim(createWorld(content.maps.placeholder), [createNavigationSystem(content, map)]);
    for (let t = 0; t < 600; t++) {
      const cmd = script[t];
      if (cmd) live.send(cmd);
      live.step();
    }
    const replay = createSim(createWorld(content.maps.placeholder), [createNavigationSystem(content, map)]);
    const inputs = [...live.inputs()];
    while (replay.state.tick < 600) {
      for (const r of inputs.filter((i) => i.tick === replay.state.tick + 1)) replay.send(r.command);
      replay.step();
    }
    expect(replay.hash()).toBe(live.hash());
  });
});
