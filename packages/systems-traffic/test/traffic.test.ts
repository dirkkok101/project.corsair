import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim } from '@corsair/core';
import type { BattleResult, Prize, Ship, WorldState } from '@corsair/core';
import { decodeRasterMap, isLand, loadContent, placeSettlements, tileAt } from '@corsair/data';
import { cargoUsed, createEconomySystem, fleetBerths, fleetHold, fleetShipPace, hoardRing, newsText, normalStock, placeHoard, shipValue, stockCap, withEconomy } from '@corsair/systems-economy';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { createWeatherSystem, createWindField, withWeather } from '@corsair/systems-weather';
import { describe, expect, it } from 'vitest';
import { atWar } from '@corsair/systems-politics';
import { createSeaLanes, createTrafficSystem, topTen, withTraffic } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});
const settlements = placeSettlements(def, map, content.settlements);
const lanes = createSeaLanes(map, settlements, content.traffic.laneCell);
const windAt = createWindField(content, def, map);
const day = content.calendar.ticksPerDay;

function world(seed: number, start: WorldState = createWorld(def), pack = content) {
  const w = withTraffic(withEconomy(withWeather(start, pack, def, seed), pack, settlements, seed), pack, settlements, lanes, seed);
  return createSim(w, [
    createWeatherSystem(pack, def, map),
    createEconomySystem(pack, settlements, map),
    createTrafficSystem(pack, settlements, lanes, map, windAt),
    createNavigationSystem(pack, map, windAt),
  ]);
}
const ai = (state: WorldState) => Object.values(state.ships).filter((s) => s.ai);
/** The everyday traffic: AI ships less the convoys, which sail on a timetable of their own. */
// The population: the famous pirates sail over and above it.
const traffic0 = (state: WorldState) => ai(state).filter((s) => !s.ai!.convoy && !s.ai!.famous).flatMap((s) => [s, ...(s.ai!.prizes ?? []).filter((p) => p.takenFrom !== 'player')]);

describe('ships at sea', () => {
  it('start with the full population moored at home ports, by role', () => {
    const sim = world(1);
    const ships = ai(sim.state);
    expect(ships).toHaveLength(content.traffic.population);
    const roles = (r: string) => ships.filter((s) => s.ai!.role === r).length;
    expect(roles('merchant')).toBe(17);
    expect(roles('patrol')).toBe(6);
    expect(roles('pirate')).toBe(11);
    for (const s of ships) expect(isLand(tileAt(map, s.x, s.y))).toBe(false);
    // Pirates sail from havens under their own flag; the rest under their port's.
    for (const s of ships.filter((x) => x.ai!.role === 'pirate')) expect(s.ai!.nation).toBe('pirate');
  });

  it('each role sails a mix of classes, from her own', () => {
    const ships = ai(world(1).state);
    for (const role of ['merchant', 'patrol', 'pirate'] as const) {
      const mix = Object.keys(content.traffic.roles[role].classes!);
      const sailed = new Set(ships.filter((s) => s.ai!.role === role).map((s) => s.classId));
      // A pirate grown big sails a brig (biggerPirates), whatever her mix.
      for (const c of sailed) expect([...mix, content.traffic.biggerPirates.classId], `${role} ${c}`).toContain(c);
    }
    expect(new Set(ships.filter((s) => s.ai!.role === 'merchant').map((s) => s.classId)).size).toBeGreaterThan(1);
  });

  it('sail a season on water, making voyages, with markets in bounds, and replay exactly', () => {
    const run = () => {
      const sim = world(7);
      for (let d = 0; d < 90; d++) {
        sim.step(day);
        for (const s of ai(sim.state)) expect(isLand(tileAt(map, s.x, s.y)), `${s.id} ${s.ai!.role} on land at day ${d}: ${JSON.stringify({ x: s.x, y: s.y, from: s.ai!.from, to: s.ai!.to, along: s.ai!.along, offset: s.ai!.offset, wait: s.ai!.waitUntil, route: s.ai!.route })}`).toBe(false);
      }
      return sim;
    };
    const a = run();
    const departed = a.events().filter((e) => e.type === 'ShipDeparted');
    const arrived = a.events().filter((e) => e.type === 'ShipArrived');
    console.log('TRAFFIC voyages', departed.length, 'arrivals', arrived.length);
    expect(departed.length).toBeGreaterThan(60);
    expect(arrived.length).toBeGreaterThan(40);
    // Merchants really carried goods.
    expect(arrived.some((e) => Object.keys(e.payload.cargo as object).length > 0)).toBe(true);
    for (const s of settlements) {
      for (const g of content.goods) {
        expect(a.state.markets![s.id]![g.id]!).toBeLessThanOrEqual(Math.ceil(stockCap(content, a.state, s, g.id)));
        expect(a.state.markets![s.id]![g.id]!).toBeGreaterThanOrEqual(0);
      }
    }
    // Ships lost at sea are made good one a day per role, so a fight late in the season can leave one short.
    expect(traffic0(a.state).length).toBeLessThanOrEqual(content.traffic.population);
    expect(traffic0(a.state).length).toBeGreaterThanOrEqual(content.traffic.population - 2);
    expect(run().hash()).toBe(a.hash());
    // Two seasons sailed (about 30 s alone); the gate runs every test file at once, so give it room.
  }, 120_000);

  it('the player sees ships within sight, remembers where, and can hail one alongside', () => {
    const sim = world(3);
    const pr = settlements.find((s) => s.id === 'town.port_royal')!;
    const to = settlements.find((s) => s.id === 'town.cartagena')!;
    sim.send({ type: 'SpawnShip', role: 'merchant', from: pr.id, to: to.id });
    sim.applyCommands();
    const id = Object.keys(sim.state.ships).at(-1)!;
    sim.step(1);
    const player = sim.state.ships.player!;
    const other = sim.state.ships[id]!;
    expect(sim.state.captain!.sightings![id]).toMatchObject({ classId: other.classId, nation: 'england' });

    // Bring the player alongside and hail.
    const alongside = { ...sim.state, ships: { ...sim.state.ships, player: { ...player, x: other.x + 1, y: other.y } } };
    const hailer = createSim(alongside, [createTrafficSystem(content, settlements, lanes, map, windAt)]);
    hailer.send({ type: 'Hail', shipId: 'player', targetId: id });
    hailer.applyCommands();
    expect(hailer.events().at(-1)!.type).toBe('Hailed');

    const far = { ...sim.state, ships: { ...sim.state.ships, player: { ...player, x: other.x + 20, y: other.y } } };
    const tooFar = createSim(far, [createTrafficSystem(content, settlements, lanes, map, windAt)]);
    tooFar.send({ type: 'Hail', shipId: 'player', targetId: id });
    tooFar.applyCommands();
    expect(tooFar.events().at(-1)!.payload.reason).toBe('too-far');
  });
});

describe('fights at sea', () => {
  const spawnAlongside = (sim: ReturnType<typeof world>, role: 'merchant' | 'pirate', from: string, to: string) => {
    sim.send({ type: 'SpawnShip', role, from, to });
    sim.applyCommands();
    const id = Object.keys(sim.state.ships).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    const other = sim.state.ships[id]!;
    const player = sim.state.ships.player!;
    const near: WorldState = { ...sim.state, ships: { ...sim.state.ships, player: { ...player, x: other.x + 1, y: other.y } } };
    return { id, near };
  };
  const traffic = () => createTrafficSystem(content, settlements, lanes, map, windAt);
  const result = (outcome: BattleResult['outcome']) => ({
    outcome,
    player: { hull: 60, sailCondition: 80, crew: 50, guns: 14 },
    enemy: { hull: 10, sailCondition: 40, crew: 9, guns: 6 },
  });

  it('a pirate that sights the player gives chase and closes to battle', () => {
    const sim = world(5);
    const haven = settlements.find((s) => s.id === 'town.tortuga')!;
    const { id } = spawnAlongside(sim, 'pirate', haven.id, 'town.port_royal');
    const pirate = sim.state.ships[id]!;
    // Put the player within sight, six tiles ahead on her own lane (open water), and let her come on.
    const [[x0, y0], [x1, y1]] = pirate.ai!.route as [[number, number], [number, number]];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ahead = Math.min(6, len);
    const at = { x: x0 + ((x1 - x0) / len) * ahead, y: y0 + ((y1 - y0) / len) * ahead };
    const start = { ...sim.state, ships: { ...sim.state.ships, player: { ...sim.state.ships.player!, ...at } } };
    const chase = createSim(start, [traffic()]);
    chase.step(30 * 20);
    expect(chase.events().some((e) => e.type === 'BattleJoined' && e.entityIds[1] === id)).toBe(true);
  });

  it("a pirate won't follow the player under a port's guns: she gives up the chase and leaves her be", () => {
    const sim = world(5);
    const { id, near } = spawnAlongside(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const royal = settlements.find((s) => s.id === 'town.port_royal')!;
    // The player off Port Royal (a city: under its guns), the pirate in full chase within contact range.
    const pirate = near.ships[id]!;
    const at = { x: royal.x + 2, y: royal.y + 2 };
    const start = {
      ...near,
      ships: { ...near.ships, player: { ...near.ships.player!, ...at, docked: undefined }, [id]: { ...pirate, x: at.x + 1, y: at.y, ai: { ...pirate.ai!, chasing: true } } },
    };
    const chase = createSim(start, [traffic()]);
    chase.step(30);
    expect(chase.events().some((e) => e.type === 'BattleJoined')).toBe(false);
    expect(chase.state.ships[id]!.ai!.chasing).toBe(false);
  });

  it("taking a merchant costs standing with her nation; her gold is plunder at once, and the plunder screen settles the rest", () => {
    const sim = world(6);
    const { id, near } = spawnAlongside(sim, 'merchant', 'town.port_royal', 'town.cartagena');
    const prize = { ...near.ships[id]!, cargo: { sugar: 12 }, ai: { ...near.ships[id]!.ai!, purse: 300 } };
    const fight = createSim({ ...near, ships: { ...near.ships, [id]: prize } }, [traffic()]);
    const gold = fight.state.captain!.gold;
    fight.send({ type: 'Attack', shipId: 'player', targetId: id });
    fight.applyCommands();
    expect(fight.events().at(-1)!.type).toBe('BattleJoined');
    expect(fight.state.captain!.standing!.england).toBe(content.combat.standing.attack);
    fight.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('struck') });
    fight.applyCommands();
    expect(fight.state.ships[id]).toBeUndefined();
    // Her gold is plunder at once, for the crew's chest; her cargo and her volunteers wait on the plunder screen.
    expect(fight.state.captain!.gold).toBe(gold);
    expect(fight.state.captain!.chest).toBe(300);
    expect(fight.state.ships.player!.cargo.sugar).toBeUndefined();
    const volunteers = Math.round(9 * content.crew.volunteers.other);
    expect(fight.state.prize).toMatchObject({ ship: { id, cargo: { sugar: 12 } }, volunteers });
    // The after-action report: her purse, a prize's cheer, and Spain (at war with England in 1660) approving.
    const report = fight.events().find((e) => e.type === 'BattleOver')!.payload;
    expect(report).toMatchObject({ outcome: 'struck', purse: 300, nation: 'england', volunteers, standing: { spain: content.combat.standing.enemyWin } });
    expect(fight.state.captain!.standing!.spain).toBe(content.combat.standing.enemyWin);
    expect(fight.state.captain!.morale).toBeGreaterThan(content.crew.morale.start - 20);
    expect(fight.state.news!.at(-1)).toMatchObject({ kind: 'taken', ship: prize.ai.name, nation: 'england' });

    // Take 8 of her 12 sugar and the volunteers, and let her go with the rest.
    fight.send({ type: 'TakePlunder', shipId: 'player', take: { sugar: 8 }, volunteers: true, release: true });
    fight.applyCommands();
    expect(fight.state.prize).toBeUndefined();
    expect(fight.state.ships.player!.cargo.sugar).toBe(8);
    expect(fight.state.ships.player!.plunder).toEqual({ sugar: 8 });
    expect(fight.state.ships.player!.crew).toBe(50 + volunteers);
    expect(fight.state.ships[id]!.cargo).toEqual({ sugar: 4 });
    expect(fight.state.ships[id]!.ai!.calmUntil).toBeGreaterThan(fight.state.tick);
    // Let go, she speaks well of you at home.
    expect(fight.state.captain!.standing!.england).toBe(content.combat.standing.attack + content.combat.standing.mercy);
  });

  it('the plunder screen: over the side to make room, the hold limits what comes aboard, and a sunk prize is gone', () => {
    const sim = world(6);
    const { id, near } = spawnAlongside(sim, 'merchant', 'town.port_royal', 'town.cartagena');
    const hold = content.ships[near.ships.player!.classId]!.cargo;
    const full = { ...near.ships.player!, cargo: { hides: hold }, paid: { hides: hold * 10 } };
    const fight = createSim({ ...near, ships: { ...near.ships, player: full, [id]: { ...near.ships[id]!, cargo: { luxuries: 30 } } } }, [traffic()]);
    fight.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('boarded') });
    fight.applyCommands();
    fight.send({ type: 'TakePlunder', shipId: 'player', take: { luxuries: 30 }, jettison: { hides: 20 }, volunteers: false, release: false });
    fight.applyCommands();
    expect(fight.state.ships.player!.cargo).toEqual({ hides: hold - 20, luxuries: 20 });
    expect(fight.state.ships.player!.paid!.hides).toBe((hold - 20) * 10);
    expect(fight.state.ships.player!.crew).toBe(50);
    expect(fight.state.ships[id]).toBeUndefined();
    // Sunk after she struck: her nation hears of it.
    expect(fight.state.captain!.standing!.england ?? 0).toBe(content.combat.standing.scuttle);
  });

  it('sinking a pirate raises standing everywhere; losing to one costs the hold and the chest, never the purse', () => {
    const sim = world(8);
    const { id, near } = spawnAlongside(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const win = createSim(near, [traffic()]);
    win.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('sunk') });
    win.applyCommands();
    expect(win.state.captain!.standing).toMatchObject({ spain: 3, england: 3, france: 3, netherlands: 3 });

    const laden = { ...near, captain: { ...near.captain!, chest: 400 }, ships: { ...near.ships, player: { ...near.ships.player!, cargo: { luxuries: 20, food: 10 } } } };
    const lose = createSim(laden, [traffic()]);
    const gold = lose.state.captain!.gold;
    lose.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('lost') });
    lose.applyCommands();
    // They leave the rations.
    expect(lose.state.ships.player!.cargo).toEqual({ food: 10 });
    expect(lose.state.captain!.chest).toBe(0);
    expect(lose.state.captain!.gold).toBe(gold);
    expect(lose.events().find((e) => e.type === 'BattleOver')!.payload.lost).toEqual({ gold: 0, chest: 400, cargo: { luxuries: 20 } });
    expect(lose.state.ships[id]).toBeDefined();
  });

  it('a fight is virtual: both ships stay where they met, guns lost stay lost, and the pirate leaves the player be', () => {
    const sim = world(8);
    const { id, near } = spawnAlongside(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const fled = createSim(near, [traffic()]);
    fled.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('fled') });
    fled.applyCommands();
    expect(fled.state.ships.player).toMatchObject({ x: near.ships.player!.x, y: near.ships.player!.y, guns: 14 });
    expect(fled.state.ships[id]).toMatchObject({ x: near.ships[id]!.x, y: near.ships[id]!.y });
    expect(fled.state.ships[id]!.ai).toMatchObject({ chasing: false });
    expect(fled.state.ships[id]!.ai!.calmUntil).toBeGreaterThan(fled.state.tick);
    expect(fled.state.captain!.gold).toBe(near.captain!.gold);
  });

  it('keeping a prize: she joins the fleet with her hold, unless the fleet is full or short of men', () => {
    const sim = world(6);
    const { id, near } = spawnAlongside(sim, 'merchant', 'town.port_royal', 'town.cartagena');
    const laden = { ...near, ships: { ...near.ships, [id]: { ...near.ships[id]!, cargo: { sugar: 120 } } } };
    const take = (state: WorldState, keep: boolean) => {
      const fight = createSim(state, [traffic()]);
      fight.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('boarded') });
      fight.applyCommands();
      fight.send({ type: 'TakePlunder', shipId: 'player', take: { sugar: 120 }, volunteers: false, release: false, keep });
      fight.applyCommands();
      return fight;
    };
    const kept = take(laden, true);
    expect(kept.state.captain!.fleet).toMatchObject([{ id, classId: 'ship.fluyt', hull: 10 }]);
    // Her hold joins the fleet's, so all 120 of her sugar comes aboard; the fleet keeps her pace.
    expect(kept.state.ships.player!.cargo.sugar).toBe(120);
    // The fleet keeps her pace, slowed by the damage she took until a shipwright mends her.
    expect(kept.state.ships.player!.fleetSpeed).toBe(fleetShipPace(content, kept.state.captain!.fleet![0]!));
    // Not kept, the brig's hold takes what it can.
    const aboard = Object.values(laden.ships.player!.cargo).reduce((n, u) => n + u, 0);
    expect(take(laden, false).state.ships.player!.cargo.sugar).toBe(content.ships['ship.brig']!.cargo - aboard);

    const fleetFull = { ...laden, captain: { ...laden.captain!, fleet: Array.from({ length: 7 }, (_, k) => ({ id: `f${k}`, name: `F${k}`, classId: 'ship.sloop', hull: 45, sailCondition: 100 })) } };
    const full = take({ ...fleetFull, ships: { ...fleetFull.ships, player: { ...fleetFull.ships.player!, crew: 150 } } }, true);
    expect(full.events().at(-1)).toMatchObject({ type: 'PlunderRefused', payload: { reason: 'fleet-full' } });
    const few = take({ ...laden, ships: { ...laden.ships, player: { ...laden.ships.player!, crew: 20 } } }, true);
    expect(few.events().at(-1)).toMatchObject({ type: 'PlunderRefused', payload: { reason: 'too-few-men' } });
  });

  it('a pirate who beats you takes what her hold carries, and keeps it, with the chest in her purse', () => {
    const sim = world(8);
    const { id, near } = spawnAlongside(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const room = content.ships['ship.sloop']!.cargo;
    const laden: WorldState = {
      ...near,
      captain: { ...near.captain!, chest: 300 },
      ships: { ...near.ships, [id]: { ...near.ships[id]!, cargo: {}, ai: { ...near.ships[id]!.ai!, purse: 100 } }, player: { ...near.ships.player!, cargo: { luxuries: 30, sugar: 30, food: 10 } } },
    };
    const lose = createSim(laden, [traffic()]);
    lose.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('lost') });
    lose.applyCommands();
    // The dearest first, as far as her hold goes; the rations stay.
    expect(lose.state.ships[id]!.cargo).toEqual({ luxuries: 30, sugar: room - 30 });
    expect(lose.state.ships.player!.cargo).toEqual({ sugar: 60 - room, food: 10 });
    expect(lose.state.ships[id]!.ai!.purse).toBe(400);
  });

  it('only the flagship fights: her berths of the fleet\'s men, and only they can fall', () => {
    const sim = world(8);
    const { id, near } = spawnAlongside(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const fleet = [{ id: 'f1', name: 'Endeavour', classId: 'ship.fluyt', hull: 70, sailCondition: 100 }];
    const big = { ...near, captain: { ...near.captain!, fleet }, ships: { ...near.ships, player: { ...near.ships.player!, crew: 200 } } };
    const won = createSim(big, [traffic()]);
    // The brig fought with 150 of her 200 men and came out with 140.
    won.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: { ...result('sunk'), player: { ...result('sunk').player, crew: 140 } } });
    won.applyCommands();
    expect(won.state.ships.player!.crew).toBe(190);
  });
});

describe('ships that carry the world', () => {
  it('the English convoy sails on her timetable: lands luxuries and settlers at Port Royal, loads sugar and rum, and goes home', () => {
    // No pirates: this is the convoy's timetable, not her luck (pirates take convoys, and keep them).
    const roles = content.traffic.roles;
    const calm = { ...content, traffic: { ...content.traffic, roles: { ...roles, pirate: { ...roles.pirate, share: 0 } } }, pirates: { ...content.pirates, captains: [] } };
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
    for (let d = 0; d < 60; d++) {
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
  });
});

describe('choosing a target at sea', () => {
  const traffic = () => createTrafficSystem(content, settlements, lanes, map, windAt);
  /** A pirate out of Tortuga on her lane toward Port Royal, alone at sea with whoever a test puts near her. */
  const setting = () => {
    const sim = world(5);
    const spawn = (role: 'merchant' | 'pirate' | 'patrol', from: string, to: string) => {
      sim.send({ type: 'SpawnShip', role, from, to });
      sim.applyCommands();
      return sim.state.ships[Object.keys(sim.state.ships).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!]!;
    };
    const pirate0 = spawn('pirate', 'town.tortuga', 'town.port_royal');
    const merchant0 = spawn('merchant', 'town.port_royal', 'town.cartagena');
    const patrol0 = spawn('patrol', 'town.port_royal', 'town.bridgetown');
    // `k` tiles on from a spot well down her lane, clear of Tortuga's harbour: open water.
    const along = (k: number) => {
      const route = pirate0.ai!.route;
      let left = 30 + k;
      for (let i = 1; i < route.length; i++) {
        const [[x0, y0], [x1, y1]] = [route[i - 1]!, route[i]!];
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (left <= len) return { x: x0 + ((x1 - x0) / len) * left, y: y0 + ((y1 - y0) / len) * left };
        left -= len;
      }
      throw new Error('lane too short');
    };
    // An AI ship sails where her `along` puts her on her route: all of them share the pirate's lane here.
    const on = (ship: Ship, k: number): Ship => ({ ...ship, ...along(k), ai: { ...ship.ai!, route: pirate0.ai!.route, along: 30 + k, offset: 0, waitUntil: undefined } });
    // An ordinary captain and crew for her role, so a test's odds are men and guns alone.
    const pirate = (temperament = 'bold', nerve = 1): Ship => ({ ...on(pirate0, 0), crew: 64, ai: { ...on(pirate0, 0).ai!, temperament, nerve, crew: undefined, captain: undefined } });
    const merchant = (k: number, cargo: Record<string, number> = { sugar: 20 }): Ship => ({ ...on(merchant0, k), cargo });
    const patrol = (k: number): Ship => on(patrol0, k);
    const player = (k: number, outfit: Partial<Ship> = {}): Ship => ({ ...sim.state.ships.player!, ...along(k), guns: 10, crew: 75, docked: undefined, ...outfit });
    const alone = (ships: Ship[]) => createSim({ ...sim.state, ships: Object.fromEntries(ships.map((x) => [x.id, x])) }, [traffic()]);
    return { pirate, merchant, patrol, player, alone, along };
  };
  const ARMED = { guns: 18, crew: 150 };

  it('a bold pirate comes for the starting brig; a cautious one, or any facing a full battery, lets her be; nerve tips it', () => {
    const t = setting();
    const chased = (temperament: string, outfit = {}, nerve = 1) => {
      const sim = t.alone([t.pirate(temperament, nerve), t.player(8, outfit)]);
      sim.step(30);
      return Boolean(Object.values(sim.state.ships).find((x) => x.ai)!.ai!.chasing);
    };
    expect(chased('bold')).toBe(true);
    expect(chased('cautious')).toBe(false);
    expect(chased('bold', ARMED)).toBe(false);
    // A sloop is 0.77 the starting brig's strength: a cautious pirate of high nerve (0.6 x 0.9 = 0.54) comes.
    expect(chased('cautious', {}, 0.6)).toBe(true);
    expect(chased('bold', { crew: 110 }, 1)).toBe(false);
    expect(chased('bold', { crew: 110 }, 0.6)).toBe(true);
  });

  it('she sights merchants as far off as the player, and with the player too strong goes for a laden one', () => {
    const t = setting();
    const m = t.merchant(12);
    const sim = t.alone([t.pirate(), t.player(8, ARMED), m]);
    sim.step(30);
    const pirate = Object.values(sim.state.ships).find((x) => x.ai?.role === 'pirate')!;
    expect(pirate.ai!.target).toBe(m.id);
  });

  it("pirates keep off a capital's guns, further out than a town's", () => {
    const t = setting();
    const royal = settlements.find((s) => s.id === 'town.port_royal')!;
    const reach = content.combat.chase.capitalTiles;
    const harbour = content.combat.chase.harbourTiles.city!;
    expect(reach).toBeGreaterThan(harbour);
    // The player beyond the city's harbour reach but within the capital's: let be. Just outside it: chased.
    const chased = (off: number) => {
      // Out to sea south of the harbour, the pirate a few tiles further out.
      const at = { x: royal.x, y: royal.y + off };
      const lurker = t.pirate();
      const sim = t.alone([{ ...lurker, x: at.x, y: at.y + 4, ai: { ...lurker.ai!, route: [[at.x, at.y + 4], [at.x, at.y + 24]], along: 0 } }, { ...t.player(0), ...at }]);
      sim.step(30);
      return Boolean(Object.values(sim.state.ships).find((x) => x.ai)!.ai!.chasing);
    };
    expect(chased((harbour + reach) / 2)).toBe(false);
    expect(chased(reach + 3)).toBe(true);
  });

  it('a patrol that sights a pirate gives chase', () => {
    const t = setting();
    const pat = t.patrol(12);
    const sim = t.alone([t.pirate(), pat, t.player(0, { x: 0, y: 0 })]);
    sim.step(30);
    expect(sim.state.ships[pat.id]!.ai!.target).toBe(t.pirate().id);
  });

  it("a fight within the player's sight plays out: both heave to until it is settled, and out of sight at once", () => {
    const t = setting();
    const seen = t.alone([t.pirate(), t.merchant(1.5), t.player(14, ARMED)]);
    seen.step(30);
    expect(seen.events().some((e) => e.type === 'SkirmishBegun')).toBe(true);
    expect(seen.events().some((e) => e.type === 'SeaFight')).toBe(false);
    const pirate = t.pirate().id;
    expect(seen.state.ships[pirate]!.ai!.skirmish).toBeDefined();
    seen.step(Math.round((content.combat.hunt.skirmishHours / 24) * day) + 30);
    expect(seen.events().some((e) => e.type === 'SeaFight')).toBe(true);
    expect(Object.values(seen.state.ships).some((x) => x.ai?.skirmish)).toBe(false);

    const unseen = t.alone([t.pirate(), t.merchant(1.5), t.player(0, { x: 0, y: 0 })]);
    unseen.step(30);
    expect(unseen.events().some((e) => e.type === 'SkirmishBegun')).toBe(false);
    expect(unseen.events().some((e) => e.type === 'SeaFight')).toBe(true);
  });

  it('a patrol that comes up on a pirate fallen on a merchant takes her on, and the merchant sails on', () => {
    const t = setting();
    const m = t.merchant(1.5);
    const pat = t.patrol(10);
    const sim = t.alone([t.pirate(), m, t.player(14, ARMED)]);
    sim.step(30);
    const pirate = t.pirate().id;
    expect(sim.state.ships[pirate]!.ai!.skirmish?.with).toBe(m.id);
    // The patrol arrives on the scene once the fight has begun, and closes with the pirate.
    const joined = createSim({ ...sim.state, ships: { ...sim.state.ships, [pat.id]: pat } }, [traffic()]);
    joined.step(30 * 20);
    const engaged = joined.events().some((e) => (e.type === 'SkirmishBegun' || e.type === 'SeaFight') && e.entityIds.includes(pat.id));
    expect(engaged).toBe(true);
    expect(joined.state.ships[m.id]?.ai?.skirmish?.with).not.toBe(pirate);
  });

  it('the player who takes the pirate off a merchant earns her nation\'s thanks, and the merchant sails on', () => {
    const t = setting();
    const m = t.merchant(1.5);
    const sim = t.alone([t.pirate(), m, t.player(14, ARMED)]);
    sim.step(30);
    const pirate = t.pirate().id;
    const result: BattleResult = {
      outcome: 'sunk',
      player: { hull: 80, sailCondition: 90, crew: 140, guns: 18 },
      enemy: { hull: 0, sailCondition: 50, crew: 30, guns: 8 },
    };
    sim.send({ type: 'BattleEnded', shipId: 'player', targetId: pirate, result });
    sim.applyCommands();
    const st = content.combat.standing;
    expect(sim.state.captain!.standing!.england).toBe(st.pirate + content.combat.hunt.rescueStanding);
    expect(sim.state.captain!.standing!.spain).toBe(st.pirate);
    sim.step(2);
    expect(sim.state.ships[m.id]!.ai!.skirmish).toBeUndefined();
  });
});

describe('nations at war at sea', () => {
  const traffic = () => createTrafficSystem(content, settlements, lanes, map, windAt);
  const spawn = (sim: ReturnType<typeof world>, role: 'merchant' | 'pirate', from: string, to: string) => {
    sim.send({ type: 'SpawnShip', role, from, to });
    sim.applyCommands();
    return Object.keys(sim.state.ships).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
  };

  it('a pirate that meets a merchant at sea takes her: news, plunder, and pressure on her nation', () => {
    const sim = world(9);
    const merchant = spawn(sim, 'merchant', 'town.port_royal', 'town.cartagena');
    const pirate = spawn(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    // Out on the open sea, halfway down her lane (by distance): under a port's guns a pirate leaves her be.
    const m0 = sim.state.ships[merchant]!;
    const route = m0.ai!.route;
    const legs = route.slice(1).map((q, i) => Math.hypot(q[0] - route[i]![0], q[1] - route[i]![1]));
    const along = legs.reduce((t, l) => t + l, 0) / 2;
    let i = 0;
    let run = 0;
    while (run + legs[i]! < along) run += legs[i++]!;
    const f = (along - run) / legs[i]!;
    const [x0, y0] = route[i]!;
    const [x1, y1] = route[i + 1]!;
    // She sails by her distance along the lane, so set that with her position.
    const m = { ...m0, x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, ai: { ...m0.ai!, along } };
    // Lay the pirate alongside the merchant, at sea, with a weak merchant crew so the pirate wins.
    const ships = {
      ...sim.state.ships,
      player: { ...sim.state.ships.player!, docked: 'town.port_royal' },
      [merchant]: { ...m, crew: 5, cargo: { sugar: 10 }, ai: { ...m.ai!, purse: 200 } },
      [pirate]: { ...sim.state.ships[pirate]!, x: m.x + 1, y: m.y, ai: { ...sim.state.ships[pirate]!.ai!, route: m.ai!.route, along } },
    };
    const fight = createSim({ ...sim.state, ships }, [traffic()]);
    fight.step(30);
    expect(fight.events().some((e) => e.type === 'SeaFight')).toBe(true);
    expect(fight.state.ships[merchant]).toBeUndefined();
    expect(fight.state.ships[pirate]!.cargo.sugar).toBe(10);
    expect(fight.state.news!.at(-1)).toMatchObject({ kind: 'aiTaken', nation: 'england', other: 'pirate' });
    expect(fight.state.politics!.piracy.england).toBe(content.politics.piracy.perTaken);
  });

  it('under a letter of marque an attack is lawful: the issuer approves, the victim still resents it, and a win is a deed', () => {
    const sim = world(10);
    const victim = spawn(sim, 'merchant', 'town.santo_domingo', 'town.cartagena');
    const v = sim.state.ships[victim]!;
    const atWarWithSpain = { ...sim.state.politics ?? { relations: structuredClone(content.politics.start), piracy: {}, month: 0 } };
    atWarWithSpain.relations = { ...atWarWithSpain.relations, 'england:spain': { war: true, tension: 85 } };
    const state: WorldState = {
      ...sim.state,
      politics: atWarWithSpain,
      captain: { ...sim.state.captain!, marques: ['england'] },
      ships: { ...sim.state.ships, player: { ...sim.state.ships.player!, x: v.x + 1, y: v.y } },
    };
    const s2 = createSim(state, [traffic()]);
    s2.send({ type: 'Attack', shipId: 'player', targetId: victim });
    s2.applyCommands();
    expect(s2.state.captain!.standing).toMatchObject({ spain: content.combat.standing.attack, england: content.politics.marque.standingGain });
    s2.send({
      type: 'BattleEnded',
      shipId: 'player',
      targetId: victim,
      result: { outcome: 'struck', player: { hull: 80, sailCondition: 90, crew: 60, guns: 18 }, enemy: { hull: 5, sailCondition: 50, crew: 4, guns: 8 } },
    });
    s2.applyCommands();
    expect(s2.state.captain!.deeds).toEqual([{ nation: 'spain', role: 'merchant', kind: 'taken', tick: s2.state.tick }]);
  });
});

describe('ships that change hands', () => {
  const traffic = () => createTrafficSystem(content, settlements, lanes, map, windAt);
  const spawn = (sim: ReturnType<typeof world>, role: 'merchant' | 'pirate' | 'patrol', from: string, to: string) => {
    sim.send({ type: 'SpawnShip', role, from, to });
    sim.applyCommands();
    return Object.keys(sim.state.ships).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
  };
  /** A ship put halfway down her lane, out on the open sea, by distance along it. */
  const halfway = (ship: Ship): Ship => {
    const route = ship.ai!.route;
    const legs = route.slice(1).map((q, i) => Math.hypot(q[0] - route[i]![0], q[1] - route[i]![1]));
    const along = legs.reduce((t, l) => t + l, 0) / 2;
    let i = 0;
    let run = 0;
    while (run + legs[i]! < along) run += legs[i++]!;
    const f = (along - run) / legs[i]!;
    const [x0, y0] = route[i]!;
    const [x1, y1] = route[i + 1]!;
    return { ...ship, x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, ai: { ...ship.ai!, along } };
  };
  const result = (outcome: BattleResult['outcome']) => ({
    outcome,
    player: { hull: 60, sailCondition: 80, crew: 50, guns: 14 },
    enemy: { hull: 10, sailCondition: 40, crew: 9, guns: 6 },
  });
  const prize = (id: string, name: string, takenFrom: Prize['takenFrom'], sellAfter = 1e9): Prize => ({
    id,
    name,
    classId: 'ship.fluyt',
    hull: 70,
    sailCondition: 100,
    takenFrom,
    role: 'merchant',
    sellAfter,
  });

  it('a pirate who takes a merchant keeps her in tow, at her pace, and makes for her haven', () => {
    const sim = world(9);
    const merchant = spawn(sim, 'merchant', 'town.port_royal', 'town.cartagena');
    const pirate = spawn(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const m = halfway(sim.state.ships[merchant]!);
    const ships = {
      ...sim.state.ships,
      player: { ...sim.state.ships.player!, docked: 'town.port_royal' },
      [merchant]: { ...m, crew: 5, cargo: { sugar: 10 } },
      [pirate]: { ...sim.state.ships[pirate]!, x: m.x + 1, y: m.y, ai: { ...sim.state.ships[pirate]!.ai!, route: m.ai!.route, along: m.ai!.along } },
    };
    const fight = createSim({ ...sim.state, ships }, [traffic()]);
    fight.step(30);
    const p = fight.state.ships[pirate]!;
    expect(p.ai!.prizes).toMatchObject([{ id: merchant, takenFrom: 'england', role: 'merchant' }]);
    expect(p.fleetSpeed).toBe(fleetShipPace(content, p.ai!.prizes![0]!));
    expect(p.ai!.to).toBe('town.tortuga');
  });

  it('beaten by a pirate, you lose the best ship of the fleet (never the flagship), and what the rest cannot carry', () => {
    const sim = world(8);
    const id = spawn(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const other = sim.state.ships[id]!;
    const fleet = [
      { id: 'f1', name: 'Endeavour', classId: 'ship.fluyt', hull: 70, sailCondition: 100 },
      { id: 'f2', name: 'Kestrel', classId: 'ship.sloop', hull: 45, sailCondition: 100 },
    ];
    const best = [...fleet].sort((a, b) => shipValue(content, b) - shipValue(content, a))[0]!;
    const state: WorldState = {
      ...sim.state,
      captain: { ...sim.state.captain!, fleet },
      ships: {
        ...sim.state.ships,
        [id]: { ...other, cargo: {} },
        player: { ...sim.state.ships.player!, x: other.x + 1, y: other.y, crew: 120, cargo: { sugar: 250, food: 10 } },
      },
    };
    const lose = createSim(state, [traffic()]);
    lose.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('lost') });
    lose.applyCommands();
    const me = lose.state.ships.player!;
    expect(lose.state.captain!.fleet!.map((f) => f.id)).toEqual(fleet.filter((f) => f !== best).map((f) => f.id));
    expect(lose.state.ships[id]!.ai!.prizes).toMatchObject([{ id: best.id, takenFrom: 'player' }]);
    expect(lose.state.ships[id]!.ai!.to).toBe('town.tortuga');
    // What's left fits what's left of the fleet.
    expect(cargoUsed(me)).toBeLessThanOrEqual(fleetHold(content, lose.state, me));
    expect(me.crew!).toBeLessThanOrEqual(fleetBerths(content, lose.state, me));
    const over = lose.events().find((e) => e.type === 'BattleOver')!;
    expect(over.payload.lost).toMatchObject({ ship: { name: best.name }, boundFor: 'Tortuga' });
    expect(lose.state.news!.some((n) => n.kind === 'yourShipTaken' && n.vessel?.includes(best.name))).toBe(true);
  });

  it('take her, and your ship is yours again; a nation\'s ship she held sails home, and they thank you', () => {
    const sim = world(8);
    const id = spawn(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const other = sim.state.ships[id]!;
    const state: WorldState = {
      ...sim.state,
      ships: {
        ...sim.state.ships,
        [id]: { ...other, ai: { ...other.ai!, prizes: [prize('f1', 'Endeavour', 'player'), prize('ai.900', 'San Juan', 'spain')] } },
        player: { ...sim.state.ships.player!, x: other.x + 1, y: other.y, crew: 120 },
      },
    };
    const win = createSim(state, [traffic()]);
    win.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('boarded') });
    win.applyCommands();
    expect(win.state.captain!.fleet).toMatchObject([{ id: 'f1', name: 'Endeavour' }]);
    expect(win.state.ships['ai.900']!.ai).toMatchObject({ nation: 'spain', role: 'merchant' });
    expect(settlements.find((s) => s.id === win.state.ships['ai.900']!.ai!.to)!.nation).toBe('spain');
    expect(win.state.captain!.standing!.spain).toBe(content.combat.standing.pirate + content.combat.hunt.rescueStanding);
    expect(win.events().find((e) => e.type === 'BattleOver')!.payload.retaken).toEqual([{ name: 'Endeavour', classId: 'ship.fluyt' }]);
    expect(win.state.prize!.ship.ai!.prizes).toBeUndefined();
  });

  it('with no room for her, your ship waits in port for you to take back', () => {
    const sim = world(8);
    const id = spawn(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const other = sim.state.ships[id]!;
    const full = Array.from({ length: 7 }, (_, k) => ({ id: `s${k}`, name: `S${k}`, classId: 'ship.sloop', hull: 45, sailCondition: 100 }));
    const state: WorldState = {
      ...sim.state,
      captain: { ...sim.state.captain!, fleet: full },
      ships: {
        ...sim.state.ships,
        [id]: { ...other, ai: { ...other.ai!, prizes: [prize('f1', 'Endeavour', 'player')] } },
        player: { ...sim.state.ships.player!, x: other.x + 1, y: other.y, crew: 150 },
      },
    };
    const win = createSim(state, [traffic()]);
    win.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('sunk') });
    win.applyCommands();
    const laid = win.state.captain!.laidUp!;
    expect(laid).toMatchObject([{ id: 'f1', fee: 0 }]);
    // At the shipwright there: a full fleet can't take her until a ship is sold.
    const at = laid[0]!.settlementId;
    const port = settlements.find((s) => s.id === at)!;
    const docked = { ...win.state, ships: { ...win.state.ships, player: { ...win.state.ships.player!, x: port.x, y: port.y, docked: at, crew: 150 } } };
    const yard = createSim(docked, [createEconomySystem(content, settlements)]);
    yard.send({ type: 'ReclaimShip', shipId: 'player', laidUpId: 'f1' });
    yard.applyCommands();
    expect(yard.events().at(-1)).toMatchObject({ type: 'TradeRefused', payload: { reason: 'fleet-full' } });
    const roomy = createSim({ ...docked, captain: { ...docked.captain!, fleet: full.slice(1) } }, [createEconomySystem(content, settlements)]);
    roomy.send({ type: 'ReclaimShip', shipId: 'player', laidUpId: 'f1' });
    roomy.applyCommands();
    expect(roomy.state.captain!.fleet!.map((f) => f.id)).toContain('f1');
    expect(roomy.state.captain!.laidUp).toEqual([]);
  });

  it('a pirate sells the prizes she has held long enough when she sails from her haven', () => {
    const sim = world(8);
    const id = spawn(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const other = sim.state.ships[id]!;
    const [mx, my] = lanes.mooring('town.tortuga')!;
    const prizes = [prize('ai.901', 'Hope', 'england', sim.state.tick), prize('ai.902', 'Faith', 'england')];
    const state: WorldState = {
      ...sim.state,
      ships: {
        ...sim.state.ships,
        [id]: { ...other, x: mx, y: my, speed: 0, ai: { ...other.ai!, from: 'town.tortuga', to: 'town.tortuga', route: [], waitUntil: sim.state.tick + 1, prizes } },
      },
    };
    const port = createSim(state, [traffic()]);
    port.step(3);
    expect(port.state.ships[id]!.ai!.prizes!.map((p) => p.id)).toEqual(['ai.902']);
    expect(port.events().some((e) => e.type === 'PrizeSold' && e.payload.prize === 'ai.901')).toBe(true);
    expect(port.state.news!.some((n) => n.kind === 'prizeSold' && n.settlementId === 'town.tortuga')).toBe(true);
  });

  it('a patrol that beats a pirate frees her prizes: a merchant sails home, your ship lies in port for salvage', () => {
    const sim = world(9);
    const patrol = spawn(sim, 'patrol', 'town.port_royal', 'town.cartagena');
    const pirate = spawn(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const pat = halfway(sim.state.ships[patrol]!);
    const pir = sim.state.ships[pirate]!;
    const ships = {
      ...sim.state.ships,
      player: { ...sim.state.ships.player!, docked: 'town.port_royal' },
      [patrol]: pat,
      [pirate]: {
        ...pir,
        x: pat.x + 1,
        y: pat.y,
        crew: 2,
        ai: { ...pir.ai!, route: pat.ai!.route, along: pat.ai!.along, prizes: [prize('f1', 'Endeavour', 'player'), prize('ai.903', 'Hope', 'england')] },
      },
    };
    const fight = createSim({ ...sim.state, ships }, [traffic()]);
    let guard = 0;
    while (fight.state.ships[pirate] && guard++ < 20) fight.step(30);
    expect(fight.state.ships[pirate]).toBeUndefined();
    expect(fight.state.ships['ai.903']!.ai).toMatchObject({ nation: 'england', role: 'merchant' });
    const laid = fight.state.captain!.laidUp!;
    expect(laid).toMatchObject([{ id: 'f1' }]);
    expect(laid[0]!.fee).toBe(Math.round(shipValue(content, laid[0]!) * content.combat.prizes.salvage));
    expect(settlements.find((s) => s.id === laid[0]!.settlementId)!.nation).toBe('england');
    expect(fight.state.news!.some((n) => n.kind === 'yourShipRetaken')).toBe(true);
  });
});

describe('the famous pirates', () => {
  const traffic = () => createTrafficSystem(content, settlements, lanes, map, windAt);
  const famous = (state: WorldState) => ai(state).filter((s) => s.ai!.famous);
  const result = (outcome: BattleResult['outcome']) => ({
    outcome,
    player: { hull: 60, sailCondition: 80, crew: 50, guns: 14 },
    enemy: { hull: 10, sailCondition: 40, crew: 30, guns: 6 },
  });

  it('the ten sail from their havens on the first day, over and above the population, and rank on the Top Ten', () => {
    const sim = world(3);
    sim.step(day);
    const ten = famous(sim.state);
    expect(ten).toHaveLength(content.pirates.captains.length);
    for (const def of content.pirates.captains) {
      const ship = ten.find((s) => s.ai!.famous === def.id)!;
      expect(ship).toMatchObject({ classId: def.classId, crew: content.ships[def.classId]!.maxCrew, ai: { name: def.name, from: def.haven, role: 'pirate', temperament: def.temperament } });
    }
    expect(traffic0(sim.state).length).toBeLessThanOrEqual(content.traffic.population);
    const ranks = topTen(content, sim.state);
    expect(ranks).toHaveLength(11);
    expect(ranks[0]).toMatchObject({ id: 'morgan', wealth: 9000 });
    expect(ranks.find((r) => r.player)!.wealth).toBe(sim.state.captain!.gold);
  }, 30_000);

  it('a prize makes her richer, and her deed is news by her name', () => {
    const sim = world(9);
    sim.step(day);
    const morgan = famous(sim.state).find((s) => s.ai!.famous === 'morgan')!;
    sim.send({ type: 'SpawnShip', role: 'merchant', from: 'town.port_royal', to: 'town.cartagena' });
    sim.applyCommands();
    const merchant = Object.keys(sim.state.ships).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    const m0 = sim.state.ships[merchant]!;
    // Halfway down the merchant's lane (by distance), on open water, Morgan alongside.
    const route = m0.ai!.route;
    const legs = route.slice(1).map((q, i) => Math.hypot(q[0] - route[i]![0], q[1] - route[i]![1]));
    const along = legs.reduce((t, l) => t + l, 0) / 2;
    let i = 0;
    let run = 0;
    while (run + legs[i]! < along) run += legs[i++]!;
    const f = (along - run) / legs[i]!;
    const [x0, y0] = route[i]!;
    const [x1, y1] = route[i + 1]!;
    const m = { ...m0, x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, crew: 5, cargo: { sugar: 10 }, ai: { ...m0.ai!, along, purse: 200 } };
    const ships = {
      ...sim.state.ships,
      player: { ...sim.state.ships.player!, docked: 'town.port_royal' },
      [merchant]: m,
      [morgan.id]: { ...morgan, x: m.x + 1, y: m.y, ai: { ...morgan.ai!, waitUntil: undefined, route, along } },
    };
    const fight = createSim({ ...sim.state, ships }, [traffic()]);
    fight.step(30);
    expect(fight.state.ships[merchant]).toBeUndefined();
    const sugar = content.goods.find((g) => g.id === 'sugar')!.basePrice;
    expect(fight.state.famous!.morgan!.wealth).toBe(9000 + 200 + 10 * sugar);
    expect(fight.state.news!.at(-1)).toMatchObject({ kind: 'famousTaken', captain: 'Henry Morgan', nation: 'england' });
    expect(newsText(content, fight.state.news!.at(-1)!, 'Port Royal')).toMatch(/^Henry Morgan has taken the English .+ off Port Royal\.$/);
  });

  it('beaten, she gives up half her wealth and the captain gains fame; she lies low, then sails again in a new ship', () => {
    const sim = world(4);
    sim.step(day);
    const morgan = famous(sim.state).find((s) => s.ai!.famous === 'morgan')!;
    const r = content.pirates.rules;
    const fight = createSim({ ...sim.state, captain: { ...sim.state.captain!, chest: 0 } }, [traffic()]);
    fight.send({ type: 'BattleEnded', shipId: 'player', targetId: morgan.id, result: result('struck') });
    fight.applyCommands();
    const share = Math.round(9000 * r.wealthShare);
    expect(fight.state.captain!.chest).toBe((morgan.ai!.purse ?? 0) + share);
    expect(fight.state.captain!.fame).toBe(r.fame);
    expect(fight.events().find((e) => e.type === 'BattleOver')!.payload.famous).toEqual({ name: 'Henry Morgan', share, fame: r.fame });
    const back = fight.state.famous!.morgan!;
    expect(back).toMatchObject({ wealth: Math.round((9000 - share) * r.keeps), defeats: 1 });
    expect(back.returnAt).toBe(fight.state.tick + Math.round(r.returnDays * day));
    // The prize is just a ship under her own name; the pirate is not aboard her.
    expect(fight.state.prize!.ship.ai).toMatchObject({ name: 'Satisfaction', famous: undefined });
    expect(fight.state.news!.at(-1)).toMatchObject({ kind: 'famousBeaten', captain: 'Henry Morgan' });
    // He drops down the Top Ten, and says when he is due back.
    const ranks = topTen(content, fight.state);
    expect(ranks.find((x) => x.id === 'morgan')).toMatchObject({ wealth: back.wealth, returnAt: back.returnAt });
    expect(ranks[0]!.id).toBe('lolonnais');

    // Let the prize go, and come to the day he is due back: he sails from his haven in a new ship.
    fight.send({ type: 'TakePlunder', shipId: 'player', take: {}, volunteers: false, release: false });
    fight.applyCommands();
    const due = Math.ceil(back.returnAt! / day) * day;
    const later = createSim({ ...fight.state, tick: due - 2 }, [traffic()]);
    later.step(1);
    expect(famous(later.state).some((s) => s.ai!.famous === 'morgan')).toBe(false);
    later.step(1);
    const again = famous(later.state).find((s) => s.ai!.famous === 'morgan')!;
    expect(again).toMatchObject({ classId: 'ship.frigate', ai: { from: 'town.ile_a_vache', name: 'Henry Morgan' } });
    expect(later.state.famous!.morgan!.returnAt).toBeUndefined();
  });

  /** Morgan struck to the player: his prize waiting on the plunder screen, and him a prisoner. */
  const struck = () => {
    const sim = world(4);
    sim.step(day);
    const morgan = famous(sim.state).find((s) => s.ai!.famous === 'morgan')!;
    const fight = createSim(sim.state, [traffic()]);
    fight.send({ type: 'BattleEnded', shipId: 'player', targetId: morgan.id, result: result('struck') });
    fight.applyCommands();
    return fight;
  };
  const settle = (fight: ReturnType<typeof struck>, captive?: 'hoard' | 'bounty' | 'free') => {
    fight.send({ type: 'TakePlunder', shipId: 'player', take: {}, volunteers: false, release: false, ...(captive ? { captive } : {}) });
    fight.applyCommands();
  };
  /** The day after his time lying low is up. */
  const dueDay = (state: WorldState) => {
    const due = Math.ceil(state.famous!.morgan!.returnAt! / day) * day;
    const later = createSim({ ...state, tick: due - 1 }, [traffic()]);
    later.step(1);
    return later;
  };

  it('taken, he is a prisoner: asked about his hoard he gives up a piece of its map, until the map is whole', () => {
    const fight = struck();
    expect(fight.state.prize!.captive).toBe('morgan');
    settle(fight, 'hoard');
    expect(fight.state.captain!.mapPieces).toEqual({ morgan: 1 });
    // His first piece places his hoard, near one of his haunts; it stays put through his defeats.
    const hoard = fight.state.famous!.morgan!.hoard!;
    expect(content.pirates.captains.find((c) => c.id === 'morgan')!.haunts).toContain(hoard.near);
    expect(fight.state.famous!.morgan!.defeats).toBe(1);
    expect(fight.events().at(-1)!.payload.captive).toEqual({ id: 'morgan', choice: 'hoard', pieces: 1 });
    // His whole map held, he has nothing more to give: he goes free instead.
    const whole = struck();
    const all = createSim({ ...whole.state, captain: { ...whole.state.captain!, mapPieces: { morgan: content.pirates.rules.mapPieces } } }, [traffic()]);
    settle(all, 'hoard');
    expect(all.state.captain!.mapPieces!.morgan).toBe(content.pirates.rules.mapPieces);
    expect(all.events().at(-1)!.payload.captive).toMatchObject({ choice: 'free' });
    // Sunk, there is no one to take.
    const sim = world(4);
    sim.step(day);
    const sunk = createSim(sim.state, [traffic()]);
    sunk.send({ type: 'BattleEnded', shipId: 'player', targetId: famous(sim.state).find((s) => s.ai!.famous === 'morgan')!.id, result: result('sunk') });
    sunk.applyCommands();
    expect(sunk.state.prize).toBeUndefined();
  });

  it('held for a bounty, he waits in irons: a deed any governor pays, and he does not sail again till then', () => {
    const fight = struck();
    settle(fight, 'bounty');
    expect(fight.state.captain!.deeds!.at(-1)).toEqual({ nation: 'pirate', role: 'pirate', kind: 'taken', tick: fight.state.tick, captive: 'morgan' });
    const later = dueDay(fight.state);
    expect(famous(later.state).some((s) => s.ai!.famous === 'morgan')).toBe(false);
  });

  it('set free (the default), the crew cheer and he leaves the captain be when he sails again, until fired on', () => {
    const fight = struck();
    const morale = fight.state.captain!.morale!;
    settle(fight);
    expect(fight.state.captain!.morale).toBe(Math.min(100, morale + content.pirates.rules.mercyMorale));
    expect(fight.state.famous!.morgan!.spared).toBe(true);
    const later = dueDay(fight.state);
    const morgan = famous(later.state).find((s) => s.ai!.famous === 'morgan')!;
    // Alongside him on the open sea: he doesn't give chase.
    const sea = { x: morgan.x, y: morgan.y };
    const meet = (state: WorldState) => ({
        ...state,
        ships: {
          ...later.state.ships,
          player: { ...later.state.ships.player!, docked: undefined, x: sea.x + 3, y: sea.y },
          [morgan.id]: { ...morgan, ai: { ...morgan.ai!, waitUntil: undefined, route: [[sea.x, sea.y], [sea.x + 1, sea.y]], along: 0, calmUntil: undefined } },
        },
      }) as WorldState;
    // Not spared, he would come for her.
    const hunted = createSim(meet({ ...later.state, famous: { ...later.state.famous, morgan: { ...later.state.famous!.morgan!, spared: undefined } } }), [traffic()]);
    hunted.step(30);
    expect(hunted.state.ships[morgan.id]!.ai!.chasing).toBe(true);
    const off = createSim(meet(later.state), [traffic()]);
    off.step(30);
    expect(off.state.ships[morgan.id]!.ai!.chasing).toBeFalsy();
    expect(off.events().some((e) => e.type === 'BattleJoined' && e.entityIds.includes(morgan.id))).toBe(false);
    // Fire on him and that is forgotten.
    off.send({ type: 'Attack', shipId: 'player', targetId: morgan.id });
    off.applyCommands();
    expect(off.state.famous!.morgan!.spared).toBeUndefined();
  }, 30_000);

  it('sunk, a survivor picked from the water may carry a piece of his map', () => {
    const sure = { ...content, treasure: { ...content.treasure, survivorChance: 1 } };
    const sim = world(4);
    sim.step(day);
    const morgan = famous(sim.state).find((s) => s.ai!.famous === 'morgan')!;
    const sunk = (pack: typeof content, men: number) => {
      const fight = createSim(sim.state, [createTrafficSystem(pack, settlements, lanes, map, windAt)]);
      fight.send({ type: 'BattleEnded', shipId: 'player', targetId: morgan.id, result: { ...result('sunk'), salvage: { gold: 0, men } } });
      fight.applyCommands();
      return fight;
    };
    const picked = sunk(sure, 6);
    expect(picked.state.captain!.mapPieces).toEqual({ morgan: 1 });
    expect(picked.state.famous!.morgan!.hoard).toBeDefined();
    expect(picked.events().find((e) => e.type === 'BattleOver')!.payload.famous).toMatchObject({ name: 'Henry Morgan', piece: 1 });
    // No one picked up, no piece.
    expect(sunk(sure, 0).state.captain!.mapPieces).toBeUndefined();
  });

  /** A world a day old with Morgan's hoard placed and a piece of his map held, the player at `at` (or off the hoard). */
  const withMap = (at?: (h: NonNullable<ReturnType<typeof placeHoard>>) => [number, number]) => {
    const sim = world(4);
    sim.step(day);
    const hoard = placeHoard(content, map, settlements, 'morgan', 9000, 77)!;
    const [x, y] = at ? at(hoard) : hoard.landing;
    const state: WorldState = {
      ...sim.state,
      famous: { ...sim.state.famous, morgan: { ...sim.state.famous!.morgan!, hoard } },
      captain: { ...sim.state.captain!, chest: 0, mapPieces: { morgan: 1 } },
      ships: { ...sim.state.ships, player: { ...sim.state.ships.player!, docked: undefined, x, y } },
    };
    return { dig: createSim(state, [traffic()]), hoard };
  };
  const digThere = (sim: ReturnType<typeof withMap>['dig']) => {
    sim.send({ type: 'Dig', shipId: 'player' });
    sim.applyCommands();
    return sim.events().at(-1)!;
  };
  const isWater = (x: number, y: number) => !isLand(tileAt(map, x, y));

  it('digging off the hoard brings it up: the gold, fame, news, and revenge from a pirate never beaten', () => {
    const { dig, hoard } = withMap();
    const found = digThere(dig);
    expect(found).toMatchObject({ type: 'HoardFound', payload: { pirateId: 'morgan', gold: hoard.value, revenge: true } });
    expect(dig.state.captain!.chest).toBe(hoard.value);
    expect(dig.state.captain!.fame).toBe(content.treasure.dig.fame);
    expect(dig.state.famous!.morgan).toMatchObject({ wealth: 9000 - hoard.value, revenge: true, hoard: { found: true } });
    expect(dig.state.news!.slice(-2).map((n) => n.kind)).toEqual(['hoardDug', 'famousRevenge']);
    // Dug up, there is nothing more there.
    expect(digThere(dig)).toMatchObject({ type: 'DigMissed', payload: { hint: null } });
  });

  it("a miss inside the search ring: the men see the landmark and say which way it lies; open sea, there's no beach", () => {
    const t = content.treasure.dig;
    // Off a beach some way from the hoard, still inside the one-piece ring.
    const spot = (h: NonNullable<ReturnType<typeof placeHoard>>): [number, number] => {
      for (let r = 4; r < 14; r += 0.5) {
        for (let a = 0; a < 360; a += 10) {
          const x = h.x + Math.sin((a * Math.PI) / 180) * r;
          const y = h.y - Math.cos((a * Math.PI) / 180) * r;
          const shore = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !isWater(x + dx! * 1.5, y + dy! * 1.5));
          const beachFar = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].every(
            ([dx, dy]) => isWater(x + dx!, y + dy!) || Math.hypot(x + dx! - h.x, y + dy! - h.y) > t.toleranceTiles + 2,
          );
          const ring = hoardRing(content, h, 1);
          if (isWater(x, y) && shore && beachFar && Math.hypot(ring.x - x, ring.y - y) < ring.r) return [x, y];
        }
      }
      throw new Error('no spot');
    };
    const { dig, hoard } = withMap(spot);
    const missed = digThere(dig);
    expect(missed.type).toBe('DigMissed');
    const hint = missed.payload.hint as { landmark: string; bearingDeg: number; tiles: number };
    expect(hint.landmark).toBe(hoard.landmark);
    const me = dig.state.ships.player!;
    const want = (Math.atan2(hoard.x - me.x, -(hoard.y - me.y)) * 180) / Math.PI;
    expect(Math.abs(((hint.bearingDeg - want + 540) % 360) - 180)).toBeLessThan(25);
    expect(dig.state.captain!.chest).toBe(0);
    // Far out at sea there is no beach to dig on.
    const open = withMap((h) => {
      for (let r = 8; ; r++) for (let a = 0; a < 360; a += 15) {
        const x = h.x + Math.sin((a * Math.PI) / 180) * r;
        const y = h.y - Math.cos((a * Math.PI) / 180) * r;
        if ([...Array(9)].every((_, i) => isWater(x + ((i % 3) - 1) * 3, y + (Math.floor(i / 3) - 1) * 3))) return [x, y];
      }
    });
    expect(digThere(open.dig)).toMatchObject({ type: 'DigRefused', payload: { reason: 'no-shore' } });
  });

  it('out for revenge he comes for the captain at any odds, from further off, until beaten', () => {
    const sim = world(4);
    sim.step(day);
    const coxon = famous(sim.state).find((s) => s.ai!.famous === 'coxon')!;
    // Open water, clear of every port's guns, and the captain a little beyond his usual sight on a clear line.
    const reach = content.combat.chase.chaseTiles + 4;
    let here: [number, number] | undefined;
    let at: [number, number] | undefined;
    for (let y = 300; y < 1000 && !at; y += 7)
      for (let x = 300; x < 1500 && !at; x += 7) {
        const far = settlements.every((s) => Math.hypot(s.x - x, s.y - y) > 40);
        const around = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
        if (far && around.every(([dx, dy]) => lanes.clear([x + dx!, y + dy!], [x + reach, y]))) {
          here = [x, y];
          at = [x + reach, y];
        }
      }
    // A great crew aboard: the odds are hopeless for him.
    const meet = (revenge: boolean) =>
      createSim(
        {
          ...sim.state,
          famous: { ...sim.state.famous, coxon: { ...sim.state.famous!.coxon!, ...(revenge ? { revenge: true } : {}) } },
          ships: {
            ...sim.state.ships,
            player: { ...sim.state.ships.player!, docked: undefined, x: at![0], y: at![1], crew: 600 },
            [coxon.id]: { ...coxon, x: here![0], y: here![1], ai: { ...coxon.ai!, waitUntil: undefined, route: [here!, [here![0] - 0.5, here![1]]], along: 0 } },
          },
        },
        [traffic()],
      );
    const calm = meet(false);
    calm.step(30);
    expect(calm.state.ships[coxon.id]!.ai!.chasing).toBeFalsy();
    const angry = meet(true);
    angry.step(30);
    expect(angry.state.ships[coxon.id]!.ai!.chasing).toBe(true);
    // Beaten, it is over.
    angry.send({ type: 'BattleEnded', shipId: 'player', targetId: coxon.id, result: result('sunk') });
    angry.applyCommands();
    expect(angry.state.famous!.coxon!.revenge).toBeUndefined();
  }, 30_000);

  it('striking to a famous pirate gives up the chest and the hold, and keeps the ships and the men', () => {
    const sim = world(4);
    sim.step(day);
    const morgan = famous(sim.state).find((s) => s.ai!.famous === 'morgan')!;
    const fleetShip = { id: 'fleet.1', name: 'Swallow', classId: 'ship.sloop', hull: content.ships['ship.sloop']!.hull, sailCondition: 100 };
    const start = {
      ...sim.state,
      captain: { ...sim.state.captain!, chest: 600, fleet: [fleetShip] },
      ships: { ...sim.state.ships, player: { ...sim.state.ships.player!, cargo: { sugar: 30, food: 10 }, crew: 90 } },
    };
    const yieldTo = createSim(start, [traffic()]);
    yieldTo.send({ type: 'BattleEnded', shipId: 'player', targetId: morgan.id, result: { ...result('lost'), outcome: 'yielded', player: { hull: 70, sailCondition: 80, crew: 90, guns: 18 } } });
    yieldTo.applyCommands();
    expect(yieldTo.state.captain!.chest).toBe(0);
    expect(yieldTo.state.ships.player!.cargo.sugar).toBeUndefined();
    expect(yieldTo.state.ships.player!.cargo.food).toBe(10);
    expect(yieldTo.state.captain!.fleet).toEqual([fleetShip]);
    expect(yieldTo.state.ships.player!.crew).toBe(90);
    expect(yieldTo.state.famous!.morgan!.wealth).toBeGreaterThan(9000);
  });

  it('losing to her makes her richer by the plunder chest', () => {
    const sim = world(4);
    sim.step(day);
    const grammont = famous(sim.state).find((s) => s.ai!.famous === 'grammont')!;
    const lose = createSim({ ...sim.state, captain: { ...sim.state.captain!, chest: 700 } }, [traffic()]);
    lose.send({ type: 'BattleEnded', shipId: 'player', targetId: grammont.id, result: result('lost') });
    lose.applyCommands();
    expect(lose.state.famous!.grammont!.wealth).toBe(4000 + 700);
    expect(lose.state.ships[grammont.id]!.ai!.famous).toBe('grammont');
  });
});
