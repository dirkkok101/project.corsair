// Why fights end: outcome mix, seconds, hull and crew left on both sides, against a boarding pirate and a gunnery patrol.
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
const ship = (classId: string, upgrades: string[], role?: 'pirate' | 'patrol', temperament?: string): Ship => ({
  id: 'x', classId, ...SEA, headingDeg: 90, speed: 0, helm: 0, sails: 'full', blocked: false, cargo: {}, upgrades,
  crew: Math.round(shipStats(content, { classId, upgrades }).maxCrew * 0.8),
  ai: role ? { nation: role === 'pirate' ? 'pirate' : 'spain', role, name: 'T', from: 'a', to: 'b', route: [], along: 0, offset: 0, tackSign: 1, news: [], ...(temperament ? { temperament } : {}) } : undefined,
});
it('why', () => {
  for (const classId of ['ship.sloop', 'ship.brig', 'ship.frigate', 'ship.galleon']) {
    for (const [foe, temp] of [['pirate', 'bold'], ['pirate', 'cautious'], ['patrol', undefined]] as const) {
      for (const ups of (process.env.UPS ?? ',scantlings,bronze_cannon').split(',').map((u) => (u ? [u] : []))) {
        const mix: Record<string, number> = {};
        let secs = 0, myHull = 0, theirHull = 0, myCrew = 0, theirCrew = 0, grapples = 0;
        for (let seed = 1; seed <= N; seed++) {
          const b = createBattle(content, { map, wind: { fromDeg: 70, strength: 'fresh' }, player: ship(classId, ups), enemy: ship(classId, [], foe, temp), seed, bearingDeg: 45 + seed * 37 });
          let g = 0, held = 0;
          while (!b.result() && g++ < 30 * 60 * 10) { held = b.state.grappling; b.step(1, (process.env.AUTO ?? 'cautious') as 'cautious'); if (held === 0 && b.state.grappling > 0) grapples++; }
          const r = b.result()!;
          mix[r.outcome] = (mix[r.outcome] ?? 0) + 1;
          secs += b.state.tick / 30;
          const st = b.state.ships;
          myHull += st.player.hull / st.player.hullMax; theirHull += st.enemy.hull / st.enemy.hullMax;
          myCrew += st.player.crew / st.player.crewStart; theirCrew += st.enemy.crew / st.enemy.crewStart;
        }
        const pc = (v: number) => Math.round((v / N) * 100);
        appendFileSync(process.env.OUT ?? '/dev/stdout', `${classId.padEnd(16)} vs ${foe}${temp ? '/' + temp : ''} ${(ups[0] ?? 'stock').padEnd(13)} ${JSON.stringify(mix)} ${Math.round(secs / N)}s hull ${pc(myHull)}/${pc(theirHull)} crew ${pc(myCrew)}/${pc(theirCrew)} grapples ${grapples}\n`);
      }
    }
  }
});
