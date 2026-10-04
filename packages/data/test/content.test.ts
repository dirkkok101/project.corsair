import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src';

const content = loadContent();
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

describe('ship sprites', () => {
  // The renderer picks `sail_{setting}_{point}[_{tack}][frame]`; every combination must exist.
  const expected = ['sail_furled'];
  for (const setting of ['full', 'half']) {
    for (const { id } of content.navigation.pointsOfSail) {
      if (id === 'run') expected.push(`sail_${setting}_run`);
      else if (id === 'irons') expected.push(...['p0', 'p1', 's0', 's1'].map((t) => `sail_${setting}_irons_${t}`));
      else expected.push(`sail_${setting}_${id}_p`, `sail_${setting}_${id}_s`);
    }
  }

  for (const ship of Object.values(content.ships)) {
    const def = content.sprites[ship.sprites.world]!;
    it(`${ship.id} lists every sail sprite`, () => {
      expect([...def.anims].sort()).toEqual([...expected].sort());
    });

    it(`${ship.id} has a frame file for every anim and facing`, () => {
      const missing = def.anims.flatMap((anim) =>
        Array.from({ length: def.facings }, (_, f) => `${ship.sprites.world}.${anim}.f${String(f).padStart(2, '0')}.png`),
      ).filter((file) => !existsSync(`${repoRoot}art/generated/ships/brig45/world/${file}`));
      expect(missing).toEqual([]);
    });
  }
});
