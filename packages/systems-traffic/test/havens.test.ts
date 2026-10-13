import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GameEvent, WorldState } from '@corsair/core';
import { careerSettlements, decodeRasterMap, loadContent, placeSettlements } from '@corsair/data';
import { withEconomy } from '@corsair/systems-economy';
import { createWorld } from '@corsair/systems-navigation';
import { describe, expect, it } from 'vitest';
import { createHavensSystem, havenKnown } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, { terrain: readFileSync(dir + def.layers.terrain), elevation: readFileSync(dir + def.layers.elevation), zones: readFileSync(dir + def.layers.zones) });
// A career's own ports, its coves drawn from its seed.
const settlements = placeSettlements(def, map, careerSettlements(content, 7));
const coves = settlements.filter((s) => s.id.startsWith('haven.'));
const tortuga = settlements.find((s) => s.id === 'town.tortuga')!;
const system = createHavensSystem(content, settlements);

/** A new career, her ship at (x, y). */
const at = (x: number, y: number): WorldState => {
  const world = createWorld(def);
  return withEconomy({ ...world, ships: { player: { ...world.ships.player!, x, y } } }, content, settlements, 1);
};
const event = (type: string, entityIds: string[], payload: Record<string, unknown> = {}): GameEvent => ({ tick: 1, type, system: 'test', entityIds, payload });

describe('the pirate havens, hidden until found', () => {
  it('knows Tortuga and the nations’ ports from the start, and none of the coves', () => {
    const state = at(0, 0);
    expect(havenKnown(content, state, tortuga)).toBe(true);
    expect(havenKnown(content, state, settlements.find((s) => s.id === 'town.port_royal')!)).toBe(true);
    for (const c of coves) expect(havenKnown(content, state, c)).toBe(false);
  });

  it('finds a cove when she sights it, docks there, hails a pirate bound for it, or hears news from it', () => {
    const [a, b, c, d] = coves;
    // Sighted: within the lookout's reach of it.
    const sighted = system.observe!(at(a!.x + 5, a!.y), []);
    expect(sighted.captain!.knownHavens).toEqual([a!.id]);
    // Docked there.
    expect(system.observe!(at(0, 0), [event('Docked', ['player', b!.id])]).captain!.knownHavens).toEqual([b!.id]);
    // A pirate hailed: she names where she sails from.
    const base = at(0, 0);
    const pirate = { ...base.ships.player!, id: 'ai.9', ai: { nation: 'pirate' as const, role: 'pirate' as const, name: 'T', from: c!.id, to: c!.id, route: [], along: 0, offset: 0, tackSign: 1 as const, news: [] } };
    const hailed = system.observe!({ ...base, ships: { ...base.ships, [pirate.id]: pirate } }, [event('Hailed', ['player', pirate.id])]);
    expect(hailed.captain!.knownHavens).toEqual([c!.id]);
    // News from it, heard in a tavern.
    const told = { ...base, news: [{ id: 'n1', kind: 'aiTaken', tick: 0, settlementId: d!.id, nation: 'spain' as const }] } as WorldState;
    expect(system.observe!(told, [event('NewsHeard', ['town.port_royal'], { ids: ['n1'] })]).captain!.knownHavens).toEqual([d!.id]);
  });
});
