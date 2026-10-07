// Imports the painted scenes: for every prompt record in art/sources/paintings/{group}/*.yaml, snaps the kept raw
// image (art/sources/paintings/{group}/{id}.{kept}.png) to art/game/scenes/{id}.png, plus
// {id}.sea.f00..f03.png shimmer frames for each harbour.
//
//   node tools/art/import_paintings.ts [--review <dir>]
//
// With --review, also writes each harbour with its harbours.json hotspots, flag point and anchorage
// drawn on, to check the painting kept the layout the game's clickable buildings depend on.
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SNAP, SCENE_H, SCENE_W, snap, writeScene } from './snap_painting.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const SOURCES = join(ROOT, 'art', 'sources', 'paintings');
const OUT = join(ROOT, 'art', 'game', 'scenes');
// Id prefix to the folder its raw output lives in. Duel, dance and fate backgrounds are painted ahead of
// their scenes (see the brief's "Next scenes"); outcomes are the battle report's pictures.
const GROUPS: Record<string, string> = {
  harbour: 'harbours',
  interior: 'interiors',
  title: 'title',
  duel: 'duels',
  dance: 'dance',
  fate: 'fates',
  outcome: 'outcomes',
};
/** 4:3 cards (a battle's outcome, a retirement fate) rather than 16:9 scenes: snapped to this size. */
const CARD: Record<string, [number, number]> = { fates: [320, 240], outcomes: [320, 240] };

const args = process.argv.slice(2);
const reviewDir = args.includes('--review') ? args[args.indexOf('--review') + 1] : undefined;
const harbours = JSON.parse(readFileSync(join(ROOT, 'art', 'game', 'harbours', 'harbours.json'), 'utf8')) as Record<
  string,
  { hotspots: Record<string, [number, number, number, number]>; flag: [number, number]; anchor: [number, number] }
>;

const SEA_FRAMES = 4;
/** Sea colours: blue leads. The painted sea snaps to navy, slate and the palette blues, all blue-led. */
const seaColour = (r: number, g: number, b: number) => b > r + 8 && b >= g - 6;

/**
 * The painted sea is still; the game's harbour sea shimmers. Below the waterline (found by climbing
 * from the bottom while rows stay mostly sea), each frame slides the sea's pixels sideways in a slow
 * wave that widens with depth. Sea pixels only borrow from other sea pixels, so the jetty, posts and
 * boats stay put. Frames hold only the sea (the rest transparent) and lie over the painted base.
 */
function writeShimmer(id: string, base: Uint8Array): number {
  const sea = (x: number, y: number) => {
    const i = (y * SCENE_W + x) * 4;
    return seaColour(base[i]!, base[i + 1]!, base[i + 2]!);
  };
  let waterline = SCENE_H;
  for (let y = SCENE_H - 1; y >= 0; y--) {
    let n = 0;
    for (let x = 0; x < SCENE_W; x++) if (sea(x, y)) n++;
    if (n < SCENE_W * 0.6) break;
    waterline = y;
  }
  if (SCENE_H - waterline < 20) return 0;
  for (let f = 0; f < SEA_FRAMES; f++) {
    const frame = new Uint8Array(SCENE_W * SCENE_H * 4);
    for (let y = waterline; y < SCENE_H; y++) {
      const depth = (y - waterline) / (SCENE_H - waterline);
      // Rows travel in bands; nearer the shore the swell is a pixel, out in the bay up to three.
      const dx = Math.round(Math.sin(y * 0.45 + (f * Math.PI) / 2) * (1 + depth * 2));
      for (let x = 0; x < SCENE_W; x++) {
        if (!sea(x, y)) continue;
        const sx = Math.min(SCENE_W - 1, Math.max(0, x + dx));
        const from = sea(sx, y) ? sx : x;
        const i = (y * SCENE_W + x) * 4;
        frame.set(base.subarray((y * SCENE_W + from) * 4, (y * SCENE_W + from) * 4 + 3), i);
        frame[i + 3] = 255;
      }
    }
    writeScene(join(OUT, `${id}.sea.f${String(f).padStart(2, '0')}.png`), frame);
  }
  return SEA_FRAMES;
}

mkdirSync(OUT, { recursive: true });
if (reviewDir) mkdirSync(reviewDir, { recursive: true });

const records = Object.values(GROUPS).flatMap((g) =>
  existsSync(join(SOURCES, g)) ? readdirSync(join(SOURCES, g)).filter((f) => f.endsWith('.yaml')).map((f) => join(g, f)) : [],
);
for (const file of records.sort()) {
  const text = readFileSync(join(SOURCES, file), 'utf8');
  const id = /^id:\s*(\S+)/m.exec(text)?.[1];
  // The first kept version is the one that ships; records list them as `kept: [v2]`.
  const kept = /^kept:\s*\[\s*([^\],\s]+)/m.exec(text)?.[1];
  const group = id && GROUPS[id.split('.')[0]!];
  if (!id || !kept || !group) throw new Error(`${file}: needs an id, a kept version and a known group`);
  const raw = join(SOURCES, group, `${id}.${kept}.png`);
  if (!existsSync(raw)) throw new Error(`${file}: ${raw} is missing`);
  // Interiors sit behind the service panels, which cover the middle: calm the centre so the panel reads.
  const [w, h] = CARD[group] ?? [SCENE_W, SCENE_H];
  const rgba = snap(raw, group === 'interiors' ? { ...DEFAULT_SNAP, calmCentre: 0.45 } : DEFAULT_SNAP, w, h);
  writeScene(join(OUT, `${id}.png`), rgba, w, h);
  const layout = harbours[id];
  const frames = layout ? writeShimmer(id, rgba) : 0;
  console.log(`${id} <- ${kept}${frames ? `, ${frames} sea frames` : ''}`);

  if (reviewDir && layout) {
    const mark = (x: number, y: number, c: [number, number, number]) => {
      if (x < 0 || y < 0 || x >= SCENE_W || y >= SCENE_H) return;
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
