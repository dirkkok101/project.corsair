import type { SailSetting, Wind } from '@corsair/core';
import type { ContentPack } from '@corsair/data';
import { normalizeDeg, pointOfSail } from '@corsair/systems-navigation';

const LUFF_FRAME_MS = 180;

/** A world ship sprite's animation for her sails on this wind: the point of sail, the tack, a luff in irons. */
export function sailAnim(content: ContentPack, ship: { sails: SailSetting; headingDeg: number }, wind: Wind, nowMs: number): string {
  if (ship.sails === 'furled') return 'sail_furled';
  // Wind angle relative to the bow: positive means the wind comes over the starboard side.
  let rel = normalizeDeg(wind.fromDeg - ship.headingDeg);
  if (rel > 180) rel -= 360;
  const tack = rel >= 0 ? 's' : 'p';
  const point = pointOfSail(content, Math.abs(rel)).id;
  const base = `sail_${ship.sails}_${point}`;
  if (point === 'run') return base;
  if (point === 'irons') return `${base}_${tack}${Math.floor(nowMs / LUFF_FRAME_MS) % 2}`;
  return `${base}_${tack}`;
}
