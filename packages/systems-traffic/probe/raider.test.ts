// The raider's opening (a hand-run balance probe, like career.test.ts): the opening a player actually plays. From
// Port Royal in the brig with 1,000 gold she carries luxuries to Santiago de Cuba and tobacco back, then fills her
// crew, food and battery and hunts pirates in the havens' waters (Île-à-Vache and Tortuga), fighting every pirate
// she meets with the battle module's aggressive autopilot (attacking only those no stronger than ODDS x her own
// strength; any that fall on her she fights), keeping every prize she can and signing on volunteers.
// After two won fights (or 30 days) she puts into Port Royal, sells her prizes at the shipwright, buys the best fit
// she can afford, refills and hunts again. Prints a dated line per milestone and a summary.
// Run by hand: pnpm probe:raider (DAYS, default 90; SEED; OUT).
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim, inPort } from '@corsair/core';
import type { Command, GameEvent, Nation, Ship } from '@corsair/core';
import { careerSettlements, decodeRasterMap, loadContent, placeSettlements, shipStats, upgradePrice } from '@corsair/data';
import { closedTo, crewOf, createEconomySystem, fleetBerths, foodDays, rationPerDay, withEconomy } from '@corsair/systems-economy';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { createPoliticsSystem, withPolitics } from '@corsair/systems-politics';
import { createWeatherSystem, createWindField, withWeather } from '@corsair/systems-weather';
import { it } from 'vitest';
import { createBattle } from '../../minigame-sea-battle/src';
import { createSeaLanes, createTrafficSystem, withTraffic } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, { terrain: readFileSync(dir + def.layers.terrain), elevation: readFileSync(dir + def.layers.elevation), zones: readFileSync(dir + def.layers.zones) });
// HAVENS=draw places a career's own ports, its pirate havens drawn from SEED (as the game does); else the classic set.
const settlements = placeSettlements(def, map, process.env.HAVENS === 'draw' ? careerSettlements(content, Number(process.env.SEED ?? 1)) : content.settlements);
const lanes = createSeaLanes(map, settlements, content.traffic.laneCell);
const windAt = createWindField(content, def, map);
const DAY = content.calendar.ticksPerDay;
const DAYS = Number(process.env.DAYS ?? 90);
const SEED = Number(process.env.SEED ?? 1);
const OUT = process.env.OUT ?? '/dev/stdout';
const say = (s: string) => appendFileSync(OUT, s + '\n');
const HOME = 'town.port_royal';
// The flag the career sails under (England's home is Port Royal), and where its opening sells luxuries: Santiago,
// unless that port is closed to the flag (at war), then the nearest open port that wants them.
const NATION = (process.env.NATION ?? 'england') as Nation;
const MARKETS = ['town.santiago_de_cuba', 'town.ile_a_vache', 'town.tortuga'];
// Where she hunts: the pirate havens nearest home (Tortuga always among them).
const HAUNTS = settlements
  .filter((s) => s.nation === 'pirate')
  .sort((a, b) => Math.hypot(a.x - settlements.find((x) => x.id === 'town.port_royal')!.x, a.y - settlements.find((x) => x.id === 'town.port_royal')!.y) - Math.hypot(b.x - settlements.find((x) => x.id === 'town.port_royal')!.x, b.y - settlements.find((x) => x.id === 'town.port_royal')!.y))
  .slice(0, 2)
  .map((s) => s.id);

it('raider', () => {
  const seed = SEED;
  const start = { ...createWorld(def), tick: Math.round((def.startHour / 24) * DAY) };
  const begun = withTraffic(withEconomy(withWeather(start, content, def, seed), content, settlements, seed), content, settlements, lanes, seed);
  const world = withPolitics({ ...begun, captain: { ...begun.captain!, nation: NATION, standing: { [NATION]: content.politics.flag.standing } } }, seed);
  const sim = createSim(world, [
    createWeatherSystem(content, def, map),
    createEconomySystem(content, settlements, map, windAt),
    createPoliticsSystem(content, def.startDate, settlements),
    createTrafficSystem(content, settlements, lanes, map, windAt),
    createNavigationSystem(content, map, windAt),
  ]);
  const byId = new Map(settlements.map((s) => [s.id, s]));
  const me = () => sim.state.ships.player!;
  const captain = () => sim.state.captain!;
  const gold = () => captain().gold;
  const day = () => Math.floor(sim.state.tick / DAY);
  let seen = sim.events().length;
  // Send a command and return the events it raised (a refusal among them).
  const send = (c: Command): GameEvent[] => {
    const before = sim.events().length;
    sim.send(c);
    sim.applyCommands();
    return sim.events().slice(before);
  };
  const refusal = (evs: GameEvent[]) => evs.find((e) => e.type.endsWith('Refused'))?.payload.reason as string | undefined;
  const log = (s: string) => say(`  day ${String(day()).padStart(3)}: ${s}`);

  const marks = new Set<string>();
  const mark = (k: string, detail = '') => {
    if (marks.has(k)) return;
    marks.add(k);
    log(`MILESTONE ${k}${detail}`);
  };
  const tally = { won: 0, lost: 0, other: 0, shipsSold: 0, prizeGold: 0, recruited: 0, volunteers: 0 };
  const goldMarks = () => {
    for (const g of [3000, 5000, 10000]) if (gold() >= g) mark(`first ${g.toLocaleString()} gold`, ` (${gold()})`);
    const s = shipStats(content, me());
    if (s.guns >= s.maxGuns) mark('full battery', ` (${s.guns} guns)`);
  };

  // What war means for her: enemy patrols that came after her, and ports that turned her away.
  const war = { patrolsChasing: new Set<string>(), refused: 0, changes: [] as string[], sworn: [] as string[] };
  const dock = (id: string) => {
    const evs = send({ type: 'Dock', shipId: 'player', settlementId: id });
    if (refusal(evs) === 'at-war') {
      war.refused++;
      log(`turned away at ${id}: at war`);
    }
    return evs;
  };
  const sellAll = () => {
    for (const [good, n] of Object.entries(me().cargo)) if (n > 0 && good !== 'food') send({ type: 'Sell', shipId: 'player', good, quantity: n });
  };
  const food = (days: number) => {
    const short = Math.ceil((days - foodDays(content, me())) * rationPerDay(content, me()));
    if (short > 0) send({ type: 'Buy', shipId: 'player', good: 'food', quantity: short });
  };
  const course = (to: string) => {
    const target = byId.get(to)!;
    const end = lanes.berth(to);
    const route = end && lanes.path([me().x, me().y], end);
    send({ type: 'SetAssist', shipId: 'player', assist: 'course', x: target.x, y: target.y, portId: to, route: route?.slice(1) });
  };

  // A fight, by the battle module (aggressive: closes and boards when it can); a prize is kept if it can be.
  const fought = new Map<string, number>();
  // She picks her fights as a sensible captain would: none she is outmatched in (men x (1 + guns / 10), the
  // measure pirates weigh her by). Pirates that fall on her she fights all the same.
  const ODDS = Number(process.env.ODDS ?? 1.25);
  const strength = (s: Ship) => crewOf(content, s) * (1 + shipStats(content, s).guns / 10);
  const fight = (targetId: string) => {
    const them = sim.state.ships[targetId];
    if (!them?.ai) return;
    fought.set(targetId, sim.state.tick);
    const men = crewOf(content, me());
    const purse = them.ai.purse ?? 0;
    const chest = captain().chest ?? 0;
    const b = createBattle(content, { map, wind: windAt(sim.state, me().x, me().y), player: me(), enemy: them, seed: (seed ^ sim.state.tick) >>> 0, bearingDeg: 90 });
    let g = 0;
    while (!b.result() && g++ < 30 * 600) b.step(1, 'aggressive');
    const result = b.result() ?? { outcome: 'escaped' as const, player: b.state.ships.player, enemy: b.state.ships.enemy };
    send({ type: 'BattleEnded', shipId: 'player', targetId, result: result as never });
    const won = result.outcome === 'sunk' || result.outcome === 'struck' || result.outcome === 'boarded';
    if (won) tally.won++;
    else if (result.outcome === 'lost' || result.outcome === 'yielded') tally.lost++;
    else tally.other++;
    let prize = '';
    if (sim.state.prize) {
      const p = sim.state.prize;
      const take = { ...p.ship.cargo };
      const captive = p.captive ? ('bounty' as const) : undefined;
      const kept = send({ type: 'TakePlunder', shipId: 'player', take, volunteers: true, release: false, keep: true, captive });
      const why = refusal(kept);
      if (why) send({ type: 'TakePlunder', shipId: 'player', take, volunteers: true, release: true, captive });
      tally.volunteers += p.volunteers;
      prize = why ? ` prize ${p.ship.classId.replace('ship.', '')} not kept (${why}), released` : ` prize ${p.ship.classId.replace('ship.', '')} KEPT`;
      prize += `, ${p.volunteers} volunteers`;
    }
    log(
      `fight ${them.ai.famous ? 'FAMOUS ' + them.ai.famous + ' ' : ''}${them.ai.role}/${them.classId.replace('ship.', '')} (${crewOf(content, them)} men, purse ${purse}) -> ${result.outcome}; men ${men} -> ${crewOf(content, me())} (lost ${Math.max(0, men - (result.player as { crew: number }).crew)}); chest ${chest} -> ${captain().chest ?? 0}; gold ${gold()}${prize}`,
    );
    return won;
  };

  // Sail to a port by the lanes; hunting, she turns on every pirate in sight and fights all who close.
  // Returns at the port (docked), or early when the hunt's end condition is met at sea.
  const voyage = (to: string, hunt?: { wins: () => boolean }) => {
    course(to);
    const left = day();
    let chasing: string | undefined;
    while (!me().docked && day() - left < 15 && day() < DAYS) {
      sim.step(30);
      for (const s of Object.values(sim.state.ships)) {
        if (s.ai?.role === 'patrol' && s.ai.chasing && !s.ai.target && !war.patrolsChasing.has(s.id)) {
          war.patrolsChasing.add(s.id);
          log(`a ${s.ai.nation} patrol (${s.classId.replace('ship.', '')}) comes after her`);
        }
      }
      while (seen < sim.events().length) {
        const e = sim.events()[seen++]!;
        if (e.type === 'WarDeclared' || e.type === 'PeaceSigned') war.changes.push(`d${day()} ${e.type === 'WarDeclared' ? 'war' : 'peace'} ${e.entityIds.join('-')}`);
        if (e.type === 'FamousSworn') {
          war.sworn.push(`d${day()} ${e.payload.pirateId}`);
          log(`${e.payload.pirateId} swears to take her (war fame ${e.payload.fame})`);
        }
        if (e.type === 'BattleJoined') {
          fight(e.entityIds[1]!);
          chasing = undefined;
          if (hunt?.wins()) return;
          course(to);
        }
        if (e.type === 'CourseArrived' && e.payload.portId) dock(e.payload.portId as string);
        if (e.type === 'AssistEnded' && e.entityIds[0] === 'player' && !me().docked) {
          chasing = undefined;
          course(to);
        }
      }
      if (sim.state.prize) send({ type: 'TakePlunder', shipId: 'player', take: {}, volunteers: true, release: true });
      if (!hunt || me().docked) continue;
      // The lookout: the nearest pirate in sight, run down and fired on once within hail.
      const pirates = Object.values(sim.state.ships)
        .filter((s) => s.ai?.role === 'pirate' && !inPort(s) && sim.state.tick - (fought.get(s.id) ?? -Infinity) > 2 * DAY && strength(s) <= strength(me()) * ODDS && Math.hypot(s.x - me().x, s.y - me().y) <= content.traffic.sightTiles)
        .sort((a, b) => Math.hypot(a.x - me().x, a.y - me().y) - Math.hypot(b.x - me().x, b.y - me().y));
      const near = pirates[0];
      if (near && Math.hypot(near.x - me().x, near.y - me().y) <= content.traffic.hailTiles) send({ type: 'Attack', shipId: 'player', targetId: near.id });
      else if (near && chasing !== near.id) {
        chasing = near.id;
        send({ type: 'SetAssist', shipId: 'player', assist: 'intercept', targetId: near.id });
      } else if (!near && chasing) {
        chasing = undefined;
        course(to);
      }
    }
    if (!me().docked && day() < DAYS) {
      log(`stuck at sea bound for ${to}; put into port`);
      const berth = lanes.berth(to)!;
      send({ type: 'Teleport', shipId: 'player', x: berth[0], y: berth[1] });
      dock(to);
    }
    seen = sim.events().length;
  };

  // Refit at Port Royal: sell the prizes, divide the chest, the best fit she can afford, then men, food and guns.
  const refit = (upgrade = true) => {
    for (const f of [...(captain().fleet ?? [])]) {
      const before = gold();
      const why = refusal(send({ type: 'SellShip', shipId: 'player', fleetId: f.id }));
      if (why) log(`prize ${f.classId.replace('ship.', '')} unsold (${why})`);
      else {
        tally.shipsSold++;
        tally.prizeGold += gold() - before;
        log(`sold prize ${f.classId.replace('ship.', '')} for ${gold() - before} (gold ${gold()})`);
      }
    }
    sellAll();
    if ((captain().chest ?? 0) > 0) {
      const chest = captain().chest!;
      const before = gold();
      send({ type: 'DividePlunder', shipId: 'player' });
      log(`divided chest ${chest}: captain's share ${gold() - before}`);
    }
    goldMarks();
    const fits = !upgrade ? [] : Object.keys(content.upgrades)
      .filter((u) => !me().upgrades?.includes(u))
      .map((u) => ({ u, price: upgradePrice(content, me().classId, u).price }))
      .filter((x) => x.price <= gold() - 500)
      .sort((a, b) => b.price - a.price);
    for (const { u, price } of fits) {
      const why = refusal(send({ type: 'BuyUpgrade', shipId: 'player', upgradeId: u }));
      if (!why) {
        log(`fitted ${u} for ${price} (gold ${gold()})`);
        mark('first upgrade', ` (${u})`);
        break;
      }
    }
    const crew = crewOf(content, me());
    // Men as gold allows, keeping back ten days' food for the whole crew.
    const berths = fleetBerths(content, sim.state, me());
    const foodGold = Math.ceil((10 * berths) / content.crew.rationMenPerUnit) * 4;
    const count = Math.min(berths - crew, Math.floor((gold() - foodGold) / content.combat.port.recruitGold));
    const evs = count > 0 ? send({ type: 'Recruit', shipId: 'player', count }) : send({ type: 'Recruit', shipId: 'player', count: berths - crew });
    const why = refusal(evs);
    // Broke: men on shares, up to half her berths (refused while she can pay).
    if (crewOf(content, me()) < Math.floor(berths * content.crew.shares.upTo)) send({ type: 'Recruit', shipId: 'player', count: berths, shares: true });
    tally.recruited += Math.max(0, crewOf(content, me()) - crew);
    log(`recruit: crew ${crew} -> ${crewOf(content, me())} of ${fleetBerths(content, sim.state, me())} berths${why ? ` (refused: ${why})` : ''}; gold ${gold()}`);
    food(10);
    const guns = shipStats(content, me()).guns;
    const gw = refusal(send({ type: 'BuyGuns', shipId: 'player', count: shipStats(content, me()).maxGuns - guns }));
    log(`guns ${guns} -> ${shipStats(content, me()).guns}${gw ? ` (${gw})` : ''}; food ${foodDays(content, me()).toFixed(0)} days; gold ${gold()}`);
    goldMarks();
  };

  say(`=== raider, seed ${seed}, ${DAYS} days ===`);
  dock(HOME);
  seen = sim.events().length;
  // The trade legs: luxuries to Santiago, tobacco home.
  const trade = () => {
    send({ type: 'Buy', shipId: 'player', good: 'luxuries', quantity: 999 });
    send({ type: 'Buy', shipId: 'player', good: 'food', quantity: 999 });
    log(`bought ${me().cargo.luxuries ?? 0} luxuries, food to ${foodDays(content, me()).toFixed(0)} days; gold ${gold()}`);
    send({ type: 'Undock', shipId: 'player' });
    const market = MARKETS.find((id) => byId.has(id) && !closedTo(content, sim.state, byId.get(id)!)) ?? MARKETS[0]!;
    log(`opening market: ${market}`);
    voyage(market);
    sellAll();
    log(`sold at Santiago: gold ${gold()} (trade profit ${captain().record?.tradeProfit ?? 0})`);
    send({ type: 'Buy', shipId: 'player', good: 'tobacco', quantity: 999 });
    food(10);
    log(`bought ${me().cargo.tobacco ?? 0} tobacco; gold ${gold()}`);
    send({ type: 'Undock', shipId: 'player' });
    voyage(HOME);
    sellAll();
    log(`sold at Port Royal: gold ${gold()} (trade profit ${captain().record?.tradeProfit ?? 0})`);
  };
  trade();
  const tradeProfit = captain().record?.tradeProfit ?? 0;
  refit(false);

  // The hunts.
  while (day() < DAYS) {
    // Too few men to hunt and too little gold to sign more: a trading round first, if there is gold to trade with.
    if (crewOf(content, me()) < fleetBerths(content, sim.state, me()) / 2 && gold() >= 300) {
      log(`short-handed (${crewOf(content, me())} men, gold ${gold()}): a trading round`);
      trade();
      if (me().docked) refit(false);
      if (gold() >= 300) continue;
    }
    const from = day();
    const wins0 = tally.won;
    // Two won fights, 30 days, or too few men left to hunt with (under half her berths, and fewer than she sailed with): home.
    const men0 = crewOf(content, me());
    const done = () =>
      tally.won - wins0 >= 2 || day() - from >= 30 || (crewOf(content, me()) < fleetBerths(content, sim.state, me()) / 2 && crewOf(content, me()) < men0);
    log(`hunt begins (crew ${crewOf(content, me())}, guns ${shipStats(content, me()).guns})`);
    send({ type: 'Undock', shipId: 'player' });
    let k = 0;
    while (!done() && day() < DAYS) {
      const haunt = HAUNTS[k++ % HAUNTS.length]!;
      voyage(haunt, { wins: done });
      if (me().docked && !done()) {
        food(10);
        send({ type: 'Undock', shipId: 'player' });
      }
    }
    if (day() >= DAYS) break;
    if (me().docked) send({ type: 'Undock', shipId: 'player' });
    voyage(HOME);
    log(`home from the hunt: ${tally.won - wins0} won, fleet ${(captain().fleet ?? []).length}`);
    if (me().docked) refit();
  }

  say(
    `summary seed ${seed}: day ${day()}, gold ${gold()}, chest ${captain().chest ?? 0}, crew ${crewOf(content, me())}, guns ${shipStats(content, me()).guns}, fits ${JSON.stringify(me().upgrades ?? [])}, fleet ${(captain().fleet ?? []).length}; ` +
      `ships sold ${tally.shipsSold} for ${tally.prizeGold} vs trade profit ${tradeProfit} (opening) / ${captain().record?.tradeProfit ?? 0} (all); ` +
      `fights won ${tally.won} lost ${tally.lost} other ${tally.other}; men recruited ${tally.recruited}, volunteers offered ${tally.volunteers}; morale ${Math.round(captain().morale ?? -1)}; ` +
      `flag ${NATION}: enemy patrols chasing ${war.patrolsChasing.size}, ports refused ${war.refused}, wars/peace ${JSON.stringify(war.changes)}; famous sworn ${JSON.stringify(war.sworn)}`,
  );
});
