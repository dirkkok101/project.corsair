// Renders the ship card portraits no painting was made for, from each class's 3D model: for every class in
// ships.json without a prompt record at art/sources/paintings/ui/ui.ship.{class}.yaml (or the classes named),
// opens apps/web/shipcard.html in a headless browser, saves the frame as that record's v1 and writes the record.
// tools/art/import_ui.ts then keys, crops, shrinks and palette-snaps it like the painted cards.
//
//   node tools/art/render_ship_cards.ts [ship.pinnace ...]
//   node tools/art/import_ui.ts
import { chromium } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'art', 'sources', 'paintings', 'ui');
const ships = JSON.parse(readFileSync(join(ROOT, 'packages', 'data', 'content', 'ships.json'), 'utf8')) as { id: string; name: string }[];
const name = (id: string) => id.replace(/^ship\./, '');
const asked = process.argv.slice(2);
const classes = asked.length ? asked : ships.map((s) => s.id).filter((id) => !existsSync(join(OUT, `ui.ship.${name(id)}.yaml`)));
if (!classes.length) {
  console.log('Every class has a card.');
  process.exit(0);
}

const server = await createServer({ root: join(ROOT, 'apps', 'web'), server: { port: 5298, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 480 } });
  for (const id of classes) {
    await page.goto(`http://localhost:5298/shipcard.html?class=${id}`);
    await page.waitForFunction(() => (window as unknown as { __card?: boolean }).__card === true);
    await page.locator('canvas').screenshot({ path: join(OUT, `ui.ship.${name(id)}.v1.png`) });
    writeFileSync(
      join(OUT, `ui.ship.${name(id)}.yaml`),
      [
        `id: ui.ship.${name(id)}`,
        'tool: tools/art/render_ship_cards.ts',
        `date: ${new Date().toISOString().slice(0, 10)}`,
        'prompt: |',
        `  Rendered, not painted: the ${ships.find((s) => s.id === id)?.name ?? id}'s 3D model (packages/render3d/src/rigs.ts) in side view`,
        '  facing right, sails set full, no colours flying, on flat magenta (apps/web/shipcard.html).',
        'kept: [v1]',
        'hand_changes: "None."',
        '',
      ].join('\n'),
    );
    console.log(`ui.ship.${name(id)}.v1.png`);
  }
} finally {
  await browser.close();
  await server.close();
}
