// Packs each ship class's world frames (art/sources/renders/ships, from render_brig.py and
// render_ships.py) into one atlas the game loads: art/game/ships/{sprite}.png, facings across and
// anims down in sprites.json order, one cell per frame. One image per class instead of 736 files.
//
//   node tools/art/pack_ships.ts
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
}
const sprites = JSON.parse(readFileSync(join(ROOT, 'packages', 'data', 'content', 'sprites.json'), 'utf8')) as Record<string, SpriteDef>;

mkdirSync(OUT, { recursive: true });
for (const [id, def] of Object.entries(sprites)) {
  if (!id.startsWith('ship.')) continue;
  const w = def.facings * def.cell;
  const h = def.anims.length * def.cell;
  const atlas = new Uint8Array(w * h * 4);
  def.anims.forEach((anim, row) => {
    for (let f = 0; f < def.facings; f++) {
      const png = decode(readFileSync(join(FRAMES, `${id}.${anim}.f${String(f).padStart(2, '0')}.png`)));
      if (png.width !== def.cell || png.height !== def.cell || png.channels !== 4) throw new Error(`${id}.${anim}.f${f}: not a ${def.cell}px RGBA cell`);
      for (let y = 0; y < def.cell; y++) {
        const src = png.data.subarray(y * def.cell * 4, (y + 1) * def.cell * 4);
        atlas.set(src, ((row * def.cell + y) * w + f * def.cell) * 4);
      }
    }
  });
  writeFileSync(join(OUT, `${id}.png`), encode({ width: w, height: h, data: atlas, channels: 4 }));
  console.log(`${id}: ${def.anims.length} anims x ${def.facings} facings -> ${w}x${h}`);
}
