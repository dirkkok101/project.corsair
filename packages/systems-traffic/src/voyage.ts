import { rngStream, seedRng } from '@corsair/core';
import type { Nation, Voyage, WorldState } from '@corsair/core';
import { isLand, tileAt } from '@corsair/data';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';
import type { SeaLanes } from './lanes';

// The First Voyage (docs/design/first-voyage.md): a new captain's first chapters, within sight of home. This file
// lays the voyage out at the career's start; the chapters themselves follow in its system.

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** The compass point (of eight) from one place to another, north up. */
export function bearingWord(dx: number, dy: number): string {
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return POINTS[Math.round(deg / 45) % 8]!;
}

/**
 * The cay of the first chapter: open water off a shore, `cayTiles` from the home berth by sea (found by a search
 * over the water from the berth, so she can always sail there), clear of every port and haven. Drawn from the seed;
 * undefined if the home waters have no such place.
 */
export function chooseCay(content: ContentPack, map: TileMap, settlements: PlacedSettlement[], berth: [number, number], seed: number): Omit<Voyage['cay'], 'name'> | undefined {
  const v = content.voyage;
  const [min, max] = v.cayTiles;
  const [bx, by] = [Math.floor(berth[0]), Math.floor(berth[1])];
  const water = (x: number, y: number) => !isLand(tileAt(map, x, y));
  const shore = (x: number, y: number) => {
    for (let dy = -v.shoreTiles; dy <= v.shoreTiles; dy++)
      for (let dx = -v.shoreTiles; dx <= v.shoreTiles; dx++) if (isLand(tileAt(map, x + dx, y + dy))) return true;
    return false;
  };
  // Every water tile she can reach within the far bound, by the eight ways a ship can sail.
  const seen = new Set<number>([by * map.width + bx]);
  const queue: [number, number][] = [[bx, by]];
  const found: [number, number][] = [];
  while (queue.length) {
    const [x, y] = queue.shift()!;
    const d = Math.hypot(x - bx, y - by);
    if (d >= min && shore(x, y) && settlements.every((s) => Math.hypot(s.x - x - 0.5, s.y - y - 0.5) >= v.clearOfPortsTiles)) found.push([x, y]);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const [nx, ny] = [x + dx, y + dy];
        const key = ny * map.width + nx;
        if (seen.has(key) || !water(nx, ny) || Math.hypot(nx - bx, ny - by) > max) continue;
        seen.add(key);
        queue.push([nx, ny]);
      }
  }
  if (!found.length) return undefined;
  const [x, y] = found[Math.floor(rngStream(seedRng(seed, 'voyage')).float() * found.length)]!;
  return { x: x + 0.5, y: y + 0.5, bearing: bearingWord(x + 0.5 - berth[0], y + 0.5 - berth[1]), tiles: Math.round(Math.hypot(x + 0.5 - berth[0], y + 0.5 - berth[1])) };
}

/** A new career on the First Voyage: in port at home, the cay chosen. Unchanged if the home waters have no cay. */
export function withVoyage(world: WorldState, content: ContentPack, map: TileMap, settlements: PlacedSettlement[], lanes: SeaLanes, home: string, nation: Nation, seed: number): WorldState {
  const town = settlements.find((s) => s.id === home);
  const berth = lanes.berth(home) ?? (town && ([town.x, town.y] as [number, number]));
  const cay = berth && world.captain && chooseCay(content, map, settlements, berth, seed);
  if (!cay) return world;
  const voyage: Voyage = { step: 'harbour', cay: { ...cay, name: content.voyage.cays[nation] ?? 'the cay' }, home };
  return { ...world, captain: { ...world.captain!, voyage } };
}
