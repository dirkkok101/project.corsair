import { isLand, openSea, tileAt } from '@corsair/data';
import type { PlacedSettlement, TileMap } from '@corsair/data';

// Sea lanes between ports. The map is cut into cell x cell tile cells; a cell is open water when
// three quarters of its tiles are water, which keeps lanes off beaches and out of creeks. A* over
// open cells finds the way, then the path is pulled straight wherever a line between two points
// stays on water, so ships sail clean legs rather than a staircase. Lanes depend only on the map,
// so they are found on demand and cached, and replays see the same ones.

type Point = [number, number];
type Settlement = Pick<PlacedSettlement, 'id' | 'x' | 'y'>;

export interface SeaLanes {
  /** Waypoints in tiles from one port's mooring to another's, or undefined if no lane joins them. */
  route(from: string, to: string): Point[] | undefined;
  /** The water tile a ship lies at off a port. */
  mooring(id: string): Point | undefined;
}

const MOORING_SEARCH = 4;
/** How far a port's way out to open water may wind, in tiles. */
const WAY_OUT_TILES = 200;
const OPEN_SHARE = 0.75;

export function createSeaLanes(map: TileMap, settlements: Settlement[], cell: number): SeaLanes {
  const water = (x: number, y: number) => !isLand(tileAt(map, x, y));
  // Moorings are on the open sea: a port's nearest water can be a lagoon behind its beach.
  const seaTiles = openSea(map);
  const seaAt = (x: number, y: number) => {
    const [tx, ty] = [Math.floor(x), Math.floor(y)];
    return tx >= 0 && ty >= 0 && tx < map.width && ty < map.height && seaTiles[ty * map.width + tx] === 1;
  };
  const cw = Math.ceil(map.width / cell);
  const ch = Math.ceil(map.height / cell);
  const open = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let n = 0;
      for (let y = cy * cell; y < (cy + 1) * cell; y++) for (let x = cx * cell; x < (cx + 1) * cell; x++) if (water(x + 0.5, y + 0.5)) n++;
      open[cy * cw + cx] = n >= cell * cell * OPEN_SHARE ? 1 : 0;
    }
  }
  const centre = (i: number): Point => [((i % cw) + 0.5) * cell, (Math.floor(i / cw) + 0.5) * cell];

  /**
   * True when the straight line between two points stays on water. Walks every tile the line passes
   * through (a grid traversal), so it can't step over the corner of a land tile the way sampling can.
   */
  const clear = ([x0, y0]: Point, [x1, y1]: Point) => {
    let tx = Math.floor(x0);
    let ty = Math.floor(y0);
    const ex = Math.floor(x1);
    const ey = Math.floor(y1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    // Distance along the line (as a fraction) to the next vertical and horizontal grid line.
    const stepX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const stepY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let nextX = dx !== 0 ? (sx > 0 ? tx + 1 - x0 : x0 - tx) * stepX : Infinity;
    let nextY = dy !== 0 ? (sy > 0 ? ty + 1 - y0 : y0 - ty) * stepY : Infinity;
    for (;;) {
      if (!water(tx + 0.5, ty + 0.5)) return false;
      if (tx === ex && ty === ey) return true;
      if (nextX < nextY) {
        tx += sx;
        nextX += stepX;
      } else {
        ty += sy;
        nextY += stepY;
      }
      if (Math.min(nextX, nextY) > 1 + 1e-9 && (tx !== ex || ty !== ey)) {
        // Past the end without landing on its tile (a line ending exactly on a grid line): check it and stop.
        return water(ex + 0.5, ey + 0.5);
      }
    }
  };

  // Each port's mooring: the nearest water tile, then the nearest open cell it can reach in a straight line.
  const STEPS: [number, number, number][] = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  /** Open cells a lane may step between: no corner-cutting past land cells, and a clear line between centres. */
  const step = (i: number, dx: number, dy: number): number | undefined => {
    const [x, y] = [i % cw, Math.floor(i / cw)];
    const [nx, ny] = [x + dx, y + dy];
    if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) return undefined;
    const n = ny * cw + nx;
    // A cell is only mostly water, so the line between two centres can still clip a headland.
    if (!open[n] || (dx && dy && (!open[y * cw + nx] || !open[ny * cw + x]))) return undefined;
    return clear(centre(i), centre(n)) ? n : undefined;
  };

  // The open sea is the largest connected group of open cells; lakes and lagoons have groups of their
  // own, and a port inside one must find its way out to the sea, not just to the lagoon's middle.
  const group = new Int32Array(cw * ch).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < cw * ch; s++) {
    if (!open[s] || group[s]! >= 0) continue;
    const id = sizes.length;
    const stack = [s];
    group[s] = id;
    let size = 0;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      for (const [dx, dy] of STEPS) {
        const n = step(i, dx, dy);
        if (n !== undefined && group[n]! < 0) {
          group[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  const sea = sizes.indexOf(Math.max(...sizes));

  /** Tile-level search from a mooring to the nearest open-sea cell whose centre it can see; the path is in tiles. */
  const wayOut = (at: Point): { cell: number; path: Point[] } | undefined => {
    const [ox, oy] = [Math.floor(at[0]), Math.floor(at[1])];
    const key = (x: number, y: number) => y * map.width + x;
    const prev = new Map<number, number>([[key(ox, oy), -1]]);
    const queue: [number, number][] = [[ox, oy]];
    for (let q = 0; q < queue.length; q++) {
      const [x, y] = queue[q]!;
      if (Math.hypot(x - ox, y - oy) > WAY_OUT_TILES) continue;
      const i = Math.floor(y / cell) * cw + Math.floor(x / cell);
      const here: Point = [x + 0.5, y + 0.5];
      if (group[i] === sea && clear(here, centre(i))) {
        const path: Point[] = [];
        for (let k = key(x, y); k >= 0; k = prev.get(k)!) path.push([(k % map.width) + 0.5, Math.floor(k / map.width) + 0.5]);
        return { cell: i, path: path.reverse() };
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const [nx, ny] = [x + dx, y + dy];
        if (prev.has(key(nx, ny)) || !water(nx + 0.5, ny + 0.5)) continue;
        prev.set(key(nx, ny), key(x, y));
        queue.push([nx, ny]);
      }
    }
    return undefined;
  };

  const moorings = new Map<string, { at: Point; cell: number; out: Point[] }>();
  for (const s of settlements) {
    let at: Point | undefined;
    for (let r = 0; r <= MOORING_SEARCH && !at; r++) {
      let best: { p: Point; d: number } | undefined;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const p: Point = [Math.floor(s.x) + dx + 0.5, Math.floor(s.y) + dy + 0.5];
          const d = Math.hypot(p[0] - s.x, p[1] - s.y);
          if (seaAt(p[0], p[1]) && (!best || d < best.d)) best = { p, d };
        }
      }
      at = best?.p;
    }
    if (!at) continue;
    // The way out to open water, found tile by tile: a port up a river or inside a lagoon reaches the
    // open grid through channels far narrower than a cell. Breadth-first, so it is the shortest.
    const way = wayOut(at);
    if (way) moorings.set(s.id, { at, cell: way.cell, out: way.path });
  }

  /** A* over open cells, 8-connected; ties broken by cell index so the result never varies. */
  const search = (start: number, goal: number): number[] | undefined => {
    const g = new Float64Array(cw * ch).fill(Infinity);
    const came = new Int32Array(cw * ch).fill(-1);
    const [gx, gy] = [goal % cw, Math.floor(goal / cw)];
    const h = (i: number) => {
      const dx = Math.abs((i % cw) - gx);
      const dy = Math.abs(Math.floor(i / cw) - gy);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    // Binary heap of [f, cell].
    const heap: [number, number][] = [];
    const push = (f: number, i: number) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p]![0] < f || (heap[p]![0] === f && heap[p]![1] <= i)) break;
        [heap[p], heap[k]] = [heap[k]!, heap[p]!];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          const less = (a: number, b: number) => heap[a]![0] < heap[b]![0] || (heap[a]![0] === heap[b]![0] && heap[a]![1] < heap[b]![1]);
          if (l < heap.length && less(l, m)) m = l;
          if (r < heap.length && less(r, m)) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k]!, heap[m]!];
          k = m;
        }
      }
      return top;
    };
    g[start] = 0;
    push(h(start), start);
    while (heap.length) {
      const [, i] = pop();
      if (i === goal) {
        const path = [i];
        for (let c = came[i]!; c >= 0; c = came[c]!) path.push(c);
        return path.reverse();
      }
      for (const [dx, dy, cost] of STEPS) {
        const n = step(i, dx, dy);
        if (n === undefined) continue;
        const ng = g[i]! + cost;
        if (ng < g[n]!) {
          g[n] = ng;
          came[n] = i;
          push(ng + h(n), n);
        }
      }
    }
    return undefined;
  };

  /** Pull the path straight: from each point, jump to the furthest later point in clear line. */
  const smooth = (points: Point[]): Point[] => {
    const out: Point[] = [points[0]!];
    let i = 0;
    while (i < points.length - 1) {
      let j = points.length - 1;
      while (j > i + 1 && !clear(points[i]!, points[j]!)) j--;
      out.push(points[j]!);
      i = j;
    }
    return out;
  };

  const cache = new Map<string, Point[] | undefined>();
  return {
    mooring: (id) => moorings.get(id)?.at,
    route(from, to) {
      const key = `${from}>${to}`;
      if (cache.has(key)) return cache.get(key);
      const a = moorings.get(from);
      const b = moorings.get(to);
      const cells = a && b ? search(a.cell, b.cell) : undefined;
      // Out of the first harbour, across open water, and in through the second.
      const lane = cells && a && b ? smooth([...a.out, ...cells.map(centre), ...[...b.out].reverse()]) : undefined;
      cache.set(key, lane);
      cache.set(`${to}>${from}`, lane && [...lane].reverse());
      return lane;
    },
  };
}
