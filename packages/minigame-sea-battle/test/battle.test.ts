import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Ship } from '@corsair/core';
import { decodeRasterMap, loadContent } from '@corsair/data';
import { describe, expect, it } from 'vitest';
import { createBattle } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const world = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});
// Fights are sailed on the world map itself.
const map = world;
// Open water south of Jamaica, so fights here are about seamanship, not coastlines.
const SEA = { x: 880, y: 680 };

const ship = (classId: string, role?: 'merchant' | 'patrol' | 'pirate', crewShare?: number): Ship => {
  const cls = content.ships[classId]!;
  return {
    id: 'x',
    classId,
    ...SEA,
    headingDeg: 90,
    speed: 0,
    helm: 0,
    sails: 'full',
    blocked: false,
    cargo: {},
    crew: crewShare === undefined ? undefined : Math.round(cls.maxCrew * crewShare),
    ai: role ? { nation: 'pirate', role, name: 'Test', from: 'a', to: 'b', route: [], along: 0, offset: 0, tackSign: 1, news: [] } : undefined,
  };
};

/**
 * One fight to the end: the player's brig sails under `autopilot` (by default a gunner keeping her range),
 * with `outfit` (guns mounted, upgrades) when given, else her class's full battery.
 */
function fight(enemy: Ship, seed: number, autopilot: 'runner' | 'cautious' | 'aggressive' = 'cautious', outfit: Partial<Ship> = {}) {
  const battle = createBattle(content, {
    map,
    wind: { fromDeg: 70, strength: 'fresh' },
    player: { ...ship('ship.brig', undefined, 0.5), ...outfit },
    enemy,
    seed,
    bearingDeg: 45 + seed * 37,
  });
  // Feel metrics: when the player's first broadside goes off, and how many she fires in all.
  // Tension: broadsides before the hulls first meet, and grapples thrown and cut free.
  let volleys = 0;
  let firstVolley: number | undefined;
  let beforeGrapple: number | undefined;
  let grapples = 0;
  let broken = 0;
  let guard = 0;
  while (!battle.result() && guard++ < 30 * 60 * 10) {
    const before = battle.state.ships.player.reload;
    const held = battle.state.grappling;
    battle.step(1, autopilot);
    const after = battle.state.ships.player.reload;
    if (after.port > before.port || after.starboard > before.starboard) {
      volleys++;
      firstVolley ??= battle.state.tick / 30;
    }
    if (held === 0 && battle.state.grappling > 0) {
      grapples++;
      beforeGrapple ??= volleys;
    }
    if (held > 0 && battle.state.grappling === 0 && !battle.result()) broken++;
  }
  return Object.assign(battle, { volleys, firstVolley, beforeGrapple: beforeGrapple ?? volleys, grapples, broken });
}

describe('sea battle', () => {
  it('always ends, and replays exactly from its seed', () => {
    const a = fight(ship('ship.sloop', 'pirate', 0.8), 4);
    expect(a.result()).toBeDefined();
    const b = fight(ship('ship.sloop', 'pirate', 0.8), 4);
    expect(b.result()).toEqual(a.result());
    expect(b.state.tick).toBe(a.state.tick);
  });

  it('is fought on open sea: a ship sails on past where any edge would be while the fight goes on', () => {
    // Both reaching east on a north wind, the sloop eight tiles ahead and only slowly drawing away.
    const battle = createBattle(content, {
      map,
      wind: { fromDeg: 0, strength: 'fresh' },
      player: ship('ship.brig'),
      enemy: ship('ship.sloop', 'merchant'),
      seed: 1,
      bearingDeg: 90,
    });
    const start = battle.state.ships.player.x;
    for (let i = 0; i < 30 * 60 && !battle.result() && battle.state.ships.player.x - start < 40; i++) {
      battle.send({ type: 'SetHelm', shipId: 'player', helm: 0 });
      battle.step(1);
    }
    expect(battle.result()).toBeUndefined();
    expect(battle.state.ships.player.blocked).toBe(false);
    expect(battle.state.ships.player.x - start).toBeGreaterThanOrEqual(40);
  });

  it('drawing apart only ends a fight that keeps opening: turning back in time keeps it going', () => {
    const c = content.combat.battle;
    const battle = createBattle(content, {
      map,
      wind: { fromDeg: 0, strength: 'fresh' },
      player: ship('ship.brig'),
      enemy: ship('ship.fluyt', 'merchant'),
      seed: 2,
      bearingDeg: 90,
    });
    const apart = () => Math.hypot(battle.state.ships.enemy.x - battle.state.ships.player.x, battle.state.ships.enemy.y - battle.state.ships.player.y);
    // Run until she is out of sight, then come about and chase: the brig is faster than a fluyt.
    let guard = 0;
    while (apart() < c.warnTiles && guard++ < 30 * 300) battle.step(1, 'runner');
    let parted = 0;
    guard = 0;
    while (apart() > c.boardTiles * 2 && !battle.result() && guard++ < 30 * 300) {
      battle.step(1, 'aggressive');
      parted = Math.max(parted, battle.state.parting);
    }
    expect(parted).toBeGreaterThan(0);
    expect(battle.result()).toBeUndefined();
    expect(battle.state.parting).toBe(0);
  });

  it('whoever draws clear gets away: a merchant runs from a brig lying to, and a brig that runs has broken off', () => {
    const outcomeOf = (enemy: Ship, autopilot?: 'runner') => {
      const battle = createBattle(content, { map, wind: { fromDeg: 70, strength: 'fresh' }, player: ship('ship.brig', undefined, 0.5), enemy, seed: 3, bearingDeg: 200 });
      // Without an autopilot the brig lies to under furled sails and never fires.
      if (!autopilot) battle.send({ type: 'SetSails', shipId: 'player', sails: 'furled' });
      let guard = 0;
      while (!battle.result() && guard++ < 30 * 60 * 10) battle.step(30, autopilot);
      return battle.result()!.outcome;
    };
    expect(outcomeOf(ship('ship.sloop', 'merchant'))).toBe('escaped');
    expect(outcomeOf(ship('ship.fluyt', 'merchant'), 'runner')).toBe('fled');
  });

  it('one fire key fires whichever broadside bears; shot switches instantly; a broadside says why it will not fire', () => {
    // The enemy seated abeam to starboard of a brig heading north, at a chosen distance.
    const at = (apart: number) =>
      createBattle({ ...content, combat: { ...content.combat, battle: { ...content.combat.battle, startApart: apart } } }, {
        map,
        wind: { fromDeg: 90, strength: 'fresh' },
        player: { ...ship('ship.brig'), headingDeg: 0 },
        enemy: ship('ship.fluyt', 'merchant'),
        seed: 5,
        bearingDeg: 90,
      });
    const close = at(content.combat.guns.grapeTiles - 0.5);
    // Switching to grape costs nothing: the loaded guns take it at once.
    close.send({ type: 'SetAmmo', ammo: 'grape' });
    close.step(1);
    expect(close.state.ships.player.ammo).toBe('grape');
    expect(close.aim('port')).toBe('no-target');
    expect(close.aim('starboard')).toBe('ready');
    // Fire with no side: the starboard broadside, the one that bears.
    close.send({ type: 'Fire' });
    close.step(1);
    expect(close.state.shots.some((s) => s.from === 'player' && s.ammo === 'grape')).toBe(true);
    expect(close.state.ships.player.reload.starboard).toBeGreaterThan(0);
    expect(close.state.ships.player.reload.port).toBe(0);
    // Again at once: starboard is loading and port doesn't bear, so nothing fires.
    const shots = close.state.shots.length;
    close.send({ type: 'Fire' });
    close.step(1);
    expect(close.state.shots.length).toBe(shots);
    // Round-shot range, but too far for grape: the broadside says so rather than failing silently.
    const far = at(content.combat.guns.rangeTiles - 0.5);
    far.send({ type: 'SetAmmo', ammo: 'grape' });
    far.step(1);
    expect(far.aim('starboard')).toBe('out-of-range');
  });

  it('hulls together throw grapples: held, the boarders go over; sailing clear cuts them', () => {
    const b = content.combat.battle;
    // Seated alongside, inside grappling distance.
    const alongside = (enemy: Ship) =>
      createBattle({ ...content, combat: { ...content.combat, battle: { ...b, startApart: b.boardTiles * 0.6 } } }, {
        map,
        wind: { fromDeg: 0, strength: 'fresh' },
        player: { ...ship('ship.brig'), headingDeg: 90 },
        enemy: { ...enemy, headingDeg: 90 },
        seed: 6,
        bearingDeg: 0,
      });
    // A pirate holds on: the grapples stay out until the boarders go over, no sooner.
    const held = alongside(ship('ship.sloop', 'pirate', 0.95));
    let guard = 0;
    while (!held.result() && guard++ < 30 * 30) held.step(1);
    expect(['boarded', 'lost']).toContain(held.result()!.outcome);
    expect(held.state.tick / 30).toBeGreaterThanOrEqual(b.grappleSeconds);
    // The brig runs downwind while the grapples are still young: past breakTiles they part.
    const cut = alongside(ship('ship.fluyt', 'merchant'));
    cut.step(1);
    expect(cut.state.grappling).toBeGreaterThan(0);
    guard = 0;
    while (cut.state.grappling > 0 && !cut.result() && guard++ < 30 * 30) cut.step(1, 'runner');
    expect(cut.result()).toBeUndefined();
    expect(cut.state.grappling).toBe(0);
  });

  it('a merchant with her sails shot away, or outmanned three to one alongside, strikes; the HUD sees her waver', () => {
    const quick = { ...content, combat: { ...content.combat, battle: { ...content.combat.battle, startApart: 4 } } };
    const meet = (enemy: Ship, crew?: number) =>
      createBattle(quick, { map, wind: { fromDeg: 0, strength: 'fresh' }, player: { ...ship('ship.brig'), crew }, enemy, seed: 2, bearingDeg: 90 });
    const demasted = meet({ ...ship('ship.fluyt', 'merchant'), sailCondition: 20 });
    expect(demasted.wavering()).toBe(true);
    demasted.step(30);
    expect(demasted.result()!.outcome).toBe('struck');
    // Three to one and close: she gives up. A pirate outmanned the same way fights on.
    const outmanned = meet({ ...ship('ship.fluyt', 'merchant'), crew: 20 }, 60);
    outmanned.step(30);
    expect(outmanned.result()!.outcome).toBe('struck');
    const pirate = meet({ ...ship('ship.sloop', 'pirate'), crew: 20 }, 60);
    expect(pirate.wavering()).toBe(false);
    pirate.step(30);
    expect(pirate.result()).toBeUndefined();
  });

  it('sunk, she leaves barrels and men in the water: sailing over them is gold and hands, and Leave ends it', () => {
    const quick = { ...content, combat: { ...content.combat, battle: { ...content.combat.battle, startApart: 4 } } };
    const sinking = () =>
      createBattle(quick, {
        map,
        wind: { fromDeg: 0, strength: 'fresh' },
        player: { ...ship('ship.brig'), headingDeg: 0 },
        enemy: { ...ship('ship.sloop', 'pirate'), hull: 0, crew: 40 },
        seed: 4,
        bearingDeg: 90,
      });
    const b = sinking();
    b.step(1);
    // She's gone down: no result yet, the wreck lies there to be picked over.
    expect(b.result()).toBeUndefined();
    const wreck = b.state.wreck!;
    expect(wreck.barrels.length).toBeGreaterThan(0);
    expect(wreck.survivors.reduce((n, g) => n + g.men, 0)).toBe(Math.round(40 * content.combat.salvage.survivors));
    expect(b.wavering()).toBe(false);
    // Put the brig on a barrel and a knot of men: they come aboard.
    const at = wreck.barrels[0]!;
    b.state.ships.player.x = at.x;
    b.state.ships.player.y = at.y;
    b.step(1);
    expect(b.state.wreck!.gold).toBeGreaterThanOrEqual(content.combat.salvage.barrelGold);
    b.send({ type: 'LeaveWreck' });
    b.step(1);
    expect(b.result()).toMatchObject({ outcome: 'sunk', salvage: { gold: b.state.wreck!.gold, men: b.state.wreck!.men } });
    // Left alone, the wreck runs out of time.
    const idle = sinking();
    idle.step(30 * (content.combat.salvage.seconds + 2));
    expect(idle.result()!.outcome).toBe('sunk');
  });

  it('close to board (G): her helm runs her down and lays alongside until the grapples take; the helm by hand stops it', () => {
    const quick = { ...content, combat: { ...content.combat, battle: { ...content.combat.battle, startApart: 6 } } };
    const chase = () =>
      // Not outmanned three to one, so she doesn't strike before the boarders get across.
      createBattle(quick, { map, wind: { fromDeg: 0, strength: 'fresh' }, player: { ...ship('ship.brig'), crew: 100 }, enemy: { ...ship('ship.fluyt', 'merchant'), crew: 40 }, seed: 5, bearingDeg: 90 });
    const b = chase();
    expect(b.boardingOdds()).toBeGreaterThan(0.5);
    b.send({ type: 'Board' });
    let grappled = false;
    for (let i = 0; i < 30 * 60 && !b.result(); i++) {
      b.step(1);
      if (b.state.grappling > 0) grappled = true;
    }
    expect(b.state.boarding).toBe(true);
    expect(grappled).toBe(true);
    // Taking the helm by hand drops the order.
    const c = chase();
    c.send({ type: 'Board' });
    c.step(10);
    c.send({ type: 'SetHelm', shipId: 'player', helm: 1 });
    c.step(1);
    expect(c.state.boarding).toBe(false);
  });

  it('the more hands at the guns, the faster she reloads, up to full manning', () => {
    // A brig's 18 guns at 4 men a gun want 36 hands for a broadside.
    const reload = (crew: number) =>
      createBattle(content, { map, wind: { fromDeg: 70, strength: 'fresh' }, player: { ...ship('ship.brig'), crew }, enemy: ship('ship.sloop', 'pirate'), seed: 1, bearingDeg: 0 }).gunnery()
        .reloadSeconds;
    const base = content.combat.guns.reloadSeconds;
    expect(reload(18)).toBeCloseTo(base * 2);
    expect(reload(36)).toBeCloseTo(base);
    expect(reload(108)).toBeCloseTo(base * (1 - content.crew.manning.reloadBonus));
    expect(reload(150)).toBeCloseTo(reload(108));
  });

  it('a happy crew carries the deck: boarded alongside, high morale loses fewer men', () => {
    const b = content.combat.battle;
    const board = (playerMorale: number) => {
      const battle = createBattle({ ...content, combat: { ...content.combat, battle: { ...b, startApart: b.boardTiles * 0.6 } } }, {
        map,
        wind: { fromDeg: 0, strength: 'fresh' },
        player: { ...ship('ship.brig', undefined, 0.5), headingDeg: 90 },
        enemy: { ...ship('ship.sloop', 'pirate', 0.95), headingDeg: 90 },
        seed: 6,
        bearingDeg: 0,
        playerMorale,
      });
      let guard = 0;
      while (!battle.result() && guard++ < 30 * 30) battle.step(1);
      return battle.state.ships.player.crew;
    };
    expect(board(100)).toBeGreaterThan(board(5));
  });

  it('fires half her mounted guns a broadside, and reports the guns she has left', () => {
    const quick = { ...content, combat: { ...content.combat, battle: { ...content.combat.battle, startApart: 4 } } };
    const broadside = (guns?: number) => {
      const b = createBattle(quick, {
        map,
        wind: { fromDeg: 90, strength: 'fresh' },
        player: { ...ship('ship.brig'), headingDeg: 0, guns },
        enemy: ship('ship.fluyt', 'merchant'),
        seed: 7,
        bearingDeg: 90,
      });
      b.send({ type: 'Fire', side: 'starboard' });
      b.step(1);
      return b.state.shots.filter((s) => s.from === 'player').length;
    };
    expect(broadside(10)).toBe(5);
    expect(broadside()).toBe(content.ships['ship.brig']!.guns / 2);
    const done = fight(ship('ship.sloop', 'pirate', 0.85), 3, 'cautious', { guns: 12 });
    expect(done.result()!.player.guns).toBeLessThanOrEqual(12);
  });

  it('who sails her: a regular crew under a captain of 50 fights as one with none; veterans under a good captain beat green men under a poor one', () => {
    const pirate = (crew?: 'green' | 'regular' | 'veteran', skill?: number): Ship => {
      const s = ship('ship.brigantine', 'pirate', 0.9);
      return { ...s, ai: { ...s.ai!, temperament: 'bold', ...(crew ? { crew } : {}), ...(skill !== undefined ? { captain: { gunnery: skill, seamanship: skill, boarding: skill, resolve: skill } } : {}) } };
    };
    // Neutral is exactly neutral: the same fight, tick for tick.
    for (const seed of [1, 2, 3]) {
      const none = fight(pirate(), seed);
      const ordinary = fight(pirate('regular', 50), seed);
      expect(ordinary.result()).toEqual(none.result());
      expect(ordinary.state.tick).toBe(none.state.tick);
    }
    const losses = (crew: 'green' | 'veteran', skill: number) => {
      let n = 0;
      for (let seed = 1; seed <= 30; seed++) if (fight(pirate(crew, skill), seed).result()!.outcome === 'lost') n++;
      return n;
    };
    const easy = losses('green', 20);
    const hard = losses('veteran', 90);
    expect(hard).toBeGreaterThan(easy + 5);
  }, 120_000);

  it('doctrine: a French patrol fires chain at the rigging, an English one round shot, and Spanish soldiers are hard to board', () => {
    const patrol = (nation: 'england' | 'france' | 'spain'): Ship => {
      const s = ship('ship.war_sloop', 'patrol', 0.8);
      return { ...s, ai: { ...s.ai!, nation } };
    };
    const ammoAfter = (nation: 'england' | 'france' | 'spain') => {
      const b = createBattle(content, { map, wind: { fromDeg: 70, strength: 'fresh' }, player: ship('ship.brig', undefined, 0.5), enemy: patrol(nation), seed: 1, bearingDeg: 0 });
      b.step(60);
      return b.state.ships.enemy.ammo;
    };
    expect(ammoAfter('england')).toBe('round');
    expect(ammoAfter('france')).toBe('chain');
    const odds = (nation: 'england' | 'spain') =>
      createBattle(content, { map, wind: { fromDeg: 70, strength: 'fresh' }, player: ship('ship.brig', undefined, 0.5), enemy: patrol(nation), seed: 1, bearingDeg: 0 }).boardingOdds();
    expect(odds('spain')).toBeLessThan(odds('england'));
  });

  it('surrender: a captain of resolve holds out longer than a faint-hearted one', () => {
    const sloop = (resolve: number): Ship => {
      const s = ship('ship.sloop', 'pirate', 0.85);
      return { ...s, ai: { ...s.ai!, temperament: 'cautious', captain: { gunnery: 50, seamanship: 50, boarding: 50, resolve } } };
    };
    const struck = (resolve: number) => {
      let n = 0;
      for (let seed = 1; seed <= 30; seed++) if (fight(sloop(resolve), seed).result()!.outcome === 'struck') n++;
      return n;
    };
    expect(struck(5)).toBeGreaterThan(struck(95));
  }, 120_000);

  it('a famous pirate calls on the player to strike when her boarders would lose; striking yields, and only then', () => {
    const morgan = (famous?: string): Ship => {
      const s = ship('ship.frigate', 'pirate', 1);
      return { ...s, x: SEA.x, y: SEA.y, ai: { ...s.ai!, ...(famous ? { famous } : {}) } };
    };
    const close = (enemy: Ship) => {
      const b = createBattle(content, { map, wind: { fromDeg: 70, strength: 'fresh' }, player: { ...ship('ship.brig', undefined, 0.5), x: SEA.x, y: SEA.y }, enemy, seed: 2, bearingDeg: 0 });
      // Run in until she is within hailing reach.
      for (let i = 0; i < 30 * 120 && !b.demands() && !b.result(); i++) b.step(1);
      return b;
    };
    const plain = close(morgan());
    expect(plain.demands()).toBe(false);
    plain.send({ type: 'Strike' });
    plain.step(1);
    expect(plain.result()?.outcome).not.toBe('yielded');
    const famous = close(morgan('morgan'));
    expect(famous.demands()).toBe(true);
    famous.send({ type: 'Strike' });
    famous.step(1);
    expect(famous.result()!.outcome).toBe('yielded');
  }, 60_000);

  it('outfitting pays: a stock 10-gun brig, a full battery, and a fully fitted brig against a pirate sloop', () => {
    const wins = (outfit: Partial<Ship>) => {
      let n = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const o = fight(ship('ship.sloop', 'pirate', 0.85), seed, 'cautious', outfit).result()!.outcome;
        if (o === 'sunk' || o === 'struck' || o === 'boarded') n++;
      }
      return n;
    };
    const stock = wins({ guns: 10 });
    const full = wins({});
    const fitted = wins({ upgrades: Object.keys(content.upgrades) });
    console.log('OUTFIT brig vs pirate sloop wins of 40: 10 guns', stock, '18 guns', full, 'fully fitted', fitted);
    expect(full).toBeGreaterThanOrEqual(stock);
    expect(fitted).toBeGreaterThanOrEqual(full);
  }, 120_000);

  it('a famous pirate is a hard fight: her veterans beat a stock 10-gun brig most times (the top of the list nearly always)', () => {
    const famous = (classId: string, temperament: string) => {
      const s = ship(classId, 'pirate', 1);
      return { ...s, ai: { ...s.ai!, famous: 'test', temperament } };
    };
    const tally: Record<string, number> = {};
    for (const c of content.pirates.captains) {
      let lost = 0;
      for (let seed = 1; seed <= 6; seed++) if (fight(famous(c.classId, c.temperament), seed, 'cautious', { guns: 10 }).result()!.outcome === 'lost') lost++;
      tally[c.id] = lost;
    }
    console.log('FAMOUS stock brig losses of 6 against each', JSON.stringify(tally));
    const losses = Object.values(tally).reduce((a, b) => a + b, 0);
    expect(losses).toBeGreaterThan(content.pirates.captains.length * 6 * 0.5);
  }, 300_000);

  it('plays matchups with the outcomes the design intends (headless runner)', () => {
    const tally = (enemy: () => Ship, n = 40) => {
      const outcomes: Record<string, number> = {};
      let seconds = 0;
      let volleys = 0;
      let beforeGrapple = 0;
      let grapples = 0;
      let broken = 0;
      const firsts: number[] = [];
      for (let seed = 1; seed <= n; seed++) {
        const b = fight(enemy(), seed);
        outcomes[b.result()!.outcome] = (outcomes[b.result()!.outcome] ?? 0) + 1;
        seconds += b.state.tick / 30;
        volleys += b.volleys;
        beforeGrapple += b.beforeGrapple;
        grapples += b.grapples;
        broken += b.broken;
        if (b.firstVolley !== undefined) firsts.push(b.firstVolley);
      }
      firsts.sort((a, b) => a - b);
      return {
        outcomes,
        seconds: Math.round(seconds / n),
        // Feel: seconds to the first broadside (median), and broadsides a minute across the fights.
        firstVolley: Math.round(firsts[Math.floor(firsts.length / 2)] ?? -1),
        volleysPerMinute: Math.round((volleys / (seconds / 60)) * 10) / 10,
        // Tension: broadsides before the first grapple (mean), and grapples thrown and cut free in all.
        volleysBeforeGrapple: Math.round((beforeGrapple / n) * 10) / 10,
        grapples,
        broken,
      };
    };
    const merchant = tally(() => ship('ship.fluyt', 'merchant', 0.55));
    const pirate = tally(() => ship('ship.sloop', 'pirate', 0.85));
    const frigate = tally(() => ship('ship.frigate', 'patrol', 0.85));
    console.log('BATTLE brig vs merchant fluyt', JSON.stringify(merchant));
    console.log('BATTLE brig vs pirate sloop', JSON.stringify(pirate));
    console.log('BATTLE brig vs frigate', JSON.stringify(frigate));
    const wins = (o: Record<string, number>) => (o.sunk ?? 0) + (o.struck ?? 0) + (o.boarded ?? 0);
    // A merchant is prey: the brig takes most of them; some run clear.
    expect(wins(merchant.outcomes)).toBeGreaterThanOrEqual(20);
    // A pirate sloop is a real fight, but a well-handled brig wins more often than not.
    expect(wins(pirate.outcomes)).toBeGreaterThanOrEqual(15);
    // A frigate outguns a brig: attacking one is a mistake.
    expect(frigate.outcomes.lost ?? 0).toBeGreaterThan(wins(frigate.outcomes));
  }, 120_000);

  it('places every hit on her, and rigging hits bring masts down: canvas and men go with them', () => {
    // The brig keeps her range and pounds a big merchantman with round shot until a mast goes.
    let seen = 0;
    for (let seed = 1; seed <= 12 && !seen; seed++) {
      const battle = createBattle(content, {
        map,
        wind: { fromDeg: 70, strength: 'fresh' },
        player: ship('ship.brig', undefined, 0.9),
        enemy: ship('ship.merchantman', 'merchant', 0.5),
        seed,
        bearingDeg: 90,
      });
      const masts = content.ships['ship.merchantman']!.masts.length;
      let guard = 0;
      while (!battle.result() && guard++ < 30 * 60 * 6) {
        const before = battle.state.ships.enemy;
        battle.step(1, 'cautious');
        const s = battle.state;
        // Every hit carries where it went in: along her length, how high, how far out.
        for (const e of s.effects.filter((x) => x.place && x.at === s.tick / 30)) {
          expect(Math.abs(e.place!.along)).toBeLessThanOrEqual(0.5);
          expect(e.place!.up).toBeGreaterThan(-0.06);
        }
        const fell = s.effects.find((e) => e.kind === 'mast' && e.ship === 'enemy' && e.at === s.tick / 30);
        if (!fell) continue;
        const after = s.ships.enemy;
        seen++;
        expect(after.masts[fell.mast!]).toBe(0);
        expect(after.masts.length).toBe(masts);
        // Her canvas: never more than her standing masts can carry.
        const up = after.masts.filter((m) => m > 0).length;
        expect(after.sailCondition).toBeLessThanOrEqual((100 * up) / masts + 1e-9);
        expect(after.sailCondition).toBeLessThan(before.sailCondition);
        expect(after.crew).toBeLessThan(before.crew);
        expect(fell.towardDeg).toBeGreaterThanOrEqual(0);
        break;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('balls really fly: one a gun, and a ship that turns hard after a broadside is fired at her dodges some of it', () => {
    // A frigate fires her loaded broadside at a brig lying beam-on four tiles off; then the brig either holds her
    // course or puts her helm hard over and runs, and we count the balls that strike her.
    const strikes = (dodge: boolean) => {
      let hits = 0;
      let fired = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const battle = createBattle(content, {
          map,
          wind: { fromDeg: 0, strength: 'fresh' },
          player: { ...ship('ship.brig', undefined, 0.9), headingDeg: 90 },
          enemy: { ...ship('ship.frigate', 'patrol', 0.9), headingDeg: 90 },
          seed,
          bearingDeg: 180,
        });
        const st = battle.state as unknown as { ships: Record<string, { x: number; y: number; speed: number; reload: Record<string, number> }> };
        // Seat the frigate 4 tiles south of the brig, both heading east, the brig at speed.
        st.ships.enemy!.x = st.ships.player!.x;
        st.ships.enemy!.y = st.ships.player!.y + 4;
        st.ships.player!.speed = 2.4;
        // Her AI fires the broadside that bears at once: one ball a gun on that side.
        for (let i = 0; i < 60 && !battle.state.shots.some((s) => s.from === 'enemy'); i++) battle.step(1);
        const balls = battle.state.shots.filter((s) => s.from === 'enemy');
        fired += balls.length;
        expect(balls.length).toBe(Math.floor(battle.state.ships.enemy.guns / 2));
        if (dodge) battle.send({ type: 'SetHelm', shipId: 'player', helm: -1 });
        for (let i = 0; i < 90 && battle.state.shots.some((s) => s.from === 'enemy'); i++) {
          battle.step(1);
          hits += battle.state.effects.filter((e) => e.ship === 'player' && e.place && e.at === battle.state.tick / 30).length;
        }
      }
      return { hits, fired };
    };
    const held = strikes(false);
    const dodged = strikes(true);
    process.stderr.write(`DODGE held ${JSON.stringify(held)} dodged ${JSON.stringify(dodged)}\n`);
    expect(held.fired).toBeGreaterThan(0);
    expect(dodged.hits).toBeLessThan(held.hits);
  });
});
