// Flattens each harbour composition (art/generated/harbours/harbours.json) into one 960x540 PNG,
// sea frame 0, for use as a layout reference when painting the scenes with an image model: a
// repaint that keeps this layout keeps the hotspots, flag point and anchorage in harbours.json.
//
//   node tools/art/composite_harbours.ts
//
// Writes art/references/harbours/{composition}.png.
import { decode, encode } from 'fast-png';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'art', 'references', 'harbours');
const W = 960;
const H = 540;

interface Layer {
  file?: string;
  frames?: string[];
}
const defs = JSON.parse(readFileSync(join(ROOT, 'art', 'generated', 'harbours', 'harbours.json'), 'utf8')) as Record<
  string,
  { layers: Layer[] }
>;

mkdirSync(OUT, { recursive: true });
for (const [id, def] of Object.entries(defs)) {
  const out = new Uint8Array(W * H * 4);
  for (const layer of def.layers) {
    const png = decode(readFileSync(join(ROOT, layer.file ?? layer.frames![0]!)));
    if (png.width !== W || png.height !== H || png.channels !== 4) throw new Error(`${id}: layer is not 960x540 RGBA`);
    // Layers have binary alpha, so compositing is a straight copy of opaque pixels.
    for (let i = 0; i < W * H; i++) {
      if (png.data[i * 4 + 3]! < 128) continue;
      out.set(png.data.subarray(i * 4, i * 4 + 4), i * 4);
    }
  }
  writeFileSync(join(OUT, `${id}.png`), encode({ width: W, height: H, data: out, channels: 4 }));
  console.log(`wrote ${id}.png`);
}
