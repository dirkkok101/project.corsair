/** The smallest logical view; the art is composed for it (art pipeline section 2). */
export const MIN_VIEW_WIDTH = 960;
export const MIN_VIEW_HEIGHT = 540;

export interface ViewFit {
  /** Logical view size in art pixels. */
  width: number;
  height: number;
  /** Device pixels per art pixel: always a whole number, so pixel art stays crisp. */
  scale: number;
  /** CSS size of the canvas; covers the window (overflowing it by less than one art pixel). */
  cssWidth: number;
  cssHeight: number;
}

/**
 * Fills the window without blurring the pixel art: the largest whole-number scale (in device
 * pixels, so Retina screens count) at which the view is still at least 960x540, then a view sized
 * to cover the window at that scale. Screens that aren't a 16:9 multiple see a little more sea.
 */
export function fitView(cssWidth: number, cssHeight: number, devicePixelRatio: number): ViewFit {
  const deviceW = Math.round(cssWidth * devicePixelRatio);
  const deviceH = Math.round(cssHeight * devicePixelRatio);
  const scale = Math.max(1, Math.floor(Math.min(deviceW / MIN_VIEW_WIDTH, deviceH / MIN_VIEW_HEIGHT)));
  const width = Math.ceil(deviceW / scale);
  const height = Math.ceil(deviceH / scale);
  return {
    width,
    height,
    scale,
    cssWidth: (width * scale) / devicePixelRatio,
    cssHeight: (height * scale) / devicePixelRatio,
  };
}
