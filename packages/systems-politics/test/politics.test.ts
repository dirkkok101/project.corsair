import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim } from '@corsair/core';
import type { WorldState } from '@corsair/core';
import { decodeRasterMap, loadContent, placeSettlements } from '@corsair/data';
import { createWorld } from '@corsair/systems-navigation';
import { describe, expect, it } from 'vitest';
import { atWar, createPoliticsSystem, enemiesOf, initialPolitics, legalTarget, raisePiracy } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});
const settlements = placeSettlements(def, map, content.settlements);
const day = content.calendar.ticksPerDay;

const world = (seed = 1): WorldState => ({ ...createWorld(def), politics: initialPolitics(content), rng: { politics: [seed, 2, 3, 4] } });
const run = (days: number, seed = 1) => {
  const sim = createSim(world(seed), [createPoliticsSystem(content, def.startDate, settlements)]);
  sim.step(days * day);
  return sim;
};

describe('nations at war', () => {
  it('opens in 1660 with Spain at war with England and France beyond the line, and pirates at war with everyone', () => {
    const s = world();
    expect(atWar(content, s, 'england', 'spain')).toBe(true);
    expect(atWar(content, s, 'france', 'spain')).toBe(true);
    expect(atWar(content, s, 'england', 'france')).toBe(false);
    expect(atWar(content, s, 'pirate', 'spain')).toBe(true);
    expect(enemiesOf(content, s, 'netherlands')).toEqual(['pirate']);
  });

  it('declares the Second Anglo-Dutch War in March 1665 and makes peace at Breda in 1667, as news', () => {
    // 1 March 1660 to 1 April 1665: just past the declaration.
    const sim = run(365 * 5 + 31 + 1);
    expect(atWar(content, sim.state, 'england', 'netherlands')).toBe(true);
    const war = sim.events().find((e) => e.type === 'WarDeclared' && e.entityIds.includes('netherlands') && e.entityIds.includes('england'));
    expect(war).toBeDefined();
    const news = sim.state.news!.find((n) => n.kind === 'war' && [n.nation, n.other].includes('netherlands'))!;
    expect(news.settlementId).toBe('town.port_royal');
    // To late 1667: the Treaty of Breda.
    sim.step((365 * 2 + 200) * day);
    expect(atWar(content, sim.state, 'england', 'netherlands')).toBe(false);
  }, 60_000);

  it('replays exactly from its seed', () => {
    expect(run(400, 7).hash()).toBe(run(400, 7).hash());
  });

  it('a letter of marque covers only its nation\'s current enemies', () => {
    const s: WorldState = { ...world(), politics: { ...initialPolitics(content), relations: { ...initialPolitics(content).relations, 'england:spain': { war: true, tension: 85 } } } };
    const captain = { gold: 0, knownPrices: {}, marques: ['england' as const] };
    expect(legalTarget(content, s, captain, 'spain')).toBe('england');
    expect(legalTarget(content, s, captain, 'france')).toBeUndefined();
    expect(legalTarget(content, s, captain, 'pirate')).toBeUndefined();
  });

  it('pirate pressure rises with every merchant taken and makes the news once, as it crosses the line', () => {
    let s: WorldState = world();
    const crossings = Math.ceil(content.politics.piracy.plague / content.politics.piracy.perTaken);
    for (let i = 0; i < crossings + 2; i++) s = raisePiracy(content, s, settlements, 'spain', 1);
    expect(s.politics!.piracy.spain).toBeGreaterThanOrEqual(content.politics.piracy.plague);
    expect(s.news!.filter((n) => n.kind === 'plague')).toHaveLength(1);
    expect(s.news![0]!.settlementId).toBe('town.santo_domingo');
  });
});
