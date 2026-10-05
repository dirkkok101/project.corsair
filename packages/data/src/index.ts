import { z } from 'zod';
import calendarJson from '../content/calendar.json';
import economyJson from '../content/economy.json';
import goodsJson from '../content/goods.json';
import musicJson from '../content/music.json';
import caribbeanMap from '../content/maps/caribbean/map.json';
import settlementsJson from '../content/maps/caribbean/settlements.json';
import weatherJson from '../content/maps/caribbean/weather.json';
import windZonesJson from '../content/maps/caribbean/wind_zones.json';
import placeholderMap from '../content/maps/placeholder.json';
import navigationJson from '../content/navigation.json';
import polarsJson from '../content/polars.json';
import shipsJson from '../content/ships.json';
import spritesJson from '../content/sprites.json';
import trafficJson from '../content/traffic.json';
import {
  calendarSchema,
  economySchema,
  goodsSchema,
  musicSchema,
  navigationSchema,
  polarSchema,
  proceduralMapSchema,
  rasterMapSchema,
  settlementSchema,
  shipClassSchema,
  spriteSchema,
  trafficSchema,
  weatherSchema,
  windZonesSchema,
} from './schemas';
import type {
  Calendar,
  Economy,
  Goods,
  Music,
  NavigationConfig,
  Polar,
  ProceduralMapDef,
  RasterMapDef,
  Settlement,
  ShipClass,
  SpriteDef,
  Traffic,
  Weather,
  WindZones,
} from './schemas';

export * from './schemas';
export * from './tilemap';

export interface ContentPack {
  ships: Record<string, ShipClass>;
  polars: Record<string, Polar>;
  navigation: NavigationConfig;
  sprites: Record<string, SpriteDef>;
  maps: { placeholder: ProceduralMapDef; caribbean: RasterMapDef };
  settlements: Settlement[];
  windZones: WindZones;
  weather: Weather;
  calendar: Calendar;
  music: Music;
  goods: Goods['goods'];
  economy: Economy;
  traffic: Traffic;
}

/**
 * The content that decides how the world plays, for the save fingerprint: music and sprite
 * framing only change how it looks and sounds, so editing them must not flag old saves.
 */
export function gameplayContent(content: ContentPack): Omit<ContentPack, 'music' | 'sprites'> {
  const { music: _music, sprites: _sprites, ...rest } = content;
  return rest;
}

/** Validates the base content at boot; a bad pack throws with the Zod path of the first error. */
export function loadContent(): ContentPack {
  const ships = z.array(shipClassSchema).parse(shipsJson);
  const pack: ContentPack = {
    ships: Object.fromEntries(ships.map((s) => [s.id, s])),
    polars: z.record(z.string(), polarSchema).parse(polarsJson),
    navigation: navigationSchema.parse(navigationJson),
    sprites: z.record(z.string(), spriteSchema).parse(spritesJson),
    maps: { placeholder: proceduralMapSchema.parse(placeholderMap), caribbean: rasterMapSchema.parse(caribbeanMap) },
    settlements: z.array(settlementSchema).parse(settlementsJson),
    windZones: windZonesSchema.parse(windZonesJson),
    weather: weatherSchema.parse(weatherJson),
    calendar: calendarSchema.parse(calendarJson),
    music: musicSchema.parse(musicJson),
    goods: goodsSchema.parse(goodsJson).goods,
    economy: economySchema.parse(economyJson),
    traffic: trafficSchema.parse(trafficJson),
  };
  for (const r of Object.values(pack.traffic.roles)) {
    if (!pack.ships[r.classId]) throw new Error(`traffic: unknown class ${r.classId}`);
  }
  const goodIds = new Set(pack.goods.map((g) => g.id));
  for (const id of Object.keys(pack.economy.normalStock)) {
    if (!goodIds.has(id)) throw new Error(`economy: normal stock for unknown good ${id}`);
  }
  for (const [name, p] of Object.entries(pack.economy.profiles)) {
    for (const id of [...Object.keys(p.produces), ...Object.keys(p.consumes)]) {
      if (!goodIds.has(id)) throw new Error(`economy profile ${name}: unknown good ${id}`);
    }
  }
  for (const s of pack.settlements) {
    const profiles = pack.economy.settlementProfiles[s.id];
    if (!profiles) throw new Error(`economy: no profile for ${s.id}`);
    for (const p of profiles) if (!pack.economy.profiles[p]) throw new Error(`economy: ${s.id} has unknown profile ${p}`);
  }
  for (const ship of ships) {
    if (!pack.polars[ship.polar]) throw new Error(`${ship.id}: unknown polar ${ship.polar}`);
    if (!pack.sprites[ship.sprites.world]) throw new Error(`${ship.id}: unknown sprite ${ship.sprites.world}`);
  }
  for (const map of Object.values(pack.maps)) {
    if (!pack.ships[map.start.classId]) throw new Error(`${map.id}: unknown start class`);
  }
  const ids = new Set<string>();
  for (const s of pack.settlements) {
    if (ids.has(s.id)) throw new Error(`duplicate settlement ${s.id}`);
    ids.add(s.id);
  }
  if (!pack.windZones.zones.some((z) => z.id === pack.windZones.defaultZone)) {
    throw new Error(`wind zones: defaultZone ${pack.windZones.defaultZone} is not a zone`);
  }
  return pack;
}
