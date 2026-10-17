import { createSim } from '@corsair/core';
import { sightTiles } from '@corsair/data';
import { createWorld } from '@corsair/systems-navigation';
import { describe, expect, it } from 'vitest';
import { atWar } from '@corsair/systems-politics';
import { createTrafficSystem } from '../src';
import { content, def, map, settlements, lanes, windAt, day, world, ai, traffic0 } from './fixtures';

describe('ships that carry the world', () => {
  it('the English convoy sails on her timetable: lands luxuries and settlers at Port Royal, loads sugar and rum, and goes home', () => {
    // No pirates, and no hunters sighting her: this is the convoy's timetable, not her luck (pirates and an enemy's
    // patrols take convoys).
    const roles = content.traffic.roles;
    const calm = {
      ...content,
      traffic: { ...content.traffic, roles: { ...roles, pirate: { ...roles.pirate, share: 0 } } },
      pirates: { ...content.pirates, captains: [] },
      combat: { ...content.combat, chase: { ...content.combat.chase, chaseTiles: 0.1 } },
    };
    const sim = world(2, createWorld(def), calm);
    const line = content.traffic.convoys.lines.find((l) => l.id === 'english')!;
    const royal = 'town.port_royal';
    sim.step(line.firstDay * day);
    const sailed = sim.events().find((e) => e.type === 'ConvoySailed' && e.payload?.line === 'english');
    expect(sailed).toBeDefined();
    const id = sailed!.entityIds[0]!;
    expect(sim.state.ships[id]).toMatchObject({ cargo: line.brings, ai: { nation: 'england', convoy: { stage: 'inbound' }, to: royal } });
    // Her coming is news at Port Royal.
    expect(sim.state.news!.some((n) => n.kind === 'convoyDue' && n.settlementId === royal)).toBe(true);
    const people = sim.state.towns![royal]!.people;
    let guard = 0;
    while (!sim.events().some((e) => e.type === 'ConvoyArrived' && e.entityIds[0] === id) && guard++ < 60) sim.step(day);
    const arrived = sim.events().find((e) => e.type === 'ConvoyArrived' && e.entityIds[0] === id)!;
    expect(arrived.payload.brought).toEqual(line.brings);
    expect(Object.keys(arrived.payload.takes as object).length).toBeGreaterThan(0);
    expect(sim.state.towns![royal]!.people).toBeGreaterThan(people);
    expect(sim.state.ships[id]!.ai!.convoy!.stage).toBe('homeward');
    guard = 0;
    while (sim.state.ships[id] && guard++ < 60) sim.step(day);
    // Gone at last: home to Europe, or taken on the way (she may win a fight or two first).
    expect(sim.state.ships[id]).toBeUndefined();
    const last = sim.events().filter((e) => e.entityIds.includes(id) && (e.type === 'ConvoySailedHome' || e.type === 'SeaFight')).at(-1);
    expect(last?.type === 'ConvoySailedHome' || last?.payload.loser === 'england').toBe(true);
  }, 120_000);

  it('no merchant sails for the port of a nation at war with hers', () => {
    const sim = world(4);
    for (let d = 0; d < 20; d++) {
      sim.step(day);
      for (const s of ai(sim.state)) {
        if (s.ai!.role !== 'merchant' || s.ai!.convoy || !s.ai!.route.length) continue;
        const to = settlements.find((x) => x.id === s.ai!.to)!;
        expect(atWar(content, sim.state, s.ai!.nation, to.nation), `${s.ai!.nation} merchant bound for ${to.id}`).toBe(false);
      }
    }
  }, 120_000);

  it('patrols go where merchants have been lost', () => {
    const sim = world(3);
    // At peace, so no patrol goes off to blockade; ten English merchants lost off Bridgetown lately.
    sim.send({ type: 'SetRelation', a: 'england', b: 'spain', war: false });
    sim.applyCommands();
    const losses = Array.from({ length: 10 }, (_, k) => ({ id: `loss.${k}`, tick: sim.state.tick, settlementId: 'town.bridgetown', kind: 'aiTaken', good: '', delayDays: 0 }));
    const patrols = ai(sim.state).filter((s) => s.ai!.role === 'patrol' && s.ai!.nation === 'england' && s.ai!.from !== 'town.bridgetown');
    expect(patrols.length).toBeGreaterThan(0);
    const ready = Object.fromEntries(patrols.map((p) => [p.id, { ...p, ai: { ...p.ai!, route: [], waitUntil: sim.state.tick + 1 } }]));
    const next = createSim({ ...sim.state, news: [...(sim.state.news ?? []), ...losses], ships: { ...sim.state.ships, ...ready } }, [
      createTrafficSystem(content, settlements, lanes, map, windAt),
    ]);
    next.step(3);
    const bound = patrols.map((p) => next.state.ships[p.id]!.ai!.to);
    expect(bound.filter((to) => to === 'town.bridgetown').length).toBeGreaterThan(bound.length / 2);
  });
});

describe('plague at sea', () => {
  it('no merchant or patrol sails for a plagued port', () => {
    const sim = world(4);
    const royal = 'town.port_royal';
    sim.send({ type: 'SpawnPlague', settlementId: royal });
    sim.applyCommands();
    for (let d = 0; d < 20; d++) {
      const seen = sim.events().length;
      sim.step(day);
      // Pirates still lurk on the lanes toward it and an enemy may lie off it in blockade; nobody puts in.
      for (const e of sim.events().slice(seen).filter((x) => x.type === 'ShipDeparted' && x.entityIds[2] === royal)) {
        const s = sim.state.ships[e.entityIds[0]!];
        if (s && s.ai!.role !== 'pirate') expect(s.ai!.blockading, `${s.id} ${s.ai!.role} bound for ${royal}`).toBe(royal);
      }
    }
  }, 120_000);

  it('a ship from a plagued port may bring it to her next', () => {
    const sim = world(5);
    sim.step(day * 3);
    const merchant = ai(sim.state).find((s) => s.ai!.role === 'merchant' && s.ai!.route.length && !sim.state.towns?.[s.ai!.to]?.plague)!;
    const to = merchant.ai!.to;
    const route = merchant.ai!.route;
    const length = route.slice(1).reduce((n, q, i) => n + Math.hypot(q[0] - route[i]![0], q[1] - route[i]![1]), 0);
    const [x, y] = route.at(-1)!;
    const carrier = { ...merchant, x, y, ai: { ...merchant.ai!, along: length - 0.01, carries: true } };
    const sure = { ...content, economy: { ...content.economy, plague: { ...content.economy.plague, spread: 1 } } };
    const next = createSim({ ...sim.state, ships: { ...sim.state.ships, [carrier.id]: carrier } }, [createTrafficSystem(sure, settlements, lanes, map, windAt)]);
    next.step(day);
    expect(next.state.towns![to]!.plague).toBeGreaterThan(next.state.tick);
    expect(next.events().some((e) => e.type === 'Plague' && e.entityIds[0] === to && e.payload.ship === carrier.id)).toBe(true);
    expect(next.state.ships[carrier.id]!.ai!.carries).toBeUndefined();
    // Four days of the whole world: past vitest's 5 s default on a busy machine.
  }, 60_000);
});

describe('a quiet sea', () => {
  it('stages a fight just beyond her sight once she has seen none a while: a hunter after her prey, the sea keeping its numbers', () => {
    // Open water south of Jamaica, under way, every check a fight (chance 1).
    const sure = { ...content, traffic: { ...content.traffic, encounters: { ...content.traffic.encounters, chance: 1 } } };
    const start = createWorld(def);
    const at = { ...start, ships: { player: { ...start.ships.player!, x: 1320, y: 1020, headingDeg: 90, speed: 4 } } };
    const sim = world(5, at, sure);
    sim.step(day);
    const before = traffic0(sim.state).length;
    const end = sim.state.tick + Math.ceil(content.traffic.encounters.quietDays + 1) * day;
    const found = () => sim.events().find((e) => e.type === 'FightStaged');
    while (!found() && sim.state.tick < end) sim.step(5);
    const staged = found();
    expect(staged).toBeDefined();
    // Both out in the haze, past what she can see (a few ticks on, neither has come into it).
    const me = sim.state.ships.player!;
    const sight = sightTiles(content, sim.state.tick, windAt(sim.state, me.x, me.y), me, sim.state.weather?.storms);
    for (const id of staged!.entityIds) expect(Math.hypot(sim.state.ships[id]!.x - me.x, sim.state.ships[id]!.y - me.y)).toBeGreaterThan(sight);
    // Their fight plays out on the map for her to come upon, rather than being settled out in the haze.
    const [hunter, prey] = staged!.entityIds;
    const met = sim.state.tick + day;
    const begun = () => sim.events().some((e) => e.type === 'SkirmishBegun' && e.entityIds[0] === hunter && e.entityIds[1] === prey);
    while (!begun() && sim.state.tick < met) sim.step(10);
    expect(begun()).toBe(true);
    // She heard of it as she saw it: the clock of quiet days starts again.
    expect(sim.state.fightSeenAt).toBeGreaterThan(0);
    // Each staged ship stood in for one far off: about as many ships as before.
    expect(Math.abs(traffic0(sim.state).length - before)).toBeLessThanOrEqual(4);
  }, 60_000);
});
