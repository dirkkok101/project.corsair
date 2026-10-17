import { createSim } from '@corsair/core';
import type { BattleResult, Prize, Ship, WorldState } from '@corsair/core';
import { shipStats } from '@corsair/data';
import { cargoUsed, createEconomySystem, fleetBerths, fleetHold, fleetShipPace, shipValue } from '@corsair/systems-economy';
import { describe, expect, it } from 'vitest';
import { createTrafficSystem } from '../src';
import { content, map, settlements, lanes, windAt, day, world, ai } from './fixtures';

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
    const alone = (ships: Ship[], captain: Partial<NonNullable<WorldState['captain']>> = {}) =>
      createSim({ ...sim.state, captain: { ...sim.state.captain!, ...captain }, ships: Object.fromEntries(ships.map((x) => [x.id, x])) }, [traffic()]);
    return { pirate, merchant, patrol, player, alone, along };
  };
  const ARMED = { guns: 18, crew: 150 };

  it('a pirate weighs the odds, and the prize: the starting brig draws bold and cautious alike; a full battery, or more men, lets her be; nerve tips it', () => {
    const t = setting();
    const chased = (temperament: string, outfit = {}, nerve = 1) => {
      const sim = t.alone([t.pirate(temperament, nerve), t.player(8, outfit)]);
      sim.step(30);
      return Boolean(Object.values(sim.state.ships).find((x) => x.ai)!.ai!.chasing);
    };
    // A sloop is 0.77 the starting brig's strength; her ship alone (400 gold of worth) makes a pirate chance odds
    // 1.4 times poorer (combat.json hunt.hunger): bold needs 0.43, cautious 0.64.
    expect(chased('bold')).toBe(true);
    expect(chased('cautious')).toBe(true);
    expect(chased('bold', ARMED)).toBe(false);
    // 110 men (odds 0.52): the cautious let her be; 140 (0.41), the bold too, unless of high nerve (0.6: needs 0.26).
    expect(chased('cautious', { crew: 110 })).toBe(false);
    expect(chased('bold', { crew: 140 }, 1)).toBe(false);
    expect(chased('bold', { crew: 140 }, 0.6)).toBe(true);
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
      // Giving chase, or already alongside and joining battle.
      return Boolean(Object.values(sim.state.ships).find((x) => x.ai)!.ai!.chasing) || sim.events().some((e) => e.type === 'BattleJoined');
    };
    expect(chased((harbour + reach) / 2)).toBe(false);
    expect(chased(reach + 3)).toBe(true);
  });

  it('at war with her flag, a warship lets a new captain pass, and hunts her once she has attacked its ships', () => {
    const t = setting();
    // An English patrol, and a Spanish captain (Spain is at war with England in 1660).
    const chased = (england: number) => {
      const pat = t.patrol(12);
      const sim = t.alone([pat, t.player(8)], { nation: 'spain', standing: { england } });
      sim.step(30);
      return Boolean(sim.state.ships[pat.id]!.ai!.chasing);
    };
    expect(chased(0)).toBe(false);
    expect(chased(content.combat.standing.attack)).toBe(true);
  });

  it('a patrol that sights a pirate gives chase', () => {
    const t = setting();
    const pat = t.patrol(12);
    const sim = t.alone([t.pirate(), pat, t.player(0, { x: 0, y: 0 })]);
    sim.step(30);
    expect(sim.state.ships[pat.id]!.ai!.target).toBe(t.pirate().id);
  });

  it('a fight in her sight wears both ships down as it goes, the weaker the more: joining, she finds them as the fight has left them', () => {
    const t = setting();
    const seen = t.alone([t.pirate(), t.merchant(1.5), t.player(14, ARMED)]);
    seen.step(30);
    const [pirate, merchant] = [t.pirate().id, t.merchant(1.5).id];
    const start = { pirate: seen.state.ships[pirate]!, merchant: seen.state.ships[merchant]! };
    expect(start.pirate.ai!.skirmish).toBeDefined();
    // Half way through.
    seen.step(Math.round((content.combat.hunt.skirmishHours / 24 / 2) * day));
    const lost = (id: string, s: Ship) => {
      const now = seen.state.ships[id]!;
      const max = shipStats(content, s).hullMax;
      return { hull: ((s.hull ?? max) - now.hull!) / max, crew: (s.crew! - now.crew!) / s.crew! };
    };
    const p = lost(pirate, start.pirate);
    const m = lost(merchant, start.merchant);
    expect(p.hull).toBeGreaterThan(0);
    expect(m.hull).toBeGreaterThan(0);
    expect(seen.state.ships[merchant]!.sailCondition).toBeLessThan(100);
    // The pirate is the stronger: the merchant loses the larger share.
    expect(m.hull).toBeGreaterThan(p.hull);
    expect(m.crew).toBeGreaterThan(p.crew);
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
