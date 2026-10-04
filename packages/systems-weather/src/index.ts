import { dateOf, rngStream, seedRng } from '@corsair/core';
import type { EmittedEvent, Storm, System, WeatherState, Wind, WindStrength, WorldState } from '@corsair/core';
import { tileOf } from '@corsair/data';
import type { ContentPack, RasterMapDef, TileMap, WindZones } from '@corsair/data';

type Zone = WindZones['zones'][number];
export type WindAt = (state: WorldState, x: number, y: number) => Wind;

const normalizeDeg = (deg: number) => ((deg % 360) + 360) % 360;
/** Signed smallest difference a - b, in (-180, 180]. */
const diffDeg = (a: number, b: number) => {
  const d = normalizeDeg(a - b);
  return d > 180 ? d - 360 : d;
};

/** PRD section 3 seasons: dry December to May, wet (hurricane) June to November. */
export function seasonOf(month: number): 'dry' | 'wet' {
  return month >= 6 && month <= 11 ? 'wet' : 'dry';
}

/** The wind zone covering a tile: zones.png holds 0 for the default zone, i + 1 for zones[i]. */
export function zoneAt(content: ContentPack, map: TileMap, x: number, y: number): Zone {
  const { zones, defaultZone } = content.windZones;
  const tx = Math.min(map.width - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(map.height - 1, Math.max(0, Math.floor(y)));
  const v = map.zones[ty * map.width + tx] ?? 0;
  return zones[v - 1] ?? zones.find((z) => z.id === defaultZone)!;
}

/**
 * Wind inside a storm, or undefined outside it. Northern-hemisphere storms turn counter-clockwise
 * seen from above: due east of the eye the wind blows toward the north.
 */
export function stormWindAt(storm: Storm, x: number, y: number): Wind | undefined {
  const dx = x - storm.x;
  const dy = y - storm.y;
  const r = Math.hypot(dx, dy);
  if (r > storm.radius) return undefined;
  // Counter-clockwise tangent in east/north terms (map y grows southward): toward (east, north) = (dy, dx),
  // so its compass bearing is atan2(east, north) = atan2(dy, dx).
  const toBearing = normalizeDeg((Math.atan2(dy, dx) * 180) / Math.PI);
  return { fromDeg: normalizeDeg(toBearing + 180), strength: r < storm.radius * 0.6 ? 'gale' : 'strong' };
}

/** Wind at a tile: a storm wins, then the zone's weather, then the fallback global wind. */
export function createWindField(content: ContentPack, map: TileMap): WindAt {
  return (state, x, y) => {
    const weather = state.weather;
    if (!weather) return state.wind;
    for (const storm of weather.storms) {
      const wind = stormWindAt(storm, x, y);
      if (wind) return wind;
    }
    const zone = weather.zones[zoneAt(content, map, x, y).id];
    return zone ? { fromDeg: zone.fromDeg, strength: zone.strength } : state.wind;
  };
}

/** Adds weather and its RNG stream to a new world. */
export function withWeather(world: WorldState, content: ContentPack, def: RasterMapDef, seed: number): WorldState {
  const { weather, rng } = initialWeather(content, def, seed);
  return { ...world, weather, rng: { ...world.rng, weather: rng } };
}

/** Initial weather for a new game: every zone on its seasonal wind, no storms. */
export function initialWeather(content: ContentPack, def: RasterMapDef, seed: number) {
  const rng = rngStream(seedRng(seed, 'weather'));
  const season = seasonOf(dateOf(def.startDate, 0).month);
  const zones: WeatherState['zones'] = {};
  for (const zone of content.windZones.zones) {
    const prevailing = zone.seasons[season];
    zones[zone.id] = {
      fromDeg: normalizeDeg(prevailing.fromDeg + rng.range(-0.5, 0.5) * prevailing.spreadDeg),
      strength: rng.weighted<WindStrength>(prevailing.strength),
    };
  }
  return { weather: { zones, storms: [], nextStormId: 1 } satisfies WeatherState, rng: rng.state() };
}

/**
 * Zone winds drift every few hours within their season's spread, zone events (northers, calms)
 * come and go, and in hurricane season storms form, track west and recurve north (PRD section 3).
 */
export function createWeatherSystem(content: ContentPack, def: RasterMapDef, map: TileMap): System {
  const w = content.weather;
  const ticksPerDay = content.calendar.ticksPerDay;
  const checkTicks = Math.round((ticksPerDay * w.checkEveryHours) / 24);
  const { lonMin, lonMax, latMin, latMax } = def.bounds;
  // Equirectangular tiles are close to square; average the two axes for km conversions.
  const midLat = ((latMin + latMax) / 2) * (Math.PI / 180);
  const kmPerTile =
    (((lonMax - lonMin) / def.width) * 111.32 * Math.cos(midLat) + ((latMax - latMin) / def.height) * 110.57) / 2;
  const latOf = (y: number) => latMax - (y / def.height) * (latMax - latMin);
  const spawnArea = w.storms.spawnArea.map(([lon, lat]) => tileOf(def, lon, lat));
  const insideSpawn = (x: number, y: number) => {
    let hit = false;
    for (let i = 0, j = spawnArea.length - 1; i < spawnArea.length; j = i++) {
      const a = spawnArea[i]!;
      const b = spawnArea[j]!;
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };

  const spawnStorm = (
    weather: WeatherState,
    rng: ReturnType<typeof rngStream>,
    day: number,
    at?: { x: number; y: number },
  ): Storm => {
    let x = at?.x ?? 0;
    let y = at?.y ?? 0;
    if (!at) {
      const xs = spawnArea.map((p) => p.x);
      const ys = spawnArea.map((p) => p.y);
      do {
        x = rng.range(Math.min(...xs), Math.max(...xs));
        y = rng.range(Math.min(...ys), Math.max(...ys));
      } while (!insideSpawn(x, y));
    }
    return {
      id: `storm.${weather.nextStormId}`,
      x,
      y,
      radius: rng.range(...w.storms.radiusKm) / kmPerTile,
      headingDeg: rng.range(...w.storms.headingDeg),
      speed: rng.range(...w.storms.speedKmPerDay) / kmPerTile,
      endDay: day + Math.round(rng.range(...w.storms.lifetimeDays)),
    };
  };

  return {
    name: 'weather',
    command(state, command) {
      const weather = state.weather;
      if (!weather) return undefined;
      const rng = rngStream(state.rng?.weather ?? seedRng(0, 'weather'));
      const day = Math.floor(state.tick / ticksPerDay);
      if (command.type === 'SpawnStorm') {
        const storm = spawnStorm(weather, rng, day, command);
        return {
          state: {
            ...state,
            weather: { ...weather, storms: [...weather.storms, storm], nextStormId: weather.nextStormId + 1 },
            rng: { ...state.rng, weather: rng.state() },
          },
          events: [{ type: 'StormFormed', entityIds: [storm.id], payload: { x: storm.x, y: storm.y, debug: true } }],
        };
      }
      if (command.type === 'SetWind') {
        // Debug wind keys set the zone the player is in, ending any zone event there.
        const player = state.ships.player;
        if (!player) return undefined;
        const zone = zoneAt(content, map, player.x, player.y);
        const wind = { fromDeg: normalizeDeg(command.fromDeg), strength: command.strength };
        return {
          state: { ...state, weather: { ...weather, zones: { ...weather.zones, [zone.id]: wind } } },
          events: [{ type: 'WindChanged', entityIds: [zone.id], payload: { ...wind } }],
        };
      }
      return undefined;
    },
    tick(state) {
      const weather = state.weather;
      if (!weather) return { state, events: [] };
      const tick = state.tick + 1;
      const day = Math.floor(tick / ticksPerDay);
      const month = dateOf(def.startDate, day).month;
      const rng = rngStream(state.rng?.weather ?? seedRng(0, 'weather'));
      const events: EmittedEvent[] = [];

      // Storms move every tick; they turn north-east once past the recurve latitude.
      let storms = weather.storms.map((s) => {
        const recurve = latOf(s.y) > w.storms.recurveNorthOfLat;
        const turn = recurve ? Math.sign(diffDeg(45, s.headingDeg)) * (w.storms.recurveDegPerDay / ticksPerDay) : 0;
        const headingDeg = normalizeDeg(s.headingDeg + turn);
        const step = s.speed / ticksPerDay;
        const rad = (headingDeg * Math.PI) / 180;
        return { ...s, headingDeg, x: s.x + Math.sin(rad) * step, y: s.y - Math.cos(rad) * step };
      });
      storms = storms.filter((s) => {
        const alive = day < s.endDay && s.x > -s.radius && s.y > -s.radius && s.x < def.width + s.radius && s.y < def.height + s.radius;
        if (!alive) events.push({ type: 'StormDissipated', entityIds: [s.id], payload: { x: s.x, y: s.y } });
        return alive;
      });

      let zones = weather.zones;
      let nextStormId = weather.nextStormId;
      const season = seasonOf(month);

      if (tick % checkTicks === 0) {
        zones = { ...zones };
        for (const zone of content.windZones.zones) {
          const current = zones[zone.id]!;
          const prevailing = zone.seasons[season];
          const hoursFraction = w.checkEveryHours / 24;
          if (current.event && day < current.event.endDay) continue;
          if (current.event) {
            // Event over: back to the season's wind.
            zones[zone.id] = { fromDeg: prevailing.fromDeg, strength: rng.weighted<WindStrength>(prevailing.strength) };
            events.push({ type: 'WindEventEnded', entityIds: [zone.id], payload: { id: current.event.id } });
            continue;
          }
          const event = zone.events?.find((e) => e.months.includes(month) && rng.float() < e.chancePerDay * hoursFraction);
          if (event) {
            const endDay = day + Math.max(1, Math.round(rng.range(...event.durationDays)));
            zones[zone.id] = { fromDeg: event.fromDeg, strength: event.strength, event: { id: event.id, endDay } };
            events.push({ type: 'WindEventStarted', entityIds: [zone.id], payload: { id: event.id, endDay } });
            continue;
          }
          let { fromDeg, strength } = current;
          if (rng.float() < w.shiftChance) {
            fromDeg = fromDeg + rng.range(-w.maxShiftDeg, w.maxShiftDeg);
            // Stay within the season's spread around its prevailing direction.
            const off = diffDeg(fromDeg, prevailing.fromDeg);
            if (Math.abs(off) > prevailing.spreadDeg) fromDeg = prevailing.fromDeg + Math.sign(off) * prevailing.spreadDeg;
            fromDeg = normalizeDeg(fromDeg);
          }
          if (rng.float() < w.strengthChangeChance) strength = rng.weighted<WindStrength>(prevailing.strength);
          if (fromDeg !== current.fromDeg || strength !== current.strength) zones[zone.id] = { fromDeg, strength };
        }
      }

      if (tick % ticksPerDay === 0 && w.storms.months.includes(month)) {
        const chance = w.storms.spawnChancePerDay[String(month)] ?? 0;
        if (rng.float() < chance) {
          const storm = spawnStorm({ ...weather, nextStormId }, rng, day);
          nextStormId++;
          storms = [...storms, storm];
          events.push({ type: 'StormFormed', entityIds: [storm.id], payload: { x: storm.x, y: storm.y } });
        }
      }

      return {
        state: { ...state, weather: { zones, storms, nextStormId }, rng: { ...state.rng, weather: rng.state() } },
        events,
      };
    },
  };
}
