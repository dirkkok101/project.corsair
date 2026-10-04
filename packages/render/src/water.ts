import { isLand, Tile } from '@corsair/data';
import type { TileMap } from '@corsair/data';

// Stand-in tile art painted from corsair.gpl until the autotile set exists (art pipeline section 5).
const C = {
  deepDark: '#253a5e',
  deep: '#3c5e8b',
  crest: '#4f8fba',
  shallow: '#4f8fba',
  shallowLight: '#73bed3',
  foam: '#a4dddb',
  surf: '#ebede9',
  sand: '#d7b594',
  sandDark: '#c09473',
  grass: '#468232',
  grassDark: '#25562e',
  grassLight: '#75a743',
};

/** Cheap integer hash so the speckle is the same on every load. */
function noise(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function px(ctx: CanvasRenderingContext2D, colour: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, h);
}

/**
 * A 64x64 seamless deep-water swatch: small wave crests (light dash over a dark trough pixel).
 * It is drawn as a tiling sprite that drifts downwind.
 */
export function paintDeepWater(): HTMLCanvasElement {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  px(ctx, C.deep, 0, 0, size, size);
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(noise(i, 1) * size);
    const y = Math.floor(noise(i, 2) * size);
    const len = 2 + Math.floor(noise(i, 3) * 4);
    for (let k = 0; k < len; k++) {
      const cx = (x + k) % size;
      // A crest bows up in the middle: ends one pixel lower than the centre.
      const lift = k === 0 || k === len - 1 ? 0 : -1;
      px(ctx, C.crest, cx, (y + lift + size) % size);
      px(ctx, C.deepDark, cx, (y + 1) % size);
    }
  }
  return canvas;
}

/** Everything except deep water: shallows with speckle and surf, sand, grass. Deep tiles stay transparent. */
export function paintCoast(map: TileMap): HTMLCanvasElement {
  const ts = map.tileSize;
  const canvas = document.createElement('canvas');
  canvas.width = map.width * ts;
  canvas.height = map.height * ts;
  const ctx = canvas.getContext('2d')!;
  const at = (x: number, y: number): Tile =>
    x < 0 || y < 0 || x >= map.width || y >= map.height ? Tile.Deep : map.tiles[y * map.width + x]!;

  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const tile = at(tx, ty);
      if (tile === Tile.Deep) continue;
      const ox = tx * ts;
      const oy = ty * ts;
      const base = tile === Tile.Shallow ? C.shallow : tile === Tile.Sand ? C.sand : C.grass;
      px(ctx, base, ox, oy, ts, ts);
      for (let y = 0; y < ts; y++) {
        for (let x = 0; x < ts; x++) {
          const n = noise(ox + x, oy + y, tile);
          if (tile === Tile.Shallow && n < 0.06) px(ctx, C.shallowLight, ox + x, oy + y);
          if (tile === Tile.Sand && n < 0.08) px(ctx, C.sandDark, ox + x, oy + y);
          if (tile === Tile.Grass && n < 0.07) px(ctx, C.grassDark, ox + x, oy + y);
          if (tile === Tile.Grass && n > 0.95) px(ctx, C.grassLight, ox + x, oy + y);
        }
      }
      if (tile !== Tile.Shallow) continue;
      // Surf: a broken white band on each side of a shallow tile that touches land.
      const sides: [number, number][] = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ];
      for (const [dx, dy] of sides) {
        if (!isLand(at(tx + dx, ty + dy))) continue;
        for (let i = 0; i < ts; i++) {
          const n = noise(ox + i * 7, oy + dx * 3 + dy * 5, 9);
          const [ax, ay] = dx !== 0 ? [dx > 0 ? ts - 1 : 0, i] : [i, dy > 0 ? ts - 1 : 0];
          const [bx, by] = dx !== 0 ? [ax - dx, ay] : [ax, ay - dy];
          px(ctx, n < 0.75 ? C.surf : C.foam, ox + ax, oy + ay);
          if (n < 0.45) px(ctx, C.foam, ox + bx, oy + by);
        }
      }
    }
  }
  return canvas;
}
