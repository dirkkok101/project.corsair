import { createSim } from '@corsair/core';
import type { BattleResult, WorldState } from '@corsair/core';
import { describe, expect, it } from 'vitest';
import { createEconomySystem } from '@corsair/systems-economy';
import { createHonoursSystem, createTrafficSystem } from '../src';
import { content, settlements, lanes, map, windAt, world } from './fixtures';

const royal = settlements.find((s) => s.id === 'town.port_royal')!;
const systems = () => [createEconomySystem(content, settlements, map), createTrafficSystem(content, settlements, lanes, map, windAt), createHonoursSystem(content, settlements)];
// In Port Royal, with the gold for a full battery.
const docked = (state: WorldState): WorldState => ({ ...state, captain: { ...state.captain!, gold: 5000 }, ships: { ...state.ships, player: { ...state.ships.player!, docked: royal.id, speed: 0 } } });
const result = (outcome: BattleResult['outcome']): BattleResult => ({
  outcome,
  player: { hull: 60, sailCondition: 80, crew: 50, guns: 14 },
  enemy: { hull: 10, sailCondition: 40, crew: 9, guns: 6 },
});
/** A sim in Port Royal whose honours have seen her once (the goals already done said nothing). */
const begun = (state = world(3).state) => {
  const sim = createSim(docked(state), systems());
  sim.send({ type: 'Dock', shipId: 'player', settlementId: royal.id });
  sim.applyCommands();
  return sim;
};

describe('honours', () => {
  it('the goals done when she is first seen are noted, not said or paid', () => {
    const w = world(3).state;
    const full = { ...w, ships: { ...w.ships, player: { ...w.ships.player!, guns: 18 } } };
    const sim = begun(full);
    expect(sim.state.captain!.goalsDone).toContain('guns');
    expect(sim.state.captain!.honours ?? []).toEqual([]);
    expect(sim.state.captain!.gold).toBe(5000);
  });

  it('a goal newly done is said once, in the past tense, and pays the purse', () => {
    const sim = begun();
    const gold = sim.state.captain!.gold;
    const lack = 18 - sim.state.ships.player!.guns!;
    sim.send({ type: 'BuyGuns', shipId: 'player', count: lack });
    sim.applyCommands();
    const h = sim.state.captain!.honours!.find((x) => x.id === 'goal:guns')!;
    expect(h).toMatchObject({ kind: 'goal', title: 'A full battery', gold: content.rewards.goals.gold, into: 'purse', lines: ['18 guns'] });
    expect(sim.state.captain!.gold).toBe(gold - lack * content.combat.port.gunGold + content.rewards.goals.gold);
    // Sold down and mounted again, it is not a deed twice.
    sim.send({ type: 'SellGuns', shipId: 'player', count: 1 });
    sim.send({ type: 'BuyGuns', shipId: 'player', count: 1 });
    sim.applyCommands();
    expect(sim.state.captain!.honours!.filter((x) => x.goal === 'guns')).toHaveLength(1);
  });

  it('only the first few goals done pay', () => {
    const sim = begun();
    const paid = content.rewards.goals.paid;
    const s = sim.state;
    // As if she had already been paid for that many.
    const honours = Array.from({ length: paid }, (_, i) => ({ id: `goal:x${i}`, kind: 'goal' as const, title: 'x', tick: 0, goal: `x${i}` }));
    const sim2 = createSim({ ...s, captain: { ...s.captain!, honours, goalsDone: [...s.captain!.goalsDone!, ...honours.map((h) => h.goal)] } }, systems());
    const gold = sim2.state.captain!.gold;
    const lack = 18 - s.ships.player!.guns!;
    sim2.send({ type: 'BuyGuns', shipId: 'player', count: lack });
    sim2.applyCommands();
    expect(sim2.state.captain!.honours!.at(-1)).toMatchObject({ id: 'goal:guns' });
    expect(sim2.state.captain!.honours!.at(-1)!.gold).toBeUndefined();
    expect(sim2.state.captain!.gold).toBe(gold - lack * content.combat.port.gunGold);
  });

  it('her first sale is a first, once; a later sale is a deed only for a big profit', () => {
    const sim = begun();
    const s = sim.state;
    const sim2 = createSim({ ...s, ships: { ...s.ships, player: { ...s.ships.player!, cargo: { sugar: 30 }, paid: { sugar: 0 } } } }, systems());
    sim2.send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 5 });
    sim2.applyCommands();
    sim2.send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 1 });
    sim2.applyCommands();
    const honours = sim2.state.captain!.honours!;
    expect(honours.filter((h) => h.id === 'first:sale')).toHaveLength(1);
    expect(honours.find((h) => h.id === 'first:sale')).toMatchObject({ kind: 'first', title: 'First cargo sold', into: 'purse', lines: ['5 sugar at Port Royal'] });
    // One cask's profit is no deed.
    expect(honours.filter((h) => h.kind === 'trade')).toHaveLength(0);
    sim2.send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 24 });
    sim2.applyCommands();
    const big = sim2.state.captain!.honours!.filter((h) => h.kind === 'trade');
    expect(big).toHaveLength(1);
    expect(big[0]!.gold).toBeGreaterThanOrEqual(content.rewards.bigTrade);
  });

  it('her first prize is a first that carries the prize goal and its pay; a second prize says nothing', () => {
    const sim = world(6);
    sim.send({ type: 'SpawnShip', role: 'pirate', from: 'town.tortuga', to: 'town.port_royal' });
    sim.send({ type: 'SpawnShip', role: 'pirate', from: 'town.tortuga', to: 'town.port_royal' });
    sim.applyCommands();
    const ids = Object.keys(sim.state.ships).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).slice(-2);
    const fight = createSim(sim.state, systems());
    // Seen once at sea before the fight.
    fight.send({ type: 'SetSails', shipId: 'player', sails: 'half' });
    fight.applyCommands();
    const seen = fight.state.captain!.goalsDone;
    expect(seen).toBeDefined();
    fight.send({ type: 'BattleEnded', shipId: 'player', targetId: ids[0]!, result: result('struck') });
    fight.applyCommands();
    const first = fight.state.captain!.honours!.filter((h) => h.goal === 'prize');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: 'first:prize', kind: 'first', into: 'chest' });
    expect(first[0]!.lines!.at(-1)).toBe(`+${content.rewards.goals.gold} gold: a goal done`);
    const n = fight.state.captain!.honours!.length;
    fight.send({ type: 'BattleEnded', shipId: 'player', targetId: ids[1]!, result: result('struck') });
    fight.applyCommands();
    expect(fight.state.captain!.honours!.filter((h) => h.kind === 'first')).toHaveLength(1);
    expect(fight.state.captain!.honours!.length).toBeGreaterThanOrEqual(n);
  });

  it('is deterministic: the same commands give the same honours', () => {
    const run = () => {
      const sim = begun();
      sim.send({ type: 'BuyGuns', shipId: 'player', count: 18 - sim.state.ships.player!.guns! });
      sim.applyCommands();
      sim.step(60);
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
