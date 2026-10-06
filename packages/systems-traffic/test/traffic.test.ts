import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim } from '@corsair/core';
import type { WorldState } from '@corsair/core';
import { decodeRasterMap, isLand, loadContent, placeSettlements, tileAt } from '@corsair/data';
import { createEconomySystem, normalStock, withEconomy } from '@corsair/systems-economy';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { createWeatherSystem, createWindField, withWeather } from '@corsair/systems-weather';
import { describe, expect, it } from 'vitest';
import { createSeaLanes, createTrafficSystem, withTraffic } from '../src';

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

function world(seed: number, start: WorldState = createWorld(def)) {
  const w = withTraffic(withEconomy(withWeather(start, content, def, seed), content, settlements, seed), content, settlements, lanes, seed);
  return createSim(w, [
    createWeatherSystem(content, def, map),
    createEconomySystem(content, settlements, map),
    createTrafficSystem(content, settlements, lanes, map, windAt),
    createNavigationSystem(content, map, windAt),
  ]);
}
const ai = (state: WorldState) => Object.values(state.ships).filter((s) => s.ai);

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
        expect(a.state.markets![s.id]![g.id]!).toBeLessThanOrEqual(Math.round(normalStock(content, s, g.id) * content.economy.maxStock));
        expect(a.state.markets![s.id]![g.id]!).toBeGreaterThanOrEqual(0);
      }
    }
    expect(ai(a.state).length).toBe(content.traffic.population);
    expect(run().hash()).toBe(a.hash());
  }, 60_000);

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
  const result = (outcome: 'sunk' | 'struck' | 'boarded' | 'escaped' | 'lost') => ({
    outcome,
    player: { hull: 60, sailCondition: 80, crew: 50 },
    enemy: { hull: 10, sailCondition: 40, crew: 9 },
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

  it("taking a merchant costs standing with her nation, and brings her gold and cargo aboard", () => {
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
    expect(fight.state.captain!.gold).toBe(gold + 300);
    expect(fight.state.ships.player!.cargo.sugar).toBe(12);
    expect(fight.state.ships.player!.crew).toBe(50);
    expect(fight.state.news!.at(-1)).toMatchObject({ kind: 'taken', ship: prize.ai.name, nation: 'england' });
  });

  it('sinking a pirate raises standing everywhere; losing to one costs the cargo and half the gold', () => {
    const sim = world(8);
    const { id, near } = spawnAlongside(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const win = createSim(near, [traffic()]);
    win.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('sunk') });
    win.applyCommands();
    expect(win.state.captain!.standing).toMatchObject({ spain: 3, england: 3, france: 3, netherlands: 3 });

    const laden = { ...near, ships: { ...near.ships, player: { ...near.ships.player!, cargo: { luxuries: 20 } } } };
    const lose = createSim(laden, [traffic()]);
    const gold = lose.state.captain!.gold;
    lose.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('lost') });
    lose.applyCommands();
    expect(lose.state.ships.player!.cargo).toEqual({});
    expect(lose.state.captain!.gold).toBe(Math.floor(gold / 2));
    expect(lose.state.ships[id]).toBeDefined();
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
    const m = sim.state.ships[merchant]!;
    // Lay the pirate alongside the merchant, at sea, with a weak merchant crew so the pirate wins.
    const ships = {
      ...sim.state.ships,
      player: { ...sim.state.ships.player!, docked: 'town.port_royal' },
      [merchant]: { ...m, crew: 5, cargo: { sugar: 10 }, ai: { ...m.ai!, purse: 200 } },
      [pirate]: { ...sim.state.ships[pirate]!, x: m.x + 1, y: m.y, ai: { ...sim.state.ships[pirate]!.ai!, route: m.ai!.route, along: 0 } },
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
      result: { outcome: 'struck', player: { hull: 80, sailCondition: 90, crew: 60 }, enemy: { hull: 5, sailCondition: 50, crew: 4 } },
    });
    s2.applyCommands();
    expect(s2.state.captain!.deeds).toEqual([{ nation: 'spain', role: 'merchant', kind: 'taken', tick: s2.state.tick }]);
  });
});
