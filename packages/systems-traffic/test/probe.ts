import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim } from '@corsair/core';
import type { Ship } from '@corsair/core';
import { decodeRasterMap, loadContent, placeSettlements } from '@corsair/data';
import type { ContentPack } from '@corsair/data';
import { createEconomySystem, normalStock, quote, withEconomy } from '@corsair/systems-economy';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { createWeatherSystem, createWindField, withWeather } from '@corsair/systems-weather';
import { createSeaLanes, createTrafficSystem, withTraffic } from '../src';

// The voyage probe (PRD section 6, traffic): the player sails back and forth between two ports on the
// course autopilot for `days`, and every pirate that runs her down is counted (and shaken off at once, so
// the voyage goes on). Alongside: merchants taken, pirates sunk by patrols, and pirate fights the player saw.

const base = loadContent();
const def = base.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});
const settlements = placeSettlements(def, map, base.settlements);
const lanes = createSeaLanes(map, settlements, base.traffic.laneCell);

export interface VoyageMeasures {
  voyages: number;
  /** Pirates that ran the player down. */
  attacks: number;
  /** Pirate-on-merchant fights, and patrol-on-pirate fights, over the whole sea. */
  merchantsTaken: number;
  piratesSunk: number;
  /** Fights between AI ships that happened within the player's sight. */
  fightsSeen: number;
  /** At the end, per unit, buying at the route's first port and selling at its second: the best good, and that margin at normal stock. */
  margin: { good: string; now: number; normal: number };
}

export function voyageProbe(
  route: [string, string],
  { days = 60, seed = 1, outfit = {}, content = base }: { days?: number; seed?: number; outfit?: Partial<Ship>; content?: ContentPack } = {},
): VoyageMeasures {
  const windAt = createWindField(content, def, map);
  const start = createWorld(def);
  const home = lanes.berth(route[0])!;
  const player = { ...start.ships.player!, x: home[0], y: home[1], guns: 10, crew: 75, ...outfit };
  const world = withTraffic(
    withEconomy(withWeather({ ...start, ships: { player } }, content, def, seed), content, settlements, seed),
    content,
    settlements,
    lanes,
    seed,
  );
  const sim = createSim(world, [
    createWeatherSystem(content, def, map),
    createEconomySystem(content, settlements, map),
    createTrafficSystem(content, settlements, lanes, map, windAt),
    createNavigationSystem(content, map, windAt),
  ]);
  const byId = new Map(settlements.map((s) => [s.id, s]));
  let bound = 1;
  const sail = () => {
    const me = sim.state.ships.player!;
    const to = byId.get(route[bound]!)!;
    const berth = lanes.berth(to.id)!;
    const path = lanes.path([me.x, me.y], berth);
    sim.send({ type: 'SetAssist', shipId: 'player', assist: 'course', x: to.x, y: to.y, portId: to.id, route: path?.slice(1) });
    sim.applyCommands();
  };
  sail();
  const m: VoyageMeasures = { voyages: 0, attacks: 0, merchantsTaken: 0, piratesSunk: 0, fightsSeen: 0, margin: { good: '', now: 0, normal: 0 } };
  let seen = sim.events().length;
  const end = days * content.calendar.ticksPerDay;
  while (sim.state.tick < end) {
    sim.step(10);
    const evs = sim.events();
    for (let i = seen; i < evs.length; i++) {
      const ev = evs[i]!;
      if (ev.type === 'BattleJoined' && ev.payload.by === 'enemy') {
        m.attacks++;
        // Shaken off: she leaves the player be a while, and the voyage goes on.
        const me = sim.state.ships.player!;
        const end = { hull: me.hull ?? 85, sailCondition: 100, crew: me.crew ?? 75, guns: me.guns ?? 10 };
        sim.send({ type: 'BattleEnded', shipId: 'player', targetId: ev.entityIds[1]!, result: { outcome: 'fled', player: end, enemy: { hull: 50, sailCondition: 100, crew: 50, guns: 8 } } });
        sim.applyCommands();
        sail();
      }
      if (ev.type === 'SeaFight') {
        if (ev.payload.winner === 'pirate') m.merchantsTaken++;
        else if (ev.payload.loser === 'pirate') m.piratesSunk++;
        const me = sim.state.ships.player!;
        if (Math.hypot((ev.payload.x as number) - me.x, (ev.payload.y as number) - me.y) <= content.traffic.sightTiles) m.fightsSeen++;
      }
      if (ev.type === 'CourseArrived' || (ev.type === 'AssistEnded' && ev.entityIds[0] === 'player')) {
        if (ev.type === 'CourseArrived') m.voyages++;
        bound = 1 - bound;
        sail();
      }
    }
    seen = sim.events().length;
  }
  const [a, b] = [byId.get(route[0])!, byId.get(route[1])!];
  const margin = (good: string, stock: (s: typeof a) => number) => quote(content, b, good, stock(b)).sell - quote(content, a, good, stock(a)).buy;
  for (const g of content.goods) {
    const normal = margin(g.id, (s) => normalStock(content, s, g.id));
    if (normal > m.margin.normal) m.margin = { good: g.id, normal, now: margin(g.id, (s) => sim.state.markets?.[s.id]?.[g.id] ?? 0) };
  }
  return m;
}
