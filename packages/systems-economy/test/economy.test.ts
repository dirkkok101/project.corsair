import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contentFingerprint, createSim, fromSave, toSave } from '@corsair/core';
import type { WorldState } from '@corsair/core';
import { decodeRasterMap, gameplayContent, isLand, loadContent, placeSettlements, shipStats, tileAt, upgradePrice } from '@corsair/data';
import { angleOffWind, createNavigationSystem, createWorld, polarAt } from '@corsair/systems-navigation';
import { createWeatherSystem, createWindField, withWeather } from '@corsair/systems-weather';
import { describe, expect, it } from 'vitest';
import {
  cargoUsed,
  createEconomySystem,
  DOCK_RANGE,
  fleetBerths,
  fleetHold,
  foodDays,
  hoardRing,
  midPrice,
  moraleOf,
  newsArrives,
  newsAt,
  newsText,
  normalStock,
  placeHoard,
  portTrade,
  priceStory,
  quote,
  repairCost,
  shipRepairCost,
  seawardHeading,
  sellDepth,
  shipValue,
  shipsForSale,
  careerScore,
  famesOf,
  landOf,
  perkPrice,
  rankOf,
  tradeEdge,
  shockFactor,
  stockCap,
  strangerOffer,
  usualStock,
  tradeLean,
  tradePreview,
  withEconomy,
  withFleetPace,
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
  // An empty hold (a new career sails with food aboard), so trades here start from nothing.
  const state = withEconomy({ ...world, ships: { player: ship } }, content, settlements, seed);
  return createSim({ ...state, ships: { player: { ...state.ships.player!, cargo: {} } } }, [createEconomySystem(content, settlements)]);
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
    // Bridgetown grows sugar and distils some of it into rum.
    expect(portTrade(content, bridgetown).exports).toEqual(['sugar', 'rum']);
    // Bridgetown uses a little cotton (rate 0.3): too little to be known as a cotton market. Food is a
    // staple: needed, but never worth carrying for profit, so it is not tagged at all.
    expect(portTrade(content, bridgetown).wants).toEqual(['cloth', 'luxuries']);
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
  it('lives day by day and turns once a week: everything stays within bounds, and it replays', () => {
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
        expect(stock).toBeLessThanOrEqual(stockCap(content, a.state, s, g.id));
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
        expect(a.state.markets![s.id]![g.id]!).toBeLessThanOrEqual(stockCap(content, a.state, s, g.id));
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

  it('never casts off into irons: with the wind blowing in from the sea she takes the nearest sailable way out', () => {
    const w = createWorld(def);
    const at = { x: portRoyal.x + 1, y: portRoyal.y + 2 };
    const seaward = seawardHeading(map, at, portRoyal, 0);
    // The wind blows straight in from seaward: dead ahead on the plain seaward heading.
    const wind = { fromDeg: seaward, strength: 'fresh' as const };
    const sim = createSim(withEconomy({ ...w, ships: { player: { ...w.ships.player!, ...at, headingDeg: 0 } } }, content, settlements, 1), [
      createEconomySystem(content, settlements, map, () => wind),
    ]);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.send({ type: 'Undock', shipId: 'player' });
    sim.applyCommands();
    const heading = player(sim.state).headingDeg;
    const polar = content.polars[content.ships['ship.brig']!.polar]!;
    expect(polarAt(polar, angleOffWind(heading, wind.fromDeg))).toBeGreaterThanOrEqual(0.5);
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

describe('provisions from a ship at sea', () => {
  const at = (nation: string, extra: { standing?: Record<string, number>; gold?: number } = {}) => {
    const sim = moored(portRoyal);
    const me = player(sim.state);
    const other = { ...me, id: 'ship.9', ai: { nation, role: 'merchant', name: 'Hope', from: 'a', to: 'b', route: [], along: 0, offset: 0, tackSign: 1, news: [] } } as unknown as WorldState['ships'][string];
    return createSim(
      { ...sim.state, ships: { player: me, 'ship.9': { ...other, x: me.x + 1 } }, captain: { ...sim.state.captain!, gold: extra.gold ?? 1000, standing: extra.standing } },
      [createEconomySystem(content, settlements)],
    );
  };
  const sp = content.economy.seaProvisions;
  const price = Math.ceil(content.goods.find((g) => g.id === 'food')!.basePrice * sp.markup);

  it('a passing merchant sells food from her spare stores, dear, and only so much', () => {
    const sim = at('england');
    sim.send({ type: 'BuyProvisions', shipId: 'player', targetId: 'ship.9', units: 1000 });
    sim.applyCommands();
    expect(player(sim.state).cargo.food).toBe(sp.spare);
    expect(sim.state.captain!.gold).toBe(1000 - sp.spare * price);
    sim.send({ type: 'BuyProvisions', shipId: 'player', targetId: 'ship.9', units: 5 });
    sim.applyCommands();
    expect(sim.events().at(-1)!.payload.reason).toBe('none-to-spare');
  });

  it('pirates, and ships of a nation that hunts the captain, will not sell; the purse limits the rest', () => {
    for (const sim of [at('pirate'), at('spain', { standing: { spain: -60 } })]) {
      sim.send({ type: 'BuyProvisions', shipId: 'player', targetId: 'ship.9', units: 5 });
      sim.applyCommands();
      expect(sim.events().at(-1)!.payload.reason).toBe('wont-sell');
    }
    const poor = at('england', { gold: price * 3 + 1 });
    poor.send({ type: 'BuyProvisions', shipId: 'player', targetId: 'ship.9', units: 20 });
    poor.applyCommands();
    expect(player(poor.state).cargo.food).toBe(3);
  });
});

describe('outfitting at the shipwright', () => {
  const docked = (at = portRoyal, gold?: number) => {
    const sim = moored(at);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: at.id });
    sim.applyCommands();
    if (gold === undefined) return sim;
    return createSim({ ...sim.state, captain: { ...sim.state.captain!, gold } }, [createEconomySystem(content, settlements)]);
  };
  const reason = (sim: ReturnType<typeof docked>) => sim.events().at(-1)!.payload.reason;
  const p = content.combat.port;

  it('a new career starts under-gunned; cannon are mounted up to the gun deck and sold back at half', () => {
    const sim = docked(portRoyal, 5000);
    const max = content.ships['ship.brig']!.guns;
    expect(shipStats(content, player(sim.state)).guns).toBe(def.start.guns);
    sim.send({ type: 'BuyGuns', shipId: 'player', count: 100 });
    sim.applyCommands();
    expect(player(sim.state).guns).toBe(max);
    expect(sim.state.captain!.gold).toBe(5000 - (max - def.start.guns!) * p.gunGold);
    sim.send({ type: 'BuyGuns', shipId: 'player', count: 1 });
    sim.applyCommands();
    expect(reason(sim)).toBe('battery-full');
    const before = sim.state.captain!.gold;
    sim.send({ type: 'SellGuns', shipId: 'player', count: 2 });
    sim.applyCommands();
    expect(player(sim.state).guns).toBe(max - 2);
    expect(sim.state.captain!.gold).toBe(before + 2 * p.gunSellGold);
  });

  it('buys only what the purse covers, and a hamlet sells no cannon', () => {
    const poor = docked(portRoyal, p.gunGold * 3 + 10);
    poor.send({ type: 'BuyGuns', shipId: 'player', count: 8 });
    poor.applyCommands();
    expect(player(poor.state).guns).toBe(def.start.guns! + 3);
    const hamlet = settlements.find((s) => s.size === 'hamlet' && s.nation !== 'pirate')!;
    const small = docked(hamlet, 5000);
    small.send({ type: 'BuyGuns', shipId: 'player', count: 1 });
    small.applyCommands();
    expect(reason(small)).toBe('not-sold-here');
  });

  it('upgrades are sold by town size, installed once, and raise what repairs and recruiting reach', () => {
    const sim = docked(portRoyal, 10_000);
    for (const id of ['scantlings', 'hammocks']) sim.send({ type: 'BuyUpgrade', shipId: 'player', upgradeId: id });
    sim.applyCommands();
    expect(player(sim.state).upgrades).toEqual(['scantlings', 'hammocks']);
    expect(sim.state.captain!.gold).toBe(10_000 - content.upgrades.scantlings!.price - content.upgrades.hammocks!.price);
    sim.send({ type: 'BuyUpgrade', shipId: 'player', upgradeId: 'hammocks' });
    sim.applyCommands();
    expect(reason(sim)).toBe('installed');
    const stats = shipStats(content, player(sim.state));
    const cls = content.ships['ship.brig']!;
    expect(stats.hullMax).toBe(Math.round(cls.hull * 1.2));
    expect(stats.maxCrew).toBe(Math.round(cls.maxCrew * 1.25));
    // At her old full hull, the new planking is there to be made good.
    const yard = createSim({ ...sim.state, ships: { player: { ...player(sim.state), hull: cls.hull } } }, [createEconomySystem(content, settlements)]);
    yard.send({ type: 'Recruit', shipId: 'player', count: 1000 });
    yard.send({ type: 'Repair', shipId: 'player' });
    yard.applyCommands();
    expect(player(yard.state).crew).toBe(stats.maxCrew);
    expect(player(yard.state).hull).toBe(stats.hullMax);
    // Copper sheathing is a city's trade: a town's shipwright doesn't sell it.
    const town = settlements.find((s) => s.size === 'town' && s.nation !== 'pirate')!;
    const small = docked(town, 10_000);
    small.send({ type: 'BuyUpgrade', shipId: 'player', upgradeId: 'copper' });
    small.applyCommands();
    expect(reason(small)).toBe('not-sold-here');
  });

  it("a sale's trade profit goes on the career's record: the gold for her own goods over what they cost", () => {
    const sim = docked(portRoyal, 5000);
    sim.send({ type: 'Buy', shipId: 'player', good: 'luxuries', quantity: 6 });
    sim.applyCommands();
    const afterBuy = sim.state.captain!.gold;
    sim.send({ type: 'Sell', shipId: 'player', good: 'luxuries', quantity: 6 });
    sim.applyCommands();
    // Sold back where she bought: the merchant's spread, a loss, and the record says so.
    expect(sim.state.captain!.record!.tradeProfit).toBe(sim.state.captain!.gold - 5000);
    expect(sim.state.captain!.gold).toBeLessThan(5000);
    expect(afterBuy).toBeLessThan(5000);
  });

  it('fouling grows by the day unless copper-sheathed; a shipwright careens her for gold, a beach for her time', () => {
    const f = content.economy.fouling;
    const sim = docked(portRoyal, 5000);
    sim.step(day * 10);
    expect(player(sim.state).fouling).toBeCloseTo(f.perDay * 10);
    // Copper keeps her clean.
    const coppered = createSim({ ...sim.state, ships: { player: { ...player(sim.state), fouling: 0, upgrades: ['copper'] } } }, [createEconomySystem(content, settlements, map)]);
    coppered.step(day * 10);
    expect(player(coppered.state).fouling ?? 0).toBe(0);
    // At the yard: gold by her hull, and clean.
    const gold = sim.state.captain!.gold;
    sim.send({ type: 'Careen', shipId: 'player' });
    sim.applyCommands();
    expect(player(sim.state).fouling).toBe(0);
    expect(sim.state.captain!.gold).toBe(gold - Math.ceil(content.ships['ship.brig']!.hull * f.careenGoldPerHull));
    // On a beach: off the shore, free; out at sea, no beach to heave down on.
    const shore = { ...portRoyal, x: portRoyal.x, y: portRoyal.y };
    const nearLand = createSim({ ...sim.state, ships: { player: { ...player(sim.state), docked: undefined, fouling: 0.1, x: shore.x + 1, y: shore.y + 1 } } }, [createEconomySystem(content, settlements, map)]);
    nearLand.send({ type: 'Careen', shipId: 'player', beach: true });
    nearLand.applyCommands();
    expect(player(nearLand.state).fouling).toBe(0);
    expect(nearLand.state.captain!.gold).toBe(sim.state.captain!.gold);
    const openSea = createSim({ ...sim.state, ships: { player: { ...player(sim.state), docked: undefined, fouling: 0.1, x: 880, y: 700 } } }, [createEconomySystem(content, settlements, map)]);
    openSea.send({ type: 'Careen', shipId: 'player', beach: true });
    openSea.applyCommands();
    expect(reason(openSea)).toBe('no-beach');
  });

  it('fine-grain powder spends itself after its days; bought again it keeps as long again', () => {
    const sim = docked(portRoyal, 5000);
    sim.send({ type: 'BuyUpgrade', shipId: 'player', upgradeId: 'powder' });
    sim.applyCommands();
    expect(player(sim.state).upgrades).toContain('powder');
    sim.step(day * (content.upgrades.powder!.modifiers.spoilsDays! + 1));
    expect(player(sim.state).upgrades ?? []).not.toContain('powder');
    expect(sim.events().some((e) => e.type === 'PowderSpoiled')).toBe(true);
  });

  it("a fitted ship is worth more: half her fits' price on top of her hull's", () => {
    const bare = shipValue(content, { classId: 'ship.brig', hull: 85, sailCondition: 100 });
    const fitted = shipValue(content, { classId: 'ship.brig', hull: 85, sailCondition: 100, upgrades: ['copper'] });
    expect(fitted - bare).toBe(Math.round(upgradePrice(content, 'ship.brig', 'copper').price / 2));
  });

  it('upgrades are priced by the work on her class: the brig pays the list price, a sloop less, a ship of the line more', () => {
    // The brig (the list's own class) pays exactly the listed prices.
    for (const u of Object.values(content.upgrades)) expect(upgradePrice(content, 'ship.brig', u.id).price).toBe(u.price);
    const stat = { gun: 'guns', hull: 'hull', berth: 'maxCrew' } as const;
    for (const u of Object.values(content.upgrades)) {
      // More guns, hull or berths: never cheaper.
      const classes = Object.values(content.ships).sort((a, b) => a[stat[u.per]] - b[stat[u.per]]);
      const prices = classes.map((c) => upgradePrice(content, c.id, u.id).price);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    }
    expect(upgradePrice(content, 'ship.sloop', 'bronze_cannon').price).toBeLessThan(content.upgrades.bronze_cannon!.price / 2);
    expect(upgradePrice(content, 'ship.ship_of_the_line', 'bronze_cannon').price).toBeGreaterThan(content.upgrades.bronze_cannon!.price * 2);
    // The shipwright charges her class's price.
    const sim = docked(portRoyal, 10_000);
    const sloop = createSim({ ...sim.state, ships: { player: { ...player(sim.state), classId: 'ship.sloop', guns: 8 } } }, [createEconomySystem(content, settlements)]);
    sloop.send({ type: 'BuyUpgrade', shipId: 'player', upgradeId: 'bronze_cannon' });
    sloop.applyCommands();
    expect(sloop.state.captain!.gold).toBe(10_000 - upgradePrice(content, 'ship.sloop', 'bronze_cannon').price);
  });
});

describe('the governor', () => {
  const atWarWithSpain = (state: WorldState): WorldState => ({
    ...state,
    politics: { relations: { ...structuredClone(content.politics.start), 'england:spain': { war: true, tension: 85 } }, piracy: { england: 50 }, month: 0 },
  });

  it('sells a letter of marque at war, cheaper with standing, and refuses it at peace', () => {
    // The Dutch open at peace with every nation: their governor has no letters to sell.
    const willemstad = town('town.willemstad');
    const dutch = moored(willemstad);
    dutch.send({ type: 'Dock', shipId: 'player', settlementId: willemstad.id });
    dutch.send({ type: 'BuyMarque', shipId: 'player' });
    dutch.applyCommands();
    expect(dutch.events().at(-1)!.payload.reason).toBe('at-peace');

    const sim = moored(portRoyal);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();

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
    const chest = gov.state.captain!.chest ?? 0;
    gov.send({ type: 'CollectBounties', shipId: 'player' });
    gov.applyCommands();
    const b = content.politics.bounty;
    // Bounties are plunder: they go into the crew's chest.
    expect(gov.state.captain!.chest! - chest).toBe(Math.round(b.pirate * (1 + 50 / b.piracyScale)) + b.merchant);
    // France is at peace with England: that deed waits for a governor who will pay it.
    expect(gov.state.captain!.deeds).toEqual([deeds[2]]);
    gov.send({ type: 'CollectBounties', shipId: 'player' });
    gov.applyCommands();
    expect(gov.events().at(-1)!.payload.reason).toBe('nothing-owed');
  });

  it('bounties are merit: with the letter they raise his rank, a promotion said, and its perks follow at that nation\'s ports', () => {
    const sim = moored(portRoyal);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();
    const ladder = content.politics.ranks.ladder;
    const pirate = { nation: 'pirate' as const, role: 'pirate' as const, kind: 'sunk' as const, tick: sim.state.tick };
    // Five merit already, the letter held: one more pirate makes him a captain.
    const s = { ...sim.state, captain: { ...sim.state.captain!, marques: ['england' as const], merit: { england: 5 }, deeds: [pirate] } };
    const gov = createSim(s, [createEconomySystem(content, settlements)]);
    expect(rankOf(content, gov.state.captain, 'england')).toBe(0);
    gov.send({ type: 'CollectBounties', shipId: 'player' });
    gov.applyCommands();
    expect(gov.state.captain!.merit!.england).toBe(6);
    expect(rankOf(content, gov.state.captain, 'england')).toBe(1);
    expect(gov.events().find((e) => e.type === 'Promoted')!.payload).toMatchObject({ nation: 'england', rank: ladder[1]!.name });
    // Without the letter, merit counts but makes no rank.
    expect(rankOf(content, { ...gov.state.captain!, marques: [] }, 'england')).toBe(-1);
    // A captain's men sign on cheaper at English ports, and nowhere else.
    expect(perkPrice(content, gov.state.captain, 'england', 'recruit')).toBe(content.politics.ranks.perks.recruit!.value);
    expect(perkPrice(content, gov.state.captain, 'spain', 'recruit')).toBe(1);
    const gold = gov.state.captain!.gold;
    gov.send({ type: 'Recruit', shipId: 'player', count: 10 });
    gov.applyCommands();
    expect(gold - gov.state.captain!.gold).toBe(Math.round(10 * content.combat.port.recruitGold * content.politics.ranks.perks.recruit!.value!));
  });

  it('a colonel trades better, a title brings land that pays rent each month', () => {
    const ladder = content.politics.ranks.ladder;
    const colonel = ladder.findIndex((l) => l.id === 'colonel');
    const captain = { gold: 0, knownPrices: {}, marques: ['england' as const], merit: { england: ladder[colonel]!.merit } };
    const edge = tradeEdge(content, captain, 'england');
    expect(edge).toBe(content.politics.ranks.perks.price!.value);
    const town = settlements.find((s) => s.id === 'town.port_royal')!;
    const plain = quote(content, town, 'sugar', 40);
    const better = quote(content, town, 'sugar', 40, edge);
    expect(better.buy).toBeLessThan(plain.buy);
    expect(better.sell).toBeGreaterThan(plain.sell);
    expect(better.buy).toBeGreaterThan(better.sell);
    // A baron's land, and more for each merit past the title.
    const baron = ladder.findIndex((l) => l.id === 'baron');
    const titled = { ...captain, merit: { england: ladder[baron]!.merit + 4 } };
    expect(landOf(content, captain, 'england')).toBe(0);
    expect(landOf(content, titled, 'england')).toBe(ladder[baron]!.acres! + 4 * content.politics.ranks.acresPerMerit);
    const sim = moored();
    const landed = createSim({ ...sim.state, captain: { ...sim.state.captain!, ...titled, gold: 0 } }, [createEconomySystem(content, settlements)]);
    landed.step(content.calendar.ticksPerDay * 31);
    const rent = landed.events().filter((e) => e.type === 'RentPaid');
    expect(rent.length).toBe(1);
    expect(rent[0]!.payload.gold).toBe(Math.round(landOf(content, titled, 'england') * content.politics.ranks.rentPerAcre));
  });

  it('retiring in port scores the career: fames, wealth, land and rank, times the difficulty', () => {
    const sim = moored(portRoyal);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();
    const f = content.politics.career.fame;
    const record = { tradeProfit: 5 * f.trade.goldPer, prizes: 2, beaten: { 'ship.sloop': 3 }, famousBeaten: 1 };
    const s = { ...sim.state, difficulty: 'rogue', captain: { ...sim.state.captain!, gold: 12_000, chest: 0, record, marques: ['england' as const] } };
    expect(famesOf(content, s)).toEqual({ trade: 5, war: 2 * f.war.prize + 3 * f.war.pirate + f.war.famous, adventure: 0 });
    const score = careerScore(content, s);
    const base = 5 + 2 * f.war.prize + 3 * f.war.pirate + f.war.famous + 12 + content.politics.career.score.rank[0]!;
    expect(score.total).toBe(Math.round(base * 1.25));
    const end = createSim(s, [createEconomySystem(content, settlements)]);
    end.send({ type: 'Retire', shipId: 'player' });
    end.applyCommands();
    expect(end.state.captain!.retired).toEqual({ tick: end.state.tick, score: score.total, fate: score.fate });
  });

  it('a famous pirate handed over in irons: any governor pays the price on his head, and the jail keeps him a while', () => {
    const sim = moored(portRoyal);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();
    const r = content.pirates.rules;
    const deeds = [{ nation: 'pirate' as const, role: 'pirate' as const, kind: 'taken' as const, tick: sim.state.tick, captive: 'morgan' }];
    const s = { ...sim.state, captain: { ...sim.state.captain!, deeds, standing: {} }, famous: { morgan: { wealth: 900, returnAt: sim.state.tick + 10 } } };
    const gov = createSim(s, [createEconomySystem(content, settlements)]);
    const chest = gov.state.captain!.chest ?? 0;
    gov.send({ type: 'CollectBounties', shipId: 'player' });
    gov.applyCommands();
    expect(gov.state.captain!.chest! - chest).toBe(r.bounty);
    expect(gov.state.captain!.standing!.england).toBe(r.bountyStanding);
    expect(gov.state.captain!.deeds).toEqual([]);
    expect(gov.state.famous!.morgan).toEqual({ wealth: 900, returnAt: gov.state.tick + Math.round(r.returnDays * content.calendar.ticksPerDay) });
    expect(gov.events().at(-1)!.payload).toMatchObject({ gold: r.bounty, captives: ['morgan'] });
  });
});

describe('treasure maps', () => {
  const week = content.economy.daysPerWeek * day;

  it("every famous pirate's hoard lies on a coast near his haunts, clear of the towns, inside every search ring", () => {
    const t = content.treasure;
    for (const c of content.pirates.captains) {
      const hoard = placeHoard(content, map, settlements, c.id, c.wealth, 1234)!;
      expect(hoard, c.id).toBeDefined();
      expect(placeHoard(content, map, settlements, c.id, c.wealth, 1234)).toEqual(hoard);
      expect(isLand(tileAt(map, hoard.x, hoard.y))).toBe(true);
      expect(isLand(tileAt(map, hoard.landing[0], hoard.landing[1]))).toBe(false);
      const haunt = settlements.find((s) => s.id === hoard.near)!;
      expect(c.haunts).toContain(haunt.id);
      expect(Math.hypot(haunt.x - hoard.x, haunt.y - hoard.y)).toBeLessThanOrEqual(t.placeTiles[1] + 1);
      for (const s of settlements) expect(Math.hypot(s.x - hoard.x, s.y - hoard.y)).toBeGreaterThanOrEqual(t.clearOfTownsTiles - 1);
      expect(hoard.value).toBe(Math.round(c.wealth * t.hoardShare));
      for (let pieces = 1; pieces <= content.pirates.rules.mapPieces; pieces++) {
        const ring = hoardRing(content, hoard, pieces);
        expect(ring.r).toBe(t.ringTiles[pieces - 1]! / 2);
        expect(Math.hypot(ring.x - hoard.x, ring.y - hoard.y)).toBeLessThanOrEqual(ring.r);
      }
    }
  });

  it("the tavern stranger: some weeks in a town, the same all week, never in a hamlet, never a whole map's", () => {
    const sim = moored(portRoyal);
    const at = (w: number) => strangerOffer(content, { ...sim.state, tick: w * week + 5 }, portRoyal, settlements);
    const weeks = Array.from({ length: 30 }, (_, w) => at(w));
    expect(weeks.filter(Boolean).length).toBeGreaterThan(3);
    expect(weeks.filter(Boolean).length).toBeLessThan(30);
    const w = weeks.findIndex(Boolean);
    expect(strangerOffer(content, { ...sim.state, tick: w * week + week - 1 }, portRoyal, settlements)).toEqual(weeks[w]);
    const hamlet = settlements.find((s) => s.size === 'hamlet')!;
    expect(Array.from({ length: 30 }, (_, i) => strangerOffer(content, { ...sim.state, tick: i * week }, hamlet, settlements)).some(Boolean)).toBe(false);
    const whole = Object.fromEntries(content.pirates.captains.map((c) => [c.id, content.pirates.rules.mapPieces]));
    expect(strangerOffer(content, { ...sim.state, tick: w * week, captain: { ...sim.state.captain!, mapPieces: whole } }, portRoyal, settlements)).toBeUndefined();
  });

  it('buying his piece: the gold goes, the first piece places the hoard, and he sells only once a week', () => {
    const moor = moored(portRoyal);
    let w = 0;
    while (!strangerOffer(content, { ...moor.state, tick: w * week }, portRoyal, settlements) && w < 60) w++;
    const docked = { ...moor.state, tick: w * week, ships: { player: { ...moor.state.ships.player!, docked: portRoyal.id } } };
    const offer = strangerOffer(content, docked, portRoyal, settlements)!;
    const sim = createSim(docked, [createEconomySystem(content, settlements, map)]);
    const gold = sim.state.captain!.gold;
    sim.send({ type: 'BuyMapPiece', shipId: 'player', pirateId: offer.pirateId });
    sim.applyCommands();
    expect(sim.events().at(-1)).toMatchObject({ type: 'MapPieceBought', payload: { pirateId: offer.pirateId, gold: offer.price, pieces: 1 } });
    expect(sim.state.captain!.gold).toBe(gold - offer.price);
    expect(sim.state.captain!.mapPieces).toEqual({ [offer.pirateId]: 1 });
    expect(sim.state.famous![offer.pirateId]!.hoard).toBeDefined();
    sim.send({ type: 'BuyMapPiece', shipId: 'player', pirateId: offer.pirateId });
    sim.applyCommands();
    expect(sim.events().at(-1)!.payload.reason).toBe('no-offer');
  });
});

describe('explaining prices', () => {
  it('previews a trade unit by unit, as Buy and Sell price it, and stops where the trade would', () => {
    const sim = moored();
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();
    const stock = sim.state.markets![portRoyal.id]!.sugar!;
    const preview = tradePreview(content, portRoyal, 'sugar', stock, 'Buy', 10, { gold: 100_000, room: 100, held: 0 });
    sim.send({ type: 'Buy', shipId: 'player', good: 'sugar', quantity: 10 });
    sim.applyCommands();
    const bought = sim.events().find((e) => e.type === 'Bought')!.payload;
    expect(preview).toMatchObject({ units: 10, total: bought.gold });
    expect(preview.after).toBe(quote(content, portRoyal, 'sugar', stock - 10).buy);
    // Room and gold stop it where the trade would stop.
    expect(tradePreview(content, portRoyal, 'sugar', stock, 'Buy', 10, { gold: 100_000, room: 3, held: 0 }).units).toBe(3);
    expect(tradePreview(content, portRoyal, 'sugar', stock, 'Sell', 50, { gold: 0, room: 0, held: 7 }).units).toBe(7);
  });

  it('says why a price is what it is: stock against the usual, and the news behind a shock', () => {
    const sim = moored();
    const usual = Math.round(normalStock(content, portRoyal, 'sugar'));
    const at = (sugar: number) => ({ ...sim.state, markets: { ...sim.state.markets, [portRoyal.id]: { ...sim.state.markets![portRoyal.id], sugar } } });
    expect(priceStory(content, at(usual * 0.3), portRoyal, 'sugar')).toMatchObject({ level: 'dear', usualStock: usual });
    expect(priceStory(content, at(usual * 3), portRoyal, 'sugar').level).toBe('cheap');
    const shocked = { ...at(usual * 0.3), shocks: [{ id: 's', kind: 'shortage', settlementId: portRoyal.id, good: 'sugar', startTick: 0, endTick: 1e9 }] };
    expect(priceStory(content, shocked, { ...portRoyal, name: 'Port Royal' }, 'sugar').news).toContain('Port Royal');
  });
});

describe('ports that live', () => {
  const at = (sim: ReturnType<typeof moored>, id: string, good: string) => sim.state.markets![id]![good]!;
  /** The economy alone (no merchants) from a world with every market at its usual stock. */
  const still = () => {
    const sim = moored();
    const markets = Object.fromEntries(settlements.map((s) => [s.id, Object.fromEntries(content.goods.map((g) => [g.id, usualStock(content, sim.state, s, g.id)]))]));
    return createSim({ ...sim.state, markets }, [createEconomySystem(content, settlements)]);
  };

  it('with no merchant calling, a port that needs a good runs below its usual stock, and one that makes it above', () => {
    const sim = still();
    sim.step(day * 60);
    // Port Royal needs sugar; Bridgetown grows it (and distils some of it, so its glut is smaller).
    expect(at(sim, portRoyal.id, 'sugar')).toBeLessThan(usualStock(content, sim.state, portRoyal, 'sugar') * 0.8);
    expect(at(sim, bridgetown.id, 'sugar')).toBeGreaterThan(usualStock(content, sim.state, bridgetown, 'sugar') * 1.1);
  });

  it('rum is distilled only from the sugar in store, and uses it up', () => {
    const run = (sugar: number) => {
      const sim = still();
      const markets = { ...sim.state.markets, [bridgetown.id]: { ...sim.state.markets![bridgetown.id], sugar, rum: 0 } };
      const live = createSim({ ...sim.state, markets }, [createEconomySystem(content, settlements)]);
      live.step(day);
      return live;
    };
    const dry = run(0);
    const full = run(500);
    expect(at(full, bridgetown.id, 'rum')).toBeGreaterThan(at(dry, bridgetown.id, 'rum'));
    expect(at(full, bridgetown.id, 'sugar')).toBeLessThan(500);
  });

  it("the merchant buys only what his purse covers, and it fills again day by day", () => {
    const sim = moored();
    const s = sim.state;
    const poor = createSim(
      { ...s, towns: { ...s.towns, [portRoyal.id]: { ...s.towns![portRoyal.id]!, cash: 200 } }, ships: { player: { ...player(s), cargo: { sugar: 60 } } } },
      [createEconomySystem(content, settlements)],
    );
    poor.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    poor.send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 60 });
    poor.applyCommands();
    const sold = poor.events().find((e) => e.type === 'Sold')!.payload;
    expect(sold.gold as number).toBeLessThanOrEqual(200);
    expect(player(poor.state).cargo.sugar).toBeGreaterThan(0);
    poor.send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 60 });
    poor.applyCommands();
    expect(poor.events().at(-1)!.payload.reason).toBe('merchant-out-of-gold');
    // A port is in no hurry while she lies there, but out at sea the days pass and his purse fills.
    poor.send({ type: 'Undock', shipId: 'player' });
    poor.applyCommands();
    poor.step(day * 5);
    expect(poor.state.towns![portRoyal.id]!.cash).toBeGreaterThan(200);
  });

  it('coasting craft make two towns on one island one market: the St Kitts gap closes', () => {
    const sim = moored();
    const live = createSim(sim.state, [createEconomySystem(content, settlements)]);
    const basseTerre = town('town.basse_terre_st_kitts');
    const oldRoad = town('town.old_road');
    const gap = () =>
      quote(content, oldRoad, 'luxuries', live.state.markets![oldRoad.id]!.luxuries!).sell - quote(content, basseTerre, 'luxuries', live.state.markets![basseTerre.id]!.luxuries!).buy;
    expect(gap()).toBeGreaterThan(30);
    live.step(day * 30);
    expect(gap()).toBeLessThan(5);
  });

  it('a port whose needs are met grows slowly; a starved one shrinks fast', () => {
    const sim = still();
    const s = sim.state;
    const fed = Object.fromEntries(content.goods.map((g) => [g.id, stockCap(content, s, portRoyal, g.id)]));
    const starved = Object.fromEntries(content.goods.map((g) => [g.id, 0]));
    const run = (market: Record<string, number>) => {
      const live = createSim({ ...s, markets: { ...s.markets, [portRoyal.id]: market } }, [createEconomySystem(content, settlements)]);
      live.step(day * 7);
      return live.state.towns![portRoyal.id]!;
    };
    const base = s.towns![portRoyal.id]!.people;
    const up = run(fed);
    const down = run(starved);
    expect(up).toMatchObject({ trend: 1 });
    expect(up.people).toBeGreaterThan(base);
    expect(down).toMatchObject({ trend: -1 });
    expect(base - down.people).toBeGreaterThan((up.people - base) * 3);
  });
});

describe('blockades', () => {
  it('an enemy warship lying off a port starves it of supply from the wider world', () => {
    const sim = moored();
    const live = (blockade: boolean) => {
      const s = sim.state;
      const warship = {
        id: 'ai.blockader',
        classId: 'ship.frigate',
        x: portRoyal.x + 3,
        y: portRoyal.y + 3,
        headingDeg: 0,
        speed: 0,
        helm: 0 as const,
        sails: 'furled' as const,
        blocked: false,
        cargo: {},
        ai: { nation: 'spain' as const, role: 'patrol' as const, name: 'San Felipe', from: 'town.havana', to: 'town.havana', route: [[0, 0], [1, 1]] as [number, number][], along: 0, offset: 0, tackSign: 1 as const, news: [], waitUntil: 1e9, blockadeOf: portRoyal.id },
      };
      const run = createSim(
        { ...s, ships: blockade ? { ...s.ships, [warship.id]: warship } : s.ships, markets: { ...s.markets, [portRoyal.id]: { ...s.markets![portRoyal.id], sugar: 0 } } },
        [createEconomySystem(content, settlements)],
      );
      run.step(day * 20);
      return run.state;
    };
    const open = live(false);
    const shut = live(true);
    expect(shut.towns![portRoyal.id]!.blockaded).toBe(true);
    expect(open.towns![portRoyal.id]!.blockaded).toBeUndefined();
    expect(shut.markets![portRoyal.id]!.sugar!).toBeLessThan(open.markets![portRoyal.id]!.sugar! * 0.6);
  });
});

describe('famine, plague and contracts', () => {
  const famished = () => {
    const sim = moored();
    sim.send({ type: 'SpawnShock', settlementId: portRoyal.id, good: 'food', kind: 'famine' });
    sim.applyCommands();
    return sim;
  };

  it('a famine thins the town, and is the governor\'s contract for food', () => {
    const sim = famished();
    const contract = sim.state.contracts!.find((c) => c.settlementId === portRoyal.id)!;
    const c = content.economy.contracts;
    expect(contract).toMatchObject({ good: 'food', delivered: 0 });
    expect(contract.units).toBeGreaterThanOrEqual(c.units[0]);
    expect(contract.units).toBeLessThanOrEqual(c.units[1]);
    // Food is too cheap to carry for profit; the reward is what makes it worth the voyage.
    expect(contract.reward).toBe(contract.units * c.minPerUnit);
    const fed = moored();
    sim.step(day * 21);
    fed.step(day * 21);
    expect(sim.state.towns![portRoyal.id]!.people).toBeLessThan(fed.state.towns![portRoyal.id]!.people * 0.96);
  });

  it('landing the food fills the contract: the reward on top of the sale, and the famine is over', () => {
    const sim = famished();
    const contract = sim.state.contracts![0]!;
    const run = createSim({ ...sim.state, ships: { player: { ...player(sim.state), cargo: { food: contract.units } } } }, [createEconomySystem(content, settlements)]);
    run.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    run.applyCommands();
    run.send({ type: 'Sell', shipId: 'player', good: 'food', quantity: 10 });
    run.applyCommands();
    expect(run.state.contracts![0]!.delivered).toBe(10);
    const gold = run.state.captain!.gold;
    run.send({ type: 'Sell', shipId: 'player', good: 'food', quantity: contract.units });
    run.applyCommands();
    const sold = run.events().filter((e) => e.type === 'Sold').at(-1)!;
    expect(run.state.captain!.gold).toBe(gold + (sold.payload.gold as number) + contract.reward);
    expect(run.events().some((e) => e.type === 'ContractFilled')).toBe(true);
    expect(run.state.contracts).toHaveLength(0);
    expect(shockFactor(content, run.state, portRoyal.id, 'food')).toBe(1);
  });

  it('plague shuts the port and thins its people until it passes', () => {
    const sim = moored();
    sim.send({ type: 'SpawnPlague', settlementId: portRoyal.id });
    sim.applyCommands();
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();
    expect(player(sim.state).docked).toBeUndefined();
    expect(sim.events().some((e) => e.type === 'TradeRefused' && e.payload.reason === 'plague')).toBe(true);
    const healthy = moored();
    sim.step(day * 14);
    healthy.step(day * 14);
    expect(sim.state.towns![portRoyal.id]!.people).toBeLessThan(healthy.state.towns![portRoyal.id]!.people * 0.95);
    sim.step(day * 7 * content.economy.plague.weeks[0]);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();
    expect(player(sim.state).docked).toBe(portRoyal.id);
  });
});

describe('the fleet', () => {
  const fluyt = { id: 'f1', name: 'Endeavour', classId: 'ship.fluyt', hull: 70, sailCondition: 100 };
  /** Docked at Port Royal with a fluyt in the fleet. */
  const withFluyt = (fleet = [fluyt], extra: Partial<WorldState['ships'][string]> = {}) => {
    const sim = moored();
    const s = sim.state;
    const docked = createSim(
      { ...s, ships: { player: withFleetPace(content, { ...player(s), ...extra }, fleet) }, captain: { ...s.captain!, gold: 100_000, fleet } },
      [createEconomySystem(content, settlements)],
    );
    docked.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    docked.applyCommands();
    return docked;
  };

  it('the shipwright mends one ship on her own, or the whole fleet', () => {
    const sim = withFluyt([fluyt], { hull: 50, sailCondition: 60 });
    const gold = sim.state.captain!.gold;
    sim.send({ type: 'Repair', shipId: 'player', only: 'f1' });
    sim.applyCommands();
    const fluytAfter = sim.state.captain!.fleet![0]!;
    expect(fluytAfter.hull).toBe(shipStats(content, fluytAfter).hullMax);
    // The flagship is left as she was, and only the fluyt was paid for.
    expect(player(sim.state).hull).toBe(50);
    expect(gold - sim.state.captain!.gold).toBe(shipRepairCost(content, fluyt));
    sim.send({ type: 'Repair', shipId: 'player' });
    sim.applyCommands();
    expect(player(sim.state).hull).toBe(shipStats(content, player(sim.state)).hullMax);
    expect(player(sim.state).sailCondition).toBe(100);
  });

  it("counts every ship's hold and berths, and buying fills the fleet's hold", () => {
    const sim = withFluyt();
    const brig = content.ships['ship.brig']!;
    const fl = content.ships['ship.fluyt']!;
    expect(fleetHold(content, sim.state, player(sim.state))).toBe(brig.cargo + fl.cargo);
    expect(fleetBerths(content, sim.state, player(sim.state))).toBe(brig.maxCrew + fl.maxCrew);
    sim.send({ type: 'Buy', shipId: 'player', good: 'cotton', quantity: 1_000_000 });
    sim.applyCommands();
    expect(cargoUsed(player(sim.state))).toBeGreaterThan(brig.cargo);
  });

  it('buys a new ship at the yard: she joins the fleet with half her battery, at her class price', () => {
    const sim = withFluyt([], { crew: 100 });
    const barque = content.ships['ship.barque']!;
    const gold = sim.state.captain!.gold;
    sim.send({ type: 'BuyShip', shipId: 'player', classId: 'ship.barque' });
    sim.applyCommands();
    expect(sim.state.captain!.fleet).toMatchObject([{ classId: 'ship.barque', hull: barque.hull, sailCondition: 100, guns: barque.guns / 2 }]);
    expect(sim.state.captain!.gold).toBe(gold - barque.price);
    // Her pace holds the fleet: the barque is slower than the brig.
    expect(shipStats(content, player(sim.state)).speed).toBe(barque.speed);
    // Two bought in port (time stands still there) are two ships, not one.
    sim.send({ type: 'BuyShip', shipId: 'player', classId: 'ship.sloop' });
    sim.applyCommands();
    const ids = sim.state.captain!.fleet!.map((f) => f.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("won't sell a great ship, nor one the crew can't sail or the purse can't pay", () => {
    const refused = (classId: string, extra = {}, gold = 100_000) => {
      const sim = withFluyt([], extra);
      const run = createSim({ ...sim.state, captain: { ...sim.state.captain!, gold } }, [createEconomySystem(content, settlements)]);
      run.send({ type: 'BuyShip', shipId: 'player', classId });
      run.applyCommands();
      return run.events().at(-1)!.payload.reason;
    };
    expect(refused('ship.galleon', { crew: 150 })).toBe('not-built-here');
    expect(refused('ship.brig', { crew: 30 })).toBe('too-few-men');
    expect(refused('ship.brig', { crew: 150 }, 100)).toBe('not-enough-gold');
    // A light frigate is built only for a captain in good standing with the yard's nation, a frigate for a colonel.
    expect(refused('ship.light_frigate', { crew: 150 })).toBe('standing');
    expect(refused('ship.frigate', { crew: 150 })).toBe('rank');
  });

  it('stocks each yard by its place: a periagua only at a pirate haven, a frigate only at a city, a ketch not in Spain', () => {
    const at = (id: string) => shipsForSale(content, settlements.find((s) => s.id === id)!);
    expect(at('town.tortuga')).toContain('ship.periagua');
    expect(at('town.tortuga')).toContain('ship.pinnace');
    expect(at('town.tortuga')).not.toContain('ship.frigate');
    expect(at('town.port_royal')).toContain('ship.frigate');
    expect(at('town.port_royal')).toContain('ship.galley_frigate');
    expect(at('town.port_royal')).not.toContain('ship.periagua');
    expect(at('town.santo_domingo')).not.toContain('ship.ketch');
    expect(at('town.santo_domingo')).not.toContain('ship.half_galley');
  });

  it('keeps the pace of its slowest ship', () => {
    const sim = withFluyt();
    expect(shipStats(content, player(sim.state)).speed).toBe(content.ships['ship.fluyt']!.speed);
  });

  it("sells a ship for her value, unless the rest can't carry the cargo or berth the crew", () => {
    const sim = withFluyt();
    const gold = sim.state.captain!.gold;
    sim.send({ type: 'SellShip', shipId: 'player', fleetId: 'f1' });
    sim.applyCommands();
    expect(sim.state.captain!.gold).toBe(gold + shipValue(content, fluyt));
    expect(sim.state.captain!.fleet).toEqual([]);
    expect(player(sim.state).fleetSpeed).toBeUndefined();

    const laden = withFluyt([fluyt], { cargo: { cotton: 150 } });
    laden.send({ type: 'SellShip', shipId: 'player', fleetId: 'f1' });
    laden.applyCommands();
    expect(laden.events().at(-1)!.payload.reason).toBe('cargo-wont-fit');
  });

  it('shifts the flag: she becomes the flagship, and the old one sails in the fleet', () => {
    const sim = withFluyt();
    sim.send({ type: 'MakeFlagship', shipId: 'player', fleetId: 'f1' });
    sim.applyCommands();
    expect(player(sim.state)).toMatchObject({ classId: 'ship.fluyt', name: 'Endeavour', hull: 70 });
    expect(sim.state.captain!.fleet!.map((f) => f.classId)).toEqual(['ship.brig']);
    // Now the brig is the faster one: the fluyt sets the pace herself.
    expect(shipStats(content, player(sim.state)).speed).toBe(content.ships['ship.fluyt']!.speed);
  });

  it('the shipwright mends the whole fleet', () => {
    const sim = withFluyt([{ ...fluyt, hull: 40, sailCondition: 60 }], { hull: 50 });
    const cost = repairCost(content, player(sim.state), sim.state.captain!.fleet);
    const gold = sim.state.captain!.gold;
    sim.send({ type: 'Repair', shipId: 'player' });
    sim.applyCommands();
    expect(gold - sim.state.captain!.gold).toBe(cost);
    expect(sim.state.captain!.fleet![0]).toMatchObject({ hull: 70, sailCondition: 100 });
  });
});

describe('the crew', () => {
  const day = content.calendar.ticksPerDay;
  const m = content.crew.morale;
  /** At sea off Port Royal, with this much food, chest and morale. */
  const crewAt = (food: number, captain: Partial<import('@corsair/core').Captain> = {}, crew?: number) => {
    const sim = moored();
    const s = sim.state;
    return createSim(
      {
        ...s,
        ships: { player: { ...player(s), cargo: food ? { food } : {}, ...(crew !== undefined ? { crew } : {}) } },
        captain: { ...s.captain!, ...captain },
      },
      [createEconomySystem(content, settlements)],
    );
  };

  it('eats its rations day by day, carrying part-units over, and the food runs out', () => {
    // 75 men at 20 a unit: 3.75 units a day.
    const sim = crewAt(30);
    sim.step(day * 4);
    expect(player(sim.state).cargo.food).toBe(15);
    expect(foodDays(content, player(sim.state))).toBeCloseTo(15 / 3.75);
    sim.step(day * 4);
    expect(player(sim.state).cargo.food).toBeUndefined();
  });

  it('starving, morale falls fast; with a full chest and pay due soon, it rises toward their mood', () => {
    const hungry = crewAt(0);
    hungry.step(day * 3);
    expect(moraleOf(content, hungry.state)).toBeLessThan(m.start - m.starvingPerDay * 2);
    expect(hungry.events().filter((e) => e.type === 'Starving').length).toBe(3);

    // A chest worth 40 a head (the full mood bonus) on a fed crew lifts them.
    const rich = crewAt(100, { chest: 75 * 40 / (1 - content.crew.captainShare) });
    rich.step(day * 5);
    expect(moraleOf(content, rich.state)).toBeGreaterThan(m.start);
    // Long unpaid with nothing in the chest, they sour.
    const sour = crewAt(200, { chest: 0, paidTick: -day * 40 });
    sour.step(day * 5);
    expect(moraleOf(content, sour.state)).toBeLessThan(m.start);
  });

  it('a crew too unhappy deserts in part when she makes port', () => {
    const sim = crewAt(50, { morale: m.deserting - 1 }, 80);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();
    expect(player(sim.state).crew).toBe(80 - Math.round(80 * m.desertShare.deserting));
    expect(sim.events().some((e) => e.type === 'Deserted')).toBe(true);
    const content2 = crewAt(50, { morale: m.start }, 80);
    content2.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    content2.applyCommands();
    expect(player(content2.state).crew).toBe(80);
  });

  it('dividing the plunder pays the captain his share and sets morale by each man\'s; wages cost every man-day unpaid', () => {
    const sim = crewAt(50, { chest: 1000, morale: 30, paidTick: -day * 20 }, 50);
    sim.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    sim.applyCommands();
    const gold = sim.state.captain!.gold;
    sim.send({ type: 'DividePlunder', shipId: 'player' });
    sim.applyCommands();
    expect(sim.state.captain!.gold).toBe(gold + Math.floor(1000 * content.crew.captainShare));
    expect(sim.state.captain!.chest).toBe(0);
    // 800 among 50 men is 16 a head: base plus 16/40 of the share bonus.
    expect(sim.state.captain!.morale).toBe(Math.round(m.afterDivision.base + m.afterDivision.fromShare * (16 / m.mood.perHeadForFull)));
    expect(sim.state.captain!.paidTick).toBe(sim.state.tick);
    sim.send({ type: 'DividePlunder', shipId: 'player' });
    sim.applyCommands();
    expect(sim.events().at(-1)!.payload.reason).toBe('chest-empty');

    const owing = crewAt(50, { morale: 30, paidTick: -day * 10 }, 50);
    owing.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    owing.applyCommands();
    const before = owing.state.captain!.gold;
    owing.send({ type: 'PayWages', shipId: 'player' });
    owing.applyCommands();
    expect(before - owing.state.captain!.gold).toBe(50 * 10 * content.crew.wagesPerManDay);
    expect(owing.state.captain!.morale).toBe(m.afterWages);
  });

  it('selling prize cargo fills the chest, not the purse, and a trade keeps the rest of the captain', () => {
    const sim = crewAt(0, { standing: { england: 12 }, marques: ['england'] });
    const prized = createSim(
      { ...sim.state, ships: { player: { ...player(sim.state), cargo: { sugar: 10 }, plunder: { sugar: 6 } } } },
      [createEconomySystem(content, settlements)],
    );
    prized.send({ type: 'Dock', shipId: 'player', settlementId: portRoyal.id });
    prized.send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 10 });
    prized.applyCommands();
    const sold = prized.events().find((e) => e.type === 'Sold')!.payload.gold as number;
    const chest = prized.state.captain!.chest!;
    expect(chest).toBeGreaterThan(0);
    expect(prized.state.captain!.gold - 1000).toBe(sold - chest);
    expect(player(prized.state).plunder).toEqual({});
    // Standing and letters of marque survive the trade (a sale used to drop them).
    expect(prized.state.captain!.standing).toEqual({ england: 12 });
    expect(prized.state.captain!.marques).toEqual(['england']);
  });
});
