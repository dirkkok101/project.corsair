import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Ship } from '@corsair/core';
import { decodeRasterMap, loadContent } from '@corsair/data';
import { describe, expect, it } from 'vitest';
import { battleMap, createBattle } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const world = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});
const map = battleMap(content, world);
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

/** One fight to the end: the player's brig sails under `autopilot` (by default a gunner keeping her range). */
function fight(enemy: Ship, seed: number, autopilot: 'runner' | 'cautious' | 'aggressive' = 'cautious') {
  const battle = createBattle(content, {
    map,
    wind: { fromDeg: 70, strength: 'fresh' },
    player: ship('ship.brig', undefined, 0.5),
    enemy,
    seed,
    bearingDeg: 45 + seed * 37,
  });
  // Feel metrics: when the player's first broadside goes off, and how many she fires in all.
  let volleys = 0;
  let firstVolley: number | undefined;
  let guard = 0;
  while (!battle.result() && guard++ < 30 * 60 * 10) {
    const before = battle.state.ships.player.reload;
    battle.step(1, autopilot);
    const after = battle.state.ships.player.reload;
    if (after.port > before.port || after.starboard > before.starboard) {
      volleys++;
      firstVolley ??= battle.state.tick / 30;
    }
  }
  return Object.assign(battle, { volleys, firstVolley });
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

  it('grape shot fires at close range, and a broadside says why it will not fire', () => {
    // The enemy seated abeam to starboard of a brig heading north; a quick reload so she can't move far.
    const at = (apart: number) => {
      const quick = {
        ...content,
        combat: { ...content.combat, battle: { ...content.combat.battle, startApart: apart }, guns: { ...content.combat.guns, reloadSeconds: 0.1 } },
      };
      const battle = createBattle(quick, {
        map,
        wind: { fromDeg: 90, strength: 'fresh' },
        player: { ...ship('ship.brig'), headingDeg: 0 },
        enemy: ship('ship.fluyt', 'merchant'),
        seed: 5,
        bearingDeg: 90,
      });
      battle.send({ type: 'SetAmmo', ammo: 'grape' });
      battle.step(1);
      expect(battle.aim('starboard')).toBe('loading');
      battle.step(5);
      return battle;
    };
    const close = at(content.combat.guns.grapeTiles - 0.5);
    expect(close.aim('port')).toBe('no-target');
    expect(close.aim('starboard')).toBe('ready');
    close.send({ type: 'Fire', side: 'starboard' });
    close.step(1);
    expect(close.state.shots.some((s) => s.from === 'player' && s.ammo === 'grape')).toBe(true);
    // Round-shot range, but too far for grape: the broadside says so rather than failing silently.
    expect(at(content.combat.guns.rangeTiles - 0.5).aim('starboard')).toBe('out-of-range');
  });

  it('plays matchups with the outcomes the design intends (headless runner)', () => {
    const tally = (enemy: () => Ship, n = 40) => {
      const outcomes: Record<string, number> = {};
      let seconds = 0;
      let volleys = 0;
      const firsts: number[] = [];
      for (let seed = 1; seed <= n; seed++) {
        const b = fight(enemy(), seed);
        outcomes[b.result()!.outcome] = (outcomes[b.result()!.outcome] ?? 0) + 1;
        seconds += b.state.tick / 30;
        volleys += b.volleys;
        if (b.firstVolley !== undefined) firsts.push(b.firstVolley);
      }
      firsts.sort((a, b) => a - b);
      return {
        outcomes,
        seconds: Math.round(seconds / n),
        // Feel: seconds to the first broadside (median), and broadsides a minute across the fights.
        firstVolley: Math.round(firsts[Math.floor(firsts.length / 2)] ?? -1),
        volleysPerMinute: Math.round((volleys / (seconds / 60)) * 10) / 10,
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
});
