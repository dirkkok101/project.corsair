import { createSim, inPort } from '@corsair/core';
import type { BattleResult, Ship, WorldState } from '@corsair/core';
import { isLand, shipStats, tileAt } from '@corsair/data';
import { hoardRing, newsText, placeHoard, seawardHeading } from '@corsair/systems-economy';
import { angleOffWind, createNavigationSystem, createWorld, polarAt } from '@corsair/systems-navigation';
import { describe, expect, it } from 'vitest';
import { careerGoals, createTrafficSystem, topTen } from '../src';
import { content, def, map, settlements, lanes, windAt, day, world, ai, traffic0 } from './fixtures';

describe('the famous pirates', () => {
  const traffic = () => createTrafficSystem(content, settlements, lanes, map, windAt);
  const famous = (state: WorldState) => ai(state).filter((s) => s.ai!.famous);
  const result = (outcome: BattleResult['outcome']) => ({
    outcome,
    player: { hull: 60, sailCondition: 80, crew: 50, guns: 14 },
    enemy: { hull: 10, sailCondition: 40, crew: 30, guns: 6 },
  });

  it('the ten sail from their havens on the first day, over and above the population, and rank on the Top Ten', () => {
    const sim = world(3);
    sim.step(day);
    const ten = famous(sim.state);
    expect(ten).toHaveLength(content.pirates.captains.length);
    for (const def of content.pirates.captains) {
      const ship = ten.find((s) => s.ai!.famous === def.id)!;
      expect(ship).toMatchObject({ classId: def.classId, crew: shipStats(content, { classId: def.classId, upgrades: def.upgrades }).maxCrew, upgrades: def.upgrades, ai: { name: def.name, from: def.haven, role: 'pirate', temperament: def.temperament, crew: def.crew } });
    }
    expect(traffic0(sim.state).length).toBeLessThanOrEqual(content.traffic.population);
    const ranks = topTen(content, sim.state);
    expect(ranks).toHaveLength(11);
    expect(ranks[0]).toMatchObject({ id: 'morgan', wealth: 9000 });
    expect(ranks.find((r) => r.player)!.wealth).toBe(sim.state.captain!.gold);
  }, 30_000);

  it('as her war fame grows, a famous pirate of that rung swears to take her and hunts her; one at a time, each once', () => {
    const sim = world(3);
    sim.step(day);
    const [low] = content.pirates.rules.huntFame;
    // Famous enough for the bottom rung: one of its pirates swears, and the word goes out from his haven.
    const famed = createSim({ ...sim.state, captain: { ...sim.state.captain!, record: { ...sim.state.captain!.record, prizes: low } } }, [traffic()]);
    famed.step(day);
    const sworn = content.pirates.captains.filter((c) => famed.state.famous?.[c.id]?.sworn);
    expect(sworn).toHaveLength(1);
    expect(sworn[0]!.rung).toBe(2);
    expect(famed.state.famous![sworn[0]!.id]).toMatchObject({ sworn: true, revenge: true });
    expect(famed.events().some((e) => e.type === 'FamousSworn')).toBe(true);
    expect((famed.state.news ?? []).some((n) => n.kind === 'famousHunts')).toBe(true);
    // While he hunts her, no other swears.
    famed.step(day);
    expect(content.pirates.captains.filter((c) => famed.state.famous?.[c.id]?.sworn)).toHaveLength(1);
  }, 30_000);

  it('a prize makes her richer, and her deed is news by her name', () => {
    const sim = world(9);
    sim.step(day);
    const morgan = famous(sim.state).find((s) => s.ai!.famous === 'morgan')!;
    sim.send({ type: 'SpawnShip', role: 'merchant', from: 'town.port_royal', to: 'town.cartagena' });
    sim.applyCommands();
    const merchant = Object.keys(sim.state.ships).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    const m0 = sim.state.ships[merchant]!;
    // Halfway down the merchant's lane (by distance), on open water, Morgan alongside.
    const route = m0.ai!.route;
    const legs = route.slice(1).map((q, i) => Math.hypot(q[0] - route[i]![0], q[1] - route[i]![1]));
    const along = legs.reduce((t, l) => t + l, 0) / 2;
    let i = 0;
    let run = 0;
    while (run + legs[i]! < along) run += legs[i++]!;
    const f = (along - run) / legs[i]!;
    const [x0, y0] = route[i]!;
    const [x1, y1] = route[i + 1]!;
    const m = { ...m0, x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, crew: 5, cargo: { sugar: 10 }, ai: { ...m0.ai!, along, purse: 200 } };
    const ships = {
      ...sim.state.ships,
      player: { ...sim.state.ships.player!, docked: 'town.port_royal' },
      [merchant]: m,
      [morgan.id]: { ...morgan, x: m.x + 1, y: m.y, ai: { ...morgan.ai!, waitUntil: undefined, route, along } },
    };
    const fight = createSim({ ...sim.state, ships }, [traffic()]);
    fight.step(30);
    expect(fight.state.ships[merchant]).toBeUndefined();
    const sugar = content.goods.find((g) => g.id === 'sugar')!.basePrice;
    expect(fight.state.famous!.morgan!.wealth).toBe(9000 + 200 + 10 * sugar);
    expect(fight.state.news!.at(-1)).toMatchObject({ kind: 'famousTaken', captain: 'Henry Morgan', nation: 'england' });
    expect(newsText(content, fight.state.news!.at(-1)!, 'Port Royal')).toMatch(/^Henry Morgan has taken the English .+ off Port Royal\.$/);
  });

  it('a famous pirate in sight the first time is sighted once, and remembered', () => {
    const sim = world(4);
    sim.step(day);
    // Morgan under way down a merchant's lane, the player close by.
    sim.send({ type: 'SpawnShip', role: 'merchant', from: 'town.port_royal', to: 'town.cartagena' });
    sim.applyCommands();
    const lane = Object.values(sim.state.ships).at(-1)!;
    const morgan = famous(sim.state).find((s) => s.ai!.famous === 'morgan')!;
    const her = { ...morgan, x: lane.x, y: lane.y, ai: { ...morgan.ai!, waitUntil: undefined, route: lane.ai!.route, along: lane.ai!.along } };
    expect(inPort(her)).toBe(false);
    const near = createSim(
      { ...sim.state, ships: { ...sim.state.ships, [her.id]: her, player: { ...sim.state.ships.player!, docked: undefined, x: her.x + 1, y: her.y } } },
      [traffic()],
    );
    near.step(2);
    expect(near.events().filter((e) => e.type === 'FamousSighted').map((e) => e.payload.pirateId)).toEqual(['morgan']);
    expect(near.state.captain!.famousSeen).toEqual(['morgan']);
  });

  it('beaten, she gives up half her wealth and the captain gains fame; she lies low, then sails again in a new ship', () => {
    const sim = world(4);
    sim.step(day);
    const morgan = famous(sim.state).find((s) => s.ai!.famous === 'morgan')!;
    const r = content.pirates.rules;
    const fight = createSim({ ...sim.state, captain: { ...sim.state.captain!, chest: 0 } }, [traffic()]);
    fight.send({ type: 'BattleEnded', shipId: 'player', targetId: morgan.id, result: result('struck') });
    fight.applyCommands();
    const share = Math.round(9000 * r.wealthShare);
    expect(fight.state.captain!.chest).toBe((morgan.ai!.purse ?? 0) + share);
    expect(fight.state.captain!.record?.famousBeaten).toBe(1);
    expect(fight.events().find((e) => e.type === 'BattleOver')!.payload.famous).toEqual({ name: 'Henry Morgan', share, fame: content.politics.career.fame.war.famous });
    const back = fight.state.famous!.morgan!;
    expect(back).toMatchObject({ wealth: Math.round((9000 - share) * r.keeps), defeats: 1 });
    expect(back.returnAt).toBe(fight.state.tick + Math.round(r.returnDays * day));
    // The prize is just a ship under her own name; the pirate is not aboard her.
    expect(fight.state.prize!.ship.ai).toMatchObject({ name: 'Satisfaction', famous: undefined });
    expect(fight.state.news!.at(-1)).toMatchObject({ kind: 'famousBeaten', captain: 'Henry Morgan' });
    // He drops down the Top Ten, and says when he is due back.
    const ranks = topTen(content, fight.state);
    expect(ranks.find((x) => x.id === 'morgan')).toMatchObject({ wealth: back.wealth, returnAt: back.returnAt });
    expect(ranks[0]!.id).toBe('lolonnais');

    // Let the prize go, and come to the day he is due back: he sails from his haven in a new ship.
    fight.send({ type: 'TakePlunder', shipId: 'player', take: {}, volunteers: false, release: false });
    fight.applyCommands();
    const due = Math.ceil(back.returnAt! / day) * day;
    const later = createSim({ ...fight.state, tick: due - 2 }, [traffic()]);
    later.step(1);
    expect(famous(later.state).some((s) => s.ai!.famous === 'morgan')).toBe(false);
    later.step(1);
    const again = famous(later.state).find((s) => s.ai!.famous === 'morgan')!;
    expect(again).toMatchObject({ classId: 'ship.frigate', ai: { from: 'town.bluefields', name: 'Henry Morgan' } });
    expect(later.state.famous!.morgan!.returnAt).toBeUndefined();
  });

  /** Morgan struck to the player: his prize waiting on the plunder screen, and him a prisoner. */
  const struck = () => {
    const sim = world(4);
    sim.step(day);
    const morgan = famous(sim.state).find((s) => s.ai!.famous === 'morgan')!;
    const fight = createSim(sim.state, [traffic()]);
    fight.send({ type: 'BattleEnded', shipId: 'player', targetId: morgan.id, result: result('struck') });
    fight.applyCommands();
    return fight;
  };
  const settle = (fight: ReturnType<typeof struck>, captive?: 'hoard' | 'bounty' | 'free') => {
    fight.send({ type: 'TakePlunder', shipId: 'player', take: {}, volunteers: false, release: false, ...(captive ? { captive } : {}) });
    fight.applyCommands();
  };
  /** The day after his time lying low is up. */
  const dueDay = (state: WorldState) => {
    const due = Math.ceil(state.famous!.morgan!.returnAt! / day) * day;
    const later = createSim({ ...state, tick: due - 1 }, [traffic()]);
    later.step(1);
    return later;
  };

  it('taken, he is a prisoner: asked about his hoard he gives up a piece of its map, until the map is whole', () => {
    const fight = struck();
    expect(fight.state.prize!.captive).toBe('morgan');
    settle(fight, 'hoard');
    expect(fight.state.captain!.mapPieces).toEqual({ morgan: 1 });
    // His first piece places his hoard, near one of his haunts; it stays put through his defeats.
    const hoard = fight.state.famous!.morgan!.hoard!;
    expect(content.pirates.captains.find((c) => c.id === 'morgan')!.haunts).toContain(hoard.near);
    expect(fight.state.famous!.morgan!.defeats).toBe(1);
    expect(fight.events().at(-1)!.payload.captive).toEqual({ id: 'morgan', choice: 'hoard', pieces: 1 });
    // His whole map held, he has nothing more to give: he goes free instead.
    const whole = struck();
    const all = createSim({ ...whole.state, captain: { ...whole.state.captain!, mapPieces: { morgan: content.pirates.rules.mapPieces } } }, [traffic()]);
    settle(all, 'hoard');
    expect(all.state.captain!.mapPieces!.morgan).toBe(content.pirates.rules.mapPieces);
    expect(all.events().at(-1)!.payload.captive).toMatchObject({ choice: 'free' });
    // Sunk, there is no one to take.
    const sim = world(4);
    sim.step(day);
    const sunk = createSim(sim.state, [traffic()]);
    sunk.send({ type: 'BattleEnded', shipId: 'player', targetId: famous(sim.state).find((s) => s.ai!.famous === 'morgan')!.id, result: result('sunk') });
    sunk.applyCommands();
    expect(sunk.state.prize).toBeUndefined();
  });

  it('held for a bounty, he waits in irons: a deed any governor pays, and he does not sail again till then', () => {
    const fight = struck();
    settle(fight, 'bounty');
    expect(fight.state.captain!.deeds!.at(-1)).toEqual({ nation: 'pirate', role: 'pirate', kind: 'taken', tick: fight.state.tick, captive: 'morgan' });
    const later = dueDay(fight.state);
    expect(famous(later.state).some((s) => s.ai!.famous === 'morgan')).toBe(false);
  });

  it('set free (the default), the crew cheer and he leaves the captain be when he sails again, until fired on', () => {
    const fight = struck();
    const morale = fight.state.captain!.morale!;
    settle(fight);
    expect(fight.state.captain!.morale).toBe(Math.min(100, morale + content.pirates.rules.mercyMorale));
    expect(fight.state.famous!.morgan!.spared).toBe(true);
    const later = dueDay(fight.state);
    const morgan = famous(later.state).find((s) => s.ai!.famous === 'morgan')!;
    // Alongside him on the open sea (east of his haven on the Mosquito Coast): he doesn't give chase.
    const sea = { x: morgan.x + 15, y: morgan.y };
    const meet = (state: WorldState) => ({
        ...state,
        ships: {
          ...later.state.ships,
          // In a frigate: Morgan's rung of the career.
          player: { ...later.state.ships.player!, classId: 'ship.frigate', guns: 32, crew: 250, docked: undefined, x: sea.x + 3, y: sea.y },
          [morgan.id]: { ...morgan, x: sea.x, y: sea.y, ai: { ...morgan.ai!, waitUntil: undefined, route: [[sea.x, sea.y], [sea.x + 1, sea.y]], along: 0, calmUntil: undefined } },
        },
      }) as WorldState;
    // Not spared, he would come for her.
    const hunted = createSim(meet({ ...later.state, famous: { ...later.state.famous, morgan: { ...later.state.famous!.morgan!, spared: undefined } } }), [traffic()]);
    hunted.step(30);
    // Giving chase, or already alongside and joining battle.
    expect(hunted.state.ships[morgan.id]!.ai!.chasing || hunted.events().some((e) => e.type === 'BattleJoined' && e.entityIds.includes(morgan.id))).toBe(true);
    const off = createSim(meet(later.state), [traffic()]);
    off.step(30);
    expect(off.state.ships[morgan.id]!.ai!.chasing).toBeFalsy();
    expect(off.events().some((e) => e.type === 'BattleJoined' && e.entityIds.includes(morgan.id))).toBe(false);
    // Fire on him (alongside, in hailing range) and that is forgotten.
    const fire = createSim(meet(later.state), [traffic()]);
    fire.send({ type: 'Attack', shipId: 'player', targetId: morgan.id });
    fire.applyCommands();
    expect(fire.state.famous!.morgan!.spared).toBeUndefined();
  }, 30_000);

  it('sunk, a survivor picked from the water may carry a piece of his map', () => {
    const sure = { ...content, treasure: { ...content.treasure, survivorChance: 1 } };
    const sim = world(4);
    sim.step(day);
    const morgan = famous(sim.state).find((s) => s.ai!.famous === 'morgan')!;
    const sunk = (pack: typeof content, men: number) => {
      const fight = createSim(sim.state, [createTrafficSystem(pack, settlements, lanes, map, windAt)]);
      fight.send({ type: 'BattleEnded', shipId: 'player', targetId: morgan.id, result: { ...result('sunk'), salvage: { gold: 0, men } } });
      fight.applyCommands();
      return fight;
    };
    const picked = sunk(sure, 6);
    expect(picked.state.captain!.mapPieces).toEqual({ morgan: 1 });
    expect(picked.state.famous!.morgan!.hoard).toBeDefined();
    expect(picked.events().find((e) => e.type === 'BattleOver')!.payload.famous).toMatchObject({ name: 'Henry Morgan', piece: 1 });
    // No one picked up, no piece.
    expect(sunk(sure, 0).state.captain!.mapPieces).toBeUndefined();
  });

  /** A world a day old with Morgan's hoard placed and a piece of his map held, the player at `at` (or off the hoard). */
  const withMap = (at?: (h: NonNullable<ReturnType<typeof placeHoard>>) => [number, number]) => {
    const sim = world(4);
    sim.step(day);
    const hoard = placeHoard(content, map, settlements, 'morgan', 9000, 77)!;
    const [x, y] = at ? at(hoard) : hoard.landing;
    const state: WorldState = {
      ...sim.state,
      famous: { ...sim.state.famous, morgan: { ...sim.state.famous!.morgan!, hoard } },
      captain: { ...sim.state.captain!, chest: 0, mapPieces: { morgan: 1 } },
      ships: { ...sim.state.ships, player: { ...sim.state.ships.player!, docked: undefined, x, y } },
    };
    return { dig: createSim(state, [traffic()]), hoard };
  };
  const digThere = (sim: ReturnType<typeof withMap>['dig']) => {
    sim.send({ type: 'Dig', shipId: 'player' });
    sim.applyCommands();
    return sim.events().at(-1)!;
  };
  const isWater = (x: number, y: number) => !isLand(tileAt(map, x, y));

  it('digging off the hoard brings it up: the gold, fame, news, and revenge from a pirate never beaten', () => {
    const { dig, hoard } = withMap();
    const found = digThere(dig);
    expect(found).toMatchObject({ type: 'HoardFound', payload: { pirateId: 'morgan', gold: hoard.value, revenge: true } });
    expect(dig.state.captain!.chest).toBe(hoard.value);
    expect(dig.state.famous!.morgan).toMatchObject({ wealth: 9000 - hoard.value, revenge: true, hoard: { found: true } });
    expect(dig.state.news!.slice(-2).map((n) => n.kind)).toEqual(['hoardDug', 'famousRevenge']);
    // Dug up, there is nothing more there.
    expect(digThere(dig)).toMatchObject({ type: 'DigMissed', payload: { hint: null } });
  });

  it("a miss inside the search ring: the men see the landmark and say which way it lies; open sea, there's no beach", () => {
    const t = content.treasure.dig;
    // Off a beach some way from the hoard, still inside the one-piece ring.
    const spot = (h: NonNullable<ReturnType<typeof placeHoard>>): [number, number] => {
      for (let r = 4; r < 14; r += 0.5) {
        for (let a = 0; a < 360; a += 10) {
          const x = h.x + Math.sin((a * Math.PI) / 180) * r;
          const y = h.y - Math.cos((a * Math.PI) / 180) * r;
          const shore = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !isWater(x + dx! * 1.5, y + dy! * 1.5));
          const beachFar = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].every(
            ([dx, dy]) => isWater(x + dx!, y + dy!) || Math.hypot(x + dx! - h.x, y + dy! - h.y) > t.toleranceTiles + 2,
          );
          const ring = hoardRing(content, h, 1);
          if (isWater(x, y) && shore && beachFar && Math.hypot(ring.x - x, ring.y - y) < ring.r) return [x, y];
        }
      }
      throw new Error('no spot');
    };
    const { dig, hoard } = withMap(spot);
    const missed = digThere(dig);
    expect(missed.type).toBe('DigMissed');
    const hint = missed.payload.hint as { landmark: string; bearingDeg: number; tiles: number };
    expect(hint.landmark).toBe(hoard.landmark);
    const me = dig.state.ships.player!;
    const want = (Math.atan2(hoard.x - me.x, -(hoard.y - me.y)) * 180) / Math.PI;
    expect(Math.abs(((hint.bearingDeg - want + 540) % 360) - 180)).toBeLessThan(25);
    expect(dig.state.captain!.chest).toBe(0);
    // Far out at sea there is no beach to dig on.
    const open = withMap((h) => {
      for (let r = 8; ; r++) for (let a = 0; a < 360; a += 15) {
        const x = h.x + Math.sin((a * Math.PI) / 180) * r;
        const y = h.y - Math.cos((a * Math.PI) / 180) * r;
        if ([...Array(9)].every((_, i) => isWater(x + ((i % 3) - 1) * 3, y + (Math.floor(i / 3) - 1) * 3))) return [x, y];
      }
    });
    expect(digThere(open.dig)).toMatchObject({ type: 'DigRefused', payload: { reason: 'no-shore' } });
  });

  it('a famous pirate hunts the player only once her ship has grown to his rung: Morgan leaves a new brig be, and comes for a frigate', () => {
    const sim = world(4);
    sim.step(day);
    const morgan = famous(sim.state).find((s) => s.ai!.famous === 'morgan')!;
    let here: [number, number] | undefined;
    for (let y = 300; y < 1000 && !here; y += 7)
      for (let x = 300; x < 1500 && !here; x += 7)
        if (settlements.every((s) => Math.hypot(s.x - x, s.y - y) > 40) && lanes.clear([x, y], [x + 8, y]) && lanes.clear([x - 1, y], [x + 8, y])) here = [x, y];
    const meet = (player: Partial<Ship>, difficulty?: string) => {
      const s = createSim(
        {
          ...sim.state,
          ...(difficulty ? { difficulty } : {}),
          ships: {
            ...sim.state.ships,
            player: { ...sim.state.ships.player!, docked: undefined, x: here![0] + 8, y: here![1], ...player },
            [morgan.id]: { ...morgan, x: here![0], y: here![1], ai: { ...morgan.ai!, waitUntil: undefined, route: [here!, [here![0] - 0.5, here![1]]], along: 0 } },
          },
        },
        [traffic()],
      );
      s.step(30);
      return Boolean(s.state.ships[morgan.id]!.ai!.chasing);
    };
    expect(meet({ guns: 10, crew: 75 })).toBe(false);
    expect(meet({ classId: 'ship.frigate', guns: 32, crew: 230 })).toBe(true);
    // The difficulty moves when he notices: a half-manned frigate draws him only on the hardest level, a full one
    // not on the easiest.
    expect(meet({ classId: 'ship.frigate', guns: 20, crew: 200 })).toBe(false);
    expect(meet({ classId: 'ship.frigate', guns: 20, crew: 200 }, 'swashbuckler')).toBe(true);
    expect(meet({ classId: 'ship.frigate', guns: 32, crew: 230 }, 'apprentice')).toBe(false);
  }, 30_000);

  it('out for revenge he comes for the captain at any odds, from further off, until beaten', () => {
    const sim = world(4);
    sim.step(day);
    const coxon = famous(sim.state).find((s) => s.ai!.famous === 'coxon')!;
    // Open water, clear of every port's guns, and the captain a little beyond his usual sight on a clear line.
    const reach = content.combat.chase.chaseTiles + 4;
    let here: [number, number] | undefined;
    let at: [number, number] | undefined;
    for (let y = 300; y < 1000 && !at; y += 7)
      for (let x = 300; x < 1500 && !at; x += 7) {
        const far = settlements.every((s) => Math.hypot(s.x - x, s.y - y) > 40);
        const around = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
        if (far && around.every(([dx, dy]) => lanes.clear([x + dx!, y + dy!], [x + reach, y]))) {
          here = [x, y];
          at = [x + reach, y];
        }
      }
    // A great crew aboard: the odds are hopeless for him.
    const meet = (revenge: boolean) =>
      createSim(
        {
          ...sim.state,
          famous: { ...sim.state.famous, coxon: { ...sim.state.famous!.coxon!, ...(revenge ? { revenge: true } : {}) } },
          ships: {
            ...sim.state.ships,
            player: { ...sim.state.ships.player!, docked: undefined, x: at![0], y: at![1], crew: 600 },
            [coxon.id]: { ...coxon, x: here![0], y: here![1], ai: { ...coxon.ai!, waitUntil: undefined, route: [here!, [here![0] - 0.5, here![1]]], along: 0 } },
          },
        },
        [traffic()],
      );
    const calm = meet(false);
    calm.step(30);
    expect(calm.state.ships[coxon.id]!.ai!.chasing).toBeFalsy();
    const angry = meet(true);
    angry.step(30);
    expect(angry.state.ships[coxon.id]!.ai!.chasing).toBe(true);
    // Beaten, it is over.
    angry.send({ type: 'BattleEnded', shipId: 'player', targetId: coxon.id, result: result('sunk') });
    angry.applyCommands();
    expect(angry.state.famous!.coxon!.revenge).toBeUndefined();
  }, 30_000);

  it('striking to a famous pirate gives up the chest and the hold, and keeps the ships and the men', () => {
    const sim = world(4);
    sim.step(day);
    const morgan = famous(sim.state).find((s) => s.ai!.famous === 'morgan')!;
    const fleetShip = { id: 'fleet.1', name: 'Swallow', classId: 'ship.sloop', hull: content.ships['ship.sloop']!.hull, sailCondition: 100 };
    const start = {
      ...sim.state,
      captain: { ...sim.state.captain!, chest: 600, fleet: [fleetShip] },
      ships: { ...sim.state.ships, player: { ...sim.state.ships.player!, cargo: { sugar: 30, food: 10 }, crew: 90 } },
    };
    const yieldTo = createSim(start, [traffic()]);
    yieldTo.send({ type: 'BattleEnded', shipId: 'player', targetId: morgan.id, result: { ...result('lost'), outcome: 'yielded', player: { hull: 70, sailCondition: 80, crew: 90, guns: 18 } } });
    yieldTo.applyCommands();
    expect(yieldTo.state.captain!.chest).toBe(0);
    expect(yieldTo.state.ships.player!.cargo.sugar).toBeUndefined();
    expect(yieldTo.state.ships.player!.cargo.food).toBe(10);
    expect(yieldTo.state.captain!.fleet).toEqual([fleetShip]);
    expect(yieldTo.state.ships.player!.crew).toBe(90);
    expect(yieldTo.state.famous!.morgan!.wealth).toBeGreaterThan(9000);
  });

  it('losing to her makes her richer by the plunder chest', () => {
    const sim = world(4);
    sim.step(day);
    const grammont = famous(sim.state).find((s) => s.ai!.famous === 'grammont')!;
    const lose = createSim({ ...sim.state, captain: { ...sim.state.captain!, chest: 700 } }, [traffic()]);
    lose.send({ type: 'BattleEnded', shipId: 'player', targetId: grammont.id, result: result('lost') });
    lose.applyCommands();
    expect(lose.state.famous!.grammont!.wealth).toBe(4000 + 700);
    expect(lose.state.ships[grammont.id]!.ai!.famous).toBe('grammont');
  });
});

describe("the captain's goals", () => {
  const traffic = () => createTrafficSystem(content, settlements, lanes, map, windAt);

  it('a new career: arm her, man her, trade; each with its progress and where it gets done', () => {
    const sim = world(3);
    const goals = careerGoals(content, sim.state, settlements);
    const open = goals.filter((g) => !g.done);
    expect(open.slice(0, 3).map((g) => g.id)).toEqual(['guns', 'crew', 'trade']);
    expect(open[0]).toMatchObject({ have: 10, of: 18, unit: 'guns' });
    expect(settlements.find((s) => s.id === open[0]!.port)!.size).toBe('city');
    // Armed and manned, the next three move on.
    const ready = { ...sim.state, ships: { ...sim.state.ships, player: { ...sim.state.ships.player!, guns: 18, crew: 150 } } };
    expect(careerGoals(content, ready, settlements).filter((g) => !g.done).slice(0, 3).map((g) => g.id)).toEqual(['trade', 'prize', 'marque']);
  });

  it('the record: a pirate taken counts a prize and a pirate of her class beaten', () => {
    const sim = world(6);
    sim.send({ type: 'SpawnShip', role: 'pirate', from: 'town.tortuga', to: 'town.port_royal' });
    sim.applyCommands();
    const id = Object.keys(sim.state.ships).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    const fight = createSim(sim.state, [traffic()]);
    fight.send({ type: 'BattleEnded', shipId: 'player', targetId: id, result: { outcome: 'struck', player: { hull: 60, sailCondition: 80, crew: 50, guns: 14 }, enemy: { hull: 10, sailCondition: 40, crew: 9, guns: 6 } } });
    fight.applyCommands();
    expect(fight.state.captain!.record).toEqual({ prizes: 1, beaten: { [sim.state.ships[id]!.classId]: 1 } });
    expect(careerGoals(content, fight.state, settlements).find((g) => g.id === 'prize')!.done).toBe(true);
  });
});

describe('the new ships at sea', () => {
  it('pirates sail pinnaces and periaguas, merchants ketches and pinks, and only Spain patrols in half-galleys', () => {
    const ships = [1, 2, 3].flatMap((seed) => ai(world(seed).state));
    const sails = (role: string, classId: string) => ships.some((s) => s.ai!.role === role && s.classId === classId);
    expect(sails('pirate', 'ship.pinnace') || sails('pirate', 'ship.periagua')).toBe(true);
    expect(sails('merchant', 'ship.ketch') || sails('merchant', 'ship.pink')).toBe(true);
    for (const s of ships.filter((x) => x.classId === 'ship.half_galley')) expect([s.ai!.role, s.ai!.nation]).toEqual(['patrol', 'spain']);
  });
});

describe('fits at sea', () => {
  it('AI ships carry the fits of their role: navy planking and bronze, pirates copper and swivels, merchants nettings', () => {
    const sim = world(3);
    const fitted = (role: string) => ai(sim.state).filter((s) => s.ai!.role === role && !s.ai!.famous).flatMap((s) => s.upgrades ?? []);
    const allowed = (role: string) => Object.keys(content.traffic.fits[role] ?? {});
    for (const role of ['merchant', 'patrol', 'pirate']) for (const u of fitted(role)) expect(allowed(role)).toContain(u);
    expect(fitted('pirate').length + fitted('patrol').length + fitted('merchant').length).toBeGreaterThan(3);
  });

  it('the difficulty moves every AI captain, crew and fit: sharper and better fitted on the hardest level, the reverse on the easiest', () => {
    const at = (difficulty: string) => {
      const ships = ai(world(3, { ...createWorld(def), difficulty }).state).filter((s) => !s.ai!.famous);
      const grade = { green: 0, regular: 1, seasoned: 2, veteran: 3 } as const;
      const n = ships.length;
      return {
        gunnery: ships.reduce((t, s) => t + s.ai!.captain!.gunnery, 0) / n,
        crew: ships.reduce((t, s) => t + grade[s.ai!.crew!], 0) / n,
        fits: ships.reduce((t, s) => t + (s.upgrades?.length ?? 0), 0) / n,
      };
    };
    const easy = at('apprentice');
    const tuned = at('adventurer');
    const hard = at('swashbuckler');
    expect(easy.gunnery).toBeLessThan(tuned.gunnery - 10);
    expect(hard.gunnery).toBeGreaterThan(tuned.gunnery + 10);
    expect(easy.crew).toBeLessThan(tuned.crew);
    expect(hard.crew).toBeGreaterThan(tuned.crew);
    expect(easy.fits).toBeLessThan(tuned.fits);
    expect(hard.fits).toBeGreaterThan(tuned.fits);
  });
});

describe('the course autopilot, sailed like a seaman', () => {
  it('dead to windward she beats on boards near the way, and her boats tow her into the harbour she cannot beat into', () => {
    // Bridgetown to Port Royal into a west wind: the whole way upwind, and Port Royal's berth upwind in its harbour.
    const wind = { fromDeg: 270, strength: 'fresh' as const };
    const from = lanes.berth('town.bridgetown')!;
    const to = settlements.find((s) => s.id === 'town.port_royal')!;
    const route = lanes.path(from, lanes.berth(to.id)!)!;
    const w = createWorld(def);
    const start = { ...w, wind, ships: { player: { ...w.ships.player!, x: from[0], y: from[1], speed: 0, docked: undefined, assist: { mode: 'course' as const, x: to.x, y: to.y, portId: to.id, route: route.slice(1), tack: 'starboard' as const } } } };
    const sim = createSim(start, [createNavigationSystem(content, map, () => wind, settlements)]);
    // Off the straight way, and whether her boats ever took her in.
    let widest = 0;
    let towed = false;
    for (let s = 0; s < 900 && !sim.events().some((e) => e.type === 'CourseArrived'); s++) {
      sim.step(30);
      const p = sim.state.ships.player!;
      const [lx, ly] = [to.x - from[0], to.y - from[1]];
      widest = Math.max(widest, Math.abs(lx * (p.y - from[1]) - ly * (p.x - from[0])) / Math.hypot(lx, ly));
      towed ||= Boolean(p.assist?.towing);
    }
    expect(sim.events().some((e) => e.type === 'CourseArrived')).toBe(true);
    expect(towed).toBe(true);
    // Her boards keep near the way: a corridor either side, plus her last board's overshoot.
    expect(widest).toBeLessThan(content.navigation.course!.corridorTiles * 2);
  }, 120_000);

  it('before the wind she gybes on boards near the way, never ranging behind the islands', () => {
    // Île-à-Vache to Port Royal with the wind astern: on one long board she ran up behind the land south of Hispaniola,
    // past her waypoint, and circled there for good.
    const wind = { fromDeg: 90, strength: 'fresh' as const };
    const from = lanes.berth('town.ile_a_vache')!;
    const to = settlements.find((s) => s.id === 'town.port_royal')!;
    const route = lanes.path(from, lanes.berth(to.id)!)!;
    const w = createWorld(def);
    const start = { ...w, wind, ships: { player: { ...w.ships.player!, x: from[0], y: from[1], speed: 0, docked: undefined, assist: { mode: 'course' as const, x: to.x, y: to.y, portId: to.id, route: route.slice(1), tack: 'starboard' as const } } } };
    const sim = createSim(start, [createNavigationSystem(content, map, () => wind, settlements)]);
    // Off the leg she is on (from the last waypoint passed to the next).
    let widest = 0;
    for (let s = 0; s < 900 && !sim.events().some((e) => e.type === 'CourseArrived'); s++) {
      sim.step(30);
      const p = sim.state.ships.player!;
      const [a, b] = [p.assist?.from, p.assist?.route?.[0]];
      if (!a || !b) continue;
      const [lx, ly] = [b[0] - a[0], b[1] - a[1]];
      widest = Math.max(widest, Math.abs(lx * (p.y - a[1]) - ly * (p.x - a[0])) / Math.max(1, Math.hypot(lx, ly)));
    }
    expect(sim.events().some((e) => e.type === 'CourseArrived')).toBe(true);
    expect(widest).toBeLessThan(content.navigation.course!.corridorTiles / 2);
  }, 120_000);

  it('out of a harbour mouth with the wind dead ahead and no room to beat, her boats tow her clear', () => {
    // Cumaná to Margarita into a west wind: her cast-off heading runs before it into the Gulf of Cariaco, a dead end
    // too narrow to beat back out of; the way out lies upwind.
    const wind = { fromDeg: 270, strength: 'fresh' as const };
    const town = settlements.find((s) => s.id === 'town.cumana')!;
    const from = lanes.berth(town.id)!;
    const to = settlements.find((s) => s.id === 'town.margarita')!;
    const route = lanes.path(from, lanes.berth(to.id)!)!;
    const w = createWorld(def);
    const polar = content.polars[content.ships[w.ships.player!.classId]!.polar]!;
    const headingDeg = seawardHeading(map, { x: from[0], y: from[1] }, town, 0, (deg) => polarAt(polar, angleOffWind(deg, wind.fromDeg)) >= 0.5);
    const start = { ...w, wind, ships: { player: { ...w.ships.player!, x: from[0], y: from[1], headingDeg, speed: 0, docked: undefined, assist: { mode: 'course' as const, x: to.x, y: to.y, portId: to.id, route: route.slice(1), tack: 'starboard' as const } } } };
    const sim = createSim(start, [createNavigationSystem(content, map, () => wind, settlements)]);
    let towed = 0;
    for (let s = 0; s < 300 && !sim.events().some((e) => e.type === 'CourseArrived' || e.type === 'AssistEnded'); s++) {
      sim.step(30);
      if (sim.state.ships.player!.assist?.towing) towed++;
    }
    expect(sim.events().some((e) => e.type === 'CourseArrived')).toBe(true);
    // Towed only through the mouth, a few seconds: then she sails.
    expect(towed).toBeGreaterThan(0);
    expect(towed).toBeLessThan(20);
  }, 120_000);
});
