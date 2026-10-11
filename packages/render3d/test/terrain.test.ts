import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeRasterMap, isLand, loadContent, placeSettlements } from '@corsair/data';
import type { Tile } from '@corsair/data';
import { describe, expect, it } from 'vitest';
import { groundShape } from '../src/terrain';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, { terrain: readFileSync(dir + def.layers.terrain), elevation: readFileSync(dir + def.layers.elevation), zones: readFileSync(dir + def.layers.zones) });

describe('the 3D ground', () => {
  it('keeps the coast where the map has it: every land tile and every town stands above the sea', () => {
    const { heightAt } = groundShape(map);
    let drowned = 0;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (isLand(map.tiles[y * map.width + x] as Tile) && heightAt(x + 0.5, y + 0.5) <= 0) drowned++;
    expect(drowned).toBe(0);
    const wet = placeSettlements(def, map, content.settlements).filter((s) => heightAt(s.x, s.y) <= 0);
    expect(wet.map((s) => s.name)).toEqual([]);
  });
});
