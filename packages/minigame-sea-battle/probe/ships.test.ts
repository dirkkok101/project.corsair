// The new ships in battle: the starting brig (and a sloop) against each, fresh breeze and calm. Prints outcomes.
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
const ship = (classId: string, role?: 'pirate' | 'patrol' | 'merchant', crew?: number, guns?: number): Ship => ({
  id: 'x', classId, ...SEA, headingDeg: 90, speed: 0, helm: 0, sails: 'full', blocked: false, cargo: {},
  crew: crew ?? Math.round(shipStats(content, { classId }).maxCrew * 0.8), ...(guns !== undefined ? { guns } : {}),
  ai: role ? { nation: role === 'pirate' ? 'pirate' : 'spain', role, name: 'T', from: 'a', to: 'b', route: [], along: 0, offset: 0, tackSign: 1, news: [] } : undefined,
});
it('ships', () => {
  const foes: [string, 'pirate' | 'patrol' | 'merchant'][] = [['ship.periagua', 'pirate'], ['ship.pinnace', 'pirate'], ['ship.half_galley', 'patrol'], ['ship.ketch', 'merchant'], ['ship.pink', 'merchant'], ['ship.galley_frigate', 'patrol']];
  for (const strength of ['fresh', 'calm'] as const)
    for (const [classId, role] of foes) {
      const mix: Record<string, number> = {};
      let secs = 0;
      for (let seed = 1; seed <= N; seed++) {
        const b = createBattle(content, { map, wind: { fromDeg: 70, strength }, player: ship('ship.brig', undefined, 75, 10), enemy: ship(classId, role), seed, bearingDeg: 45 + seed * 37 });
        let g = 0;
        while (!b.result() && g++ < 30 * 60 * 10) b.step(1, 'cautious');
        const r = b.result()!.outcome;
        mix[r] = (mix[r] ?? 0) + 1;
        secs += b.state.tick / 30;
      }
      appendFileSync(process.env.OUT ?? '/dev/stdout', `${strength.padEnd(6)} brig vs ${role} ${classId.padEnd(20)} ${JSON.stringify(mix)} ${Math.round(secs / N)}s\n`);
    }
});
