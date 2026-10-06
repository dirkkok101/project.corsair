import { dateOf, rngStream, seedRng } from '@corsair/core';
import type { EmittedEvent, Storm, System, WeatherState, WeatherSystem, Wind, WindStrength, WorldState } from '@corsair/core';
import { isLand, tileOf } from '@corsair/data';
import type { ContentPack, RasterMapDef, Tile, TileMap, WindZones } from '@corsair/data';

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
  // Squared distances: exact on every engine, so the gale/strong boundary replays identically.
  const r2 = dx * dx + dy * dy;
  if (r2 > storm.radius * storm.radius) return undefined;
  // Counter-clockwise tangent in east/north terms (map y grows southward): toward (east, north) = (dy, dx),
  // so its compass bearing is atan2(east, north) = atan2(dy, dx).
  const toBearing = normalizeDeg((Math.atan2(dy, dx) * 180) / Math.PI);
  const gale = storm.radius * 0.6;
  return { fromDeg: normalizeDeg(toBearing + 180), strength: r2 < gale * gale ? 'gale' : 'strong' };
}

/** Kilometres per tile: equirectangular tiles are close to square, so the two axes are averaged. */
function kmPerTileOf(def: RasterMapDef): number {
  const { lonMax, lonMin, latMin, latMax } = def.bounds;
  const midLat = ((latMin + latMax) / 2) * (Math.PI / 180);
  return (((lonMax - lonMin) / def.width) * 111.32 * Math.cos(midLat) + ((latMax - latMin) / def.height) * 110.57) / 2;
}

/**
 * A weather system's wind at a tile, as a toward-vector in east/north wind-multiplier units, and how much
 * of the wind it sets there: maxBlend at the centre, none at its edge, faded in and out over fadeDays.
 * A low turns the wind anticlockwise (as a storm does), a high clockwise.
 */
export function systemWindAt(content: ContentPack, s: WeatherSystem, x: number, y: number, day: number) {
  const dx = x - s.x;
  const dy = y - s.y;
  const r2 = dx * dx + dy * dy;
  if (r2 >= s.radius * s.radius) return undefined;
  const c = content.weather.systems;
  const fade = Math.max(0, Math.min(1, (day - s.startDay) / c.fadeDays, (s.endDay - day) / c.fadeDays));
  const weight = c.maxBlend * fade * (1 - r2 / (s.radius * s.radius));
  if (weight <= 0) return undefined;
  // Anticlockwise tangent in east/north terms (map y grows southward) is (dy, dx); a high runs the other way.
  const sign = s.kind === 'low' ? 1 : -1;
  const len = Math.sqrt(r2) || 1;
  const m = content.navigation.windStrength[s.strength]!;
  return { east: (sign * dy * m) / len, north: (sign * dx * m) / len, weight };
}

/** Hour of the game day, 0 to 24, from the tick (a new game starts at midnight). */
export function hourOf(tick: number, ticksPerDay: number): number {
  return ((tick % ticksPerDay) / ticksPerDay) * 24;
}

export interface Breeze {
  kind: 'sea' | 'land';
  /** Toward-vector in east/north terms, in windStrength multiplier units. */
  east: number;
  north: number;
}

/**
 * Coastal sea and land breezes. Distance to land comes from a breadth-first pass over the coastal
 * band; the onshore direction is the downhill direction of that distance field.
 */
export function createBreezeField(content: ContentPack, def: RasterMapDef, map: TileMap) {
  const { reachKm, strength, seaBreezePeakHour } = content.weather.breeze;
  const { lonMin, lonMax, latMin, latMax } = def.bounds;
  const midLat = ((latMin + latMax) / 2) * (Math.PI / 180);
  const kmPerTile =
    (((lonMax - lonMin) / map.width) * 111.32 * Math.cos(midLat) + ((latMax - latMin) / map.height) * 110.57) / 2;
  const reach = Math.max(1, Math.round(reachKm / kmPerTile));
  const far = reach + 1;
  const { width: w, height: h } = map;
  const dist = new Uint8Array(w * h).fill(far);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < w * h; i++) {
    if (isLand(map.tiles[i]! as Tile)) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++]!;
    const d = dist[i]! + 1;
    if (d > reach) continue;
    const x = i % w;
    const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
    for (const j of neighbours) {
      if (j < 0 || j >= w * h || dist[j]! <= d) continue;
      dist[j] = d;
      queue[tail++] = j;
    }
  }
  const d = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? far : dist[y * w + x]!);

  return {
    /** 1 at the water's edge, falling to 0 at the edge of the coastal band (and 0 on land). */
    coastNearness(x: number, y: number): number {
      const here = d(Math.floor(x), Math.floor(y));
      return here === 0 || here > reach ? 0 : 1 - (here - 1) / reach;
    },
    /** The breeze at a water tile, or undefined beyond its reach, on land, or at the turn of the day. */
    at(tick: number, x: number, y: number): Breeze | undefined {
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      const here = d(tx, ty);
      if (here === 0 || here > reach) return undefined;
      // Toward land is down the distance field; map y grows southward, so north is -dy.
      const gx = d(tx + 1, ty) - d(tx - 1, ty);
      const gy = d(tx, ty + 1) - d(tx, ty - 1);
      const len = Math.hypot(gx, gy);
      if (len === 0) return undefined;
      // +1 at the sea-breeze peak hour, -1 twelve hours later (offshore land breeze).
      const cycle = Math.cos(((hourOf(tick, content.calendar.ticksPerDay) - seaBreezePeakHour) / 24) * 2 * Math.PI);
      const amount = strength * cycle * (1 - (here - 1) / reach);
      if (Math.abs(amount) < 0.05) return undefined;
      return { kind: amount > 0 ? 'sea' : 'land', east: (-gx / len) * amount, north: (gy / len) * amount };
    },
  };
}

/** Wind at a tile: a storm wins, then the zone's weather plus any coastal breeze, then the fallback global wind. */
export function createWindField(content: ContentPack, def: RasterMapDef, map: TileMap): WindAt {
  const breezes = createBreezeField(content, def, map);
  const multipliers = content.navigation.windStrength;
  const levels = (Object.entries(multipliers) as [WindStrength, number][]).sort((a, b) => a[1] - b[1]);
  return (state, x, y) => {
    const weather = state.weather;
    if (!weather) return state.wind;
    for (const storm of weather.storms) {
      const wind = stormWindAt(storm, x, y);
      if (wind) return wind;
    }
    const zone = weather.zones[zoneAt(content, map, x, y).id];
    if (!zone) return state.wind;
    const breeze = breezes.at(state.tick, x, y);
    const day = state.tick / content.calendar.ticksPerDay;
    const near = (weather.systems ?? []).map((s) => systemWindAt(content, s, x, y, day)).filter((v) => v !== undefined);
    if (!breeze && !near.length) return { fromDeg: zone.fromDeg, strength: zone.strength };
    // Add the breeze to the zone wind as vectors, blend in each weather system by its weight, then read
    // back a direction and the nearest strength.
    const to = ((zone.fromDeg + 180) * Math.PI) / 180;
    const m = multipliers[zone.strength]!;
    let east = Math.sin(to) * m + (breeze?.east ?? 0);
    let north = Math.cos(to) * m + (breeze?.north ?? 0);
    for (const v of near) {
      east = east * (1 - v.weight) + v.east * v.weight;
      north = north * (1 - v.weight) + v.north * v.weight;
    }
    const speed = Math.hypot(east, north);
    const strength = levels.reduce((best, l) => (Math.abs(l[1] - speed) < Math.abs(best[1] - speed) ? l : best))[0];
    const fromDeg = normalizeDeg((Math.atan2(east, north) * 180) / Math.PI + 180);
    return { fromDeg, strength };
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
  let weather: WeatherState = { zones, storms: [], nextStormId: 1, systems: [], nextSystemId: 1 };
  for (let i = 0; i < content.weather.systems.count[0]; i++) weather = formSystem(content, def, weather, rng, 0, true);
  return { weather, rng: rng.state() };
}

/** A new weather system somewhere over the map, already at full strength when `grown` (a new world). */
function formSystem(content: ContentPack, def: RasterMapDef, weather: WeatherState, rng: ReturnType<typeof rngStream>, day: number, grown = false): WeatherState {
  const c = content.weather.systems;
  const kmPerTile = kmPerTileOf(def);
  const n = weather.nextSystemId ?? 1;
  const kind = rng.float() < c.lowShare ? 'low' : 'high';
  const life = rng.range(...c.lifetimeDays);
  // A grown system started a while ago, so it doesn't fade in on the first day of a new world.
  const startDay = grown ? day - rng.range(c.fadeDays, life / 2) : day;
  const system: WeatherSystem = {
    id: `system.${n}`,
    kind,
    x: rng.range(0, def.width),
    y: rng.range(0, def.height),
    radius: rng.range(...c.radiusKm) / kmPerTile,
    headingDeg: rng.range(0, 360),
    speed: rng.range(...c.speedKmPerDay) / kmPerTile,
    strength: rng.weighted<WindStrength>(c.strength[kind] as Record<WindStrength, number>),
    startDay,
    endDay: startDay + life,
  };
  return { ...weather, systems: [...(weather.systems ?? []), system], nextSystemId: n + 1 };
}

/**
 * Zone winds drift every few hours within their season's spread, zone events (northers, calms)
 * come and go, and in hurricane season storms form, track west and recurve north (PRD section 3).
 */
export function createWeatherSystem(content: ContentPack, def: RasterMapDef, map: TileMap): System {
  const w = content.weather;
  const ticksPerDay = content.calendar.ticksPerDay;
  const checkTicks = Math.max(1, Math.round((ticksPerDay * w.checkEveryHours) / 24));
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
        const ended = weather.zones[zone.id]?.event;
        const events: EmittedEvent[] = [{ type: 'WindChanged', entityIds: [zone.id], payload: { ...wind } }];
        if (ended) events.push({ type: 'WindEventEnded', entityIds: [zone.id], payload: { id: ended.id } });
        return { state: { ...state, weather: { ...weather, zones: { ...weather.zones, [zone.id]: wind } } }, events };
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

      // Weather systems drift; one past its time (or off the map) breaks up, and new ones form.
      let systems = (weather.systems ?? [])
        .map((s) => {
          const rad = (s.headingDeg * Math.PI) / 180;
          const step = s.speed / ticksPerDay;
          return { ...s, x: s.x + Math.sin(rad) * step, y: s.y - Math.cos(rad) * step };
        })
        .filter((s) => day < s.endDay && s.x > -s.radius && s.y > -s.radius && s.x < def.width + s.radius && s.y < def.height + s.radius);
      let nextSystemId = weather.nextSystemId ?? 1;
      if (tick % ticksPerDay === 0) {
        const c = w.systems;
        const form = systems.length < c.count[0] || (systems.length < c.count[1] && rng.float() < c.spawnChancePerDay);
        if (form) {
          const formed = formSystem(content, def, { ...weather, systems, nextSystemId }, rng, day);
          systems = formed.systems!;
          nextSystemId = formed.nextSystemId!;
          events.push({ type: 'WeatherSystemFormed', entityIds: [systems.at(-1)!.id], payload: { kind: systems.at(-1)!.kind } });
        }
      }

      let zones = weather.zones;
      let nextStormId = weather.nextStormId;
      const season = seasonOf(month);

      if (tick % checkTicks === 0) {
        zones = { ...zones };
        for (const zone of content.windZones.zones) {
          const current = zones[zone.id]!;
          const prevailing = zone.seasons[season];
          const hoursFraction = w.checkEveryHours / 24;
          if (current.event && day < current.event.endDay) {
            // Variable winds: a fresh direction at every check while the spell lasts.
            if (current.event.variable) zones[zone.id] = { ...current, fromDeg: rng.range(0, 360) };
            continue;
          }
          if (current.event) {
            // Event over: back to the season's wind.
            zones[zone.id] = { fromDeg: prevailing.fromDeg, strength: rng.weighted<WindStrength>(prevailing.strength) };
            events.push({ type: 'WindEventEnded', entityIds: [zone.id], payload: { id: current.event.id } });
            continue;
          }
          const event = zone.events?.find((e) => e.months.includes(month) && rng.float() < e.chancePerDay * hoursFraction);
          if (event) {
            const endDay = day + Math.max(1, Math.round(rng.range(...event.durationDays)));
            const spread = event.spreadDeg ?? 0;
            zones[zone.id] = {
              fromDeg: normalizeDeg(event.fromDeg + rng.range(-spread, spread)),
              strength: event.strength,
              event: { id: event.id, endDay, ...(event.variable ? { variable: true } : {}) },
            };
            events.push({ type: 'WindEventStarted', entityIds: [zone.id], payload: { id: event.id, endDay } });
            continue;
          }
          let { fromDeg, strength } = current;
          // A wind left over from the last season jumps straight into this season's range.
          const seasonTurned = Math.abs(diffDeg(fromDeg, prevailing.fromDeg)) > prevailing.spreadDeg;
          if (seasonTurned || rng.float() < w.shiftChance) {
            fromDeg = seasonTurned ? prevailing.fromDeg : fromDeg + rng.range(-w.maxShiftDeg, w.maxShiftDeg);
            // Stay within the season's spread around its prevailing direction.
            const off = diffDeg(fromDeg, prevailing.fromDeg);
            if (Math.abs(off) > prevailing.spreadDeg) fromDeg = prevailing.fromDeg + Math.sign(off) * prevailing.spreadDeg;
            fromDeg = normalizeDeg(fromDeg);
          }
          if (seasonTurned || rng.float() < w.strengthChangeChance) {
            strength = rng.weighted<WindStrength>(prevailing.strength);
          }
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
        state: { ...state, weather: { zones, storms, nextStormId, systems, nextSystemId }, rng: { ...state.rng, weather: rng.state() } },
        events,
      };
    },
  };
}
