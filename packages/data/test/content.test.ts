import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeRasterMap, isLand, loadContent, placeSettlements, startOf, Tile, tileAt, tileOf } from '../src';

const content = loadContent();
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

describe('ship sprites', () => {
  // The renderer picks `sail_{setting}_{point}[_{tack}][frame]`; every combination must exist.
  const expected = ['sail_furled'];
  for (const setting of ['full', 'half']) {
    for (const { id } of content.navigation.pointsOfSail) {
      if (id === 'run') expected.push(`sail_${setting}_run`);
      else if (id === 'irons') expected.push(...['p0', 'p1', 's0', 's1'].map((t) => `sail_${setting}_irons_${t}`));
      else expected.push(`sail_${setting}_${id}_p`, `sail_${setting}_${id}_s`);
    }
  }

  for (const ship of Object.values(content.ships)) {
    const def = content.sprites[ship.sprites.world]!;
    it(`${ship.id} lists every sail sprite`, () => {
      expect([...def.anims].sort()).toEqual([...expected].sort());
    });

    it(`${ship.id} has a frame file for every anim and facing`, () => {
      const missing = def.anims.flatMap((anim) =>
        Array.from({ length: def.facings }, (_, f) => `${ship.sprites.world}.${anim}.f${String(f).padStart(2, '0')}.png`),
      ).filter((file) => !existsSync(`${repoRoot}art/game/ships/${file}`));
      expect(missing).toEqual([]);
    });
  }
});

describe('caribbean map', () => {
  const def = content.maps.caribbean;
  const dir = `${repoRoot}packages/data/content/maps/caribbean/`;
  const map = decodeRasterMap(def, {
    terrain: readFileSync(dir + def.layers.terrain),
    elevation: readFileSync(dir + def.layers.elevation),
    zones: readFileSync(dir + def.layers.zones),
  });

  it('decodes every layer at the map size', () => {
    expect(map.tiles.length).toBe(def.width * def.height);
    expect(map.elevation.length).toBe(def.width * def.height);
    expect(map.zones.length).toBe(def.width * def.height);
  });

  it('only uses wind zone indices that exist (rebuild zones.png after editing wind_zones.json)', () => {
    const max = map.zones.reduce((m, v) => (v > m ? v : m), 0);
    expect(max).toBeLessThanOrEqual(content.windZones.zones.length);
  });

  it('puts known places on the right terrain', () => {
    const at = (lon: number, lat: number) => {
      const { x, y } = tileOf(def, lon, lat);
      return tileAt(map, x, y);
    };
    expect(isLand(at(-77.3, 18.1))).toBe(true); // inland Jamaica
    expect(at(-76.6, 18.1)).toBe(Tile.Mountain); // Blue Mountains, Jamaica
    expect(at(-75, 15)).toBe(Tile.Deep); // open Caribbean Sea
    expect(at(-78, 24)).toBe(Tile.Shallow); // Great Bahama Bank
  });

  it('starts the player on open water', () => {
    const { x, y } = startOf(def);
    expect(isLand(tileAt(map, x, y))).toBe(false);
  });

  it('snaps every settlement to the coast and has a sprite for it', () => {
    const placed = placeSettlements(def, map, content.settlements);
    expect(placed).toHaveLength(content.settlements.length);
    const town = content.sprites.settlement!;
    for (const s of placed) {
      const anim = s.type === 'haven' ? 'pirate.haven' : `${s.nation}.${s.size}`;
      expect(town.anims).toContain(anim);
      expect(existsSync(`${repoRoot}art/game/settlements/settlement.${anim}.png`)).toBe(true);
    }
  });
});
