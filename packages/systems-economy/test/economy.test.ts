import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contentFingerprint, createSim, fromSave, toSave } from '@corsair/core';
import type { WorldState } from '@corsair/core';
import { decodeRasterMap, gameplayContent, loadContent, placeSettlements } from '@corsair/data';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { createWeatherSystem, createWindField, withWeather } from '@corsair/systems-weather';
import { describe, expect, it } from 'vitest';
import { cargoUsed, createEconomySystem, DOCK_RANGE, midPrice, normalStock, portTrade, quote, tradeLean, withEconomy } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});
const settlements = placeSettlements(def, map, content.settlements);
const town = (id: string) => settlements.find((s) => s.id === id)!;
const portRoyal = town('town.port_royal');
const bridgetown = town('town.bridgetown');
const day = content.calendar.ticksPerDay;

/** A world with the player's ship moored off a port. */
function moored(at = portRoyal, seed = 1) {
  const world = createWorld(def);
  const ship = { ...world.ships.player!, x: at.x + 1, y: at.y + 1 };
  return createSim(withEconomy({ ...world, ships: { player: ship } }, content, settlements, seed), [createEconomySystem(content, settlements)]);
}
const player = (state: WorldState) => state.ships.player!;

describe('prices', () => {
  it('rise when stock is short and fall when it is plentiful', () => {
    expect(midPrice(content, portRoyal, 'sugar', 5)).toBeGreaterThan(midPrice(content, portRoyal, 'sugar', 200));
  });

  it('are cheapest where a good is made and dearest where it is needed', () => {
    // At their usual stock, a sugar island sells sugar below base and a port that needs it pays above.
    const base = content.goods.find((g) => g.id === 'sugar')!.basePrice;
    expect(midPrice(content, bridgetown, 'sugar', normalStock(content, bridgetown, 'sugar'))).toBeLessThan(base);
    expect(midPrice(content, portRoyal, 'sugar', normalStock(content, portRoyal, 'sugar'))).toBeGreaterThan(base);
  });

  it('always buy dearer than they sell', () => {
    for (const g of content.goods) {
      const q = quote(content, portRoyal, g.id, normalStock(content, portRoyal, g.id));
      expect(q.buy).toBeGreaterThan(q.sell);
    }
  });
});

describe('docking and trading', () => {
  it('docks only within range, and refuses to trade at sea', () => {
    const far = moored();
    far.send({ type: 'Buy', shipId: 'player', good: 'sugar', quantity: 1 });
    far.step();
    expect(far.events().at(-1)!.payload.reason).toBe('not-docked');

    const away = createWorld(def);
    const sim = createSim(
      withEconomy({ ...away, ships: { player: { ...away.ships.player!, x: portRoyal.x + DOCK_RANGE + 5, y: portRoyal.y } } }, content, settlements, 1),
      [createEconomySystem(content, settlements)],
    );
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();
    expect(player(sim.state).docked).toBeUndefined();
    expect(sim.events().at(-1)!.payload.reason).toBe('too-far');
  });

  it('buys and sells unit by unit: gold, hold and the market all move, and the captain remembers prices', () => {
    const sim = moored();
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();
    expect(player(sim.state).docked).toBe(portRoyal.id);
    const gold0 = sim.state.captain!.gold;
    const stock0 = sim.state.markets![portRoyal.id]!.food!;
    const first = quote(content, portRoyal, 'food', stock0).buy;

    sim.send({ type: 'Buy', shipId: 'player', good: 'food', quantity: 40 });
    sim.applyCommands();
    expect(player(sim.state).cargo.food).toBe(40);
    expect(sim.state.markets![portRoyal.id]!.food).toBe(stock0 - 40);
    expect(gold0 - sim.state.captain!.gold).toBeGreaterThanOrEqual(first * 40);
    expect(sim.state.captain!.knownPrices[portRoyal.id]).toBeDefined();

    sim.send({ type: 'Sell', shipId: 'player', good: 'food', quantity: 100 });
    sim.applyCommands();
    // Only what was in the hold is sold.
    expect(player(sim.state).cargo.food).toBeUndefined();
    expect(sim.events().at(-1)!.payload.quantity).toBe(40);
    // A round trip in one port always loses the spread.
    expect(sim.state.captain!.gold).toBeLessThan(gold0);
  });

  it('keeps what the hold cost: buys add to it, sales take out the average cost', () => {
    const sim = moored(bridgetown, 3);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: bridgetown.id });
    sim.send({ type: 'Buy', shipId: 'player', good: 'sugar', quantity: 10 });
    sim.applyCommands();
    const spent = 1000 - sim.state.captain!.gold;
    expect(player(sim.state).paid!.sugar).toBe(spent);
    sim.send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 4 });
    sim.applyCommands();
    expect(player(sim.state).paid!.sugar).toBe(Math.round(spent * 0.6));
    sim.send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 6 });
    sim.applyCommands();
    expect(player(sim.state).paid?.sugar).toBeUndefined();
  });

  it('knows what every port exports and wants, from its profiles', () => {
    expect(portTrade(content, bridgetown).exports).toEqual(['sugar']);
    expect(portTrade(content, bridgetown).wants).toEqual(expect.arrayContaining(['food', 'luxuries', 'cotton']));
    expect(tradeLean(content, portRoyal, 'sugar')).toBe('wants');
    expect(tradeLean(content, bridgetown, 'silver')).toBeUndefined();
  });

  it('never overfills the hold or overspends', () => {
    const sim = moored();
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.send({ type: 'Buy', shipId: 'player', good: 'food', quantity: 10_000 });
    sim.applyCommands();
    const cap = content.ships['ship.brig']!.cargo;
    expect(cargoUsed(player(sim.state))).toBeLessThanOrEqual(cap);
    sim.send({ type: 'Buy', shipId: 'player', good: 'silver', quantity: 10_000 });
    sim.applyCommands();
    expect(sim.state.captain!.gold).toBeGreaterThanOrEqual(0);
    expect(cargoUsed(player(sim.state))).toBeLessThanOrEqual(cap);
  });

  it('makes money on a real route: sugar from Bridgetown sells dearer in Port Royal', () => {
    const sim = moored(bridgetown, 3);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: bridgetown.id });
    sim.send({ type: 'Buy', shipId: 'player', good: 'sugar', quantity: 20 });
    sim.applyCommands();
    const spent = 1000 - sim.state.captain!.gold;
    // Sail across (teleport for the test) and sell.
    const ship = player(sim.state);
    const there = { ...sim.state, ships: { player: { ...ship, docked: undefined, x: portRoyal.x + 1, y: portRoyal.y + 1 } } };
    const sim2 = createSim(there, [createEconomySystem(content, settlements)]);
    sim2.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim2.send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 20 });
    sim2.applyCommands();
    const earned = sim2.events().at(-1)!.payload.gold as number;
    expect(earned).toBeGreaterThan(spent);
  });
});

describe('weekly markets', () => {
  it('turns once a week: producers gain stock, everything stays within bounds, and it replays', () => {
    const run = () => {
      const sim = moored(portRoyal, 9);
      sim.step(7 * day * 4);
      return sim;
    };
    const a = run();
    expect(a.events().filter((e) => e.type === 'MarketsTurned')).toHaveLength(4);
    for (const s of settlements) {
      for (const g of content.goods) {
        const stock = a.state.markets![s.id]![g.id]!;
        expect(stock).toBeGreaterThanOrEqual(0);
        expect(stock).toBeLessThanOrEqual(normalStock(content, s, g.id) * content.economy.maxStock);
      }
    }
    expect(run().hash()).toBe(a.hash());
  });
});

describe('saves', () => {
  it('a saved career reads back through JSON and runs on exactly as if it never stopped', () => {
    const systems = () => [
      createWeatherSystem(content, def, map),
      createEconomySystem(content, settlements),
      createNavigationSystem(content, map, createWindField(content, def, map)),
    ];
    const world = createWorld(def);
    const start = { ...world, ships: { player: { ...world.ships.player!, x: bridgetown.x + 1, y: bridgetown.y + 1 } } };
    const sim = createSim(withEconomy(withWeather(start, content, def, 5), content, settlements, 5), systems());
    sim.send({ type: 'Dock', shipId: 'player', settlementId: bridgetown.id });
    sim.send({ type: 'Buy', shipId: 'player', good: 'sugar', quantity: 15 });
    sim.applyCommands();
    sim.send({ type: 'Undock', shipId: 'player' });
    // Past a weekly market turn, so weather, economy and their RNG streams have all moved.
    sim.step(day * 8);

    const fingerprint = contentFingerprint(content);
    const file = JSON.stringify(toSave(sim.state, 5, fingerprint, 0));
    const { save, contentMismatch } = fromSave(JSON.parse(file), fingerprint);
    expect(contentMismatch).toBe(false);
    const restored = createSim(save.state, systems());
    expect(restored.hash()).toBe(sim.hash());

    sim.step(day * 3);
    restored.step(day * 3);
    expect(restored.hash()).toBe(sim.hash());
    expect(restored.state.ships.player!.cargo.sugar).toBe(15);
  });

  it('fingerprints only gameplay content: new music or sprite framing keeps old saves clean', () => {
    const base = contentFingerprint(gameplayContent(content));
    expect(contentFingerprint(gameplayContent({ ...content, music: { ...content.music, tunes: [] } }))).toBe(base);
    expect(contentFingerprint(gameplayContent({ ...content, sprites: {} }))).toBe(base);
    const dearSugar = content.goods.map((g) => (g.id === 'sugar' ? { ...g, basePrice: g.basePrice + 1 } : g));
    expect(contentFingerprint(gameplayContent({ ...content, goods: dearSugar }))).not.toBe(base);
  });

  it('refuses what is not a save, and flags saves made with other content', () => {
    expect(() => fromSave({ hello: 1 }, 'x')).toThrow();
    expect(() => fromSave({ format: 99, seed: 1, state: {} }, 'x')).toThrow(/format/);
    const sim = moored();
    expect(fromSave(toSave(sim.state, 1, 'old', 0), 'new').contentMismatch).toBe(true);
  });
});
