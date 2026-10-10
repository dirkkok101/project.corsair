// The career's pace (slice 8 of docs/design/combat-model.md, section 8): a scripted trader captain in the whole
// headless world, from the start in Port Royal. At each port he sells his hold, fills his battery and crew once he
// can spare the gold, buys a first upgrade later, then loads the good that pays best per day of sailing to a port
// within reach and sails there by the lanes. A ship that catches him is fought by the battle module (he runs).
// Prints the day each milestone fell, against the pace targets. Run by hand: pnpm probe:career (YEARS, SEED).
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim } from '@corsair/core';
import type { Command, Ship } from '@corsair/core';
import { decodeRasterMap, loadContent, placeSettlements, shipStats, upgradePrice } from '@corsair/data';
import { cargoUsed, crewOf, createEconomySystem, fleetBerths, fleetHold, foodDays, quote, rationPerDay, withEconomy } from '@corsair/systems-economy';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { createPoliticsSystem } from '@corsair/systems-politics';
import { createWeatherSystem, createWindField, withWeather } from '@corsair/systems-weather';
import { it } from 'vitest';
import { createBattle } from '../../minigame-sea-battle/src';
import { createSeaLanes, createTrafficSystem, withTraffic } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, { terrain: readFileSync(dir + def.layers.terrain), elevation: readFileSync(dir + def.layers.elevation), zones: readFileSync(dir + def.layers.zones) });
const settlements = placeSettlements(def, map, content.settlements);
const lanes = createSeaLanes(map, settlements, content.traffic.laneCell);
const windAt = createWindField(content, def, map);
const DAY = content.calendar.ticksPerDay;
const YEARS = Number(process.env.YEARS ?? 2);
const SEED = Number(process.env.SEED ?? 1);
const OUT = process.env.OUT ?? '/dev/stdout';
const say = (s: string) => appendFileSync(OUT, s + '\n');

it('career', () => {
  const seed = SEED;
  const start = { ...createWorld(def), tick: Math.round((def.startHour / 24) * DAY) };
  const world = withTraffic(withEconomy(withWeather(start, content, def, seed), content, settlements, seed), content, settlements, lanes, seed);
  const sim = createSim(world, [
    createWeatherSystem(content, def, map),
    createEconomySystem(content, settlements, map, windAt),
    createPoliticsSystem(content, def.startDate, settlements),
    createTrafficSystem(content, settlements, lanes, map, windAt),
    createNavigationSystem(content, map, windAt),
  ]);
  const send = (c: Command) => {
    sim.send(c);
    sim.applyCommands();
  };
  const me = () => sim.state.ships.player!;
  const gold = () => sim.state.captain!.gold;
  send({ type: 'Dock', shipId: 'player', settlementId: def.start.port! });
  const day = () => Math.floor(sim.state.tick / DAY);
  const marks: Record<string, number> = {};
  const mark = (k: string) => (marks[k] ??= day());
  let voyages = 0;
  let fights = 0;
  let stuck = 0;
  const outcomes: Record<string, number> = {};
  const byId = new Map(settlements.map((s) => [s.id, s]));
  // Sea days between two ports, by lane length at her speed.
  const daysTo = (from: [number, number], to: string) => {
    const end = lanes.berth(to);
    const route = end && lanes.path(from, end);
    if (!route) return undefined;
    let tiles = 0;
    for (let i = 1; i < route.length; i++) tiles += Math.hypot(route[i]![0] - route[i - 1]![0], route[i]![1] - route[i - 1]![1]);
    return { route, days: tiles / (shipStats(content, me()).speed * content.navigation.tilesPerSecondPerSpeedPoint * DAY / 30) };
  };
  const fight = (targetId: string) => {
    const them = sim.state.ships[targetId];
    if (!them) return;
    fights++;
    const b = createBattle(content, { map, wind: windAt(sim.state, me().x, me().y), player: me(), enemy: them, seed: (seed ^ sim.state.tick) >>> 0, bearingDeg: 90 });
    let g = 0;
    while (!b.result() && g++ < 30 * 600) b.step(1, 'runner');
    const result = b.result() ?? { outcome: 'fled' as const, player: b.state.ships.player, enemy: b.state.ships.enemy };
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    send({ type: 'BattleEnded', shipId: 'player', targetId, result: result as never });
    if (sim.state.prize) send({ type: 'TakePlunder', shipId: 'player', take: {}, volunteers: true, release: true });
  };
  let seen = sim.events().length;
  const until = YEARS * 365;
  while (day() < until) {
    const port = me().docked ? byId.get(me().docked!)! : undefined;
    if (port) {
      // Sell the hold (but the food), stock ten days' food, and pay the men what they are owed when there is no chest to divide.
      for (const [good, n] of Object.entries(me().cargo)) if (n > 0 && good !== 'food') send({ type: 'Sell', shipId: 'player', good, quantity: n });
      const short = Math.ceil((10 - foodDays(content, me())) * rationPerDay(content, me()));
      if (short > 0) send({ type: 'Buy', shipId: 'player', good: 'food', quantity: short });
      if (process.env.WAGES !== '0' && !(sim.state.captain!.chest ?? 0) && day() % 14 === 0) send({ type: 'PayWages', shipId: 'player' });
      if ((sim.state.captain!.record?.tradeProfit ?? 0) >= 2000) mark('trade 2,000 gold');
      // Rung 2: a full battery and crew, once it leaves him 1,500 to trade with.
      const stats = shipStats(content, me());
      const guns = stats.maxGuns - stats.guns;
      const men = fleetBerths(content, sim.state, me()) - crewOf(content, me());
      const fill = guns * content.combat.port.gunGold + men * content.combat.port.recruitGold;
      if (port.size !== 'hamlet' && (guns > 0 || men > 0) && gold() - fill >= 1500) {
        if (guns > 0) send({ type: 'BuyGuns', shipId: 'player', count: guns });
        if (men > 0) send({ type: 'Recruit', shipId: 'player', count: men });
      }
      const s2 = shipStats(content, me());
      if (s2.guns >= s2.maxGuns && crewOf(content, me()) >= fleetBerths(content, sim.state, me())) mark('full battery and crew (rung 2)');
      // A first upgrade (scantlings), once it leaves him 2,000.
      if (!me().upgrades?.length && port.size === 'city' && marks['full battery and crew (rung 2)'] !== undefined) {
        const price = upgradePrice(content, me().classId, 'scantlings').price;
        if (gold() - price >= 2000) send({ type: 'BuyUpgrade', shipId: 'player', upgradeId: 'scantlings' });
      }
      if (me().upgrades?.length) mark('first upgrade');
      if (gold() >= 10_000) mark('10,000 gold (a light frigate)');
      if (gold() >= 14_000) mark('14,000 gold (a frigate)');
      if (sim.state.captain!.morale !== undefined && (sim.state.captain!.chest ?? 0) > 0) send({ type: 'DividePlunder', shipId: 'player' });
      // The best trade per day of sailing from here.
      const market = sim.state.markets![port.id]!;
      const room = Math.max(0, fleetHold(content, sim.state, me()) - cargoUsed(me()));
      let best: { good: string; to: string; units: number; perDay: number; route: [number, number][] } | undefined;
      for (const to of settlements) {
        if (to.id === port.id || Math.hypot(to.x - port.x, to.y - port.y) > 400) continue;
        const trip = daysTo([me().x, me().y], to.id);
        if (!trip) continue;
        for (const g of content.goods) {
          const here = quote(content, port, g.id, market[g.id] ?? 0);
          const there = quote(content, to, g.id, sim.state.markets![to.id]![g.id] ?? 0);
          if (g.id === 'food') continue;
          const units = Math.min(room, Math.floor((gold() - Math.min(200, gold() * 0.2)) / here.buy), market[g.id] ?? 0, 60);
          if (units <= 0) continue;
          // Prices slide as he trades: count on half the margin.
          const perDay = ((there.sell - here.buy) * units * 0.5) / Math.max(0.5, trip.days);
          if (perDay > (best?.perDay ?? 0)) best = { good: g.id, to: to.id, units, perDay, route: trip.route };
        }
      }
      const to = best ?? (() => {
        // Nothing pays: sail empty to the nearest town.
        const t = settlements.filter((x) => x.id !== port.id && x.size !== 'hamlet').sort((a, b) => Math.hypot(a.x - port.x, a.y - port.y) - Math.hypot(b.x - port.x, b.y - port.y))[0]!;
        const trip = daysTo([me().x, me().y], t.id)!;
        return { good: '', to: t.id, units: 0, perDay: 0, route: trip.route };
      })();
      if (to.units) send({ type: 'Buy', shipId: 'player', good: to.good, quantity: to.units });
      send({ type: 'Undock', shipId: 'player' });
      const target = byId.get(to.to)!;
      send({ type: 'SetAssist', shipId: 'player', assist: 'course', x: target.x, y: target.y, portId: target.id, route: to.route.slice(1) });
      voyages++;
      const left = day();
      // Sail until she arrives (docking), a fight, or she is stuck.
      while (!me().docked && day() - left < 15 && day() < until) {
        sim.step(30);
        const evs = sim.events();
        for (; seen < evs.length; seen++) {
          const ev = evs[seen]!;
          if (ev.type === 'BattleJoined') fight(ev.entityIds[1]!);
          if (ev.type === 'CourseArrived' && ev.payload.portId) send({ type: 'Dock', shipId: 'player', settlementId: ev.payload.portId as string });
          if (ev.type === 'AssistEnded') {
            // Lost her course (aground, or a fight): dock if in reach, else plot again.
            const end = lanes.berth(target.id);
            const route = end && lanes.path([me().x, me().y], end);
            if (route) send({ type: 'SetAssist', shipId: 'player', assist: 'course', x: target.x, y: target.y, portId: target.id, route: route.slice(1) });
          }
        }
        // Struck to a pirate, or the plunder left waiting: settle it and go on.
        if (sim.state.prize) send({ type: 'TakePlunder', shipId: 'player', take: {}, volunteers: true, release: true });
      }
      if (!me().docked) {
        say(`  stuck at sea on day ${day()} bound for ${target.name}; put into port`);
        stuck++;
        const berth = lanes.berth(target.id) ?? [target.x, target.y];
        send({ type: 'Teleport', shipId: 'player', x: berth[0], y: berth[1] });
        send({ type: 'Dock', shipId: 'player', settlementId: target.id });
      }
    } else {
      // Neither in port nor bound anywhere (a refused undock or dock): put into the nearest port, a day later.
      sim.step(DAY);
      const near = settlements.filter((x) => x.size !== 'hamlet').sort((a, b) => Math.hypot(a.x - me().x, a.y - me().y) - Math.hypot(b.x - me().x, b.y - me().y))[0]!;
      const berth = lanes.berth(near.id) ?? [near.x, near.y];
      send({ type: 'Teleport', shipId: 'player', x: berth[0], y: berth[1] });
      send({ type: 'Dock', shipId: 'player', settlementId: near.id });
      seen = sim.events().length;
    }
  }
  say(`seed ${seed}, ${YEARS} years: ${voyages} voyages (${stuck} put into port by hand), ${fights} fights ${JSON.stringify(outcomes)}, gold ${gold().toLocaleString()}, trade profit ${(sim.state.captain!.record?.tradeProfit ?? 0).toLocaleString()}`);
  for (const [k, d] of Object.entries(marks)) say(`  day ${String(d).padStart(4)} (${(d / 30).toFixed(1)} months): ${k}`);
});
