import { z } from 'zod';
import placeholderMap from '../content/maps/placeholder.json';
import navigationJson from '../content/navigation.json';
import polarsJson from '../content/polars.json';
import shipsJson from '../content/ships.json';
import spritesJson from '../content/sprites.json';
import { mapSchema, navigationSchema, polarSchema, shipClassSchema, spriteSchema } from './schemas';
import type { MapDef, NavigationConfig, Polar, ShipClass, SpriteDef } from './schemas';

export * from './schemas';
export * from './tilemap';

export interface ContentPack {
  ships: Record<string, ShipClass>;
  polars: Record<string, Polar>;
  navigation: NavigationConfig;
  sprites: Record<string, SpriteDef>;
  map: MapDef;
}

/** Validates the base content at boot; a bad pack throws with the Zod path of the first error. */
export function loadContent(): ContentPack {
  const ships = z.array(shipClassSchema).parse(shipsJson);
  const pack: ContentPack = {
    ships: Object.fromEntries(ships.map((s) => [s.id, s])),
    polars: z.record(z.string(), polarSchema).parse(polarsJson),
    navigation: navigationSchema.parse(navigationJson),
    sprites: z.record(z.string(), spriteSchema).parse(spritesJson),
    map: mapSchema.parse(placeholderMap),
  };
  for (const ship of ships) {
    if (!pack.polars[ship.polar]) throw new Error(`${ship.id}: unknown polar ${ship.polar}`);
    if (!pack.sprites[ship.sprites.world]) throw new Error(`${ship.id}: unknown sprite ${ship.sprites.world}`);
  }
  if (!pack.ships[pack.map.start.classId]) throw new Error(`${pack.map.id}: unknown start class`);
  return pack;
}
