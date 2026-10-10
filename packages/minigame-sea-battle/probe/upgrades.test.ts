// Balance probe (not part of the gate): each class against her own kind, stock, with each upgrade, and fully
// fitted; and running from her own kind. Run: pnpm probe:battle upgrades (N=40 for more fights, OUT=file to save)
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Ship } from '@corsair/core';
import { decodeRasterMap, loadContent, shipStats } from '@corsair/data';
import { it } from 'vitest';
import { createBattle } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, { terrain: readFileSync(dir + def.layers.terrain), elevation: readFileSync(dir + def.layers.elevation), zones: readFileSync(dir + def.layers.zones) });
const SEA = { x: 880, y: 680 };
const N = Number(process.env.N ?? 30);
const CREW = 0.8;

const ship = (classId: string, upgrades: string[], role?: 'pirate'): Ship => {
  const s = shipStats(content, { classId, upgrades });
  return {
    id: 'x', classId, ...SEA, headingDeg: 90, speed: 0, helm: 0, sails: 'full', blocked: false, cargo: {}, upgrades,
    // Berths filled to the same share: hammocks put more men aboard.
    crew: Math.round(s.maxCrew * CREW),
    ai: role ? { nation: 'pirate', role, name: 'Test', from: 'a', to: 'b', route: [], along: 0, offset: 0, tackSign: 1, news: [], temperament: 'bold' } : undefined,
  };
};

function run(classId: string, upgrades: string[], autopilot: 'cautious' | 'runner', seed: number, wind: 'fresh' | 'strong' = 'fresh') {
  const b = createBattle(content, { map, wind: { fromDeg: 70, strength: wind }, player: ship(classId, upgrades), enemy: ship(classId, [], 'pirate'), seed, bearingDeg: 45 + seed * 37 });
  let guard = 0;
  while (!b.result() && guard++ < 30 * 60 * 10) b.step(1, autopilot);
  const r = b.result()!;
  return { outcome: r.outcome, hullLeft: r.player.hull / shipStats(content, { classId, upgrades }).hullMax };
}

it('upgrade balance', () => {
  const ups = Object.keys(content.upgrades);
  const configs: [string, string[]][] = [['stock', []], ...ups.map((u) => [u, [u]] as [string, string[]]), ['all', ups]];
  const rows: string[] = [];
  for (const classId of Object.keys(content.ships)) {
    const cells: string[] = [];
    for (const [name, list] of configs) {
      let wins = 0;
      let hull = 0;
      for (let seed = 1; seed <= N; seed++) {
        const r = run(classId, list, 'cautious', seed);
        if (r.outcome === 'sunk' || r.outcome === 'struck' || r.outcome === 'boarded') wins++;
        hull += r.hullLeft;
      }
      let esc = 0;
      for (let seed = 1; seed <= Math.ceil(N / 2); seed++) {
        const r = run(classId, list, 'runner', seed);
        if (r.outcome === 'escaped' || r.outcome === 'fled') esc++;
      }
      cells.push(`${name}:${wins}/${N} h${Math.round((hull / N) * 100)} e${esc}/${Math.ceil(N / 2)}`);
    }
    rows.push(`${classId.padEnd(24)} ${cells.join('  ')}`);
    appendFileSync(process.env.OUT ?? '/dev/stdout', rows.at(-1) + '\n');
  }
}, 3_600_000);
