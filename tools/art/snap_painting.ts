// Snaps a painted image onto the game palette at 960x540 (art pipeline section 8, `art:snap`, for
// full-frame scenes): area-average downsample, then nearest palette colour in OKLab. Every output
// pixel is an exact palette colour, so the day/night palette shader maps it like the rest of the game.
//
//   node tools/art/snap_painting.ts <in.png> <out.png> [--chroma 3] [--saturate 1.6] [--dither 0]
//
// The defaults were picked on the Grok harbours: paintings are mixed softer than the palette, so
// without the chroma weight and saturation boost their sky and sea land on the palette's slate greys.
import { decode, encode } from 'fast-png';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
export const SCENE_W = 960;
export const SCENE_H = 540;

export interface SnapOptions {
  /** Colour (OKLab a, b) counts this many times lightness when matching. */
  chroma: number;
  /** Chroma is scaled by this before matching. */
  saturate: number;
  /** 0 for flat colour; up to 1 for ordered dithering between the two nearest colours. */
  dither: number;
  /** Darkens the middle of the frame by up to this share of its lightness, fading out to the edges. */
  calmCentre?: number;
}
export const DEFAULT_SNAP: SnapOptions = { chroma: 3, saturate: 1.6, dither: 0 };

/** Palette rows are "r g b name" lines after the GIMP header. */
export function readPalette(): [number, number, number][] {
  return readFileSync(join(ROOT, 'art', 'palette', 'corsair.gpl'), 'utf8')
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 3 && p.slice(0, 3).every((n) => /^\d+$/.test(n)))
    .map((p) => [Number(p[0]), Number(p[1]), Number(p[2])] as [number, number, number]);
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
/** sRGB to OKLab, where straight-line distance tracks how different two colours look. */
function oklab(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** The two palette colours nearest a colour in OKLab, colour (a, b) weighted `chroma` times lightness. */
function nearestTwo(labs: [number, number, number][], lab: [number, number, number], chroma: number) {
  let best = 0;
  let second = 0;
  let d1 = Infinity;
  let d2 = Infinity;
  for (let p = 0; p < labs.length; p++) {
    const q = labs[p]!;
    const d = (lab[0] - q[0]) ** 2 + chroma * ((lab[1] - q[1]) ** 2 + (lab[2] - q[2]) ** 2);
    if (d < d1) {
      d2 = d1;
      second = best;
      d1 = d;
      best = p;
    } else if (d < d2) {
      d2 = d;
      second = p;
    }
  }
  return { best, second, d1, d2 };
}

/** A colour to its nearest palette colour, matched as `snap` matches (without dithering). */
export function paletteMatcher(opts: SnapOptions = DEFAULT_SNAP): (r: number, g: number, b: number) => [number, number, number] {
  const palette = readPalette();
  const labs = palette.map(([r, g, b]) => oklab(r, g, b));
  return (r, g, b) => {
    const raw = oklab(r, g, b);
    return palette[nearestTwo(labs, [raw[0], raw[1] * opts.saturate, raw[2] * opts.saturate], opts.chroma).best]!;
  };
}

/** Returns `w` x `h` RGBA (960x540, a scene, unless told), opaque, every pixel a palette colour. */
export function snap(file: string, opts: SnapOptions = DEFAULT_SNAP, w = SCENE_W, h = SCENE_H): Uint8Array {
  const palette = readPalette();
  const labs = palette.map(([r, g, b]) => oklab(r, g, b));
  const png = decode(readFileSync(file));
  const ch = png.channels;
  const src = png.data;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Area average of the source pixels this output pixel covers.
      const x0 = (x * png.width) / w;
      const x1 = ((x + 1) * png.width) / w;
      const y0 = (y * png.height) / h;
      const y1 = ((y + 1) * png.height) / h;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const cover = wy * (Math.min(sx + 1, x1) - Math.max(sx, x0));
          const i = (sy * png.width + sx) * ch;
          r += src[i]! * cover;
          g += src[i + 1]! * cover;
          b += src[i + 2]! * cover;
          n += cover;
        }
      }
      const raw = oklab(r / n, g / n, b / n);
      // Elliptical falloff: 1 at the centre, 0 at the frame's edge.
      const ex = (x - w / 2) / (w / 2);
      const ey = (y - h / 2) / (h / 2);
      const calm = (opts.calmCentre ?? 0) * Math.max(0, 1 - Math.hypot(ex, ey));
      const lab: [number, number, number] = [raw[0] * (1 - calm), raw[1] * opts.saturate * (1 - calm), raw[2] * opts.saturate * (1 - calm)];
      // The two nearest palette colours; dithering picks the second where the pixel sits between them.
      const { best, second, d1, d2 } = nearestTwo(labs, lab, opts.chroma);
      const mix = Math.sqrt(d1) / (Math.sqrt(d1) + Math.sqrt(d2) || 1);
      const threshold = (BAYER[(y % 4) * 4 + (x % 4)]! + 0.5) / 16;
      const pick = opts.dither > 0 && mix * 2 * opts.dither > threshold ? second : best;
      out.set([...palette[pick]!, 255], (y * w + x) * 4);
    }
  }
  return out;
}

export function writeScene(file: string, rgba: Uint8Array, w = SCENE_W, h = SCENE_H) {
  writeFileSync(file, encode({ width: w, height: h, data: rgba, channels: 4 }));
}

if (import.meta.main) {
  const [input, output, ...rest] = process.argv.slice(2);
  if (!input || !output) throw new Error('usage: snap_painting.ts <in.png> <out.png> [--chroma 3] [--saturate 1.6] [--dither 0]');
  const flag = (name: string, fallback: number) => {
    const at = rest.indexOf(`--${name}`);
    return at >= 0 ? Number(rest[at + 1]) : fallback;
  };
  writeScene(
    output,
    snap(input, {
      chroma: flag('chroma', DEFAULT_SNAP.chroma),
      saturate: flag('saturate', DEFAULT_SNAP.saturate),
      dither: flag('dither', DEFAULT_SNAP.dither),
    }),
  );
  console.log(`wrote ${output}`);
}
