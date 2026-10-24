import { describe, expect, it } from 'vitest';
import { createSim } from '@corsair/core';
import { isLand, shipStats, tileAt } from '@corsair/data';
import { createEconomySystem, crewOf, quote } from '@corsair/systems-economy';
import { createNavigationSystem } from '@corsair/systems-navigation';
import { bearingWord, createHonoursSystem, createVoyageSystem, withVoyage } from '../src';
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
    expect(sim.state.captain!.voyage!.lessons ?? []).toEqual([]);
    sim.send({ type: 'SetHelm', shipId: 'player', helm: 1 });
    sim.step(5);
    sim.send({ type: 'SetSails', shipId: 'player', sails: 'full' });
    sim.step(5);
    expect(sim.state.captain!.voyage!.lessons).toEqual(['steer', 'sail']);
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
