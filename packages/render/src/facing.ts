/** Sprite facing for a heading: f00 = north, clockwise, 360 / facings degrees per step. */
export function facingIndex(headingDeg: number, facings = 16): number {
  const step = 360 / facings;
  return ((Math.round(headingDeg / step) % facings) + facings) % facings;
}
