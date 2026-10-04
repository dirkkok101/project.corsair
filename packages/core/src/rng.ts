// xoshiro128** on uint32 words (PRD section 14: named, seeded RNG streams). The state is four plain
// numbers stored in WorldState, so it saves, hashes and replays with everything else. Math.imul and
// >>> 0 keep every step in exact 32-bit integer arithmetic, identical across JS engines.

export type RngState = [number, number, number, number];

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** Seeds a named stream: the same seed and name always give the same sequence. */
export function seedRng(seed: number, stream: string): RngState {
  let h = seed >>> 0;
  for (let i = 0; i < stream.length; i++) h = Math.imul(h ^ stream.charCodeAt(i), 0x9e3779b1) >>> 0;
  // splitmix32 spreads the seed over the four state words.
  const next = () => {
    h = (h + 0x9e3779b9) >>> 0;
    let z = h;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  return [next(), next(), next(), next() || 1];
}

/** A working copy of a stream. Draw from it, then store `state()` back into WorldState. */
export function rngStream(start: RngState) {
  const s = [...start] as RngState;
  const nextU32 = () => {
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl(s[3], 11);
    return result;
  };
  const float = () => nextU32() / 4294967296;
  return {
    /** Uniform in [0, 1). */
    float,
    /** Uniform in [min, max). */
    range: (min: number, max: number) => min + (max - min) * float(),
    /** A key drawn by weight; weights need not sum to 1. */
    weighted<K extends string>(weights: Partial<Record<K, number>>): K {
      const entries = Object.entries(weights) as [K, number][];
      let roll = float() * entries.reduce((sum, [, w]) => sum + w, 0);
      for (const [key, w] of entries) {
        roll -= w;
        if (roll < 0) return key;
      }
      return entries[entries.length - 1]![0];
    },
    state: () => [...s] as RngState,
  };
}
