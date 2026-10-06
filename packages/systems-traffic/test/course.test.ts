import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim, TICKS_PER_SECOND } from '@corsair/core';
import { decodeRasterMap, loadContent, placeSettlements } from '@corsair/data';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { expect, it } from 'vitest';
import { createSeaLanes } from '../src';
const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, { terrain: readFileSync(dir + def.layers.terrain), elevation: readFileSync(dir + def.layers.elevation), zones: readFileSync(dir + def.layers.zones) });
const settlements = placeSettlements(def, map, content.settlements);
const lanes = createSeaLanes(map, settlements, content.traffic.laneCell);
const port = (id: string) => settlements.find((s) => s.id === id)!;
// The player's autopilot on real voyages: a course clicked to a port follows the sea lanes and ends
// near enough to dock, beating where it must; one it can't finish hands back the helm instead of grinding.
it('a course clicked to a port sails there by the lanes and ends within docking range', () => {
  const docked: string[] = [];
  for (const [from, to] of [
    ['town.port_royal', 'town.tortuga'], ['town.tortuga', 'town.port_royal'], ['town.port_royal', 'town.cartagena'],
    ['town.port_royal', 'town.havana'], ['town.santiago_de_cuba', 'town.santo_domingo'], ['town.bridgetown', 'town.port_royal'],
    ['town.havana', 'town.veracruz'], ['town.campeche', 'town.villahermosa'], ['town.port_royal', 'town.puerto_principe'],
  ] as const) {
    const a = port(from), b = port(to);
    const start = lanes.mooring(a.id)!;
    const berth = lanes.berth(b.id)!;
    const route = lanes.path(start, berth);
    const world = createWorld(def);
    const sim = createSim({ ...world, wind: { fromDeg: 70, strength: 'fresh' }, ships: { player: { ...world.ships.player!, x: start[0], y: start[1] } } }, [createNavigationSystem(content, map)]);
    sim.send({ type: 'SetAssist', shipId: 'player', assist: 'course', x: b.x, y: b.y, portId: b.id, route: route?.slice(1) });
    sim.applyCommands();
    let t = 0, blocked = 0;
    for (; t < 900 * TICKS_PER_SECOND && sim.state.ships.player!.assist; t++) { sim.step(); if (sim.state.ships.player!.blocked) blocked++; }
    const p = sim.state.ships.player!;
    console.log('VOYAGE', from.slice(5), '->', to.slice(5), 'secs', (t / 30).toFixed(0), 'aground%', ((blocked / t) * 100).toFixed(1), 'from town', Math.hypot(p.x - b.x, p.y - b.y).toFixed(1));
    // Every course ends (no grinding against a coast), and almost all within docking range of the town.
    expect(p.assist).toBeUndefined();
    if (Math.hypot(p.x - b.x, p.y - b.y) <= 3) docked.push(to);
  }
  // Villahermosa lies up an inlet too narrow to beat into: that course gives up a few tiles short.
  expect(docked.length).toBeGreaterThanOrEqual(8);
}, 900_000);
