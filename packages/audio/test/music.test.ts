import { loadContent } from '@corsair/data';
import { describe, expect, it } from 'vitest';
import { arrange, chordTones, musicPlan, noteToMidi, parseBars } from '../src/music';

const content = loadContent();
const instruments = { fiddle: [53, 83], flute: [67, 90], bass: [34, 58], harp: [53, 78] } as Record<string, [number, number]>;

describe('notes and chords', () => {
  it('converts note names to MIDI', () => {
    expect(['A4', 'C4', 'G#4', 'Bb3', 'D5'].map(noteToMidi)).toEqual([69, 60, 68, 58, 74]);
  });

  it('builds major and minor triads', () => {
    expect(chordTones('C')).toEqual([48, 52, 55]);
    expect(chordTones('Dm')).toEqual([50, 53, 57]);
  });

  it('rejects a bar that does not add up', () => {
    expect(() => parseBars('A4/1 A4/1 | A4/1', 2, 'x')).toThrow(/bar 2 has 1 beats/);
  });
});

describe('the tunes', () => {
  for (const tune of content.music.tunes) {
    it(`${tune.title}: every bar adds up and every note is in its instrument's range`, () => {
      const { events, beats } = arrange(tune);
      expect(beats).toBeGreaterThan(0);
      for (const e of events) {
        const range = instruments[e.instrument];
        if (!range) continue; // unpitched drums
        expect(e.midi, `${e.instrument} ${e.midi}`).toBeGreaterThanOrEqual(range[0]);
        expect(e.midi, `${e.instrument} ${e.midi}`).toBeLessThanOrEqual(range[1]);
      }
    });
  }

  it('has a tune for every mood the band plays', () => {
    const moods = new Set(content.music.tunes.map((t) => t.mood));
    expect([...moods].sort()).toEqual(['gentle', 'lively', 'night']);
  });
});

describe('musicPlan', () => {
  const base = { hour: 12, inStorm: false, sailsSet: true, luffing: false, speed: 0.5 };
  it('plays the full shanty under full sail at speed, a ballad at night, and nothing in a storm', () => {
    expect(musicPlan({ ...base, speed: 0.9 }).mood).toBe('lively');
    expect(musicPlan({ ...base, speed: 0.9 }).parts.drums).toBeGreaterThan(0);
    expect(musicPlan({ ...base, hour: 22 }).mood).toBe('night');
    expect(musicPlan({ ...base, inStorm: true }).mood).toBe('none');
    expect(musicPlan({ ...base, sailsSet: false }).parts.melody).toBe(0);
  });
});
