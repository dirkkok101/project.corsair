import { arrange, musicPlan } from './music';
import type { MusicInputs, NoteEvent, Part, TuneData } from './music';
import type { SampleLibrary } from './samples';

const LOOKAHEAD_S = 0.3; // schedule notes this far ahead of the audio clock
const GAP_S: [number, number] = [25, 50]; // silence between tunes, so music stays a treat
const PLUCKED = new Set(['bass', 'harp', 'frame_drum', 'bass_drum', 'tambourine']);
const PARTS: Part[] = ['melody', 'whistle', 'bass', 'harp', 'drums'];

/**
 * The ship's band: picks a tune for the mood, sequences it over the instrument samples, and fades
 * each part in or out as the sailing changes. Silent gaps between tunes keep it from wearing thin.
 */
export function createBand(ctx: AudioContext, out: AudioNode, tunes: TuneData[]) {
  const bus = ctx.createGain();
  bus.connect(out);
  const parts = Object.fromEntries(
    PARTS.map((p) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(bus);
      return [p, g];
    }),
  ) as Record<Part, GainNode>;
  const arranged = new Map<string, { events: NoteEvent[]; beats: number }>();
  let library: SampleLibrary | undefined;
  let playing: { tune: TuneData; events: NoteEvent[]; beats: number; start: number; next: number } | undefined;
  let lastTune: string | undefined;
  // A short first gap so a new game opens with the sea before the band.
  let gapUntil = ctx.currentTime + 6;

  const play = (e: NoteEvent, when: number, secondsPerBeat: number) => {
    const notes = library?.instruments.get(e.instrument);
    if (!notes?.length) return;
    // The nearest recorded note, pitch-shifted the rest of the way.
    const sample = notes.reduce((best, n) => (Math.abs(n.midi - e.midi) < Math.abs(best.midi - e.midi) ? n : best));
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = 2 ** ((e.midi - sample.midi) / 12);
    const g = ctx.createGain();
    const length = e.beats * secondsPerBeat;
    // A touch of human timing, so the band doesn't sound quantised.
    const t = when + (Math.random() - 0.5) * 0.02;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(e.velocity, t + 0.008);
    src.connect(g).connect(parts[e.part]);
    // start() must come before stop(): a source stopped before it starts throws.
    src.start(t);
    if (PLUCKED.has(e.instrument)) {
      // Plucked and struck notes ring out naturally.
      g.gain.setTargetAtTime(0.0001, t + Math.max(length, 0.25), 0.25);
      src.stop(t + Math.max(length, 0.25) + 1.2);
    } else {
      // Bowed and blown notes stop when the note ends.
      g.gain.setValueAtTime(e.velocity * 0.9, t + Math.max(0.01, length - 0.06));
      g.gain.exponentialRampToValueAtTime(0.0001, t + length + 0.08);
      src.stop(t + length + 0.12);
    }
  };

  return {
    setLibrary(lib: SampleLibrary) {
      library = lib;
    },
    /** Music on or off (separate from the master mute). */
    setVolume(volume: number) {
      bus.gain.setTargetAtTime(volume, ctx.currentTime, 0.1);
    },
    get nowPlaying() {
      return playing?.tune.title;
    },
    update(inputs: MusicInputs) {
      const plan = musicPlan(inputs);
      for (const p of PARTS) parts[p].gain.setTargetAtTime(plan.parts[p], ctx.currentTime, 0.8);
      const now = ctx.currentTime;

      if (!playing && library && plan.mood !== 'none' && now >= gapUntil) {
        const options = tunes.filter((t) => t.mood === plan.mood);
        const pick = options.find((t) => t.id !== lastTune) ?? options[0];
        if (pick) {
          if (!arranged.has(pick.id)) arranged.set(pick.id, arrange(pick));
          const { events, beats } = arranged.get(pick.id)!;
          playing = { tune: pick, events, beats, start: now + 0.1, next: 0 };
          lastTune = pick.id;
        }
      }
      if (!playing) return;

      const spb = 60 / playing.tune.bpm;
      while (playing.next < playing.events.length) {
        const e = playing.events[playing.next]!;
        const when = playing.start + e.beat * spb;
        if (when > now + LOOKAHEAD_S) break;
        if (when >= now - 0.05) play(e, when, spb);
        playing.next++;
      }
      if (now > playing.start + playing.beats * spb + 1.5) {
        playing = undefined;
        gapUntil = now + GAP_S[0] + Math.random() * (GAP_S[1] - GAP_S[0]);
      }
    },
  };
}
