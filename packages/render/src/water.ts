import { isLand, Tile } from '@corsair/data';
import type { TileMap } from '@corsair/data';

// Stand-in terrain art painted from corsair.gpl until the autotile set exists (art pipeline section 5).
const C = {
  deepDark: '#253a5e',
  deep: '#3c5e8b',
  crest: '#4f8fba',
};

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

// Ramps run dark to light; a pixel's tone comes from relief lighting, dithered between steps.
const RAMP = {
  shallow: ['#4f8fba', '#4f8fba', '#73bed3'].map(rgb),
  beach: ['#c09473', '#d7b594', '#e7d5b3'].map(rgb),
  jungle: ['#25562e', '#468232', '#75a743'].map(rgb),
  hills: ['#468232', '#75a743', '#a8ca58'].map(rgb),
  mountain: ['#577277', '#819796', '#a8b5b2'].map(rgb),
};
const SURF = rgb('#ebede9');
const FOAM = rgb('#a4dddb');

// Field thresholds. Land, shallows and height are blended between tile centres, so a coast is the
// 0.5 contour of the land field: it curves through the tile grid instead of stepping along it.
const COAST = 0.5;
const BEACH_BELOW = 0.64; // land field values just above the coast are sand
const SURF_ABOVE = 0.36; // water field values just below the coast break as surf
const HILLS_FROM = 2.5; // interpolated elevation band (PRD 0-7) where hills start
const MOUNTAIN_FROM = 4.5;
const RELIEF = 1.1; // how strongly slope shifts the tone
const DITHER = 0.6; // fraction of a tone step the ordered dither spans

// 4x4 ordered dither, so tone gradients read as pixel-art bands rather than noise.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

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
 * A 96x96 seamless deep-water swatch: small wave crests (light dash over a dark trough pixel).
 * It is drawn as a screen-sized tiling sprite that drifts downwind.
 */
export function paintDeepWater(): HTMLCanvasElement {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  px(ctx, C.deep, 0, 0, size, size);
  for (let i = 0; i < 27; i++) {
    const x = Math.floor(noise(i, 1) * size);
    const y = Math.floor(noise(i, 2) * size);
    const len = 3 + Math.floor(noise(i, 3) * 6);
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

/**
 * One square chunk of everything except deep water, painted per pixel. Deep water stays
 * transparent so the drifting swell shows through. Returns null for an all-deep chunk.
 * Everything is keyed on world pixels, so neighbouring chunks join seamlessly. Ship collision
 * stays on the tile grid; the smooth coast only changes how it looks.
 */
export function paintTerrainChunk(map: TileMap, tx0: number, ty0: number, size: number): HTMLCanvasElement | null {
  const ts = map.tileSize;
  const tile = (x: number, y: number): Tile =>
    x < 0 || y < 0 || x >= map.width || y >= map.height ? Tile.Deep : (map.tiles[y * map.width + x]! as Tile);
  // A one-tile margin around the chunk lets the blend reach across chunk edges.
  let any = false;
  for (let ty = ty0 - 1; ty <= ty0 + size && !any; ty++) {
    for (let tx = tx0 - 1; tx <= tx0 + size && !any; tx++) any = tile(tx, ty) !== Tile.Deep;
  }
  if (!any) return null;

  const height = (x: number, y: number) =>
    x < 0 || y < 0 || x >= map.width || y >= map.height ? 0 : (map.elevation[y * map.width + x] ?? 0);

  // Per-tile fields for the chunk plus a margin: land (0/1), shallow-or-land (0/1), elevation band,
  // and slope (height on the north-west side minus the south-east side; light comes from the
  // north-west, so a positive slope faces away from it). Each is blended per pixel.
  const n = size + 2;
  const land = new Float32Array(n * n);
  const shoal = new Float32Array(n * n);
  const elev = new Float32Array(n * n);
  const slope = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const tx = tx0 - 1 + i;
      const ty = ty0 - 1 + j;
      const t = tile(tx, ty);
      land[j * n + i] = isLand(t) ? 1 : 0;
      shoal[j * n + i] = t === Tile.Deep ? 0 : 1;
      elev[j * n + i] = height(tx, ty);
      slope[j * n + i] = (height(tx - 1, ty) - height(tx + 1, ty) + height(tx, ty - 1) - height(tx, ty + 1)) * 0.25;
    }
  }

  const w = size * ts;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = w;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(w, w);
  const out = image.data;

  for (let py = 0; py < w; py++) {
    // Position in the margin-padded field grid, measured from tile centres.
    const v = (py + 0.5) / ts + 0.5;
    const j0 = Math.min(Math.floor(v), n - 2);
    const fy = v - j0;
    for (let pxl = 0; pxl < w; pxl++) {
      const u = (pxl + 0.5) / ts + 0.5;
      const i0 = Math.min(Math.floor(u), n - 2);
      const fx = u - i0;
      const k = j0 * n + i0;
      const blend = (f: Float32Array) =>
        (f[k]! * (1 - fx) + f[k + 1]! * fx) * (1 - fy) + (f[k + n]! * (1 - fx) + f[k + n + 1]! * fx) * fy;

      const wx = tx0 * ts + pxl;
      const wy = ty0 * ts + py;
      const dither = BAYER[(wy & 3) * 4 + (wx & 3)]! * DITHER;
      const lf = blend(land);
      let colour: Rgb | undefined;

      if (lf >= COAST) {
        const e = blend(elev);
        const ramp =
          lf < BEACH_BELOW ? RAMP.beach : e >= MOUNTAIN_FROM ? RAMP.mountain : e >= HILLS_FROM ? RAMP.hills : RAMP.jungle;
        const tone = Math.max(0, Math.min(2, Math.round(1 - blend(slope) * RELIEF + dither)));
        colour = ramp[tone]!;
        // Canopy: small clumps of the darker tone so jungle doesn't read as flat paint.
        if (ramp === RAMP.jungle && tone > 0 && noise(wx >> 2, wy >> 2, 7) < 0.1) colour = ramp[tone - 1]!;
      } else if (lf > SURF_ABOVE) {
        // Broken surf line hugging the coast.
        colour = noise(wx >> 1, wy, 9) < 0.7 ? SURF : FOAM;
      } else if (blend(shoal) >= COAST) {
        colour = noise(wx, wy, 1) < 0.05 ? RAMP.shallow[2]! : RAMP.shallow[1]!;
      }

      if (!colour) continue;
      const o = (py * w + pxl) * 4;
      out[o] = colour[0];
      out[o + 1] = colour[1];
      out[o + 2] = colour[2];
      out[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
