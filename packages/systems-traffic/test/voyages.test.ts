import { describe, expect, it } from 'vitest';
import { voyageProbe } from './probe';

// The voyage probe's targets (PRD section 6, traffic): the lanes between Jamaica and Hispaniola are
// dangerous in the starting brig, a brig with her full battery and berths filled still meets her own kind, the Leewards
// are quiet, and the piracy moves prices without drying up the trade.
describe('voyages', () => {
  it('Port Royal to Tortuga: about one pirate every two or three voyages in the starting brig, and still about one in three fully armed', () => {
    const run = (outfit = {}, seeds = [1, 2, 3]) => {
      let voyages = 0;
      let attacks = 0;
      for (const seed of seeds) {
        const m = voyageProbe(['town.port_royal', 'town.tortuga'], { days: 40, seed, outfit });
        voyages += m.voyages;
        attacks += m.attacks;
      }
      return attacks / voyages;
    };
    const start = run();
    // Attacks on her are rare (about one in twenty voyages), so she is measured over more seeds.
    const armed = run({ guns: 18, crew: 150 }, [1, 2, 3, 4, 5, 6, 7, 8]);
    console.log('VOYAGES attacks per voyage, Port Royal-Tortuga: starting brig', start.toFixed(2), 'fully armed', armed.toFixed(2));
    expect(start).toBeGreaterThan(0.2);
    expect(start).toBeLessThan(0.7);
    // Fully armed she still meets her own kind (no cliff, docs/design/combat-model.md section 2): pirates chance
    // poorer odds for a rich prize, and the bigger ones haunt these waters.
    expect(armed).toBeLessThan(start);
    expect(armed).toBeGreaterThan(0.15);
    expect(armed).toBeLessThan(0.45);
  }, 300_000);

  it('the Leewards are quiet, and the trade still pays', () => {
    const m = voyageProbe(['town.basse_terre_st_kitts', 'town.charlestown'], { days: 40 });
    expect(m.voyages).toBeGreaterThan(30);
    expect(m.attacks).toBeLessThanOrEqual(1);
    const tortuga = voyageProbe(['town.port_royal', 'town.tortuga'], { days: 40 });
    // Ports live now (stock rises and falls with what is made, eaten and carried), so the margin moves with
    // the world; the trade still pays.
    expect(tortuga.margin.now).toBeGreaterThan(0);
  }, 300_000);
});
