import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Ship } from '@corsair/core';
import { decodeRasterMap, loadContent } from '@corsair/data';
import { createBattle } from '../src';

export const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const world = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});
// Fights are sailed on the world map itself.
export const map = world;
// Open water south of Jamaica, so fights here are about seamanship, not coastlines.
export const SEA = { x: 1320, y: 1020 };

export const ship = (classId: string, role?: 'merchant' | 'patrol' | 'pirate', crewShare?: number): Ship => {
  const cls = content.ships[classId]!;
  return {
    id: 'x',
    classId,
    ...SEA,
    headingDeg: 90,
    speed: 0,
    helm: 0,
    sails: 'full',
    blocked: false,
    cargo: {},
    crew: crewShare === undefined ? undefined : Math.round(cls.maxCrew * crewShare),
    ai: role ? { nation: 'pirate', role, name: 'Test', from: 'a', to: 'b', route: [], along: 0, offset: 0, tackSign: 1, news: [] } : undefined,
  };
};

/**
 * One fight to the end: the player's brig sails under `autopilot` (by default a gunner keeping her range),
 * with `outfit` (guns mounted, upgrades) when given, else her class's full battery.
 */
export function fight(enemy: Ship, seed: number, autopilot: 'runner' | 'cautious' | 'aggressive' = 'cautious', outfit: Partial<Ship> = {}) {
  const battle = createBattle(content, {
    map,
    wind: { fromDeg: 70, strength: 'fresh' },
    player: { ...ship('ship.brig', undefined, 0.5), ...outfit },
    enemy,
    seed,
    bearingDeg: 45 + seed * 37,
  });
  // Feel metrics: when the player's first broadside goes off, and how many she fires in all.
  // Tension: broadsides before the hulls first meet, and grapples thrown and cut free.
  let volleys = 0;
  let firstVolley: number | undefined;
  let beforeGrapple: number | undefined;
  let grapples = 0;
  let broken = 0;
  let guard = 0;
  while (!battle.result() && guard++ < 30 * 60 * 10) {
    const before = battle.state.ships.player.reload;
    const held = battle.state.grappling;
    battle.step(1, autopilot);
    const after = battle.state.ships.player.reload;
    if (after.port > before.port || after.starboard > before.starboard) {
      volleys++;
      firstVolley ??= battle.state.tick / 30;
    }
    if (held === 0 && battle.state.grappling > 0) {
      grapples++;
      beforeGrapple ??= volleys;
    }
    if (held > 0 && battle.state.grappling === 0 && !battle.result()) broken++;
  }
  return Object.assign(battle, { volleys, firstVolley, beforeGrapple: beforeGrapple ?? volleys, grapples, broken });
}
