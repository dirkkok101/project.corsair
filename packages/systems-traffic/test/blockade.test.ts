import { createSim } from '@corsair/core';
import type { BattleResult, Ship, WorldState } from '@corsair/core';
import { describe, expect, it } from 'vitest';
import { initialPolitics } from '@corsair/systems-politics';
import { createTrafficSystem } from '../src';
import { content, settlements, lanes, map, windAt, day, world, ai } from './fixtures';

const royal = settlements.find((s) => s.id === 'town.port_royal')!;
const t = content.traffic.blockade;
/** England and Spain at war, set in the state (these worlds have no politics system to carry out a SetRelation). */
const atWar = (state: WorldState): WorldState => {
  const p = initialPolitics(content);
  return { ...state, politics: { ...p, relations: { ...p.relations, 'england:spain': { ...p.relations['england:spain']!, war: true } } } };
};
/** How many blockaders a port has, under way to it or lying off it. */
const held = (state: WorldState, id: string) =>
  ai(state).filter((s) => s.ai!.blockading === id || (s.ai!.blockadeOf === id && (s.ai!.waitUntil ?? 0) > state.tick)).length;
/** A new ship of a role, sailing from one port to another: her id and the world with her. */
const spawn = (state: WorldState, role: 'merchant' | 'patrol', from: string, to: string) => {
  const sim = createSim(state, [createTrafficSystem(content, settlements, lanes, map, windAt)]);
  sim.send({ type: 'SpawnShip', role, from, to });
  sim.applyCommands();
  const id = Object.keys(sim.state.ships).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
  return { id, state: sim.state };
};
/** A Spanish warship lying off Port Royal, on the water by its mooring, for `days` more. */
const blockader = (state: WorldState, id: string, days = 5): Ship => {
  const [x, y] = lanes.mooring(royal.id)!;
  const s = state.ships[id]!;
  return { ...s, x, y, speed: 0, ai: { ...s.ai!, nation: 'spain', route: [[x, y], [x, y]], along: 0, offset: 0, waitUntil: state.tick + days * day, blockading: undefined, blockadeOf: royal.id, beat: undefined, calmUntil: undefined } };
};

describe('blockades', () => {
  it('spread over the enemy ports in reach: none ringed by more than its fill', () => {
    // Every patrol at war that sets out goes to blockade, so the cap is all that holds them off one port.
    const sure = { ...content, traffic: { ...content.traffic, blockade: { ...t, chance: 1 } } };
    const sim = world(7, undefined, sure);
    const ports = new Set<string>();
    for (let d = 0; d < 24; d++) {
      sim.step(day);
      for (const s of settlements) {
        expect(held(sim.state, s.id), s.id).toBeLessThanOrEqual(t.maxPerPort);
        if (held(sim.state, s.id)) ports.add(s.id);
      }
    }
    expect(ports.size).toBeGreaterThan(2);
  }, 120_000);

  it('a blockader beats to and fro across the approach, stays off the port, and sails home after', () => {
    const sim = world(2);
    const { id, state } = spawn(atWar(sim.state), 'patrol', 'town.cartagena', 'town.santo_domingo');
    // She has just made her station: arriving there lays out her beat.
    const s = state.ships[id]!;
    // Down the lane from a Spanish port with one to Port Royal, a few legs short of it.
    const route = settlements.filter((p) => p.nation === 'spain').map((p) => lanes.route(p.id, royal.id)).find((r) => r && r.length > 4)!;
    const station = route.at(-4)!;
    const coming = { ...s, x: station[0], y: station[1], ai: { ...s.ai!, nation: 'spain' as const, to: royal.id, route: [station, station], along: 0, blockading: royal.id } };
    const lie = createSim({ ...state, ships: { ...state.ships, [id]: coming } }, [createTrafficSystem(content, settlements, lanes, map, windAt)]);
    lie.step(1);
    const on = lie.state.ships[id]!;
    expect(on.ai!.blockadeOf).toBe(royal.id);
    expect(on.ai!.beat).toBeDefined();
    const seen: [number, number][] = [];
    for (let k = 0; k < 20; k++) {
      lie.step(Math.round(day / 10));
      const now = lie.state.ships[id];
      if (!now?.ai?.blockadeOf) break;
      seen.push([now.x, now.y]);
      expect(Math.hypot(now.x - royal.x, now.y - royal.y)).toBeLessThanOrEqual(Math.hypot(station[0] - royal.x, station[1] - royal.y) + t.beatTiles + 1);
    }
    // Under way along her beat, not lying dead in the water.
    const moved = Math.max(...seen.map(([a, b]) => Math.hypot(a - seen[0]![0], b - seen[0]![1])));
    expect(moved).toBeGreaterThan(1);
    // Her time up, she makes for home and lets the port be.
    const end = lie.state.ships[id]!.ai!.waitUntil! - lie.state.tick;
    lie.step(end + 2);
    const home = lie.state.ships[id];
    if (home) {
      expect(home.ai!.blockadeOf).toBeUndefined();
      expect(home.ai!.beat).toBeUndefined();
    }
  }, 60_000);

  it('she dares the port guns to take an enemy merchant coming out; a patrol not blockading it lets her be', () => {
    const sim = world(3);
    let w = atWar(sim.state);
    const merchant = spawn(w, 'merchant', royal.id, 'town.bridgetown');
    w = merchant.state;
    const patrol = spawn(w, 'patrol', 'town.cartagena', 'town.santo_domingo');
    w = patrol.state;
    // The English merchant just out of Port Royal, under its guns; the Spanish warship beside her.
    const [x, y] = lanes.mooring(royal.id)!;
    expect(Math.hypot(x - royal.x, y - royal.y)).toBeLessThanOrEqual(content.combat.chase.harbourTiles[royal.size]!);
    const m = w.ships[merchant.id]!;
    const out = { ...m, x, y, ai: { ...m.ai!, nation: 'england' as const, waitUntil: undefined, along: 0, offset: 0, calmUntil: undefined } };
    const fought = (warship: Ship) => {
      const sea = createSim({ ...w, ships: { ...w.ships, [merchant.id]: out, [patrol.id]: warship } }, [createTrafficSystem(content, settlements, lanes, map, windAt)]);
      sea.step(Math.round(day / 4));
      return sea.events().some((e) => (e.type === 'SeaFight' || e.type === 'SkirmishBegun') && e.entityIds.includes(merchant.id) && e.entityIds.includes(patrol.id));
    };
    expect(fought(blockader(w, patrol.id))).toBe(true);
    const plain = blockader(w, patrol.id);
    expect(fought({ ...plain, ai: { ...plain.ai!, blockadeOf: undefined, waitUntil: undefined } })).toBe(false);
  }, 60_000);

  it("challenges a new captain of the port's flag inside the blockade, and lets her be once she is clear of it", () => {
    const sim = world(5);
    const { id, state } = spawn(atWar(sim.state), 'patrol', 'town.cartagena', 'town.santo_domingo');
    // Spots on the lane into Port Royal, by their distance from the town: open water all the way.
    const lane = settlements.filter((p) => p.nation === 'spain').map((p) => lanes.route(p.id, royal.id)).find((r) => r && r.length > 4)!;
    const off = (k: number): [number, number] => {
      // Back from the port along the lane, a tenth of a tile at a time, to the first spot k tiles from the town.
      for (let i = lane.length - 1; i > 0; i--) {
        const [a, b] = [lane[i]!, lane[i - 1]!];
        const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 10);
        for (let j = 0; j <= n; j++) {
          const q: [number, number] = [a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n];
          if (Math.hypot(q[0] - royal.x, q[1] - royal.y) >= k) return q;
        }
      }
      return lane[0]!;
    };
    const station = off(t.tiles * 0.6);
    const lying = { ...blockader(state, id, 8), x: station[0], y: station[1] };
    // An English captain, new (no standing with Spain), and a wide sight so the lookout finds her at once.
    const english = { ...state, captain: { ...state.captain!, nation: 'england' as const, standing: {} } };
    const wide = { ...content, combat: { ...content.combat, chase: { ...content.combat.chase, chaseTiles: 40 } } };
    const at = ([x, y]: [number, number], from: WorldState = english) => {
      const player = { ...from.ships.player!, docked: undefined, x, y, speed: 0 };
      const sea = createSim({ ...from, ships: { ...from.ships, player, [id]: from === english ? lying : from.ships[id]! } }, [createTrafficSystem(wide, settlements, lanes, map, windAt)]);
      sea.step(30);
      return sea;
    };
    // Close by her inside the blockade: she lays the captain aboard.
    const close = at([station[0] + 1, station[1] + 1]);
    expect(close.events().some((e) => e.type === 'BattleJoined' && e.entityIds.includes(id))).toBe(true);
    // Further in, toward the quay, still inside it: she gives chase.
    const inside = at(off(t.tiles * 0.2));
    expect(Math.hypot(inside.state.ships.player!.x - station[0], inside.state.ships.player!.y - station[1])).toBeGreaterThan(content.combat.chase.contactTiles);
    expect(inside.state.ships[id]!.ai!.chasing).toBe(true);
    // Well clear of it: a new captain is let pass, as anywhere else at sea.
    const outside = off(t.tiles * 2);
    expect(Math.hypot(outside[0] - royal.x, outside[1] - royal.y)).toBeGreaterThan(t.tiles);
    expect(at(outside).state.ships[id]!.ai!.chasing ?? false).toBe(false);
    // Chased out past it, she breaks off and goes back to her station.
    const broke = at(outside, inside.state);
    expect(broke.state.ships[id]!.ai!.chasing).toBe(false);
    expect(broke.state.ships[id]!.ai!.blockadeOf).toBe(royal.id);
  });

  it('beating a blockader breaks the blockade: the deed remembers the port, and it is news there', () => {
    const sim = world(4);
    const { id, state } = spawn(atWar(sim.state), 'patrol', 'town.cartagena', 'town.santo_domingo');
    const lying = blockader(state, id);
    const player = { ...state.ships.player!, docked: undefined, x: lying.x + 1, y: lying.y };
    const result: BattleResult = { outcome: 'sunk', player: { hull: 60, sailCondition: 80, crew: 50, guns: 14 }, enemy: { hull: 0, sailCondition: 40, crew: 9, guns: 6 } };
    const fight = createSim({ ...state, ships: { ...state.ships, player, [id]: lying } }, [createTrafficSystem(content, settlements, lanes, map, windAt)]);
    fight.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result });
    fight.applyCommands();
    expect(fight.state.captain!.deeds!.at(-1)).toMatchObject({ nation: 'spain', role: 'patrol', relieved: 'england' });
    expect(fight.state.news!.some((n) => n.kind === 'blockadeBroken' && n.settlementId === royal.id)).toBe(true);
    expect(fight.events().find((e) => e.type === 'BattleOver')!.payload.relieved).toMatchObject({ nation: 'england', bounty: content.politics.bounty.blockade });
  });
});
