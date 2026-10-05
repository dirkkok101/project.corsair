// What the player should hear, as plain targets the engine glides toward. Pure so it can be
// tested without Web Audio. Every layer is a gameplay cue first and realism second:
//   waves  - how hard it is blowing        rush  - how fast the ship is going
//   wind   - how close to the wind you are luff  - the sails have lost the wind
//   surf   - land is near                  rain  - you are inside a storm

export interface AudioInputs {
  /** Wind strength as the navigation multiplier (calm 0.15 ... gale 1.1). */
  wind: number;
  /** Smallest angle between heading and the wind's FROM direction, 0-180. */
  offWindDeg: number;
  /** Ship speed as a fraction of its class top speed, 0-1+. */
  speed: number;
  sailsSet: boolean;
  /** In irons: sails set but no drive. */
  luffing: boolean;
  inStorm: boolean;
  /** 1 on the coast, falling to 0 at the edge of the coastal band. */
  coast: number;
  /** 1 next to a town, falling to 0 beyond earshot. */
  harbour: number;
  /** Game hour, 0-24. */
  hour: number;
  /** Sail setting id (furled, half, full), to hear sail being set or taken in. */
  sails: string;
}

export interface AmbienceTargets {
  waves: number;
  /** 0-1: drives the swell's low-pass cutoff, so a rough sea sounds brighter. */
  wavesBright: number;
  wind: number;
  /** Centre frequency of the rigging whistle, Hz. */
  windPitch: number;
  rush: number;
  /** Low-pass cutoff of the hull rush, Hz. */
  rushTone: number;
  luff: number;
  surf: number;
  rain: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function ambienceTargets(i: AudioInputs): AmbienceTargets {
  const wind = clamp01(i.wind / 1.1);
  // Rigging sings loudest close-hauled and goes quiet running before the wind, which is how a
  // sailor hears it: the apparent wind is strongest when you sail into it.
  const intoWind = clamp01(1 - i.offWindDeg / 180);
  const storm = i.inStorm ? 1 : 0;
  return {
    waves: 0.25 + 0.45 * wind + 0.2 * storm,
    wavesBright: clamp01(0.2 + 0.6 * wind + 0.2 * storm),
    wind: clamp01((0.08 + 0.5 * wind * (0.35 + 0.65 * intoWind)) * (i.sailsSet ? 1 : 0.6) + 0.35 * storm),
    windPitch: 380 + 900 * wind * (0.5 + 0.5 * intoWind) + 300 * storm,
    rush: clamp01(i.speed) * 0.55,
    rushTone: 250 + 1100 * clamp01(i.speed),
    luff: i.luffing && i.sailsSet ? 0.5 + 0.3 * wind : 0,
    surf: clamp01(i.coast) * 0.5,
    rain: storm * 0.45,
  };
}
