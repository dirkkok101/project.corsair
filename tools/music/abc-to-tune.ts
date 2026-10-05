// Converts an ABC transcription into a tune entry for packages/data/content/music.json.
//
//   node tools/music/abc-to-tune.ts <file.abc> --id x --title "X" --mood lively --bpm 120 \
//     --source "..." [--key Em] [--transpose N] [--meter 4/4] [--beat 1/4] [--repeats expand|first] \
//     [--chord-split 2] [--append packages/data/content/music.json]
//
// Handles the ABC subset found in the sea-song sources: K: (major, minor and modes), L:, M:,
// notes with octave marks, accidentals that carry through the bar, lengths (2, 3/2, /2, /, >, <),
// rests, ties, triplets, slurs and decorations (ignored), simple |: :| repeats with [1 [2 endings,
// and "chord" symbols. Without chord symbols, one triad per bar (or per --chord-split part) is
// derived from the melody. The melody is re-barred from the metre, so a pickup becomes the first
// bar (padded with a leading rest) and a short final bar is padded with a trailing rest.
import { readFileSync, writeFileSync } from 'node:fs';

type Frac = [number, number];
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const frac = (n: number, d = 1): Frac => {
  const g = gcd(n, d) || 1;
  return d < 0 ? [-n / g, -d / g] : [n / g, d / g];
};
const add = (a: Frac, b: Frac) => frac(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const sub = (a: Frac, b: Frac) => frac(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const mul = (a: Frac, b: Frac) => frac(a[0] * b[0], a[1] * b[1]);
const div = (a: Frac, b: Frac) => frac(a[0] * b[1], a[1] * b[0]);
const cmp = (a: Frac, b: Frac) => a[0] * b[1] - b[0] * a[1];
const num = (a: Frac) => a[0] / a[1];
const parseFrac = (s: string): Frac => {
  const [n, d] = s.split('/');
  return frac(Number(n), Number(d ?? 1));
};

const args = process.argv.slice(2);
const file = args[0];
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : fallback;
};
if (!file) throw new Error('usage: abc-to-tune.ts <file.abc> --id --title --mood --bpm --source');

const text = readFileSync(file, 'utf8');
const header: Record<string, string> = {};
const body: string[] = [];
for (const raw of text.split('\n')) {
  const line = raw.replace(/%.*$/, '').trimEnd();
  const h = /^([A-Za-z]):\s*(.*)$/.exec(line);
  if (h) {
    // Only the first K: ends the header; lyrics (w:, W:) and other fields are skipped.
    if (!(h[1]! in header)) header[h[1]!] = h[2]!.trim();
    continue;
  }
  if (header.K !== undefined && line.trim()) body.push(line);
}

const meterText = header.M === 'C' ? '4/4' : header.M === 'C|' ? '2/2' : (header.M ?? '4/4');
const meter = parseFrac(opt('meter', meterText)!);
const unit = parseFrac(header.L ?? (num(meter) < 0.75 ? '1/16' : '1/8'));
// The beat is the metre's own note value for compound time (6/8 -> six eighth-note beats).
const beat = parseFrac(opt('beat', opt('meter', meterText)!.endsWith('/8') ? '1/8' : '1/4')!);
const barBeats = div(meter, beat);
if (barBeats[1] !== 1) throw new Error(`a bar of ${meterText} is not a whole number of ${beat.join('/')} beats`);
const beatsPerBar = barBeats[0];

// Key signature: the tonic's place on the circle of fifths, shifted by the mode.
const FIFTHS: Record<string, number> = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const MODE: Record<string, number> = { '': 0, maj: 0, ion: 0, mix: -1, dor: -2, m: -3, min: -3, aeo: -3, phr: -4, loc: -5, lyd: 1 };
// --key overrides K: when the transcription writes a minor-mode tune under its relative major.
const km = /^([A-G])([#b]?)\s*([A-Za-z]*)/.exec(opt('key', header.K ?? 'C')!);
if (!km) throw new Error(`bad key ${header.K}`);
const modeName = km[3]!.toLowerCase().slice(0, 3) === 'm' ? 'm' : km[3]!.toLowerCase().slice(0, 3);
if (!(modeName in MODE)) throw new Error(`unsupported mode ${km[3]}`);
const keyFifths = FIFTHS[km[1]! + km[2]!]! + MODE[modeName]!;
const keySig: Record<string, number> = {};
'FCGDAEB'.slice(0, Math.max(0, keyFifths)).split('').forEach((l) => (keySig[l] = 1));
'BEADGCF'.slice(0, Math.max(0, -keyFifths)).split('').forEach((l) => (keySig[l] = -1));
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const tonicPc = (PC[km[1]!]! + (km[2] === '#' ? 1 : km[2] === 'b' ? -1 : 0) + 12) % 12;
const MODE_STEPS: Record<string, number[]> = {
  '': [0, 2, 4, 5, 7, 9, 11], maj: [0, 2, 4, 5, 7, 9, 11], ion: [0, 2, 4, 5, 7, 9, 11],
  mix: [0, 2, 4, 5, 7, 9, 10], dor: [0, 2, 3, 5, 7, 9, 10], m: [0, 2, 3, 5, 7, 8, 10],
  min: [0, 2, 3, 5, 7, 8, 10], aeo: [0, 2, 3, 5, 7, 8, 10], phr: [0, 1, 3, 5, 7, 8, 10],
  loc: [0, 1, 3, 5, 6, 8, 10], lyd: [0, 2, 4, 6, 7, 9, 11],
};

interface Note { midi: number | null; len: Frac; tie: boolean; spelled: string }
interface Bar { items: Note[]; chords: { at: Frac; symbol: string }[]; repeatStart: boolean; repeatEnd: boolean; ending: number }

// Tokenise the body into bars.
const music = body.join(' ').replace(/\\/g, ' ').replace(/!([^!\s]+)!/g, ' ').replace(/!/g, ' ').replace(/\{[^}]*\}/g, '');
const bars: Bar[] = [];
let bar: Bar = { items: [], chords: [], repeatStart: false, repeatEnd: false, ending: 0 };
let barLen: Frac = [0, 1];
let accidentals: Record<string, number> = {};
let tuplet = { left: 0, ratio: frac(1) };
let pendingBroken: Frac | null = null;
const closeBar = (next: Partial<Bar>) => {
  if (bar.items.length) bars.push(bar);
  else if (bars.length && bar.repeatEnd) bars[bars.length - 1]!.repeatEnd = true;
  bar = { items: [], chords: [], repeatStart: false, repeatEnd: false, ending: 0, ...next };
  barLen = [0, 1];
  accidentals = {};
};
const re = /("[^"]*")|(:*\|[\]|:]*\d?|\[\|:?|\[\d|::)|\((\d)|([\^_=]{0,2})([A-Ga-gzx])([',]*)(\d*\/*\d*)|(>+|<+)|(-)|([()\s.~HLMOPSTuvR])/g;
let m: RegExpExecArray | null;
let pos = 0;
while ((m = re.exec(music))) {
  if (m.index !== pos) throw new Error(`unparsed ABC near "${music.slice(pos, pos + 20)}"`);
  pos = re.lastIndex;
  if (m[1]) {
    const sym = m[1].slice(1, -1).replace(/[()]/g, '');
    if (/^[\^_<>@]/.test(sym)) continue; // annotation, not a chord
    const c = /^([A-G][#b]?)(m(?!aj))?/.exec(sym);
    if (c) bar.chords.push({ at: barLen, symbol: c[1]! + (c[2] ? 'm' : '') });
  } else if (m[2]) {
    const t = m[2];
    if (t === '[1' || t === '[2') {
      bar.ending = Number(t[1]);
      continue;
    }
    const end = t.startsWith(':');
    const start = t.endsWith(':') || t === '::';
    const ending = /\d$/.test(t) ? Number(t.slice(-1)) : 0;
    if (end || t === '::') bar.repeatEnd = true;
    closeBar({ repeatStart: start, ending });
  } else if (m[3]) {
    const n = Number(m[3]);
    tuplet = { left: n, ratio: frac(n === 3 ? 2 : n === 2 ? 3 : n - 1, n) };
  } else if (m[5]) {
    const letter = m[5];
    let len = mul(unit, (() => {
      const s = m[7]!;
      if (!s) return frac(1);
      const mm = /^(\d*)(\/*)(\d*)$/.exec(s)!;
      const n = mm[1] ? Number(mm[1]) : 1;
      const d = mm[3] ? Number(mm[3]) : 2 ** mm[2]!.length;
      return frac(n, d);
    })());
    if (tuplet.left > 0) {
      len = mul(len, tuplet.ratio);
      tuplet.left--;
    }
    if (pendingBroken) {
      len = mul(len, pendingBroken);
      pendingBroken = null;
    }
    let midi: number | null = null;
    let spelled = '';
    if (letter !== 'z' && letter !== 'x') {
      const upper = letter.toUpperCase();
      let octave = letter === upper ? 4 : 5;
      for (const ch of m[6]!) octave += ch === "'" ? 1 : -1;
      const accKey = upper + octave;
      if (m[4]) accidentals[accKey] = m[4] === '=' ? 0 : m[4].length * (m[4][0] === '^' ? 1 : -1);
      const acc = accidentals[accKey] ?? keySig[upper] ?? 0;
      midi = 12 * (octave + 1) + PC[upper]! + acc;
      spelled = upper + (acc === 1 ? '#' : acc === -1 ? 'b' : '');
    }
    bar.items.push({ midi, len, tie: false, spelled });
    barLen = add(barLen, len);
  } else if (m[8]) {
    // Broken rhythm: > dots the previous note and halves the next; < the reverse.
    const prev = bar.items[bar.items.length - 1];
    if (!prev) throw new Error('broken rhythm with no previous note');
    const k = m[8].length;
    const short = frac(1, 2 ** k);
    const long = sub(frac(2), short);
    const [p, n] = m[8][0] === '>' ? [long, short] : [short, long];
    barLen = sub(barLen, prev.len);
    prev.len = mul(prev.len, p);
    barLen = add(barLen, prev.len);
    pendingBroken = n;
  } else if (m[9]) {
    const prev = bar.items[bar.items.length - 1] ?? bars[bars.length - 1]?.items.at(-1);
    if (prev) prev.tie = true;
  }
}
if (pos !== music.length) throw new Error(`unparsed ABC near "${music.slice(pos, pos + 20)}"`);
closeBar({});

// Expand repeats (or take the first time through).
const repeats = opt('repeats', 'expand');
const played: Bar[] = [];
let sectionStart = 0;
for (let i = 0; i < bars.length; i++) {
  const b = bars[i]!;
  if (b.repeatStart) sectionStart = i;
  if (b.ending === 2 && repeats === 'expand') continue; // played on the second time round, below
  if (!(b.ending === 2 && repeats === 'first')) played.push(b);
  if (b.repeatEnd && repeats === 'expand') {
    for (let j = sectionStart; j <= i; j++) if (bars[j]!.ending !== 1) played.push(bars[j]!);
    // Second-time endings follow the repeat sign until the next section.
    let k = i + 1;
    while (k < bars.length && bars[k]!.ending === 2) played.push(bars[k++]!);
    i = k - 1;
    sectionStart = i + 1;
  } else if (b.repeatEnd) sectionStart = i + 1;
}

// Flatten to a timeline, merging ties, then re-bar from the metre.
interface Event { midi: number | null; at: Frac; len: Frac; spelled: string }
const events: Event[] = [];
const chordMarks: { at: Frac; symbol: string }[] = [];
let t: Frac = [0, 1];
let tied = false;
for (const b of played) {
  for (const c of b.chords) chordMarks.push({ at: add(t, c.at), symbol: c.symbol });
  for (const n of b.items) {
    const last = events[events.length - 1];
    if (tied && last && last.midi === n.midi) last.len = add(last.len, n.len);
    else events.push({ midi: n.midi, at: t, len: n.len, spelled: n.spelled });
    tied = n.tie;
    t = add(t, n.len);
  }
}
const total = t;
const barFrac = meter;
const firstLen = played[0]!.items.reduce<Frac>((s, n) => add(s, n.len), [0, 1]);
const pickup = cmp(firstLen, barFrac) < 0 ? firstLen : frac(0);
const offset = cmp(pickup, frac(0)) > 0 ? sub(barFrac, pickup) : frac(0); // leading rest
const nBars = Math.ceil(num(div(add(total, offset), barFrac)) - 1e-9);
const out: { midi: number | null; beats: Frac; spelled: string }[][] = Array.from({ length: nBars }, () => []);
const warnings: string[] = [];
if (cmp(offset, frac(0)) > 0) out[0]!.push({ midi: null, beats: div(offset, beat), spelled: '' });
for (const e of events) {
  let start = add(e.at, offset);
  let left = e.len;
  while (cmp(left, frac(0)) > 0) {
    const barIdx = Math.floor(num(div(start, barFrac)) + 1e-9);
    const barEnd = mul(frac(barIdx + 1), barFrac);
    const piece = cmp(sub(barEnd, start), left) < 0 ? sub(barEnd, start) : left;
    if (piece !== left) warnings.push(`note split across bar ${barIdx + 1}`);
    out[barIdx]!.push({ midi: e.midi, beats: div(piece, beat), spelled: e.spelled });
    start = add(start, piece);
    left = sub(left, piece);
  }
}
const tail = sub(mul(frac(nBars), barFrac), add(total, offset));
if (cmp(tail, frac(0)) > 0) out[nBars - 1]!.push({ midi: null, beats: div(tail, beat), spelled: '' });

// Transpose: explicit, or by octaves until the melody sits inside the band's range. The flute
// doubles the melody an octave up, so the lowest note must stay at 55 or above.
const pitches = events.filter((e) => e.midi !== null).map((e) => e.midi!);
let transpose = Number(opt('transpose', 'NaN'));
if (!Number.isFinite(transpose)) {
  transpose = 0;
  while (Math.min(...pitches) + transpose < 55) transpose += 12;
  while (Math.max(...pitches) + transpose > 83) transpose -= 12;
}
const lo = Math.min(...pitches) + transpose;
const hi = Math.max(...pitches) + transpose;
if (lo < 55 || hi > 83) warnings.push(`melody range ${lo}-${hi} is outside 55-83`);

const newTonic = (tonicPc + transpose + 120) % 12;
const newFifths = (((keyFifths + 7 * transpose) % 12) + 12 + 5) % 12 - 5; // -5..6
const useFlats = newFifths < 0;
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const pcName = (pc: number) => (useFlats ? FLAT : SHARP)[((pc % 12) + 12) % 12]!;
// Keep the source's spelling (F# stays F#, not Gb) unless the tune moves to another key; the
// octave comes from the letter, so B#/Cb-style spellings would need care (none in the sources).
const noteName = (midi: number, spelled: string) =>
  transpose % 12 === 0 && /^[A-G][#b]?$/.test(spelled)
    ? `${spelled}${Math.floor((midi - (spelled[1] === '#' ? 1 : spelled[1] === 'b' ? -1 : 0)) / 12) - 1}`
    : `${pcName(midi)}${Math.floor(midi / 12) - 1}`;
const fmt = (f: Frac) => String(Number(num(f).toPrecision(15)));

const melody = out.map((b) => b.map((n) => `${n.midi === null ? 'r' : noteName(n.midi + transpose, n.spelled)}/${fmt(n.beats)}`).join(' ')).join(' | ');

// Chords: from the source's symbols when present, else derived from the melody.
const transposeChord = (s: string) => {
  const c = /^([A-G][#b]?)(m?)$/.exec(s)!;
  const pc = (PC[c[1]![0]!]! + (c[1]![1] === '#' ? 1 : c[1]![1] === 'b' ? -1 : 0) + transpose + 120) % 12;
  return pcName(pc) + c[2];
};
let chords: string;
let derived = false;
if (chordMarks.length) {
  const marks = chordMarks.map((c) => ({ at: add(c.at, offset), symbol: transposeChord(c.symbol) }));
  let current = marks[0]!.symbol;
  chords = out
    .map((_, b) => {
      const start = mul(frac(b), barFrac);
      const end = mul(frac(b + 1), barFrac);
      const parts: { at: Frac; symbol: string }[] = [{ at: start, symbol: current }];
      for (const mk of marks) {
        if (cmp(mk.at, start) >= 0 && cmp(mk.at, end) < 0) {
          if (cmp(mk.at, start) === 0) parts[0]!.symbol = mk.symbol;
          else parts.push(mk);
          current = mk.symbol;
        }
      }
      if (parts.length === 1) return parts[0]!.symbol;
      return parts.map((p, i) => `${p.symbol}/${fmt(div(sub(parts[i + 1]?.at ?? end, p.at), beat))}`).join(' ');
    })
    .join(' | ');
} else {
  derived = true;
  // Candidate triads on the scale degrees (major or minor only), plus the major dominant in minor.
  const steps = MODE_STEPS[modeName]!;
  const cands: { root: number; minor: boolean; rank: number }[] = [];
  const order = [0, 4, 3, 5, 1, 2, 6]; // I, V, IV, vi, ii, iii, vii: earlier wins ties
  steps.forEach((s, i) => {
    const third = (steps[(i + 2) % 7]! - s + 12) % 12;
    const fifth = (steps[(i + 4) % 7]! - s + 12) % 12;
    // In minor the major dominant (added below) is the primary V, not the minor v.
    const rank = steps[2] === 3 && i === 4 ? 2.5 : order.indexOf(i);
    if (fifth === 7) cands.push({ root: (tonicPc + s) % 12, minor: third === 3, rank });
  });
  if (steps[2] === 3) cands.push({ root: (tonicPc + 7) % 12, minor: false, rank: 1 });
  const split = Number(opt('chord-split', '1'));
  const partLen = div(barFrac, frac(split));
  // Primary chords (I, IV, V) are preferred over ii, iii and vi, and a chord is kept from the
  // previous part when it fits about as well, so the harmony doesn't churn.
  let previous = '';
  const pick = (from: Frac, to: Frac, first: boolean, last: boolean) => {
    let best = cands[0]!;
    let bestScore = -Infinity;
    const span = num(sub(to, from));
    for (const c of cands) {
      const tones = [c.root, (c.root + (c.minor ? 3 : 4)) % 12, (c.root + 7) % 12];
      const name = pcName(c.root + transpose) + (c.minor ? 'm' : '');
      let score = -c.rank * 0.01 - (c.rank > 2 ? 0.15 * span : 0) + (name === previous ? 0.1 * span : 0);
      for (const e of events) {
        if (e.midi === null) continue;
        const s = add(e.at, offset);
        const eEnd = add(s, e.len);
        const ov = num(sub(cmp(eEnd, to) < 0 ? eEnd : to, cmp(s, from) > 0 ? s : from));
        if (ov <= 0) continue;
        const pc = (e.midi % 12 + 12) % 12;
        const onBeat = cmp(s, from) === 0 ? 1.5 : 1;
        // The dominant's seventh is heard as part of V7, so it doesn't count against V.
        const seventh = c.rank === 1 && !c.minor && pc === (c.root + 10) % 12;
        if (tones.includes(pc)) score += ov * onBeat * (pc === c.root ? 1.2 : 1);
        else if (seventh) score += ov * 0.6;
        else score -= ov * 0.5;
      }
      if ((first || last) && c.rank === 0) score += 0.2;
      if (score > bestScore) [best, bestScore] = [c, score];
    }
    previous = pcName(best.root + transpose) + (best.minor ? 'm' : '');
    return previous;
  };
  chords = out
    .map((_, b) => {
      const parts = Array.from({ length: split }, (_, p) => {
        const from = add(mul(frac(b), barFrac), mul(frac(p), partLen));
        return pick(from, add(from, partLen), b === 0, b === nBars - 1);
      });
      if (parts.every((p) => p === parts[0])) return parts[0]!;
      return parts.map((p) => `${p}/${fmt(div(partLen, beat))}`).join(' ');
    })
    .join(' | ');
}

const entry = {
  id: opt('id', 'tune')!,
  title: opt('title', header.T ?? 'Tune')!,
  source: opt('source', 'Traditional, public domain')!,
  mood: opt('mood', 'lively')!,
  bpm: Number(opt('bpm', '120')),
  beatsPerBar,
  melody,
  chords,
};
console.error(`${entry.id}: ${nBars} bars, range ${lo}-${hi}, transpose ${transpose}, key ${pcName(newTonic)}${modeName === '' ? '' : ' ' + modeName}, chords ${derived ? 'derived' : 'from source'}, repeats ${repeats}`);
for (const w of new Set(warnings)) console.error(`  warning: ${w}`);

const target = opt('append');
if (target) {
  const data = JSON.parse(readFileSync(target, 'utf8'));
  data.tunes = data.tunes.filter((x: { id: string }) => x.id !== entry.id).concat(entry);
  writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
} else console.log(JSON.stringify(entry, null, 2));
