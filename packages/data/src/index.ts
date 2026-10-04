import { z } from 'zod';
import caribbeanMap from '../content/maps/caribbean/map.json';
import settlementsJson from '../content/maps/caribbean/settlements.json';
import weatherJson from '../content/maps/caribbean/weather.json';
import windZonesJson from '../content/maps/caribbean/wind_zones.json';
import placeholderMap from '../content/maps/placeholder.json';
import navigationJson from '../content/navigation.json';
import polarsJson from '../content/polars.json';
import shipsJson from '../content/ships.json';
import spritesJson from '../content/sprites.json';
import {
  navigationSchema,
  polarSchema,
  proceduralMapSchema,
  rasterMapSchema,
  settlementSchema,
  shipClassSchema,
  spriteSchema,
  weatherSchema,
  windZonesSchema,
} from './schemas';
import type {
  NavigationConfig,
  Polar,
  ProceduralMapDef,
  RasterMapDef,
  Settlement,
  ShipClass,
  SpriteDef,
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
  };
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
