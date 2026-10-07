import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSim } from '@corsair/core';
import { decodeRasterMap, isLand, loadContent, placeSettlements, tileAt } from '@corsair/data';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { createWeatherSystem, createWindField, withWeather } from '@corsair/systems-weather';
import { describe, expect, it } from 'vitest';
import { createSeaLanes } from '../src';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, { terrain: readFileSync(dir + def.layers.terrain), elevation: readFileSync(dir + def.layers.elevation), zones: readFileSync(dir + def.layers.zones) });
const settlements = placeSettlements(def, map, content.settlements);
const lanes = createSeaLanes(map, settlements, content.traffic.laneCell);

// The course autopilot (PRD section 4) brings her into every port: from 12 tiles out along a lane, she
// arrives (and the game docks her) without running aground or circling off the harbour.
describe('making port on the autopilot', () => {
  it('reaches every port from 12 tiles out, within 20 seconds', () => {
    const windAt = createWindField(content, def, map);
    const w = createWorld(def);
    const failed: string[] = [];
    for (const port of settlements) {
      // 12 tiles back along a lane into this port from another.
      const from = settlements.find((q) => q !== port && lanes.route(q.id, port.id));
      if (!from) continue;
      const r = lanes.route(from.id, port.id)!;
      let back = 12;
      let at = { x: r.at(-1)![0], y: r.at(-1)![1] };
      for (let i = r.length - 1; i > 0 && back > 0; i--) {
        const [a, b] = [r[i]!, r[i - 1]!];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const k = Math.min(1, back / len);
        at = { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k };
        back -= len;
      }
      const sim = createSim(withWeather({ ...w, ships: { player: { ...w.ships.player!, ...at } } }, content, def, 3), [
        createWeatherSystem(content, def, map),
        createNavigationSystem(content, map, windAt),
      ]);
      const path = lanes.path([at.x, at.y], lanes.berth(port.id)!)!;
      sim.send({ type: 'SetAssist', shipId: 'player', assist: 'course', x: port.x, y: port.y, portId: port.id, route: path.slice(1) });
      sim.applyCommands();
      // 600 ticks: 20 seconds at 1x.
      for (let i = 0; i < 600 && sim.state.ships.player!.assist; i++) sim.step(1);
      const ended = sim.events().at(-1)!;
      if (sim.state.ships.player!.assist || ended.type !== 'CourseArrived') failed.push(`${port.id}: ${sim.state.ships.player!.assist ? 'still sailing' : `${ended.type} ${JSON.stringify(ended.payload)}`}`);
    }
    expect(failed).toEqual([]);
  });
});
