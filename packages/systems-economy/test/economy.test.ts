import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contentFingerprint, createSim, fromSave, toSave } from '@corsair/core';
import type { WorldState } from '@corsair/core';
import { decodeRasterMap, gameplayContent, isLand, loadContent, placeSettlements, tileAt } from '@corsair/data';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { createWeatherSystem, createWindField, withWeather } from '@corsair/systems-weather';
import { describe, expect, it } from 'vitest';
import {
  cargoUsed,
  createEconomySystem,
  DOCK_RANGE,
  midPrice,
  newsArrives,
  newsAt,
  newsText,
  normalStock,
  portTrade,
  quote,
  seawardHeading,
  sellDepth,
  shockFactor,
  tradeLean,
  withEconomy,
} from '../src';

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
    // Bridgetown uses a little cotton (rate 0.3): too little to be known as a cotton market. Food is a
    // staple: needed, but never worth carrying for profit, so it is not tagged at all.
    expect(portTrade(content, bridgetown).wants).toEqual(['luxuries']);
    expect(tradeLean(content, portRoyal, 'food')).toBeUndefined();
    expect(tradeLean(content, portRoyal, 'sugar')).toBe('wants');
    expect(tradeLean(content, bridgetown, 'silver')).toBeUndefined();
  });

  it('leans stock by how much a port needs a good, so a light need barely raises the price', () => {
    const coro = town('town.coro'); // cattle coast: uses a little sugar (0.3)
    const light = midPrice(content, coro, 'sugar', normalStock(content, coro, 'sugar'));
    const strong = midPrice(content, portRoyal, 'sugar', normalStock(content, portRoyal, 'sugar'));
    const base = content.goods.find((g) => g.id === 'sugar')!.basePrice;
    expect(tradeLean(content, coro, 'sugar')).toBeUndefined();
    expect(light).toBeGreaterThan(base);
    expect(light - base).toBeLessThan(strong - base);
  });

  it('measures market depth: a small market takes fewer units before its price falls a quarter', () => {
    const haven = town('town.ile_a_vache');
    const deep = sellDepth(content, portRoyal, 'tobacco', normalStock(content, portRoyal, 'tobacco'));
    const shallow = sellDepth(content, haven, 'tobacco', normalStock(content, haven, 'tobacco'));
    expect(shallow).toBeLessThan(deep);
    expect(shallow).toBeGreaterThan(0);
    // Selling exactly that many leaves the price at or above three quarters of where it started.
    const stock = normalStock(content, haven, 'tobacco');
    expect(quote(content, haven, 'tobacco', stock + shallow).sell).toBeGreaterThanOrEqual(quote(content, haven, 'tobacco', stock).sell * 0.75);
  });

  it('remembers the depth of each market with its prices', () => {
    const sim = moored(portRoyal);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();
    const seen = sim.state.captain!.knownPrices[portRoyal.id]!.prices.tobacco!;
    expect(seen.depth).toBe(sellDepth(content, portRoyal, 'tobacco', sim.state.markets![portRoyal.id]!.tobacco!));
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

describe('market shocks and news', () => {
  const sugarAt = (state: WorldState, s = bridgetown) => quote(content, s, 'sugar', state.markets![s.id]!.sugar!);

  it('a blight makes a good dear at once, holds for its weeks, then the market recovers', () => {
    const sim = moored(bridgetown, 4);
    const before = sugarAt(sim.state).buy;
    sim.send({ type: 'SpawnShock', settlementId: bridgetown.id, good: 'sugar', kind: 'blight' });
    sim.applyCommands();
    const shock = sim.state.shocks![0]!;
    expect(sim.events().at(-1)!.type).toBe('MarketShock');
    const jolted = sugarAt(sim.state).buy;
    expect(jolted).toBeGreaterThan(before * 1.3);
    // Weekly turns while it lasts keep pulling toward the blighted stock, so it gets dearer still.
    sim.step(shock.endTick - sim.state.tick - 1);
    expect(sugarAt(sim.state).buy).toBeGreaterThan(jolted);
    expect(shockFactor(content, sim.state, bridgetown.id, 'sugar')).toBeLessThan(1);
    // Once it ends, a few weeks bring the price back toward normal.
    sim.step(7 * day * 8);
    expect(sim.state.shocks!.some((x) => x.id === shock.id)).toBe(false);
    expect(sugarAt(sim.state).buy).toBeLessThan(before * 1.15);
  });

  it("a storm's eye over a town wrecks its exports, once per storm", () => {
    const world = withEconomy(createWorld(def), content, settlements, 2);
    const storm = { id: 'storm.t', x: bridgetown.x, y: bridgetown.y, radius: 6, headingDeg: 0, speed: 0, endDay: 99 };
    const weather = { zones: {}, storms: [storm], nextStormId: 1 } as unknown as WorldState['weather'];
    const sim = createSim({ ...world, weather }, [createEconomySystem(content, settlements)]);
    sim.step(60);
    const shocks = sim.events().filter((x) => x.type === 'MarketShock');
    expect(shocks).toHaveLength(1);
    expect(shocks[0]!.payload).toMatchObject({ kind: 'storm', good: 'sugar' });
  });

  it('news is known at once where it happened, reaches far ports later, and is heard in the tavern', () => {
    const sim = moored(portRoyal, 4);
    sim.send({ type: 'SpawnShock', settlementId: bridgetown.id, good: 'sugar', kind: 'blight' });
    sim.applyCommands();
    const item = sim.state.news![0]!;
    expect(newsAt(content, sim.state, settlements, bridgetown.id)).toHaveLength(1);
    expect(newsAt(content, sim.state, settlements, portRoyal.id)).toHaveLength(0);
    const arrives = newsArrives(content, item, bridgetown, portRoyal);
    // About 740 tiles at 80 a day, plus the item's own delay.
    expect((arrives - item.tick) / day).toBeGreaterThan(9);
    sim.step(arrives - sim.state.tick - 1);
    expect(newsAt(content, sim.state, settlements, portRoyal.id)).toHaveLength(0);
    sim.step(1);
    expect(newsAt(content, sim.state, settlements, portRoyal.id)).toHaveLength(1);
    expect(newsText(content, item, 'Bridgetown')).toBe('Blight has struck the sugar at Bridgetown. It is scarce and dear.');

    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.send({ type: 'HearNews', shipId: 'player' });
    sim.applyCommands();
    expect(sim.state.captain!.heard).toEqual([item.id]);
    // Hearing again adds nothing.
    sim.send({ type: 'HearNews', shipId: 'player' });
    sim.applyCommands();
    expect(sim.state.captain!.heard).toEqual([item.id]);
  });

  it('a year of shocks comes and goes within bounds, and replays exactly', () => {
    const run = () => {
      const sim = moored(portRoyal, 11);
      sim.step(day * 7 * 52);
      return sim;
    };
    const a = run();
    const started = a.events().filter((x) => x.type === 'MarketShock');
    // About 0.6 a week.
    expect(started.length).toBeGreaterThan(15);
    expect(started.length).toBeLessThan(50);
    for (const s of settlements) {
      for (const g of content.goods) {
        expect(a.state.markets![s.id]![g.id]!).toBeLessThanOrEqual(normalStock(content, s, g.id) * content.economy.maxStock);
      }
    }
    // Old news is forgotten after ten weeks.
    for (const n of a.state.news!) expect(a.state.tick - n.tick).toBeLessThanOrEqual(content.economy.news.keepWeeks * 7 * day);
    expect(run().hash()).toBe(a.hash());
  });
});

describe('leaving port', () => {
  it('casts off along the clearest way out of every port', () => {
    const ahead = (x: number, y: number, deg: number, n: number) => {
      const rad = (deg * Math.PI) / 180;
      for (let i = 1; i <= n; i++) if (isLand(tileAt(map, x + Math.sin(rad) * i, y - Math.cos(rad) * i))) return i - 1;
      return n;
    };
    const stuck: string[] = [];
    for (const s of settlements) {
      // The nearest water tile within docking range is where a ship would lie.
      let spot: { x: number; y: number } | undefined;
      for (let r = 1; r <= DOCK_RANGE && !spot; r++) {
        for (let dy = -r; dy <= r && !spot; dy++) {
          for (let dx = -r; dx <= r && !spot; dx++) {
            if (!isLand(tileAt(map, s.x + dx, s.y + dy))) spot = { x: s.x + dx, y: s.y + dy };
          }
        }
      }
      if (!spot) continue;
      // Pointing at the town (into the quay) is the worst case to cast off from.
      const intoTown = (Math.atan2(s.x - spot.x, -(s.y - spot.y)) * 180) / Math.PI;
      const deg = seawardHeading(map, spot, s, intoTown);
      // Some ports sit in tight inlets (Puerto Príncipe, Villahermosa): there, the clearest way out will do.
      const most = Math.max(...Array.from({ length: 32 }, (_, i) => ahead(spot!.x, spot!.y, i * 11.25, 12)));
      const clear = ahead(spot.x, spot.y, deg, 12);
      if (clear < Math.min(5, most)) stuck.push(`${s.name} ${deg}°: ${clear} clear, best ${most}`);
    }
    expect(stuck).toEqual([]);
  });

  it('turns the ship seaward on Undock', () => {
    const w = createWorld(def);
    const at = { x: portRoyal.x + 1, y: portRoyal.y + 2 };
    const sim = createSim(withEconomy({ ...w, ships: { player: { ...w.ships.player!, ...at, headingDeg: 0 } } }, content, settlements, 1), [
      createEconomySystem(content, settlements, map),
    ]);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.send({ type: 'Undock', shipId: 'player' });
    sim.applyCommands();
    expect(player(sim.state).docked).toBeUndefined();
    expect(player(sim.state).headingDeg).toBe(seawardHeading(map, at, portRoyal, 0));
    expect(player(sim.state).headingDeg).not.toBe(0);
  });
});

describe('the shipwright, the tavern and a hostile port', () => {
  it('recruits men up to the berths, repairs as far as the purse reaches, and an enemy nation shuts its port', () => {
    const sim = moored(portRoyal);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();
    const cls = content.ships['ship.brig']!;
    sim.send({ type: 'Recruit', shipId: 'player', count: 1000 });
    sim.applyCommands();
    expect(player(sim.state).crew).toBe(cls.maxCrew);
    const afterRecruit = sim.state.captain!.gold;

    const hurt = { ...sim.state, ships: { player: { ...player(sim.state), hull: cls.hull - 20, sailCondition: 50 } } };
    const yard = createSim(hurt, [createEconomySystem(content, settlements)]);
    yard.send({ type: 'Repair', shipId: 'player' });
    yard.applyCommands();
    expect(player(yard.state).hull).toBe(cls.hull);
    expect(player(yard.state).sailCondition).toBe(100);
    expect(afterRecruit - yard.state.captain!.gold).toBe(20 * content.combat.port.hullGold + 50 * content.combat.port.sailGold);

    const w = createWorld(def);
    const enemyOfEngland = withEconomy({ ...w, ships: { player: { ...w.ships.player!, x: portRoyal.x + 1, y: portRoyal.y + 1 } } }, content, settlements, 1);
    const shut = createSim({ ...enemyOfEngland, captain: { ...enemyOfEngland.captain!, standing: { england: -60 } } }, [createEconomySystem(content, settlements)]);
    shut.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    shut.applyCommands();
    expect(player(shut.state).docked).toBeUndefined();
    expect(shut.events().at(-1)!.payload.reason).toBe('hostile');
  });
});

describe('the governor', () => {
  const atWarWithSpain = (state: WorldState): WorldState => ({
    ...state,
    politics: { relations: { ...structuredClone(content.politics.start), 'england:spain': { war: true, tension: 85 } }, piracy: { england: 50 }, month: 0 },
  });

  it('sells a letter of marque at war, cheaper with standing, and refuses it at peace', () => {
    const sim = moored(portRoyal);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.send({ type: 'BuyMarque', shipId: 'player' });
    sim.applyCommands();
    expect(sim.events().at(-1)!.payload.reason).toBe('at-peace');

    const war = createSim({ ...atWarWithSpain(sim.state), captain: { ...sim.state.captain!, gold: 5000, standing: { england: 15 } } }, [
      createEconomySystem(content, settlements),
    ]);
    war.send({ type: 'BuyMarque', shipId: 'player' });
    war.applyCommands();
    expect(war.state.captain!.marques).toEqual(['england']);
    expect(5000 - war.state.captain!.gold).toBe(Math.round(content.politics.marque.price * (1 - 15 / content.politics.marque.freeAt)));
  });

  it('pays bounties for pirates (more under pirate pressure) and for enemies of the crown, once', () => {
    const sim = moored(portRoyal);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();
    const deeds = [
      { nation: 'pirate' as const, role: 'pirate' as const, kind: 'sunk' as const, tick: sim.state.tick },
      { nation: 'spain' as const, role: 'merchant' as const, kind: 'taken' as const, tick: sim.state.tick },
      { nation: 'france' as const, role: 'merchant' as const, kind: 'taken' as const, tick: sim.state.tick },
    ];
    const s = atWarWithSpain({ ...sim.state, captain: { ...sim.state.captain!, deeds } });
    const gov = createSim(s, [createEconomySystem(content, settlements)]);
    const gold = gov.state.captain!.gold;
    gov.send({ type: 'CollectBounties', shipId: 'player' });
    gov.applyCommands();
    const b = content.politics.bounty;
    expect(gov.state.captain!.gold - gold).toBe(Math.round(b.pirate * (1 + 50 / b.piracyScale)) + b.merchant);
    // France is at peace with England: that deed waits for a governor who will pay it.
    expect(gov.state.captain!.deeds).toEqual([deeds[2]]);
    gov.send({ type: 'CollectBounties', shipId: 'player' });
    gov.applyCommands();
    expect(gov.events().at(-1)!.payload.reason).toBe('nothing-owed');
  });
});
