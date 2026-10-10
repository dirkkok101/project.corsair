// Famous pirates' difficulty (not part of the gate): each captain as he sails (pirates.json: class, crew grade,
// skills, fit, temperament, doctrine, morale 90) against the player's ship at each career rung, `N` seeds each.
// Run: pnpm probe:battle famous (N=100 for tighter numbers).
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
const base = { id: 'x', ...SEA, headingDeg: 90, speed: 0, helm: 0, sails: 'full' as const, blocked: false, cargo: {} };

/** The player at each rung: the new career's brig, the armed brig, the fitted brig, a frigate. */
const RUNGS: [string, Ship][] = [
  ['new brig', { ...base, classId: 'ship.brig', guns: 10, crew: 75 }],
  ['brig 18', { ...base, classId: 'ship.brig', crew: 120 }],
  ['brig fitted', { ...base, classId: 'ship.brig', upgrades: Object.keys(content.upgrades), crew: Math.round(shipStats(content, { classId: 'ship.brig', upgrades: Object.keys(content.upgrades) }).maxCrew * 0.8) }],
  ['frigate', { ...base, classId: 'ship.frigate', crew: 200 }],
];

it('famous pirates by rank', () => {
  const out = process.env.OUT ?? '/dev/stdout';
  appendFileSync(out, `${'captain (rank)'.padEnd(26)} ${RUNGS.map(([n]) => n.padStart(12)).join('')}   (player losses of ${N})\n`);
  for (const c of content.pirates.captains) {
    const enemy: Ship = {
      ...base,
      classId: c.classId,
      upgrades: c.upgrades,
      crew: shipStats(content, { classId: c.classId, upgrades: c.upgrades }).maxCrew,
      ai: { nation: 'pirate', role: 'pirate', name: c.name, from: 'a', to: 'b', route: [], along: 0, offset: 0, tackSign: 1, news: [], temperament: c.temperament, nerve: c.nerve, famous: c.id, crew: c.crew, captain: c.captain, ...(c.doctrine ? { doctrine: c.doctrine } : {}), ...(c.terror ? { terror: c.terror } : {}) },
    };
    const cells = RUNGS.map(([, player]) => {
      let lost = 0;
      for (let seed = 1; seed <= N; seed++) {
        const b = createBattle(content, { map, wind: { fromDeg: 70, strength: 'fresh' }, player, enemy, seed, bearingDeg: 45 + seed * 37 });
        let g = 0;
        while (!b.result() && g++ < 30 * 60 * 10) b.step(1, 'cautious');
        if (b.result()!.outcome === 'lost') lost++;
      }
      return String(lost).padStart(12);
    });
    appendFileSync(out, `${`${c.name} (${content.pirates.captains.indexOf(c) + 1})`.padEnd(26)} ${cells.join('')}\n`);
  }
});
