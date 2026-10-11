import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim } from '@corsair/core';
import type { GameEvent, WorldState } from '@corsair/core';
import { decodeRasterMap, loadContent, placeSettlements } from '@corsair/data';
import { createWorld } from '@corsair/systems-navigation';
import { describe, expect, it } from 'vitest';
import { createEconomySystem, createLogbookSystem, LOGBOOK_SIZE, withEconomy } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});
const settlements = placeSettlements(def, map, content.settlements);
const port = settlements.find((s) => s.id === 'town.port_royal')!;
const day = content.calendar.ticksPerDay;

function docked() {
  const world = createWorld(def);
  const ship = { ...world.ships.player!, x: port.x + 1, y: port.y + 1, cargo: { sugar: 40 } };
  const state = withEconomy({ ...world, ships: { player: ship } }, content, settlements, 1);
  const sim = createSim(state, [createEconomySystem(content, settlements), createLogbookSystem(content, settlements)]);
  sim.send({ type: 'Dock', shipId: 'player', settlementId: port.id });
  sim.applyCommands();
  return sim;
}

describe('the logbook', () => {
  it('writes a sale, adding lots of one good sold the same day into one line, with the profit', () => {
    const sim = docked();
    sim.send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 10 });
    sim.applyCommands();
    sim.send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 10 });
    sim.applyCommands();
    const log = sim.state.captain!.logbook!;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'deed', place: port.id, sale: { good: 'sugar', quantity: 20 } });
    expect(log[0]!.text).toMatch(new RegExp(`^Sold 20 sugar at ${port.name} for [\\d,]+ gold: \\+[\\d,]+\\.$`));
    // Another day is another line.
    sim.step(day);
    sim.send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 10 });
    sim.applyCommands();
    expect(sim.state.captain!.logbook).toHaveLength(2);
  });

  it('writes the news heard in a tavern', () => {
    const sim = docked();
    sim.send({ type: 'SpawnShock', settlementId: port.id, good: 'sugar', kind: 'shortage' });
    sim.applyCommands();
    sim.send({ type: 'HearNews', shipId: 'player' });
    sim.applyCommands();
    const news = sim.state.captain!.logbook!.filter((e) => e.kind === 'news');
    expect(news).toHaveLength(1);
    expect(news[0]).toMatchObject({ place: port.id });
    expect(news[0]!.text).toContain(port.name);
  });

  it('keeps the last 200 lines', () => {
    const log = createLogbookSystem(content, settlements);
    let state = docked().state as WorldState;
    const deeds: GameEvent[] = Array.from({ length: LOGBOOK_SIZE + 5 }, (_, i) => ({
      tick: i,
      type: 'HoardFound',
      system: 'traffic',
      entityIds: ['player'],
      payload: { name: `Pirate ${i}`, gold: 100 },
    }));
    state = log.observe!(state, deeds);
    const book = state.captain!.logbook!;
    expect(book).toHaveLength(LOGBOOK_SIZE);
    expect(book.at(-1)!.text).toBe(`Dug up Pirate ${LOGBOOK_SIZE + 4}'s hoard: 100 gold.`);
  });
});
