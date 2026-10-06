// Packs each ship class's world frames (art/sources/renders/ships, from render_brig.py and
// render_ships.py) into one atlas the game loads: art/game/ships/{sprite}.png, facings across and
// anims down in sprites.json order, one cell per frame. One image per class instead of 736 files.
//
//   node tools/art/pack_ships.ts
//
// Also writes {sprite}.tops.json: for every anim and facing, the frame's highest opaque pixel (the
// mast tip) as an offset from the pivot, so the game can fly a ship's colours from her real masthead.
import { decode, encode } from 'fast-png';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const FRAMES = join(ROOT, 'art', 'sources', 'renders', 'ships');
const OUT = join(ROOT, 'art', 'game', 'ships');

interface SpriteDef {
  cell: number;
  facings: number;
  anims: string[];
  pivot: { x: number; y: number };
}
const sprites = JSON.parse(readFileSync(join(ROOT, 'packages', 'data', 'content', 'sprites.json'), 'utf8')) as Record<string, SpriteDef>;

mkdirSync(OUT, { recursive: true });
for (const [id, def] of Object.entries(sprites)) {
  if (!id.startsWith('ship.')) continue;
  const w = def.facings * def.cell;
  const h = def.anims.length * def.cell;
  const atlas = new Uint8Array(w * h * 4);
  const tops: Record<string, [number, number][]> = {};
  def.anims.forEach((anim, row) => {
    tops[anim] = [];
    for (let f = 0; f < def.facings; f++) {
      const png = decode(readFileSync(join(FRAMES, `${id}.${anim}.f${String(f).padStart(2, '0')}.png`)));
      if (png.width !== def.cell || png.height !== def.cell || png.channels !== 4) throw new Error(`${id}.${anim}.f${f}: not a ${def.cell}px RGBA cell`);
      for (let y = 0; y < def.cell; y++) {
        const src = png.data.subarray(y * def.cell * 4, (y + 1) * def.cell * 4);
        atlas.set(src, ((row * def.cell + y) * w + f * def.cell) * 4);
      }
      // The mast tip: the first opaque pixel from the top near the hull's centre line (masts stand
      // there; a lateen yard or bowsprit end reaching out sideways is not a masthead).
      let top: [number, number] = [0, 0];
      const px = Math.round(def.pivot.x * def.cell);
      const band = Math.round(def.cell * 0.2);
      for (let y = 0; y < def.cell; y++) {
        const xs: number[] = [];
        for (let x = px - band; x <= px + band; x++) if (png.data[(y * def.cell + x) * 4 + 3]! > 0) xs.push(x);
        if (xs.length) {
          top = [xs[Math.floor(xs.length / 2)]! - Math.round(def.pivot.x * def.cell), y - Math.round(def.pivot.y * def.cell)];
          break;
        }
      }
      tops[anim]!.push(top);
    }
  });
  writeFileSync(join(OUT, `${id}.png`), encode({ width: w, height: h, data: atlas, channels: 4 }));
  writeFileSync(join(OUT, `${id}.tops.json`), JSON.stringify(tops));
  console.log(`${id}: ${def.anims.length} anims x ${def.facings} facings -> ${w}x${h}`);
}
