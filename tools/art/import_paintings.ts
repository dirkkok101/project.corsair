// Imports the painted scenes: for every prompt record in art/prompts/*.yaml, snaps the kept raw
// image (art/generated/grok/{group}/{id}.{kept}.png) to art/generated/painted/{id}.png.
//
//   node tools/art/import_paintings.ts [--review <dir>]
//
// With --review, also writes each harbour with its harbours.json hotspots, flag point and anchorage
// drawn on, to check the painting kept the layout the game's clickable buildings depend on.
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENE_W, snap, writeScene } from './snap_painting.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const PROMPTS = join(ROOT, 'art', 'prompts');
const OUT = join(ROOT, 'art', 'generated', 'painted');
const GROUPS: Record<string, string> = { harbour: 'harbours', interior: 'interiors', title: 'title' };

const args = process.argv.slice(2);
const reviewDir = args.includes('--review') ? args[args.indexOf('--review') + 1] : undefined;
const harbours = JSON.parse(readFileSync(join(ROOT, 'art', 'generated', 'harbours', 'harbours.json'), 'utf8')) as Record<
  string,
  { hotspots: Record<string, [number, number, number, number]>; flag: [number, number]; anchor: [number, number] }
>;

mkdirSync(OUT, { recursive: true });
if (reviewDir) mkdirSync(reviewDir, { recursive: true });

for (const file of readdirSync(PROMPTS).filter((f) => f.endsWith('.yaml')).sort()) {
  const text = readFileSync(join(PROMPTS, file), 'utf8');
  const id = /^id:\s*(\S+)/m.exec(text)?.[1];
  // The first kept version is the one that ships; records list them as `kept: [v2]`.
  const kept = /^kept:\s*\[\s*([^\],\s]+)/m.exec(text)?.[1];
  const group = id && GROUPS[id.split('.')[0]!];
  if (!id || !kept || !group) throw new Error(`${file}: needs an id, a kept version and a known group`);
  const raw = join(ROOT, 'art', 'generated', 'grok', group, `${id}.${kept}.png`);
  if (!existsSync(raw)) throw new Error(`${file}: ${raw} is missing`);
  const rgba = snap(raw);
  writeScene(join(OUT, `${id}.png`), rgba);
  console.log(`${id} <- ${kept}`);

  const layout = harbours[id];
  if (reviewDir && layout) {
    const mark = (x: number, y: number, c: [number, number, number]) => {
      if (x < 0 || y < 0 || x >= SCENE_W || y >= 540) return;
      rgba.set([...c, 255], (Math.round(y) * SCENE_W + Math.round(x)) * 4);
    };
    const box = ([x, y, w, h]: number[], c: [number, number, number]) => {
      for (let i = 0; i <= w!; i++) for (const t of [0, 1]) (mark(x! + i, y! + t, c), mark(x! + i, y! + h! - t, c));
      for (let j = 0; j <= h!; j++) for (const t of [0, 1]) (mark(x! + t, y! + j, c), mark(x! + w! - t, y! + j, c));
    };
    for (const rect of Object.values(layout.hotspots)) box(rect, [255, 255, 0]);
    box([layout.flag[0] - 4, layout.flag[1] - 4, 8, 8], [255, 0, 255]);
    box([layout.anchor[0] - 10, layout.anchor[1] - 6, 20, 12], [0, 255, 255]);
    writeScene(join(reviewDir, `${id}.png`), rgba);
  }
}
