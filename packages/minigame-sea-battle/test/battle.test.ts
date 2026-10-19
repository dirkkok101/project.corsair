import type { Ship } from '@corsair/core';
import { difficultyOf } from '@corsair/data';
import { describe, expect, it } from 'vitest';
import { createBattle, weatherGauge } from '../src';
import { content, fight, map, SEA, ship } from './fixtures';

describe('a fair start', () => {
  // A pirate sloop falls on the brig. Fair: across the wind, converging. Not: bows-on from dead to windward.
  const start = (fair: boolean, seed: number) =>
    createBattle(content, {
      map,
      wind: { fromDeg: 0, strength: 'fresh' },
      player: { ...ship('ship.brig', undefined, 0.5), headingDeg: 0, speed: 5 },
      enemy: { ...ship('ship.sloop', 'pirate', 0.9), headingDeg: 180, speed: 5 },
      seed,
      bearingDeg: 0,
      fair,
    });
  const apart = (b: ReturnType<typeof start>) => Math.hypot(b.state.ships.enemy.x - b.state.ships.player.x, b.state.ships.enemy.y - b.state.ships.player.y);

  it('lies across the wind, neither with the weather gauge, on courses drawing apart downwind', () => {
    const fair = start(true, 1);
    expect(weatherGauge(fair.state)).toBeUndefined();
    expect(apart(fair)).toBeCloseTo(content.combat.battle.fairApart, 5);
    // Each heads fairAngle off the line to the other, downwind of it (never in irons), so they draw apart.
    const { player, enemy } = fair.state.ships;
    const line = (Math.atan2(enemy.x - player.x, -(enemy.y - player.y)) * 180) / Math.PI;
    const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    expect(angle(player.headingDeg, line)).toBeCloseTo(content.combat.battle.fairAngle, 5);
    expect(angle(enemy.headingDeg, line + 180)).toBeCloseTo(content.combat.battle.fairAngle, 5);
    expect(angle(player.headingDeg, 180)).toBeLessThanOrEqual(90);
    // Out of boarding reach, and both under way.
    expect(apart(fair)).toBeGreaterThan(content.combat.battle.boardTiles * 4);
    expect(player.speed).toBeGreaterThanOrEqual(content.combat.battle.fairSpeed);
    // As they met, she came down from windward with the gauge.
    expect(weatherGauge(start(false, 1).state)).toBe('enemy');
  });

});

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

  it('a boarder alongside throws grapples: held, the boarders go over; sailing clear cuts them', () => {
    const b = content.combat.battle;
    // Seated alongside, inside grappling distance.
    const alongside = (enemy: Ship, playerCrew?: number) =>
      createBattle({ ...content, combat: { ...content.combat, battle: { ...b, startApart: b.boardTiles * 0.6 } } }, {
        map,
        wind: { fromDeg: 0, strength: 'fresh' },
        player: { ...ship('ship.brig', undefined, playerCrew), headingDeg: 90 },
        enemy: { ...enemy, headingDeg: 90 },
        seed: 6,
        bearingDeg: 0,
      });
    // A pirate who outmans her means to board, and holds on: the grapples stay out until the boarders go over.
    const held = alongside(ship('ship.sloop', 'pirate', 0.95), 0.3);
    let guard = 0;
    while (!held.result() && guard++ < 30 * 30) held.step(1);
    expect(['boarded', 'lost']).toContain(held.result()!.outcome);
    expect(held.state.tick / 30).toBeGreaterThanOrEqual(b.grappleSeconds);
    // The brig runs downwind while the grapples are still young: past breakTiles they part.
    // Closing to board herself (G), the player throws them on a merchant; running clear cuts them.
    const cut = alongside(ship('ship.fluyt', 'merchant'));
    cut.send({ type: 'Board' });
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

  it('a brush in passing throws no grapples: only a ship that means to board', () => {
    const b = content.combat.battle;
    // A merchant alongside, no one boarding: no grapples, however close.
    const battle = createBattle({ ...content, combat: { ...content.combat, battle: { ...b, startApart: b.boardTiles * 0.6 } } }, {
      map,
      wind: { fromDeg: 0, strength: 'fresh' },
      player: { ...ship('ship.brig'), headingDeg: 90 },
      enemy: { ...ship('ship.fluyt', 'merchant'), headingDeg: 90 },
      seed: 6,
      bearingDeg: 0,
    });
    for (let i = 0; i < 30; i++) battle.step(1);
    expect(battle.state.grappling).toBe(0);
  });

  it('repels boarders: in the window the grapples are cut and she sheers off; too soon and they come over', () => {
    const b = content.combat.battle;
    const grappled = () => {
      const battle = createBattle({ ...content, combat: { ...content.combat, battle: { ...b, startApart: b.boardTiles * 0.6 } } }, {
        map,
        wind: { fromDeg: 0, strength: 'fresh' },
        player: { ...ship('ship.brig', undefined, 0.3), headingDeg: 90 },
        enemy: { ...ship('ship.sloop', 'pirate', 0.95), headingDeg: 90 },
        seed: 6,
        bearingDeg: 0,
      });
      battle.step(1);
      expect(battle.state.enemyBoarding).toBe(true);
      expect(battle.repelWindow()).toBeGreaterThan(0);
      return battle;
    };
    // In time: a moment before the boarders would go over.
    const timely = grappled();
    const crew = timely.state.ships.player.crew;
    while (timely.state.grappling < b.grappleSeconds - timely.repelWindow() / 2) timely.step(1);
    timely.send({ type: 'Repel' });
    timely.step(1);
    expect(timely.state.repel?.result).toBe('repelled');
    expect(timely.state.grappling).toBe(0);
    expect(timely.state.ships.player.crew).toBeLessThan(crew);
    // She sheers off for a while: no grapples, however close she lies.
    for (let i = 0; i < 30 * 3; i++) timely.step(1);
    expect(timely.result()).toBeUndefined();
    expect(timely.state.enemyBoarding).toBe(false);
    // Too soon: one try a grapple, and the boarders go over.
    const early = grappled();
    early.step(5);
    early.send({ type: 'Repel' });
    early.step(1);
    expect(early.state.repel?.result).toBe('missed');
    let guard = 0;
    while (!early.result() && guard++ < 30 * 30) early.step(1);
    expect(['boarded', 'lost']).toContain(early.result()!.outcome);
  });

  it('a happy crew carries the deck: boarded alongside, high morale loses fewer men', () => {
    const b = content.combat.battle;
    const board = (playerMorale: number) => {
      const battle = createBattle({ ...content, combat: { ...content.combat, battle: { ...b, startApart: b.boardTiles * 0.6 } } }, {
        map,
        wind: { fromDeg: 0, strength: 'fresh' },
        player: { ...ship('ship.brig', undefined, 0.3), headingDeg: 90 },
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

  it('who sails her: a regular crew under a captain of 50 fights as one with none', () => {
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
  });

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

  it('guns and range: a ball is full force close in and weaker at long shot; a ball down her length rakes her', () => {
    const at = (apart: number, enemyHeading: number) => {
      const b = createBattle({ ...content, combat: { ...content.combat, battle: { ...content.combat.battle, startApart: apart } } }, {
        map,
        wind: { fromDeg: 0, strength: 'fresh' },
        player: { ...ship('ship.brig'), headingDeg: 0 },
        enemy: { ...ship('ship.sloop', 'merchant'), headingDeg: enemyHeading },
        seed: 3,
        bearingDeg: 90,
      });
      b.send({ type: 'Fire', side: 'starboard' });
      b.step(1);
      return b;
    };
    const near = at(2.5, 0);
    const far = at(5.6, 0);
    expect(near.state.shots.every((s) => s.power === 1)).toBe(true);
    expect(far.state.shots.every((s) => (s.power ?? 1) < 0.6)).toBe(true);
    // Beam on, the balls strike across her; bow on (heading straight at the guns), they rake her.
    const landed = (b: ReturnType<typeof at>) => {
      const effects: { place?: { rake?: boolean }; ship?: string }[] = [];
      for (let i = 0; i < 60; i++) {
        b.step(1);
        effects.push(...b.state.effects.filter((e) => e.ship === 'enemy' && e.kind !== 'smoke'));
      }
      return effects;
    };
    expect(landed(at(2.5, 0)).some((e) => e.place?.rake)).toBe(false);
    expect(landed(at(2.5, 270)).some((e) => e.place?.rake)).toBe(true);
  });

  it('sails shot away all but stop her in a fight: a fluyt running from a frigate is caught', () => {
    // Her canvas already in rags as she turns to run.
    const near = { ...content, combat: { ...content.combat, battle: { ...content.combat.battle, startApart: 5 * content.combat.battle.shipScale } } };
    const chase = createBattle(near, { map, wind: { fromDeg: 70, strength: 'fresh' }, player: { ...ship('ship.fluyt', undefined, 0.5), sailCondition: 0 }, enemy: ship('ship.frigate', 'patrol', 0.9), seed: 4, bearingDeg: 0 });
    chase.step(30 * 10, 'runner');
    const her = chase.state.ships.player;
    expect(her.sailCondition).toBe(0);
    // Her rags draw only combat.json's battle floor (her point of sail takes more off, never adds): with the world
    // map's floor she would still make 0.29 here.
    expect(her.speed).toBeLessThan(content.ships['ship.fluyt']!.speed * content.combat.battle.tilesPerSecondPerSpeedPoint * content.combat.battle.tornSailsFloor * 1.5);
    for (let i = 0; i < 30 * 90 && !chase.result(); i++) chase.step(1, 'runner');
    expect(chase.result()?.outcome).toBe('lost');
  });

  it('swivels sweep the deck close in; chasers fire along her heading', () => {
    const swivelled = { ...content, ships: { ...content.ships, 'ship.sloop': { ...content.ships['ship.sloop']!, swivels: 4 } } };
    const close = createBattle({ ...swivelled, combat: { ...swivelled.combat, battle: { ...swivelled.combat.battle, startApart: 2.5 } } }, {
      map,
      wind: { fromDeg: 0, strength: 'fresh' },
      player: { ...ship('ship.brig'), headingDeg: 0, crew: 100 },
      enemy: { ...ship('ship.sloop', 'pirate', 0.9), headingDeg: 0 },
      seed: 1,
      bearingDeg: 90,
    });
    close.step(30 * 3);
    expect(close.state.ships.player.crew).toBeLessThan(100);
    // A frigate in chase, her bow on the brig running from her: her bow chasers speak (a ball from her very head).
    // Her canvas holding as on the world map (navigation's floor), so the chase lasts until the chasers speak:
    // with the battle's own floor her shot-away sails stop her first, and she is caught under the frigate's broadside.
    const near = { ...content, combat: { ...content.combat, battle: { ...content.combat.battle, startApart: 5, tornSailsFloor: content.navigation.tornSailsFloor } } };
    const chase = createBattle(near, { map, wind: { fromDeg: 70, strength: 'fresh' }, player: ship('ship.fluyt', undefined, 0.5), enemy: ship('ship.frigate', 'patrol', 0.9), seed: 4, bearingDeg: 0 });
    const half = content.ships['ship.frigate']!.size.length / 2;
    let chased = false;
    for (let i = 0; i < 30 * 90 && !chased && !chase.result(); i++) {
      chase.step(1, 'runner');
      const e = chase.state.ships.enemy;
      const r = (e.headingDeg * Math.PI) / 180;
      chased = chase.state.shots.some((s) => s.from === 'enemy' && (s.x - e.x) * Math.sin(r) - (s.y - e.y) * Math.cos(r) > half * 0.8);
    }
    expect(chased).toBe(true);
  });

  it('the fits in battle: bronze cannon cool after three quick broadsides, nettings stiffen the boarded', () => {
    const close = { ...content, combat: { ...content.combat, battle: { ...content.combat.battle, startApart: 3 } } };
    const brig = (upgrades: string[]) => createBattle(close, { map, wind: { fromDeg: 0, strength: 'fresh' }, player: { ...ship('ship.brig', undefined, 0.8), headingDeg: 0, upgrades }, enemy: { ...ship('ship.frigate', 'patrol'), headingDeg: 0 }, seed: 2, bearingDeg: 90 });
    // Three broadsides in quick succession: her guns must cool, and the next reload is the long one.
    const hot = brig(['bronze_cannon']);
    const cool = hot.gunnery().reloadSeconds;
    let fired = 0;
    for (let i = 0; i < 30 * 40 && fired < 3; i++) {
      const before = hot.state.ships.player.reload;
      hot.send({ type: 'Fire' });
      hot.step(1);
      const after = hot.state.ships.player.reload;
      if (after.port > before.port || after.starboard > before.starboard) fired++;
    }
    expect(fired).toBe(3);
    expect(hot.gunnery().reloadSeconds).toBeGreaterThan(cool * 1.3);
    // Nettings: boarded, the player stands stiffer; going over herself (G) she is a little slower.
    const netted = brig(['nettings']);
    const bare = brig([]);
    expect(netted.boardingOdds()).toBeGreaterThan(bare.boardingOdds());
    netted.send({ type: 'Board' });
    bare.send({ type: 'Board' });
    netted.step(1);
    bare.step(1);
    expect(netted.boardingOdds()).toBeLessThan(bare.boardingOdds());
  });

  it('places every hit on her, and rigging hits bring masts down: canvas and men go with them', () => {
    // The brig works a big merchantman's rigging with chain (as a boarder would) until a mast goes.
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
        battle.step(1, 'aggressive');
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

describe('difficulty in battle', () => {
  const duel = (difficulty?: string) =>
    createBattle(content, {
      map,
      wind: { fromDeg: 0, strength: 'fresh' },
      player: ship('ship.brig', undefined, 0.8),
      enemy: ship('ship.brig', 'patrol', 0.8),
      seed: 7,
      bearingDeg: 90,
      ...(difficulty ? { difficulty: difficultyOf(content, difficulty) } : {}),
    });

  it('the wind holds through a fight on the tuned level, and veers on the hardest', () => {
    const steady = duel('adventurer');
    const veering = duel('swashbuckler');
    const seen = new Set<number>();
    for (let i = 0; i < 4; i++) {
      steady.step(30 * content.combat.difficulty.windShiftSeconds);
      veering.step(30 * content.combat.difficulty.windShiftSeconds);
      expect(steady.state.wind.fromDeg).toBe(0);
      // Degrees off where it blew when they met.
      const off = Math.abs(((veering.state.wind.fromDeg + 180) % 360) - 180);
      seen.add(veering.state.wind.fromDeg);
      expect(off).toBeLessThanOrEqual(difficultyOf(content, 'swashbuckler').windShiftDeg + 1e-9);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('the easiest level forgives the player near misses: the same broadsides do more harm', () => {
    const harm = (difficulty: string) => {
      const b = duel(difficulty);
      // A gunnery fight held at range, stopped before either strikes.
      for (let i = 0; i < 30 * 45 && !b.result(); i++) b.step(1, 'cautious');
      const e = b.state.ships.enemy;
      return e.hullMax - e.hull + (100 - e.sailCondition);
    };
    expect(harm('apprentice')).toBeGreaterThan(harm('adventurer'));
  });
});
