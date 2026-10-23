import { createSim } from '@corsair/core';
import type { BattleResult, Mission, WorldState } from '@corsair/core';
import { describe, expect, it } from 'vitest';
import { createEconomySystem } from '@corsair/systems-economy';
import { createTrafficSystem, missionGoals, missionOffer, quarryClass } from '../src';
import { content, settlements, lanes, map, windAt, day, world } from './fixtures';

const royal = settlements.find((s) => s.id === 'town.port_royal')!;
const m = content.politics.missions;
/** Content whose governors offer only the one kind. */
const only = (kind: 'hunt' | 'courier') => ({
  ...content,
  politics: { ...content.politics, missions: { ...m, hunt: { ...m.hunt, weight: kind === 'hunt' ? 1 : 0 }, courier: { ...m.courier, weight: kind === 'courier' ? 1 : 0 } } },
});
const systems = (pack = content) => [createEconomySystem(pack, settlements, map), createTrafficSystem(pack, settlements, lanes, map, windAt)];
const docked = (state: WorldState, at: string): WorldState => ({ ...state, ships: { ...state.ships, player: { ...state.ships.player!, docked: at, speed: 0 } } });
const result = (outcome: BattleResult['outcome']): BattleResult => ({
  outcome,
  player: { hull: 60, sailCondition: 80, crew: 50, guns: 14 },
  enemy: { hull: 10, sailCondition: 40, crew: 30, guns: 6 },
});
const types = (sim: { events: () => readonly { type: string }[] }) => sim.events().map((e) => e.type);

describe("governors' missions", () => {
  it('a governor offers one a week, the same each time asked, and none to a captain his nation counts hostile', () => {
    const state = docked(world(3).state, royal.id);
    const offer = missionOffer(content, state, royal, settlements);
    expect(offer).toBeDefined();
    expect(missionOffer(content, state, royal, settlements)).toEqual(offer);
    const hostile = { ...state, captain: { ...state.captain!, standing: { england: content.combat.standing.hostile } } };
    expect(missionOffer(content, hostile, royal, settlements)).toBeUndefined();
  });

  it('a hunt puts a named quarry matched to her ship on the sea, kept there; beaten, the governor pays into the chest, and merit', () => {
    const pack = only('hunt');
    const sim = createSim(docked(world(3, undefined, pack).state, royal.id), systems(pack));
    const offer = missionOffer(pack, sim.state, royal, settlements)!;
    expect(offer.kind).toBe('hunt');
    expect(offer.classId).toBe(quarryClass(pack, sim.state));
    sim.send({ type: 'AcceptMission', shipId: 'player' });
    sim.applyCommands();
    expect(types(sim)).toContain('MissionAccepted');
    const mission = sim.state.captain!.missions![0]!;
    const quarry = sim.state.ships[mission.target!]!;
    expect(quarry.ai).toMatchObject({ role: 'pirate', name: offer.name, mission: mission.id });
    expect(quarry.classId).toBe(offer.classId);
    expect(quarry.ai!.haunts).toContain(offer.to);
    // Taken, the offer is not made again this week.
    expect(missionOffer(pack, sim.state, royal, settlements)).toBeUndefined();
    // The goal at sea names her and where she is.
    expect(missionGoals(sim.state, settlements)[0]).toMatchObject({ id: mission.id, port: offer.to, mission: true });
    // Days on, she is still at sea (the population's top-up and trims leave her be).
    sim.step(3 * day);
    expect(sim.state.ships[mission.target!]?.ai?.mission).toBe(mission.id);

    const chest = sim.state.captain!.chest ?? 0;
    const merit = sim.state.captain!.merit?.england ?? 0;
    sim.send({ type: 'BattleEnded', shipId: 'player', targetId: mission.target!, result: result('sunk') });
    sim.applyCommands();
    expect(types(sim)).toContain('MissionDone');
    expect(sim.state.captain!.missions![0]!.done).toBeDefined();
    expect(missionGoals(sim.state, settlements)[0]).toMatchObject({ title: `Collect your reward at ${royal.name}`, port: royal.id });

    // Paid by the governor who gave it, with the bounty for the pirate.
    const pay = createSim(docked(sim.state, royal.id), systems(pack));
    pay.send({ type: 'CollectBounties', shipId: 'player' });
    pay.applyCommands();
    expect(pay.state.captain!.missions).toEqual([]);
    expect(pay.state.captain!.chest! - chest).toBeGreaterThanOrEqual(offer.reward);
    expect((pay.state.captain!.merit?.england ?? 0) - merit).toBeGreaterThanOrEqual(offer.merit);
  }, 120_000);

  it('the quarry sails the class the governor named, however famous the captain, and lurks inside the ringed waters', () => {
    // Every pirate setting out for a captain this famous would be the bigger kind.
    const hunt = only('hunt');
    const pack = { ...hunt, traffic: { ...hunt.traffic, biggerPirates: { ...hunt.traffic.biggerPirates, maxShare: 1 } } };
    const start = docked(world(3, undefined, pack).state, royal.id);
    const famed = { ...start, captain: { ...start.captain!, record: { ...start.captain!.record, prizes: 200, famousBeaten: 20 } } };
    const sim = createSim(famed, systems(pack));
    const offer = missionOffer(pack, sim.state, royal, settlements)!;
    sim.send({ type: 'AcceptMission', shipId: 'player' });
    sim.applyCommands();
    const id = sim.state.captain!.missions![0]!.target!;
    expect(sim.state.ships[id]!.classId).toBe(offer.classId);
    // Out of her haven, bound for her waters: her lurking spot lies within the chart's ring about the port.
    const port = settlements.find((s) => s.id === offer.to)!;
    for (let k = 0; k < 10 && !sim.state.ships[id]!.ai!.route.length; k++) sim.step(Math.round(day / 4));
    const end = sim.state.ships[id]!.ai!.route.at(-1)!;
    expect(sim.state.ships[id]!.ai!.to).toBe(offer.to);
    expect(Math.hypot(end[0] - port.x, end[1] - port.y)).toBeLessThanOrEqual(m.hunt.ringTiles);
  }, 120_000);

  it('the quarry is matched to the flagship: a frigate is sent after a bigger pirate than a lone sloop is', () => {
    const state = world(3).state;
    const weak = { ...state, ships: { ...state.ships, player: { ...state.ships.player!, classId: 'ship.sloop', crew: 40, guns: 4 } } };
    const strong = { ...state, ships: { ...state.ships, player: { ...state.ships.player!, classId: 'ship.frigate', crew: 250, guns: 32 } } };
    const price = (s: WorldState) => content.ships[quarryClass(content, s)]!.price;
    expect(price(strong)).toBeGreaterThan(price(weak));
  });

  it('a courier hands the letter over, carries the reply home, and is paid there', () => {
    const pack = only('courier');
    const sim = createSim(docked(world(3, undefined, pack).state, royal.id), systems(pack));
    sim.send({ type: 'AcceptMission', shipId: 'player' });
    sim.applyCommands();
    const mission = sim.state.captain!.missions![0]!;
    expect(mission.kind).toBe('courier');
    const there = createSim(docked(sim.state, mission.to), systems(pack));
    there.send({ type: 'CallOnGovernor', shipId: 'player' });
    there.applyCommands();
    expect(types(there)).toContain('LetterDelivered');
    expect(missionGoals(there.state, settlements)[0]).toMatchObject({ title: `Bring the reply to ${royal.name}`, port: royal.id });
    const home = createSim(docked(there.state, royal.id), systems(pack));
    home.send({ type: 'CallOnGovernor', shipId: 'player' });
    home.send({ type: 'CollectBounties', shipId: 'player' });
    home.applyCommands();
    expect(types(home)).toContain('MissionDone');
    expect(home.state.captain!.missions).toEqual([]);
    expect(home.state.captain!.chest ?? 0).toBeGreaterThanOrEqual(mission.reward);
  });

  it('no more than the open limit at once', () => {
    const pack = only('courier');
    const state = docked(world(3, undefined, pack).state, royal.id);
    const open: Mission[] = Array.from({ length: m.open }, (_, i) => ({ id: `mission.x${i}`, kind: 'courier', from: royal.id, nation: 'england', to: royal.id, reward: 1, merit: 1, tick: 0, endTick: 1e9 }));
    const sim = createSim({ ...state, captain: { ...state.captain!, missions: open } }, systems(pack));
    sim.send({ type: 'AcceptMission', shipId: 'player' });
    sim.applyCommands();
    expect(sim.events().at(-1)).toMatchObject({ type: 'MissionRefused', payload: { reason: 'too-many' } });
  });

  it('one not done lapses with no penalty, her quarry sailing on as any pirate; one beaten by another ship is over', () => {
    const pack = only('hunt');
    const sim = createSim(docked(world(3, undefined, pack).state, royal.id), systems(pack));
    sim.send({ type: 'AcceptMission', shipId: 'player' });
    sim.applyCommands();
    const mission = sim.state.captain!.missions![0]!;
    const standing = sim.state.captain!.standing;
    const due = createSim({ ...sim.state, captain: { ...sim.state.captain!, missions: [{ ...mission, endTick: sim.state.tick + 1 }] } }, systems(pack));
    due.step(day);
    expect(types(due)).toContain('MissionLapsed');
    expect(due.state.captain!.missions).toEqual([]);
    expect(due.state.captain!.standing).toEqual(standing);
    expect(due.state.ships[mission.target!]?.ai?.mission).toBeUndefined();

    const { [mission.target!]: _gone, ...rest } = sim.state.ships;
    const lost = createSim({ ...sim.state, ships: rest }, systems(pack));
    lost.step(day);
    expect(types(lost)).toContain('MissionLost');
    expect(lost.state.captain!.missions).toEqual([]);
  }, 120_000);
});
