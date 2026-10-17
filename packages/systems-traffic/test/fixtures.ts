// The world the traffic tests sail: the map, its ports and lanes, the wind, and a full world by seed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim } from '@corsair/core';
import type { WorldState } from '@corsair/core';
import { decodeRasterMap, loadContent, placeSettlements } from '@corsair/data';
import { createEconomySystem, withEconomy } from '@corsair/systems-economy';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { createWeatherSystem, createWindField, withWeather } from '@corsair/systems-weather';
import { createSeaLanes, createTrafficSystem, withTraffic } from '../src';

export const content = loadContent();
export const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
export const map = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});
export const settlements = placeSettlements(def, map, content.settlements);
export const lanes = createSeaLanes(map, settlements, content.traffic.laneCell);
export const windAt = createWindField(content, def, map);
export const day = content.calendar.ticksPerDay;

export function world(seed: number, start: WorldState = createWorld(def), pack = content) {
  const w = withTraffic(withEconomy(withWeather(start, pack, def, seed), pack, settlements, seed), pack, settlements, lanes, seed);
  return createSim(w, [
    createWeatherSystem(pack, def, map),
    createEconomySystem(pack, settlements, map),
    createTrafficSystem(pack, settlements, lanes, map, windAt),
    createNavigationSystem(pack, map, windAt),
  ]);
}
export const ai = (state: WorldState) => Object.values(state.ships).filter((s) => s.ai);
/** The everyday traffic: AI ships less the convoys, which sail on a timetable of their own. */
// The population: the famous pirates sail over and above it (the merchants they tow are still the population's).
export const traffic0 = (state: WorldState) =>
  ai(state)
    .filter((s) => !s.ai!.convoy)
    .flatMap((s) => [...(s.ai!.famous ? [] : [s]), ...(s.ai!.prizes ?? []).filter((p) => p.takenFrom !== 'player')]);
