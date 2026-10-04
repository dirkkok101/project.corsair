import type { Ship, Wind, WindStrength } from '@corsair/core';
import { isLand, tileAt } from '@corsair/data';
import type { TileMap } from '@corsair/data';
import { Graphics } from 'pixi.js';

// Visual-only tuning. These never feed the sim, so they live with the renderer, not in content.
const STREAKS: Record<WindStrength, { count: number; speedPx: number; length: number; colour: number }> = {
  calm: { count: 0, speedPx: 0, length: 0, colour: 0xa4dddb },
  light: { count: 10, speedPx: 18, length: 4, colour: 0xa4dddb },
  fresh: { count: 22, speedPx: 32, length: 6, colour: 0xa4dddb },
  strong: { count: 36, speedPx: 46, length: 8, colour: 0xebede9 },
  gale: { count: 54, speedPx: 64, length: 10, colour: 0xebede9 },
};
const STREAK_LIFE_S = 1.6;
const WAKE_LIFE_S = 1.4;
const WAKE_SPREAD_PX_PER_S = 7;
const WAKE_MIN_SPEED = 0.15; // tiles per second
// The stern sits about this far behind the waterline pivot in the 45 deg sprite; vertical is foreshortened.
const STERN_PX = { along: 15, vertical: 0.7 };

/** Unit vector the wind blows TOWARD, in screen space (y down). */
export function windVector(wind: Wind): [number, number] {
  const rad = ((wind.fromDeg + 180) * Math.PI) / 180;
  return [Math.sin(rad), -Math.cos(rad)];
}

interface Streak {
  x: number;
  y: number;
  age: number;
}

/** Short pale dashes blown across open water. They grow, hold and shrink rather than fade (binary alpha). */
export function createWindStreaks(map: TileMap) {
  const g = new Graphics();
  const streaks: Streak[] = [];
  const ts = map.tileSize;

  return {
    view: g,
    update(wind: Wind, dt: number, view: { x: number; y: number; w: number; h: number }) {
      const fx = STREAKS[wind.strength];
      const [vx, vy] = windVector(wind);
      while (streaks.length < fx.count) {
        streaks.push({ x: view.x + Math.random() * view.w, y: view.y + Math.random() * view.h, age: Math.random() * STREAK_LIFE_S });
      }
      streaks.length = Math.min(streaks.length, fx.count);

      g.clear();
      for (const s of streaks) {
        s.age += dt;
        s.x += vx * fx.speedPx * dt;
        s.y += vy * fx.speedPx * dt;
        const offscreen = s.x < view.x - 16 || s.y < view.y - 16 || s.x > view.x + view.w + 16 || s.y > view.y + view.h + 16;
        if (s.age > STREAK_LIFE_S || offscreen) {
          s.x = view.x + Math.random() * view.w;
          s.y = view.y + Math.random() * view.h;
          s.age = 0;
        }
        const t = s.age / STREAK_LIFE_S;
        const len = Math.round(fx.length * Math.min(1, 3 * t, 3 * (1 - t)));
        for (let i = 0; i < len; i++) {
          const px = Math.round(s.x - vx * i);
          const py = Math.round(s.y - vy * i);
          if (!isLand(tileAt(map, px / ts, py / ts))) g.rect(px, py, 1, 1);
        }
      }
      g.fill(fx.colour);
    },
  };
}

interface WakePoint {
  x: number;
  y: number;
  /** Perpendicular to the heading when the point was laid, for the V spread. */
  px: number;
  py: number;
  age: number;
}

/** A V of foam laid at the stern; longer and wider the faster the ship goes, none when it's stopped. */
export function createWake(map: TileMap) {
  const g = new Graphics();
  const points: WakePoint[] = [];
  const ts = map.tileSize;
  let carry = 0;

  return {
    view: g,
    update(ship: Ship, dt: number) {
      for (const p of points) p.age += dt;
      while (points.length && points[0]!.age > WAKE_LIFE_S) points.shift();

      const rad = (ship.headingDeg * Math.PI) / 180;
      const hx = Math.sin(rad);
      const hy = -Math.cos(rad);
      // Lay one point per pixel travelled, so spacing reads as speed.
      carry += ship.speed > WAKE_MIN_SPEED ? ship.speed * ts * dt : 0;
      while (carry >= 1) {
        carry -= 1;
        points.push({
          x: ship.x * ts - hx * STERN_PX.along,
          y: ship.y * ts - hy * STERN_PX.along * STERN_PX.vertical,
          px: -hy,
          py: hx,
          age: 0,
        });
      }

      g.clear();
      for (const p of points) {
        const spread = 1 + p.age * WAKE_SPREAD_PX_PER_S;
        for (const side of [-1, 1]) {
          const x = Math.round(p.x + p.px * spread * side);
          const y = Math.round(p.y + p.py * spread * side);
          if (!isLand(tileAt(map, x / ts, y / ts))) g.rect(x, y, 1, 1);
        }
      }
      g.fill(0xebede9);
    },
  };
}
