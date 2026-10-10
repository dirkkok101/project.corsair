// Difficulty by level: the starting brig against a pirate sloop and a patrol brig drawn as the world draws them at
// each level (captain, crew grade and fits, combat.json difficulty), the player's near misses and the wind as the
// level has them. Prints wins and outcome mix per level. LEVELS (a JSON list of levels) tries other knobs; ROLE one foe.
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rngStream, seedRng } from '@corsair/core';
import type { Ship } from '@corsair/core';
import { atDifficulty, decodeRasterMap, loadContent, shipStats } from '@corsair/data';
import { it } from 'vitest';
import { createBattle } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, { terrain: readFileSync(dir + def.layers.terrain), elevation: readFileSync(dir + def.layers.elevation), zones: readFileSync(dir + def.layers.zones) });
const SEA = { x: 880, y: 680 };
const N = Number(process.env.N ?? 40);

it('difficulty', () => {
  const only = process.env.LEVELS ? (JSON.parse(process.env.LEVELS) as typeof content.combat.difficulty.levels) : undefined;
  for (const level of only ?? content.combat.difficulty.levels) {
    for (const [classId, role] of ([['ship.sloop', 'pirate'], ['ship.brig', 'patrol']] as const).filter(([, r]) => !process.env.ROLE || r === process.env.ROLE)) {
      const mix: Record<string, number> = {};
      for (let seed = 1; seed <= N; seed++) {
        const draw = rngStream(seedRng(seed, 'probe'));
        const d = content.combat.captains[role]!;
        const skill = ([lo, hi]: [number, number]) => Math.round(draw.range(lo, hi));
        const drawn = atDifficulty(level, draw.weighted(d.crew), { gunnery: skill(d.gunnery), seamanship: skill(d.seamanship), boarding: skill(d.boarding), resolve: skill(d.resolve) }, () => draw.float());
        const upgrades = Object.entries(content.traffic.fits[role] ?? {}).filter(([, p]) => draw.float() < p * level.fits).map(([id]) => id);
        const enemy: Ship = {
          id: 'e', classId, ...SEA, headingDeg: 90, speed: 0, helm: 0, sails: 'full', blocked: false, cargo: {}, upgrades,
          crew: Math.round(shipStats(content, { classId, upgrades }).maxCrew * 0.8),
          ai: { nation: role === 'pirate' ? 'pirate' : 'spain', role, name: 'T', from: 'a', to: 'b', route: [], along: 0, offset: 0, tackSign: 1, news: [], ...drawn },
        };
        const player: Ship = { id: 'p', classId: 'ship.brig', ...SEA, headingDeg: 90, speed: 0, helm: 0, sails: 'full', blocked: false, cargo: {}, crew: 75, guns: 10 };
        const b = createBattle(content, { map, wind: { fromDeg: 70, strength: 'fresh' }, player, enemy, seed, bearingDeg: 45 + seed * 37, difficulty: level });
        let g = 0;
        while (!b.result() && g++ < 30 * 60 * 10) b.step(1, 'cautious');
        const r = b.result()!.outcome;
        mix[r] = (mix[r] ?? 0) + 1;
      }
      const won = (mix.sunk ?? 0) + (mix.struck ?? 0) + (mix.boarded ?? 0);
      appendFileSync(process.env.OUT ?? '/dev/stdout', `${level.name.padEnd(13)} brig vs ${role} ${classId.padEnd(11)} won ${won}/${N} ${JSON.stringify(mix)}\n`);
    }
  }
});
