// Minimal PCM WAV codec and signal helpers for the audio prep scripts. No dependencies.
import { readFileSync, writeFileSync } from 'node:fs';

export type Mono = { rate: number; data: Float32Array };

// Reads integer PCM (8/16/24/32-bit) or 32-bit float WAV, including WAVE_FORMAT_EXTENSIBLE,
// and mixes all channels to mono.
export function readWav(path: string): Mono {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path}: not a RIFF/WAVE file`);
  }
  let fmt: { format: number; channels: number; rate: number; bits: number } | undefined;
  let data: Buffer | undefined;
  for (let p = 12; p + 8 <= buf.length; ) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const body = buf.subarray(p + 8, Math.min(buf.length, p + 8 + size));
    if (id === 'fmt ') {
      let format = body.readUInt16LE(0);
      if (format === 0xfffe) format = body.readUInt16LE(24); // extensible: first 2 bytes of the GUID
      fmt = { format, channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    } else if (id === 'data') {
      data = body;
    }
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${path}: missing fmt or data chunk`);
  const { format, channels, rate, bits } = fmt;
  if (!(format === 1 || (format === 3 && bits === 32))) throw new Error(`${path}: unsupported format ${format}/${bits}`);
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const o = (i * channels + c) * bytes;
      if (format === 3) sum += data.readFloatLE(o);
      else if (bits === 8) sum += (data[o]! - 128) / 128;
      else if (bits === 16) sum += data.readInt16LE(o) / 32768;
      else if (bits === 24) sum += data.readIntLE(o, 3) / 8388608;
      else sum += data.readInt32LE(o) / 2147483648;
    }
    out[i] = sum / channels;
  }
  return { rate, data: out };
}

export function writeWav16(path: string, { rate, data }: Mono): void {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + data.length * 2, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i]!)) * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

// Linear interpolation; adequate here because sources are 44.1-96 kHz and targets keep the
// audible band (no anti-alias filter beyond a 2-tap average when downsampling hard).
export function resample({ rate, data }: Mono, to: number): Mono {
  if (rate === to) return { rate, data };
  let src = data;
  if (rate >= to * 1.8) {
    src = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) src[i] = (data[i]! + (data[i + 1] ?? data[i]!)) / 2;
  }
  const n = Math.floor((data.length * to) / rate);
  const out = new Float32Array(n);
  const step = rate / to;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = src[j]! * (1 - f) + (src[j + 1] ?? src[j]!) * f;
  }
  return { rate: to, data: out };
}

export function peak(data: Float32Array): number {
  let p = 0;
  for (const v of data) p = Math.max(p, Math.abs(v));
  return p;
}

// Index of the first sample louder than `db` below the clip's peak.
export function firstAbove(data: Float32Array, db: number): number {
  const t = peak(data) * 10 ** (db / 20);
  const i = data.findIndex((v) => Math.abs(v) >= t);
  return Math.max(0, i);
}

// RMS envelope in `win`-second windows, as dBFS, for choosing segments of long recordings.
export function envelope({ rate, data }: Mono, win: number): number[] {
  const n = Math.max(1, Math.round(win * rate));
  const out: number[] = [];
  for (let s = 0; s < data.length; s += n) {
    let e = 0;
    const end = Math.min(data.length, s + n);
    for (let i = s; i < end; i++) e += data[i]! * data[i]!;
    out.push(10 * Math.log10(e / (end - s) + 1e-12));
  }
  return out;
}

// Fundamental by normalised autocorrelation; takes the shortest lag whose correlation is within
// 90% of the best, which avoids the usual octave-down error.
export function detectPitch({ rate, data }: Mono, from: number, len: number): { hz: number; clarity: number } {
  const s = Math.floor(from * rate);
  const x = data.subarray(s, Math.min(data.length, s + Math.floor(len * rate)));
  const minLag = Math.floor(rate / 2000);
  const maxLag = Math.min(Math.floor(rate / 30), Math.floor(x.length / 2));
  const r: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0, e1 = 0, e2 = 0;
    for (let i = 0; i + lag < x.length; i++) {
      num += x[i]! * x[i + lag]!;
      e1 += x[i]! * x[i]!;
      e2 += x[i + lag]! * x[i + lag]!;
    }
    r.push(num / Math.sqrt(e1 * e2 + 1e-12));
  }
  const best = Math.max(...r);
  let k = 1;
  while (k < r.length - 1 && !(r[k]! >= 0.9 * best && r[k]! >= r[k - 1]! && r[k]! >= r[k + 1]!)) k++;
  // Parabolic interpolation around the chosen peak.
  const a = r[k - 1]!, b = r[k]!, c = r[k + 1] ?? b;
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return { hz: rate / (minLag + k + shift), clarity: b };
}

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
