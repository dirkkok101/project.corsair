// Music is played live from note data, not from recordings: each tune is a melody and a chord per
// bar, arranged here into band parts, then sequenced over single-note samples. That keeps the files
// tiny and lets the band thin out or fill in with the sailing (adaptive layers).

export type Part = 'melody' | 'whistle' | 'bass' | 'harp' | 'drums';

export interface NoteEvent {
  part: Part;
  /** Instrument id from instruments.json. */
  instrument: string;
  /** Start, in beats from the top of the tune. */
  beat: number;
  /** Length in beats. */
  beats: number;
  midi: number;
  velocity: number;
}

export interface TuneData {
  id: string;
  title: string;
  mood: 'lively' | 'gentle' | 'night';
  bpm: number;
  beatsPerBar: number;
  melody: string;
  chords: string;
}

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "A4" -> 69, "G#4" -> 68, "Bb3" -> 58. */
export function noteToMidi(note: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(note);
  if (!m) throw new Error(`bad note ${note}`);
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]!]! + accidental;
}

/** Bars of [note-or-rest, beats] tokens. Throws if a full bar doesn't add up (the first may be a pickup). */
export function parseBars(line: string, beatsPerBar: number, id = 'tune'): { note: string; beats: number }[][] {
  const bars = line.split('|').map((bar) =>
    bar
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => {
        const [note, beats] = token.split('/');
        const n = Number(beats);
        if (!note || !Number.isFinite(n) || n <= 0) throw new Error(`${id}: bad token ${token}`);
        return { note, beats: n };
      }),
  );
  bars.forEach((bar, i) => {
    const total = bar.reduce((sum, t) => sum + t.beats, 0);
    if (Math.abs(total - beatsPerBar) > 1e-9) throw new Error(`${id}: bar ${i + 1} has ${total} beats, not ${beatsPerBar}`);
  });
  return bars;
}

/** Root MIDI note (octave 3) and chord tones for a chord symbol: C, Dm, G#, Bbm. */
export function chordTones(symbol: string): number[] {
  const m = /^([A-G])([#b]?)(m?)$/.exec(symbol);
  if (!m) throw new Error(`bad chord ${symbol}`);
  const root = noteToMidi(`${m[1]}${m[2]}3`);
  return [root, root + (m[3] ? 3 : 4), root + 7];
}

/** Where the bass and drums land in a bar: strong beats for the metre. */
function strongBeats(beatsPerBar: number): number[] {
  if (beatsPerBar === 9) return [0, 3, 6];
  if (beatsPerBar === 6) return [0, 3];
  if (beatsPerBar === 4) return [0, 2];
  return [0];
}

/**
 * Arrange a tune for the band. The tune plays twice: the second time the whistle doubles the
 * melody an octave up, so the crew sounds like it is warming to the song.
 */
export function arrange(tune: TuneData): { events: NoteEvent[]; beats: number } {
  const melody = parseBars(tune.melody, tune.beatsPerBar, tune.id);
  const chordBars = tune.chords.split('|').map((bar) =>
    bar
      .trim()
      .split(/\s+/)
      .map((t) => {
        const [symbol, beats] = t.split('/');
        return { symbol: symbol!, beats: beats ? Number(beats) : tune.beatsPerBar };
      }),
  );
  if (chordBars.length !== melody.length) {
    throw new Error(`${tune.id}: ${melody.length} melody bars but ${chordBars.length} chord bars`);
  }
  const passBeats = melody.length * tune.beatsPerBar;
  const events: NoteEvent[] = [];
  const lively = tune.mood === 'lively';

  for (const pass of [0, 1]) {
    const offset = pass * passBeats;
    melody.forEach((bar, b) => {
      let beat = offset + b * tune.beatsPerBar;
      for (const { note, beats } of bar) {
        if (note !== 'r') {
          const midi = noteToMidi(note);
          // Accent the first note of each bar a little, as a fiddler would.
          const velocity = beat % tune.beatsPerBar === 0 ? 0.9 : 0.75;
          events.push({ part: 'melody', instrument: 'fiddle', beat, beats, midi, velocity });
          if (pass === 1) {
            const up = midi + 12 <= 90 ? midi + 12 : midi;
            events.push({ part: 'whistle', instrument: 'flute', beat, beats, midi: up, velocity: 0.55 });
          }
        }
        beat += beats;
      }
    });

    chordBars.forEach((chords, b) => {
      let beat = offset + b * tune.beatsPerBar;
      for (const { symbol, beats } of chords) {
        const tones = chordTones(symbol);
        // Bass: the root an octave down on the first strong beat, the fifth above it on the next.
        const root = tones[0]! - 12;
        strongBeats(tune.beatsPerBar)
          .filter((s) => s < beats)
          .forEach((s, i) => {
            const midi = i % 2 === 0 ? root : root + 7;
            events.push({ part: 'bass', instrument: 'bass', beat: beat + s, beats: 1, midi, velocity: 0.8 });
          });
        // Harp: a rolling arpeggio, one chord tone per beat (two per beat for lively tunes).
        const step = lively ? 0.5 : 1;
        const shape = [0, 1, 2, 1];
        for (let t = 0, i = 0; t < beats - 1e-9; t += step, i++) {
          const tone = tones[shape[i % shape.length]!]! + 12;
          events.push({ part: 'harp', instrument: 'harp', beat: beat + t, beats: step * 2, midi: tone, velocity: 0.45 });
        }
        beat += beats;
      }
      // Drums only for the lively tunes: frame drum on the strong beats, tambourine between.
      if (lively) {
        const bar = offset + b * tune.beatsPerBar;
        for (let t = 0; t < tune.beatsPerBar; t++) {
          const strong = strongBeats(tune.beatsPerBar).includes(t);
          events.push({ part: 'drums', instrument: strong ? 'frame_drum' : 'tambourine', beat: bar + t, beats: 1, midi: 60, velocity: strong ? 0.8 : 0.45 });
        }
      }
    });
  }
  events.sort((a, b) => a.beat - b.beat);
  return { events, beats: passBeats * 2 };
}

export interface MusicInputs {
  hour: number;
  inStorm: boolean;
  sailsSet: boolean;
  luffing: boolean;
  /** Fraction of top speed. */
  speed: number;
}

export interface MusicPlan {
  /** Which kind of tune should play now, or none. */
  mood: TuneData['mood'] | 'none';
  /** Gain per band part, 0-1. */
  parts: Record<Part, number>;
}

const silent: Record<Part, number> = { melody: 0, whistle: 0, bass: 0, harp: 0, drums: 0 };

/**
 * The band follows the sailing, like a crew that sings when the work is good. Storms belong to the
 * wind and thunder; night is a quiet ballad; a fast ship under full sail gets the full shanty.
 */
export function musicPlan(i: MusicInputs): MusicPlan {
  if (i.inStorm) return { mood: 'none', parts: silent };
  const night = i.hour < 5 || i.hour >= 19;
  if (night) return { mood: 'night', parts: { ...silent, melody: 0.55, harp: 0.8 } };
  if (!i.sailsSet || i.speed < 0.2) return { mood: 'gentle', parts: { ...silent, harp: 0.7 } };
  if (i.speed > 0.7 && !i.luffing) {
    return { mood: 'lively', parts: { melody: 1, whistle: 0.8, bass: 0.9, harp: 0.7, drums: 0.8 } };
  }
  return { mood: 'gentle', parts: { ...silent, melody: 0.8, bass: 0.7, harp: 0.8 } };
}
