// Imports the painted UI kit (the ship panel's portraits, icons and frame, and the chart's marks) and the people's
// busts: for every prompt record in art/sources/paintings/{ui,people}/*.yaml, keys out the flat background of the
// kept raw image, crops to what's left, shrinks it to its game size and snaps it to the palette, writing
// art/game/{ui,people}/{id}.png.
//
//   node tools/art/import_ui.ts
//
// Grok can't paint a transparent background, so the brief asks for flat magenta. It comes back a hot pink
// that isn't exact #FF00FF, and the JPEG field wobbles by a few levels: the key colour and its tolerance
// are read from each image's own corners. Nothing in the kit is that pink, so the key takes it everywhere,
// with the pinkish fringe the JPEG leaves round the object's edge.
import { decode, encode } from 'fast-png';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paletteMatcher } from './snap_painting.ts';

const ROOT = join(import.meta.dirname, '..', '..');
/** Each group's raw paintings and where its game images go. */
const GROUPS = ['ui', 'people'].map((g) => ({ sources: join(ROOT, 'art', 'sources', 'paintings', g), out: join(ROOT, 'art', 'game', g) }));

/** Game size by id prefix: the box each image is shrunk to fit (aspect kept), in art pixels. */
const SIZES: [prefix: string, w: number, h: number][] = [
  ['ui.ship.', 96, 64],
  ['ui.icon.', 24, 24],
  // The sea chart's marks: ports by size, havens, you, a ship seen; the compass rose larger.
  ['ui.chart.compass', 64, 64],
  ['ui.chart.', 20, 20],
  ['ui.panel.', 96, 64],
  // The people who speak to the captain (docs/design/storyboard.md), head and shoulders.
  ['bust.', 192, 224],
];
/** Sheets of icons painted together, cut into a grid (left to right, top to bottom) into these ids. */
const SHEETS: Record<string, { cols: number; ids: string[] }> = {
  'ui.icons.fits': {
    cols: 3,
    ids: ['copper', 'cotton_sails', 'scantlings', 'bronze_cannon', 'powder', 'hammocks', 'swivel_guns', 'nettings', 'sweeps'].map((u) => `ui.icon.fit.${u}`),
  },
};

/** One cell of a sheet's grid, as an image of its own. */
function cell(png: ReturnType<typeof decode>, col: number, row: number, cols: number, rows: number): ReturnType<typeof decode> {
  const cw = Math.floor(png.width / cols);
  const chh = Math.floor(png.height / rows);
  const data = new Uint8Array(cw * chh * png.channels);
  for (let y = 0; y < chh; y++) {
    const from = ((row * chh + y) * png.width + col * cw) * png.channels;
    data.set(png.data.subarray(from, from + cw * png.channels) as Uint8Array, y * cw * png.channels);
  }
  return { ...png, width: cw, height: chh, data };
}

/** Corner patches the key colour is read from, in source pixels. */
const CORNER = 24;
/** Added to the corners' own spread, so the key takes the whole field but not the object's edge. */
const TOLERANCE_MARGIN = 36;
/** The fringe: pinkish pixels this many tolerances from the key, touching the background, are keyed too. */
const FRINGE = 2.2;
const FRINGE_PASSES = 2;
/** A shrunk pixel is opaque when at least this share of what it covers is object. */
const COVERAGE = 0.5;

const match = paletteMatcher();

for (const { sources: SOURCES, out: OUT } of GROUPS) {
mkdirSync(OUT, { recursive: true });
for (const file of readdirSync(SOURCES).filter((f) => f.endsWith('.yaml')).sort()) {
  const text = readFileSync(join(SOURCES, file), 'utf8');
  const id = /^id:\s*(\S+)/m.exec(text)?.[1];
  const kept = /^kept:\s*\[\s*([^\],\s]+)/m.exec(text)?.[1];
  if (!id || !kept) throw new Error(`${file}: needs an id and a kept version`);
  const whole = decode(readFileSync(join(SOURCES, `${id}.${kept}.png`)));
  // A sheet of icons (SHEETS) is cut into its grid first; each cell is then keyed like a single image.
  const sheet = SHEETS[id];
  const jobs = sheet
    ? sheet.ids.map((cellId, k) => ({ id: cellId, png: cell(whole, k % sheet.cols, Math.floor(k / sheet.cols), sheet.cols, Math.ceil(sheet.ids.length / sheet.cols)) }))
    : [{ id, png: whole }];
  for (const { id, png } of jobs) {
  const size = SIZES.find(([p]) => id.startsWith(p));
  if (!size) throw new Error(`${file}: ${id} needs an id with a known prefix`);
  const { width: w, height: h, channels: ch, data } = png;
  const px = (x: number, y: number) => {
    const i = (y * w + x) * ch;
    return [data[i]!, data[i + 1]!, data[i + 2]!] as const;
  };

  // The key: the median corner colour, and how far the corners stray from it.
  const samples: (readonly [number, number, number])[] = [];
  // A bust runs off the bottom edge (cut at the chest), so only its top corners are background; a sheet's cell may
  // have its icon in a corner, so the key comes from the whole sheet's corners.
  const from = sheet ? whole : png;
  const fw = from.width;
  const fh = from.height;
  const fpx = (x: number, y: number) => {
    const i = (y * fw + x) * from.channels;
    return [from.data[i]!, from.data[i + 1]!, from.data[i + 2]!] as const;
  };
  const corners = id.startsWith('bust.') ? [[0, 0], [fw - CORNER, 0]] : [[0, 0], [fw - CORNER, 0], [0, fh - CORNER], [fw - CORNER, fh - CORNER]];
  for (const [cx, cy] of corners as [number, number][]) {
    for (let y = cy; y < cy + CORNER; y++) for (let x = cx; x < cx + CORNER; x++) samples.push(fpx(x, y));
  }
  const median = (k: 0 | 1 | 2) => samples.map((s) => s[k]).sort((a, b) => a - b)[samples.length >> 1]!;
  const key = [median(0), median(1), median(2)] as const;
  const off = (c: readonly [number, number, number]) => Math.max(Math.abs(c[0] - key[0]), Math.abs(c[1] - key[1]), Math.abs(c[2] - key[2]));
  const spread = samples.map(off).sort((a, b) => a - b)[Math.floor(samples.length * 0.99)]!;
  const tolerance = spread + TOLERANCE_MARGIN;

  // The background: every pixel near the key, not only those joined to the edge, since rigging and chain
  // links close off pockets of it. Then the fringe: JPEG blends the object's edge into the pink, so a
  // pixel still pinkish (within FRINGE times the tolerance) that touches background goes too.
  const background = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (off(px(x, y)) <= tolerance) background[y * w + x] = 1;
  for (let pass = 0; pass < FRINGE_PASSES; pass++) {
    const grow: number[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (background[i] || off(px(x, y)) > tolerance * FRINGE) continue;
        if (background[i - 1] || background[i + 1] || background[i - w] || background[i + w]) grow.push(i);
      }
    }
    for (const i of grow) background[i] = 1;
  }

  // Crop to the object, then shrink to fit the game size, keeping its aspect.
  let [x0, y0, x1, y1] = [w, h, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (background[y * w + x]) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  if (x1 <= x0) throw new Error(`${id}: nothing left after keying the background`);
  const [, boxW, boxH] = size;
  const scale = Math.min(boxW / (x1 - x0), boxH / (y1 - y0));
  const ow = Math.max(1, Math.round((x1 - x0) * scale));
  const oh = Math.max(1, Math.round((y1 - y0) * scale));
  const out = new Uint8Array(ow * oh * 4);
  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      // Area average over the object pixels this output pixel covers; its coverage decides opacity.
      const sx0 = x0 + ox / scale;
      const sx1 = x0 + (ox + 1) / scale;
      const sy0 = y0 + oy / scale;
      const sy1 = y0 + (oy + 1) / scale;
      let [r, g, b, n, all] = [0, 0, 0, 0, 0];
      for (let sy = Math.floor(sy0); sy < Math.min(h, Math.ceil(sy1)); sy++) {
        for (let sx = Math.floor(sx0); sx < Math.min(w, Math.ceil(sx1)); sx++) {
          const a = (Math.min(sx + 1, sx1) - Math.max(sx, sx0)) * (Math.min(sy + 1, sy1) - Math.max(sy, sy0));
          all += a;
          if (background[sy * w + sx]) continue;
          const c = px(sx, sy);
          r += c[0] * a;
          g += c[1] * a;
          b += c[2] * a;
          n += a;
        }
      }
      if (n / all < COVERAGE) continue;
      out.set([...match(r / n, g / n, b / n), 255], (oy * ow + ox) * 4);
    }
  }
  writeFileSync(join(OUT, `${id}.png`), encode({ width: ow, height: oh, data: out, channels: 4 }));
  console.log(`${id} <- ${kept}: key ${key.join(',')} ±${tolerance}, ${ow}x${oh}`);
  }
}
}
