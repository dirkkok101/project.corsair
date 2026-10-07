import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim } from '@corsair/core';
import type { BattleResult, Ship, WorldState } from '@corsair/core';
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
    // Ships lost at sea are made good one a day per role, so a fight late in the season can leave one short.
    expect(ai(a.state).length).toBeLessThanOrEqual(content.traffic.population);
    expect(ai(a.state).length).toBeGreaterThanOrEqual(content.traffic.population - 2);
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
    const pirate = (temperament = 'bold', nerve = 1): Ship => ({ ...on(pirate0, 0), crew: 64, ai: { ...on(pirate0, 0).ai!, temperament, nerve } });
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
