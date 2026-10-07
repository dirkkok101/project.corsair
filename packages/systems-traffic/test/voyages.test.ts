import { describe, expect, it } from 'vitest';
import { voyageProbe } from './probe';

// The voyage probe's targets (PRD section 6, traffic): the lanes between Jamaica and Hispaniola are
// dangerous in the starting brig, a brig with her full battery and berths filled is let be, the Leewards
// are quiet, and the piracy moves prices without drying up the trade.
describe('voyages', () => {
  it('Port Royal to Tortuga: about one pirate every two or three voyages in the starting brig, a few fully armed', () => {
    const run = (outfit = {}) => {
      let voyages = 0;
      let attacks = 0;
      for (const seed of [1, 2, 3]) {
        const m = voyageProbe(['town.port_royal', 'town.tortuga'], { days: 40, seed, outfit });
        voyages += m.voyages;
        attacks += m.attacks;
      }
      return attacks / voyages;
    };
    const start = run();
    const armed = run({ guns: 18, crew: 150 });
    console.log('VOYAGES attacks per voyage, Port Royal-Tortuga: starting brig', start.toFixed(2), 'fully armed', armed.toFixed(2));
    expect(start).toBeGreaterThan(0.2);
    expect(start).toBeLessThan(0.7);
    // Fully armed she is let be most of the time, but a pirate with nerve, or in a bigger ship, still comes.
    expect(armed).toBeLessThan(start / 2);
    expect(armed).toBeGreaterThan(0);
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
