import { playClip } from './samples';
import type { SampleLibrary } from './samples';

// One-off recorded sounds, each a cue: gulls mean land is near, creaks rise with the wind, canvas
// and rope mark a change of sail, bells and voices mean a town. Timers are real seconds.

export interface SfxInputs {
  /** 1 on the coast, 0 beyond the coastal band. */
  coast: number;
  /** 1 next to a town, 0 beyond earshot. */
  harbour: number;
  /** Wind strength 0-1. */
  wind: number;
  hour: number;
  sails: string;
  /** Sails just filled after being in irons. */
  filled: boolean;
}

const pick = <T>(list: T[] | undefined) => (list?.length ? list[Math.floor(Math.random() * list.length)] : undefined);
const between = (a: number, b: number) => a + Math.random() * (b - a);

export function createSfx(ctx: AudioContext, out: AudioNode) {
  let library: SampleLibrary | undefined;
  let lastSails: string | undefined;
  const next = { gull: 0, creak: 0, bell: 0, crowd: 0 };
  const clip = (id: string) => pick(library?.sfx.get(id));

  return {
    setLibrary(lib: SampleLibrary) {
      library = lib;
    },
    /** A recorded thunder clip; false if none is loaded (the synthesised roll covers it). */
    thunder(delayS: number): boolean {
      const b = clip('thunder');
      if (!b) return false;
      playClip(ctx, out, b, { when: ctx.currentTime + delayS, gain: 0.8, pan: between(-0.4, 0.4), lowpass: 2500 });
      return true;
    },
    update(i: SfxInputs) {
      if (!library) return;
      const now = ctx.currentTime;
      const day = i.hour >= 6 && i.hour < 19;

      // Gulls by day near land, more often the closer the coast; panned so they feel placed.
      if (day && i.coast > 0.2 && now >= next.gull) {
        const b = clip('gull');
        if (b) playClip(ctx, out, b, { gain: 0.25 + 0.35 * i.coast, pan: between(-0.8, 0.8), rate: between(0.92, 1.08) });
        next.gull = now + between(3, 9) / Math.max(0.3, i.coast);
      }

      // The hull works more as the wind rises. Slowed down, the clips sound like a heavier ship.
      if (now >= next.creak) {
        const b = clip('creak');
        if (b && next.creak > 0) playClip(ctx, out, b, { gain: 0.12 + 0.25 * i.wind, pan: between(-0.3, 0.3), rate: between(0.6, 0.85), lowpass: 1800 });
        next.creak = now + between(6, 14) * (1.3 - i.wind * 0.6);
      }

      // Setting or furling sail: canvas and a block running.
      if (lastSails !== undefined && i.sails !== lastSails) {
        const canvas = clip('canvas');
        const rope = clip('rope');
        if (canvas) playClip(ctx, out, canvas, { gain: 0.5, pan: between(-0.2, 0.2) });
        if (rope) playClip(ctx, out, rope, { when: now + 0.15, gain: 0.35, rate: between(0.9, 1.1) });
      }
      lastSails = i.sails;

      // Sails filling after a tack or a luff: a canvas snap over the synthesised thump.
      if (i.filled) {
        const canvas = clip('canvas');
        if (canvas) playClip(ctx, out, canvas, { gain: 0.45, rate: 0.85 });
      }

      // Towns: harbour voices by day, a church bell now and then.
      if (i.harbour > 0.15) {
        if (day && now >= next.crowd) {
          const b = clip('harbour_crowd');
          if (b) playClip(ctx, out, b, { gain: 0.35 * i.harbour, lowpass: 1400 + 2000 * i.harbour, pan: between(-0.5, 0.5) });
          next.crowd = now + (b ? b.duration - 1 : 8);
        }
        if (now >= next.bell) {
          const b = clip('harbour_bell');
          if (b && next.bell > 0) playClip(ctx, out, b, { gain: 0.3 * i.harbour, lowpass: 3000, pan: between(-0.5, 0.5) });
          next.bell = now + between(25, 45);
        }
      }
    },
  };
}
