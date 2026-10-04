import { describe, expect, it } from 'vitest';
import { fitView } from '../src/view';

describe('fitView', () => {
  it('is exactly 960x540 at 2x on a 1080p screen', () => {
    expect(fitView(1920, 1080, 1)).toEqual({ width: 960, height: 540, scale: 2, cssWidth: 1920, cssHeight: 1080 });
  });

  it('fills a 1440p screen at 2x by showing more of the world, not with borders', () => {
    const fit = fitView(2560, 1440, 1);
    expect(fit.scale).toBe(2);
    expect([fit.width, fit.height]).toEqual([1280, 720]);
    expect([fit.cssWidth, fit.cssHeight]).toEqual([2560, 1440]);
  });

  it('counts Retina device pixels and still covers the window', () => {
    // A MacBook window: 1512x860 CSS pixels at devicePixelRatio 2 is 3024x1720 device pixels.
    const fit = fitView(1512, 860, 2);
    expect(fit.scale).toBe(3);
    expect(fit.width).toBeGreaterThanOrEqual(960);
    expect(fit.height).toBeGreaterThanOrEqual(540);
    expect(fit.cssWidth).toBeGreaterThanOrEqual(1512);
    expect(fit.cssHeight).toBeGreaterThanOrEqual(860);
    expect(fit.cssWidth - 1512).toBeLessThan(fit.scale / 2);
  });

  it('never drops below 1x on a small window', () => {
    expect(fitView(800, 500, 1)).toMatchObject({ scale: 1, width: 800, height: 500 });
  });
});
