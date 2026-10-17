import { zoneAt } from '@corsair/systems-weather';
import { describe, expect, it } from 'vitest';
import { content, map, settlements, day, world, ai } from '../test/fixtures';

// Balance: where pirates of each size go hunting, over two months (pnpm verify:balance).
describe('pirate haunts', () => {
  it('pirates haunt waters that fit their ships: brigantines mark more dangerous waters than sloops', () => {
    const sim = world(3);
    const classOf = new Map<string, string>();
    for (let d = 0; d < 60; d++) {
      for (const s of ai(sim.state)) classOf.set(s.id, s.classId);
      sim.step(day);
    }
    const tierOf = (id: string) => {
      const p = settlements.find((s) => s.id === id)!;
      return content.traffic.danger.zones[zoneAt(content, map, p.x, p.y).id] ?? 2;
    };
    const marks = (classes: string[]) =>
      sim
        .events()
        .filter((e) => e.type === 'ShipDeparted' && e.payload.role === 'pirate' && classes.includes(classOf.get(e.entityIds[0]!) ?? ''))
        .map((e) => tierOf(e.entityIds[2]!))
        .filter((t, i, all) => all.length > 0 && t > 0);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const small = marks(['ship.sloop']);
    const big = marks(['ship.brigantine', 'ship.brig']);
    expect(small.length).toBeGreaterThan(5);
    expect(big.length).toBeGreaterThan(1);
    expect(mean(big)).toBeGreaterThan(mean(small));
  }, 120_000);
});
