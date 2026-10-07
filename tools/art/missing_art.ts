// What art the game still needs, in one list: every image the game asks for that isn't in art/game, every
// painting in the brief (art/sources/paintings/README.md) not painted yet or painted but not imported, and
// the things drawn in code for now that want real art.
//
//   node tools/art/missing_art.ts
//
// The game's asks are found two ways: the art ids written in apps/web/src, and the ids it builds from content
// (a good's icon, a ship's portrait, each nation's harbour by size, each port service's interior).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const CONTENT = join(ROOT, 'packages', 'data', 'content');
const json = (file: string) => JSON.parse(readFileSync(join(CONTENT, file), 'utf8'));
const ids = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')) : []);

// What the game has.
const have = new Set([...ids(join(ROOT, 'art', 'game', 'ui')), ...ids(join(ROOT, 'art', 'game', 'scenes'))]);

// What the game asks for: ids written in the code...
const asked = new Map<string, string>();
const ask = (id: string, why: string) => asked.has(id) || asked.set(id, why);
const src = join(ROOT, 'apps', 'web', 'src');
for (const file of readdirSync(src).filter((f) => /\.tsx?$/.test(f))) {
  const text = readFileSync(join(src, file), 'utf8');
  for (const m of text.matchAll(/['"`]((?:ui|outcome|interior|harbour|title)\.[a-z_]+(?:\.[a-z_]+)*)['"`]/g)) ask(m[1]!, `named in ${file}`);
}
// ...and those it builds from content.
const goods: { id: string; staple?: boolean }[] = json('goods.json').goods;
for (const g of goods) ask(`ui.icon.good.${g.id}`, 'each good (merchant, plunder, planner)');
const ships: { id: string }[] = json('ships.json');
for (const s of ships) ask(`ui.ship.${s.id.replace(/^ship\./, '')}`, 'each ship class (ship card)');
for (const shot of ['round', 'chain', 'grape']) ask(`ui.icon.${shot}_shot`, 'each shot (ship card)');
for (const mark of ['hamlet', 'town', 'city', 'haven', 'you', 'compass']) ask(`ui.chart.${mark}`, 'the sea chart');
const settlements: { nation: string; size: string; type: string }[] = json('maps/caribbean/settlements.json');
const tier: Record<string, string> = { hamlet: 'small', town: 'medium', city: 'large' };
for (const s of settlements) {
  if (s.nation === 'pirate' || s.type === 'haven') ask('harbour.pirate.haven', 'a pirate haven');
  else ask(`harbour.${s.nation}.${tier[s.size]}`, `a ${s.nation} ${s.size}`);
}
for (const service of ['merchant', 'tavern', 'governor', 'shipwright']) ask(`interior.${service}`, 'a port service');
ask('interior.tavern.pirate', "a haven's tavern");
for (const end of ['taken', 'sunk', 'lost', 'escaped']) ask(`outcome.${end}`, 'the battle report');

// The brief: every id it lists, painted (a prompt record with a kept version) or not, imported or not.
const brief = readFileSync(join(ROOT, 'art', 'sources', 'paintings', 'README.md'), 'utf8');
// (Backticked names ending .png are the layout references' file names, not ids.)
const briefed = [
  ...new Set(
    [...brief.matchAll(/`((?:harbour|interior|title|duel|dance|fate|outcome|ui)\.[a-z_]+(?:\.[a-z_]+)*)`/g)].map((m) => m[1]!).filter((id) => !id.endsWith('.png')),
  ),
];
const groups: Record<string, string> = { harbour: 'harbours', interior: 'interiors', title: 'title', duel: 'duels', dance: 'dance', fate: 'fates', outcome: 'outcomes', ui: 'ui' };
const painted = (id: string) => {
  const record = join(ROOT, 'art', 'sources', 'paintings', groups[id.split('.')[0]!]!, `${id}.yaml`);
  return existsSync(record) && /^kept:\s*\[\s*\S/m.test(readFileSync(record, 'utf8'));
};
// Painted ahead of scenes and services not built yet: imported when they are.
const AHEAD = /^(duel|dance|fate)\.|^interior\.(bank|surgeon)$/;

// Drawn in code for now; real art would make them better (none blocks the game).
const STAND_INS = [
  'Ship damage: torn sails, a broken mast, a listing hull (Blender renders of each class; the battle draws less canvas, smoke and fire for now)',
  'Wreckage after a sinking: barrels and men in the water (drawn as pixels)',
  "Ships seen on the chart: a diamond in the nation's colour (a painted mark was too dark on the sea)",
  'Battle effects: gunsmoke, splashes, splinters, shot in flight (drawn as pixels)',
];

const missing = [...asked].filter(([id]) => !have.has(id));
const notPainted = briefed.filter((id) => !painted(id));
const notImported = briefed.filter((id) => painted(id) && !have.has(id) && !AHEAD.test(id));
const ahead = briefed.filter((id) => painted(id) && !have.has(id) && AHEAD.test(id));

const section = (title: string, lines: string[]) => console.log(`\n${title} (${lines.length})\n${lines.length ? lines.map((l) => `  ${l}`).join('\n') : '  none'}`);
section('The game asks for these and they are missing', missing.map(([id, why]) => `${id}  (${why})${painted(id) ? ': painted, run the importer' : notPainted.includes(id) ? ': in the brief, not painted yet' : ': not in the brief yet'}`));
section('In the brief, not painted yet', notPainted);
section('Painted, not imported (run tools/art/import_ui.ts or import_paintings.ts)', notImported);
section('Painted ahead of scenes not built yet (imported with their scene)', ahead);
section('Drawn in code for now (would be better as art)', STAND_INS);
