import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeRasterMap, isLand, loadContent, placeSettlements, tileAt } from '@corsair/data';
import { describe, expect, it } from 'vitest';
import { createSeaLanes } from '../src/lanes';

const content = loadContent();
const def = content.maps.caribbean;
const dir = fileURLToPath(new URL('../../data/content/maps/caribbean/', import.meta.url));
const map = decodeRasterMap(def, {
  terrain: readFileSync(dir + def.layers.terrain),
  elevation: readFileSync(dir + def.layers.elevation),
  zones: readFileSync(dir + def.layers.zones),
});
const settlements = placeSettlements(def, map, content.settlements);
const lanes = createSeaLanes(map, settlements, content.traffic.laneCell);

describe('sea lanes', () => {
  it('give almost every port a mooring and a lane to Port Royal', () => {
    const unreached = settlements.filter((s) => s.id !== 'town.port_royal' && !lanes.route(s.id, 'town.port_royal')).map((s) => s.name);
    console.log('LANES unreached', unreached.join(', ') || 'none');
    // A port up a river or inside a lagoon may have no lane at this grid; the rest of the map must join up.
    expect(unreached.length).toBeLessThanOrEqual(3);
  });

  it('run on water the whole way, from mooring to mooring', () => {
    const route = lanes.route('town.bridgetown', 'town.havana')!;
    expect(route[0]).toEqual(lanes.mooring('town.bridgetown'));
    expect(route.at(-1)).toEqual(lanes.mooring('town.havana'));
    for (let k = 1; k < route.length; k++) {
      const [x0, y0] = route[k - 1]!;
      const [x1, y1] = route[k]!;
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
      for (let i = 0; i <= steps; i++) expect(isLand(tileAt(map, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps))).toBe(false);
    }
  });

  it('are the same both ways, and straightened into a few legs', () => {
    const there = lanes.route('town.port_royal', 'town.cartagena')!;
    const back = lanes.route('town.cartagena', 'town.port_royal')!;
    expect(back).toEqual([...there].reverse());
    expect(there.length).toBeLessThan(12);
  });
});
