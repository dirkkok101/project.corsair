import { describe, expect, it } from 'vitest';
import { createSim } from '@corsair/core';
import { isLand, shipStats, Tile, tileAt } from '@corsair/data';
import { createEconomySystem, crewOf, quote, suggestTrade } from '@corsair/systems-economy';
import { createNavigationSystem } from '@corsair/systems-navigation';
import { bearingWord, createHonoursSystem, createTrafficSystem, createVoyageSystem, missionOffer, withVoyage } from '../src';
import { content, settlements, lanes, map, windAt, world } from './fixtures';

const capitals = (['england', 'spain', 'france', 'netherlands'] as const).map((n) => ({ nation: n, home: settlements.find((s) => s.nation === n && s.type === 'capital')! }));

describe('the First Voyage', () => {
  it('reads a bearing as a compass point, north up', () => {
    expect(bearingWord(0, -1)).toBe('north');
    expect(bearingWord(1, 0)).toBe('east');
    expect(bearingWord(1, 1)).toBe('south-east');
    expect(bearingWord(-1, 0)).toBe('west');
  });

  it.each(capitals)("lays a cay off $nation's capital: water by a shore, in range by sea, clear of every port", ({ nation, home }) => {
    for (const seed of [1, 2, 3]) {
      const w = withVoyage(world(seed).state, content, map, settlements, lanes, home.id, nation, seed);
      const v = w.captain!.voyage!;
      expect(v).toMatchObject({ step: 'harbour', home: home.id, cay: { name: content.voyage.cays[nation] } });
      const { x, y, tiles, bearing } = v.cay;
      expect(isLand(tileAt(map, x, y))).toBe(false);
      const berth = lanes.berth(home.id)!;
      expect(Math.hypot(x - berth[0], y - berth[1])).toBeGreaterThanOrEqual(content.voyage.cayTiles[0]);
      expect(tiles).toBeLessThanOrEqual(content.voyage.cayTiles[1]);
      expect(bearing).toBe(bearingWord(x - berth[0], y - berth[1]));
      for (const s of settlements) expect(Math.hypot(s.x - x, s.y - y)).toBeGreaterThanOrEqual(content.voyage.clearOfPortsTiles);
      // A sea path from home to it.
      expect(lanes.path(berth, [x, y])).toBeDefined();
    }
  });

  it('is the same cay for the same seed, and leaves the rest of the world as it was', () => {
    const { nation, home } = capitals[0]!;
    const a = withVoyage(world(5).state, content, map, settlements, lanes, home.id, nation, 5);
    const b = withVoyage(world(5).state, content, map, settlements, lanes, home.id, nation, 5);
    expect(a.captain!.voyage).toEqual(b.captain!.voyage);
    const { voyage: _v, ...rest } = a.captain!;
    expect(rest).toEqual(world(5).state.captain);
  });
});

describe('the First Voyage, sailed', () => {
  const royal = settlements.find((s) => s.id === 'town.port_royal')!;
  /** A new career on the voyage, in port at Port Royal. */
  const begun = (seed = 3) => {
    const w = withVoyage(world(seed).state, content, map, settlements, lanes, royal.id, 'england', seed);
    const sim = createSim(w, [createEconomySystem(content, settlements, map, windAt), createNavigationSystem(content, map, windAt, settlements), createVoyageSystem(content, settlements), createHonoursSystem(content, settlements)]);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: royal.id });
    sim.applyCommands();
    return sim;
  };
  const refused = (sim: ReturnType<typeof begun>) => sim.events().filter((e) => e.type === 'TradeRefused').map((e) => e.payload.reason);

  it('in the harbour every building is shut: its business is refused', () => {
    const sim = begun();
    for (const command of [
      { type: 'Buy', shipId: 'player', good: 'sugar', quantity: 1 },
      { type: 'BuyGuns', shipId: 'player', count: 1 },
      { type: 'Recruit', shipId: 'player', count: 1 },
      { type: 'CollectBounties', shipId: 'player' },
    ] as const) {
      sim.send(command);
      sim.applyCommands();
    }
    expect(refused(sim)).toEqual(['shuttered', 'shuttered', 'shuttered', 'shuttered']);
  });

  it('sailing from home takes her out at half sail, bound for the cay; the helm and more sail are lessons learned; the cay reached', () => {
    const sim = begun();
    sim.send({ type: 'Undock', shipId: 'player' });
    sim.applyCommands();
    expect(sim.state.captain!.voyage!.step).toBe('helm');
    expect(sim.state.ships.player!.sails).toBe('half');
    sim.step(30);
    // Nothing learned of sail yet (the helm may be, if she left with her head on the smoke).
    expect(sim.state.captain!.voyage!.lessons ?? []).not.toContain('sail');
    sim.send({ type: 'SetHelm', shipId: 'player', helm: 1 });
    sim.step(5);
    sim.send({ type: 'SetSails', shipId: 'player', sails: 'full' });
    sim.step(5);
    expect(sim.state.captain!.voyage!.lessons).toEqual(expect.arrayContaining(['steer', 'sail']));
    const { x, y } = sim.state.captain!.voyage!.cay;
    sim.send({ type: 'Teleport', shipId: 'player', x: x + 1, y });
    sim.step(1);
    expect(sim.state.captain!.voyage!.step).toBe('salvage');
    expect(sim.events().filter((e) => e.type === 'CayReached')).toHaveLength(1);
    // The salvage: sugar enough that its sale at home fills her battery, and castaways into her crew.
    const crew = crewOf(content, sim.state.ships.player!);
    sim.send({ type: 'Salvage', shipId: 'player' });
    sim.step(1);
    const me = sim.state.ships.player!;
    const casks = me.cargo.sugar!;
    expect(casks).toBeGreaterThanOrEqual(content.voyage.salvage.minUnits);
    expect(me.crew).toBe(crew + content.voyage.salvage.men);
    expect(sim.state.captain!.voyage!.step).toBe('prize');
    expect(sim.state.captain!.honours!.find((h) => h.id === 'first:salvage')).toMatchObject({ kind: 'first', title: 'First salvage' });
    // Sold at home it covers the guns she lacks.
    const sell = quote(content, royal, 'sugar', sim.state.markets![royal.id]!.sugar ?? 0).sell;
    const lack = (shipStats(content, me).maxGuns - shipStats(content, me).guns) * content.combat.port.gunGold - sim.state.captain!.gold;
    expect(casks * sell).toBeGreaterThanOrEqual(lack);
    // Once only.
    sim.send({ type: 'Salvage', shipId: 'player' });
    sim.step(1);
    expect(sim.state.ships.player!.cargo.sugar).toBe(casks);
  });

  it("a veteran's career has no voyage, and every building open", () => {
    const sim = createSim(world(3).state, [createEconomySystem(content, settlements, map, windAt), createVoyageSystem(content, settlements)]);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: royal.id });
    sim.send({ type: 'Buy', shipId: 'player', good: 'sugar', quantity: 1 });
    sim.applyCommands();
    expect(refused(sim)).toEqual([]);
  });
});

describe('the First Voyage, the first prize', () => {
  const royal = settlements.find((s) => s.id === 'town.port_royal')!;
  it('salvaged, a pirate comes out harrying a fishing boat off the cay; she hunts no one; taken, home, and the boat sails for home too', () => {
    const w = withVoyage(world(3).state, content, map, settlements, lanes, royal.id, 'england', 3);
    const v = w.captain!.voyage!;
    // At the cay, salvaged (its sugar aboard), with the gold for her guns.
    const at = { ...w, ships: { ...w.ships, player: { ...w.ships.player!, x: v.cay.x + 1, y: v.cay.y, cargo: { ...w.ships.player!.cargo, sugar: 20 } } }, captain: { ...w.captain!, gold: 5000, voyage: { ...v, step: 'prize' as const } } };
    const sim = createSim(at, [
      createEconomySystem(content, settlements, map, windAt),
      createTrafficSystem(content, settlements, lanes, map, windAt),
      createNavigationSystem(content, map, windAt, settlements),
      createVoyageSystem(content, settlements),
      createHonoursSystem(content, settlements),
    ]);
    sim.step(1);
    const voyage = sim.state.captain!.voyage!;
    expect(voyage.pirate).toBe(content.voyage.pirate.name);
    const pirate = () => sim.state.ships[voyage.pirateId!]!;
    const boat = () => sim.state.ships[voyage.boatId!]!;
    expect(pirate()).toMatchObject({ classId: content.voyage.pirate.classId, guns: 0, crew: content.voyage.pirate.crew, ai: { role: 'pirate', purse: content.voyage.pirate.purse, voyage: { meek: true } } });
    // Near the wreck, on deep open water: no land or shoal for the battle's reach about her.
    const off = Math.hypot(boat().x - v.cay.x, boat().y - v.cay.y);
    expect(off).toBeGreaterThanOrEqual(content.voyage.pirate.nearTiles[0]);
    expect(off).toBeLessThanOrEqual(content.voyage.pirate.nearTiles[1]);
    for (let r = 0; r <= content.voyage.pirate.clearTiles; r += 1)
      for (let a = 0; a < 360; a += 30) expect(tileAt(map, boat().x + Math.sin((a * Math.PI) / 180) * r, boat().y - Math.cos((a * Math.PI) / 180) * r)).toBe(Tile.Deep);
    // She circles the boat for days, never chasing the captain alongside.
    sim.step(content.calendar.ticksPerDay * 2);
    expect(Math.hypot(pirate().x - boat().x, pirate().y - boat().y)).toBeCloseTo(content.voyage.harry.orbitTiles, 1);
    expect(pirate().ai!.chasing).toBeFalsy();
    expect(sim.events().filter((e) => e.type === 'BattleJoined')).toHaveLength(0);
    // Taken: home with her, the boat freed onto the lanes.
    sim.send({ type: 'BattleEnded', shipId: 'player', targetId: voyage.pirateId!, result: { outcome: 'struck', player: { hull: 80, sailCondition: 90, crew: 70, guns: 10 }, enemy: { hull: 8, sailCondition: 60, crew: 20, guns: 0 } } });
    sim.applyCommands();
    expect(sim.state.captain!.voyage!.step).toBe('home');
    expect(sim.state.captain!.honours!.some((h) => h.id === 'first:prize')).toBe(true);
    sim.step(2);
    expect(boat().ai!.voyage).toBeUndefined();
    expect(boat().ai!.route.length).toBeGreaterThan(0);
    // Home: ashore, the merchant, shipwright and tavern open; the three chores done, the governor.
    sim.send({ type: 'Teleport', shipId: 'player', x: royal.x + 2, y: royal.y + 2 });
    sim.step(1);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: royal.id });
    sim.applyCommands();
    expect(sim.state.captain!.voyage).toMatchObject({ step: 'home', ashore: true });
    sim.send({ type: 'CollectBounties', shipId: 'player' });
    sim.applyCommands();
    expect(sim.events().at(-1)!.payload.reason).toBe('shuttered');
    sim.send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 1000 });
    sim.send({ type: 'BuyGuns', shipId: 'player', count: 20 });
    sim.applyCommands();
    expect(sim.state.captain!.voyage!.lessons).toEqual(expect.arrayContaining(['sold', 'battery']));
    expect(sim.state.captain!.voyage!.step).toBe('home');
    sim.send({ type: 'DividePlunder', shipId: 'player' });
    sim.applyCommands();
    expect(sim.state.captain!.voyage!.step).toBe('governor');
    // The governor: no commission before his letter; the letter free, then her pick of his three.
    sim.send({ type: 'ChooseCommission', shipId: 'player', kind: 'courier' });
    sim.applyCommands();
    expect(sim.events().at(-1)!.type).toBe('VoyageRefused');
    const gold = sim.state.captain!.gold;
    sim.send({ type: 'VoyageMarque', shipId: 'player' });
    sim.applyCommands();
    expect(sim.state.captain!.marques).toEqual(['england']);
    // (The marque goal it completes pays its little.)
    expect(sim.state.captain!.gold - gold).toBeLessThanOrEqual(content.rewards.goals.gold);
    const run = suggestTrade(content, sim.state, royal, settlements)!;
    expect(run.profit).toBeGreaterThan(0);
    expect(run.units * run.buy).toBeLessThanOrEqual(sim.state.captain!.gold);
    expect(missionOffer(content, sim.state, royal, settlements, 'hunt')).toMatchObject({ kind: 'hunt', classId: content.voyage.commissions.quarry });
    sim.send({ type: 'AcceptMission', shipId: 'player', kind: 'courier' });
    sim.send({ type: 'ChooseCommission', shipId: 'player', kind: 'courier' });
    sim.applyCommands();
    expect(sim.state.captain!.voyage).toMatchObject({ step: 'done', commission: 'courier' });
    expect(sim.state.captain!.missions!.map((m) => m.kind)).toEqual(['courier']);
    expect(sim.state.captain!.honours!.some((h) => h.id === 'first:voyage')).toBe(true);
  });
});

describe('the First Voyage, given up', () => {
  it('sending the quartermaster ashore ends it: every building open, its ships gone', () => {
    const royal = settlements.find((s) => s.id === 'town.port_royal')!;
    const w = withVoyage(world(3).state, content, map, settlements, lanes, royal.id, 'england', 3);
    const at = { ...w, captain: { ...w.captain!, voyage: { ...w.captain!.voyage!, step: 'prize' as const } } };
    const sim = createSim(at, [createEconomySystem(content, settlements, map, windAt), createTrafficSystem(content, settlements, lanes, map, windAt), createVoyageSystem(content, settlements)]);
    sim.step(1);
    expect(Object.values(sim.state.ships).filter((s) => s.ai?.voyage)).toHaveLength(2);
    sim.send({ type: 'SkipVoyage', shipId: 'player' });
    sim.step(1);
    expect(sim.state.captain!.voyage!.step).toBe('done');
    expect(Object.values(sim.state.ships).filter((s) => s.ai?.voyage)).toHaveLength(0);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: royal.id });
    sim.send({ type: 'Teleport', shipId: 'player', x: royal.x + 2, y: royal.y + 2 });
    sim.step(1);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: royal.id });
    sim.send({ type: 'Buy', shipId: 'player', good: 'sugar', quantity: 1 });
    sim.applyCommands();
    expect(sim.events().filter((e) => e.type === 'TradeRefused' && e.payload.reason === 'shuttered')).toHaveLength(0);
  });
});

describe('the First Voyage, the first prize at every capital', () => {
  it.each(capitals)("off $nation's cay the pirate is out on deep water, clear of shoals and land", ({ nation, home }) => {
    const w = withVoyage(world(3).state, content, map, settlements, lanes, home.id, nation, 3);
    const v = w.captain!.voyage!;
    const at = { ...w, ships: { ...w.ships, player: { ...w.ships.player!, x: v.cay.x + 1, y: v.cay.y } }, captain: { ...w.captain!, voyage: { ...v, step: 'prize' as const } } };
    const sim = createSim(at, [createTrafficSystem(content, settlements, lanes, map, windAt)]);
    sim.step(1);
    const boat = sim.state.ships[sim.state.captain!.voyage!.boatId!]!;
    for (let r = 0; r <= content.voyage.pirate.clearTiles; r += 1)
      for (let a = 0; a < 360; a += 30) expect(tileAt(map, boat.x + Math.sin((a * Math.PI) / 180) * r, boat.y - Math.cos((a * Math.PI) / 180) * r)).toBe(Tile.Deep);
  });
});
