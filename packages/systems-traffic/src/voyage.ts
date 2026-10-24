import { rngStream, seedRng } from '@corsair/core';
import type { EmittedEvent, Nation, System, Voyage, WorldState } from '@corsair/core';
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
 * The cay of the first chapter: open water off a small island (or, if there is none, any shore), `cayTiles` from the home berth by sea (found by a search
 * over the water from the berth, so she can always sail there), clear of every port and haven. Drawn from the seed;
 * undefined if the home waters have no such place.
 */
export function chooseCay(content: ContentPack, map: TileMap, settlements: PlacedSettlement[], berth: [number, number], seed: number): Omit<Voyage['cay'], 'name'> | undefined {
  const v = content.voyage;
  const [min, max] = v.cayTiles;
  const [bx, by] = [Math.floor(berth[0]), Math.floor(berth[1])];
  const water = (x: number, y: number) => !isLand(tileAt(map, x, y));
  // The land within `shoreTiles`, if any.
  const shore = (x: number, y: number): [number, number] | undefined => {
    for (let dy = -v.shoreTiles; dy <= v.shoreTiles; dy++)
      for (let dx = -v.shoreTiles; dx <= v.shoreTiles; dx++) if (isLand(tileAt(map, x + dx, y + dy))) return [x + dx, y + dy];
    return undefined;
  };
  // Whether land is a cay: an island of fewer than `islandTiles` tiles (its tiles counted once, by the first asked).
  const small = new Map<number, boolean>();
  const cay = ([lx, ly]: [number, number]) => {
    const start = ly * map.width + lx;
    if (small.has(start)) return small.get(start)!;
    const seenLand = new Set<number>([start]);
    const stack: [number, number][] = [[lx, ly]];
    while (stack.length && seenLand.size < v.islandTiles) {
      const [x, y] = stack.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const key = (y + dy) * map.width + x + dx;
        if (seenLand.has(key) || !isLand(tileAt(map, x + dx, y + dy))) continue;
        seenLand.add(key);
        stack.push([x + dx, y + dy]);
      }
    }
    const isCay = seenLand.size < v.islandTiles;
    for (const key of seenLand) small.set(key, isCay);
    return isCay;
  };
  // Every water tile she can reach within the far bound, by the eight ways a ship can sail.
  const seen = new Set<number>([by * map.width + bx]);
  const queue: [number, number][] = [[bx, by]];
  const found: [number, number][] = [];
  const offCays: [number, number][] = [];
  while (queue.length) {
    const [x, y] = queue.shift()!;
    const d = Math.hypot(x - bx, y - by);
    const land = d >= min ? shore(x, y) : undefined;
    if (land && settlements.every((s) => Math.hypot(s.x - x - 0.5, s.y - y - 0.5) >= v.clearOfPortsTiles)) {
      found.push([x, y]);
      if (cay(land)) offCays.push([x, y]);
    }
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const [nx, ny] = [x + dx, y + dy];
        const key = ny * map.width + nx;
        if (seen.has(key) || !water(nx, ny) || Math.hypot(nx - bx, ny - by) > max) continue;
        seen.add(key);
        queue.push([nx, ny]);
      }
  }
  // Off a cay if the home waters have one; else off any shore.
  const pool = offCays.length ? offCays : found;
  if (!pool.length) return undefined;
  const [x, y] = pool[Math.floor(rngStream(seedRng(seed, 'voyage')).float() * pool.length)]!;
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

/**
 * The voyage's chapters as they happen. Sailing from home the first time, she goes at half sail, bound for the cay;
 * on the way the lessons she has shown she knows are kept (the helm used, more sail set); within `arriveTiles` of
 * the wreck she has reached it.
 */
export function createVoyageSystem(content: ContentPack): System {
  return {
    name: 'voyage',
    tick(state) {
      const v = state.captain?.voyage;
      const me = state.ships.player;
      if (!v || !me || v.step !== 'helm') return { state, events: [] };
      const learned = new Set(v.lessons ?? []);
      if (me.helm !== 0) learned.add('steer');
      if (me.sails === 'full') learned.add('sail');
      const there = Math.hypot(me.x - v.cay.x, me.y - v.cay.y) <= content.voyage.arriveTiles;
      if (!there && learned.size === (v.lessons ?? []).length) return { state, events: [] };
      const voyage: Voyage = { ...v, lessons: [...learned], ...(there ? { step: 'salvage' as const } : {}) };
      const events: EmittedEvent[] = there ? [{ type: 'CayReached', entityIds: [me.id], payload: { name: v.cay.name } }] : [];
      return { state: { ...state, captain: { ...state.captain!, voyage } }, events };
    },
    observe(state, events) {
      const v = state.captain?.voyage;
      const me = state.ships.player;
      if (v?.step !== 'harbour' || !me || !events.some((e) => e.type === 'Undocked' && e.entityIds[0] === me.id)) return state;
      return { ...state, ships: { ...state.ships, [me.id]: { ...me, sails: 'half' } }, captain: { ...state.captain!, voyage: { ...v, step: 'helm' } } };
    },
  };
}
