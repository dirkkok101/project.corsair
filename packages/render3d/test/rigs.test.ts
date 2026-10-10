import { loadContent } from '@corsair/data';
import { describe, expect, it } from 'vitest';
import { RIGS } from '../src/rigs';

const content = loadContent();

describe('rig plans', () => {
  it('every ship class has a 3D plan, with her masts and her length as her battle size has them', () => {
    for (const cls of Object.values(content.ships)) {
      const plan = RIGS[cls.id];
      expect(plan, cls.id).toBeDefined();
      expect(plan!.masts.length, cls.id).toBe(cls.masts.length);
      // Drawn at the sprites' scale: her battle length is about 1.08 of the model's.
      expect(cls.size.length / plan!.hull.length, cls.id).toBeGreaterThan(0.95);
      expect(cls.size.length / plan!.hull.length, cls.id).toBeLessThan(1.2);
    }
  });
});
