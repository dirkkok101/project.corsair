import { createSim } from '@corsair/core';
import type { BattleResult, Ship, WorldState } from '@corsair/core';
import { isLand, tileAt } from '@corsair/data';
import { fleetShipPace, stockCap } from '@corsair/systems-economy';
import { targetSpeed } from '@corsair/systems-navigation';
import { describe, expect, it } from 'vitest';
import { createTrafficSystem } from '../src';
import { content, map, settlements, lanes, windAt, day, world, ai, traffic0 } from './fixtures';

describe('ships at sea', () => {
  it('start with the full population moored at home ports, by role', () => {
    const sim = world(1);
    const ships = ai(sim.state);
    // The population split by share, each role's count rounded.
    const roleCounts = Object.values(content.traffic.roles).map((r) => Math.round(content.traffic.population * r.share));
    expect(ships).toHaveLength(roleCounts.reduce((a, b) => a + b, 0));
    const roles = (r: string) => ships.filter((s) => s.ai!.role === r).length;
    // Each role's share of the population (traffic.json roles), rounded.
    for (const [role, def] of Object.entries(content.traffic.roles)) expect(roles(role), role).toBeCloseTo(content.traffic.population * def.share, -0.5);
    for (const s of ships) expect(isLand(tileAt(map, s.x, s.y))).toBe(false);
    // Pirates sail from havens under their own flag; the rest under their port's.
    for (const s of ships.filter((x) => x.ai!.role === 'pirate')) expect(s.ai!.nation).toBe('pirate');
  });

  it('each role sails a mix of classes, from her own', () => {
    const ships = ai(world(1).state);
    for (const role of ['merchant', 'patrol', 'pirate'] as const) {
      // Her role's classes, and those a nation adds for its own ships (byNation: Spain's half-galleys).
      const def = content.traffic.roles[role];
      const mix = [...Object.keys(def.classes!), ...('byNation' in def && def.byNation ? Object.values(def.byNation).flatMap((c) => Object.keys(c)) : [])];
      const sailed = new Set(ships.filter((s) => s.ai!.role === role).map((s) => s.classId));
      // A pirate grown big sails a brig (biggerPirates), whatever her mix.
      for (const c of sailed) expect([...mix, content.traffic.biggerPirates.classId], `${role} ${c}`).toContain(c);
    }
    expect(new Set(ships.filter((s) => s.ai!.role === 'merchant').map((s) => s.classId)).size).toBeGreaterThan(1);
  });

  it('sail a month on water, making voyages, with markets in bounds, and replay exactly', () => {
    const run = () => {
      const sim = world(7);
      for (let d = 0; d < 30; d++) {
        sim.step(day);
        // The where and why only for a ship that is on land (built for every ship, it slowed the run).
        const aground = ai(sim.state).find((s) => isLand(tileAt(map, s.x, s.y)));
        if (aground) {
          const s = aground;
          expect.fail(`${s.id} ${s.ai!.role} on land at day ${d}: ${JSON.stringify({ x: s.x, y: s.y, from: s.ai!.from, to: s.ai!.to, along: s.ai!.along, offset: s.ai!.offset, wait: s.ai!.waitUntil, route: s.ai!.route })}`);
        }
      }
      return sim;
    };
    const a = run();
    const departed = a.events().filter((e) => e.type === 'ShipDeparted');
    const arrived = a.events().filter((e) => e.type === 'ShipArrived');
    console.log('TRAFFIC voyages', departed.length, 'arrivals', arrived.length);
    expect(departed.length).toBeGreaterThan(20);
    expect(arrived.length).toBeGreaterThan(13);
    // Merchants really carried goods.
    expect(arrived.some((e) => Object.keys(e.payload.cargo as object).length > 0)).toBe(true);
    for (const s of settlements) {
      for (const g of content.goods) {
        expect(a.state.markets![s.id]![g.id]!).toBeLessThanOrEqual(Math.ceil(stockCap(content, a.state, s, g.id)));
        expect(a.state.markets![s.id]![g.id]!).toBeGreaterThanOrEqual(0);
      }
    }
    // Ships lost at sea are made good one a day per role, so a fight late in the month can leave one short; a
    // merchant taken counts while a pirate has her in tow, till sold, and the sea tops up her role meanwhile.
    expect(traffic0(a.state).length).toBeLessThanOrEqual(content.traffic.population + 2);
    expect(traffic0(a.state).length).toBeGreaterThanOrEqual(content.traffic.population - 2);
    expect(run().hash()).toBe(a.hash());
    // A month sailed twice; the gate runs every test file at once, so give it room.
  }, 120_000);

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
    // A point `k` tiles down her lane from the haven.
    const along = (k: number) => {
      const route = pirate.ai!.route;
      let left = k;
      for (let i = 1; i < route.length; i++) {
        const [[x0, y0], [x1, y1]] = [route[i - 1]!, route[i]!];
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (left <= len) return { x: x0 + ((x1 - x0) / len) * left, y: y0 + ((y1 - y0) / len) * left };
        left -= len;
      }
      throw new Error('lane too short');
    };
    // Off her haven the brethren keep a truce: the player six tiles ahead there is let be.
    const truce = content.combat.chase.havenTruceTiles;
    const at = (pk: number, mk: number) => {
      const s0 = { ...sim.state, ships: { ...sim.state.ships, [id]: { ...pirate, ...along(pk) }, player: { ...sim.state.ships.player!, ...along(mk) } } };
      const sea = createSim(s0, [traffic()]);
      sea.step(30 * 20);
      return sea.events().some((e) => e.type === 'BattleJoined' && e.entityIds[1] === id);
    };
    expect(at(2, 8)).toBe(false);
    // Past it, within sight on her own lane (open water), she gives chase and closes to battle.
    expect(at(truce + 10, truce + 16)).toBe(true);
  });

  it('a pirate leads the player across her bow, and gathers way from rest as the player does', () => {
    const sim = world(5);
    const { id } = spawnAlongside(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    // Open water south of Jamaica; the player 10 tiles dead downwind of the pirate (an easy run, no tacking),
    // crossing at a good pace.
    const here = { x: 1320, y: 1060 };
    const down = windAt(sim.state, here.x, here.y).fromDeg + 180;
    const rad = (down * Math.PI) / 180;
    const player = { ...sim.state.ships.player!, docked: undefined, x: here.x + Math.sin(rad) * 10, y: here.y - Math.cos(rad) * 10, headingDeg: (down + 90) % 360, speed: 4 };
    const pirate = { ...sim.state.ships[id]!, ...here, headingDeg: down, speed: 0, ai: { ...sim.state.ships[id]!.ai!, waitUntil: undefined, route: [[here.x, here.y], [here.x - 0.5, here.y]] as [number, number][], along: 0 } };
    const sea = createSim({ ...sim.state, ships: { ...sim.state.ships, player, [id]: pirate } }, [traffic()]);
    sea.step(30);
    const early = sea.state.ships[id]!;
    expect(early.ai!.chasing).toBe(true);
    // A second on she is still gathering way, as the player's ship would be.
    expect(early.speed).toBeGreaterThan(0);
    expect(early.speed).toBeLessThan(targetSpeed(content, { ...early, sails: 'full' }, windAt(sea.state, early.x, early.y)) * 0.6);
    // She steers ahead of the player, toward where she'll be, not at where she is.
    const bearing = (Math.atan2(player.x - early.x, -(player.y - early.y)) * 180) / Math.PI;
    const ahead = (((early.headingDeg - bearing) % 360) + 540) % 360 - 180;
    expect(ahead).toBeGreaterThan(10);
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

  it('a ship carried by boarding gives up more gold and cargo than one that strikes', () => {
    const sim = world(6);
    const { id, near } = spawnAlongside(sim, 'merchant', 'town.port_royal', 'town.cartagena');
    const prize = { ...near.ships[id]!, cargo: { sugar: 12 }, ai: { ...near.ships[id]!.ai!, purse: 300 } };
    const fight = createSim({ ...near, ships: { ...near.ships, [id]: prize } }, [traffic()]);
    fight.send({ type: 'Attack', shipId: 'player', targetId: id });
    fight.applyCommands();
    fight.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('boarded') });
    fight.applyCommands();
    const loot = content.combat.boarding.loot;
    expect(loot).toBeGreaterThan(1);
    expect(fight.state.captain!.chest).toBe(Math.round(300 * loot));
    expect(fight.state.prize!.ship.cargo.sugar).toBe(Math.round(12 * loot));
    expect(fight.events().find((e) => e.type === 'BattleOver')!.payload.purse).toBe(Math.round(300 * loot));
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
    // Let go, she speaks well of you at home.
    expect(fight.state.captain!.standing!.england).toBe(content.combat.standing.attack + content.combat.standing.mercy);
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
    // Sunk after she struck: her nation hears of it.
    expect(fight.state.captain!.standing!.england ?? 0).toBe(content.combat.standing.scuttle);
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

  it('keeping a prize: she joins the fleet with her hold, unless the fleet is full or short of men', () => {
    const sim = world(6);
    const { id, near } = spawnAlongside(sim, 'merchant', 'town.port_royal', 'town.cartagena');
    const laden = { ...near, ships: { ...near.ships, [id]: { ...near.ships[id]!, cargo: { sugar: 120 } } } };
    const take = (state: WorldState, keep: boolean) => {
      const fight = createSim(state, [traffic()]);
      fight.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('boarded') });
      fight.applyCommands();
      fight.send({ type: 'TakePlunder', shipId: 'player', take: { sugar: 120 }, volunteers: false, release: false, keep });
      fight.applyCommands();
      return fight;
    };
    const kept = take(laden, true);
    expect(kept.state.captain!.fleet).toMatchObject([{ id, classId: 'ship.fluyt', hull: 10 }]);
    // Her hold joins the fleet's, so all 120 of her sugar comes aboard; the fleet keeps her pace.
    expect(kept.state.ships.player!.cargo.sugar).toBe(120);
    // The fleet keeps her pace, slowed by the damage she took until a shipwright mends her.
    expect(kept.state.ships.player!.fleetSpeed).toBe(fleetShipPace(content, kept.state.captain!.fleet![0]!));
    // Not kept, the brig's hold takes what it can.
    const aboard = Object.values(laden.ships.player!.cargo).reduce((n, u) => n + u, 0);
    expect(take(laden, false).state.ships.player!.cargo.sugar).toBe(content.ships['ship.brig']!.cargo - aboard);

    const fleetFull = { ...laden, captain: { ...laden.captain!, fleet: Array.from({ length: 7 }, (_, k) => ({ id: `f${k}`, name: `F${k}`, classId: 'ship.sloop', hull: 45, sailCondition: 100 })) } };
    const full = take({ ...fleetFull, ships: { ...fleetFull.ships, player: { ...fleetFull.ships.player!, crew: 150 } } }, true);
    expect(full.events().at(-1)).toMatchObject({ type: 'PlunderRefused', payload: { reason: 'fleet-full' } });
    const few = take({ ...laden, ships: { ...laden.ships, player: { ...laden.ships.player!, crew: 20 } } }, true);
    expect(few.events().at(-1)).toMatchObject({ type: 'PlunderRefused', payload: { reason: 'too-few-men' } });
  });

  it('a pirate who beats you takes what her hold carries, and keeps it, with the chest in her purse', () => {
    const sim = world(8);
    const { id, near } = spawnAlongside(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const room = content.ships['ship.sloop']!.cargo;
    const laden: WorldState = {
      ...near,
      captain: { ...near.captain!, chest: 300 },
      ships: { ...near.ships, [id]: { ...near.ships[id]!, cargo: {}, ai: { ...near.ships[id]!.ai!, purse: 100 } }, player: { ...near.ships.player!, cargo: { luxuries: 30, sugar: 30, food: 10 } } },
    };
    const lose = createSim(laden, [traffic()]);
    lose.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: result('lost') });
    lose.applyCommands();
    // The dearest first, as far as her hold goes; the rations stay.
    expect(lose.state.ships[id]!.cargo).toEqual({ luxuries: 30, sugar: room - 30 });
    expect(lose.state.ships.player!.cargo).toEqual({ sugar: 60 - room, food: 10 });
    expect(lose.state.ships[id]!.ai!.purse).toBe(400);
  });

  it('only the flagship fights: her berths of the fleet\'s men, and only they can fall', () => {
    const sim = world(8);
    const { id, near } = spawnAlongside(sim, 'pirate', 'town.tortuga', 'town.port_royal');
    const fleet = [{ id: 'f1', name: 'Endeavour', classId: 'ship.fluyt', hull: 70, sailCondition: 100 }];
    const big = { ...near, captain: { ...near.captain!, fleet }, ships: { ...near.ships, player: { ...near.ships.player!, crew: 200 } } };
    const won = createSim(big, [traffic()]);
    // The brig fought with 150 of her 200 men and came out with 140.
    won.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: { ...result('sunk'), player: { ...result('sunk').player, crew: 140 } } });
    won.applyCommands();
    expect(won.state.ships.player!.crew).toBe(190);
  });
});

describe('pirates lying in wait', () => {
  it('cruise slow circles on watch, never dead still, never far from their spot, never ashore', () => {
    const sim = world(3);
    let lurkers: Ship[] = [];
    for (let d = 0; d < 20 && !lurkers.length; d++) {
      sim.step(day);
      lurkers = ai(sim.state).filter((s) => s.ai!.role === 'pirate' && s.ai!.route.length && (s.ai!.waitUntil ?? 0) > sim.state.tick + 120);
    }
    expect(lurkers.length).toBeGreaterThan(0);
    const before = new Map(lurkers.map((s) => [s.id, { x: s.x, y: s.y }]));
    sim.step(60);
    for (const [id, at] of before) {
      const s = sim.state.ships[id];
      if (!s || s.ai!.chasing || s.ai!.target) continue;
      const moved = Math.hypot(s.x - at.x, s.y - at.y);
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThan(6);
      expect(isLand(tileAt(map, s.x, s.y))).toBe(false);
    }
  });
});
