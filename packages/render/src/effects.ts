import type { Ship, Wind, WindStrength } from '@corsair/core';
import { isLand, Tile, tileAt } from '@corsair/data';
import type { TileMap } from '@corsair/data';
import { Graphics } from 'pixi.js';

// Visual-only tuning. These never feed the sim, so they live with the renderer, not in content.
const STREAKS: Record<WindStrength, { count: number; speedPx: number; length: number; colour: number }> = {
  calm: { count: 0, speedPx: 0, length: 0, colour: 0xa4dddb },
  light: { count: 40, speedPx: 27, length: 6, colour: 0xa4dddb },
  fresh: { count: 88, speedPx: 48, length: 9, colour: 0xa4dddb },
  strong: { count: 144, speedPx: 69, length: 12, colour: 0xebede9 },
  gale: { count: 216, speedPx: 96, length: 15, colour: 0xebede9 },
};
const STREAK_LIFE_S = 1.6;
const WAKE_LIFE_S = 1.4;
const WAKE_SPREAD_PX_PER_S = 10.5;
const WAKE_MIN_SPEED = 0.15; // tiles per second
// The stern sits about this far behind the waterline pivot in the 45 deg sprite; vertical is foreshortened.
const STERN_PX = { along: 22, vertical: 0.7 };

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

interface SprayPoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

const SPRAY_LIFE_S = 0.45;
const SPRAY_FROM_SPEED = 0.55; // fraction of class top speed where the bow starts throwing spray
const BOW_PX = 26; // the bow sits about this far ahead of the waterline pivot in the 96 px sprite

/** White water thrown off the bow when the ship drives hard; more of it the faster she goes. */
export function createSpray(map: TileMap) {
  const g = new Graphics();
  const points: SprayPoint[] = [];
  const ts = map.tileSize;
  let carry = 0;
  let seed = 1;
  const rand = () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x9e3779b9;
    return ((seed >>> 0) % 10000) / 10000;
  };

  return {
    view: g,
    /** `drive` is speed as a fraction of the ship's top speed. */
    update(ship: Ship, drive: number, dt: number) {
      for (const p of points) {
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      while (points.length && points[0]!.age > SPRAY_LIFE_S) points.shift();

      const rad = (ship.headingDeg * Math.PI) / 180;
      const hx = Math.sin(rad);
      const hy = -Math.cos(rad);
      carry += Math.max(0, drive - SPRAY_FROM_SPEED) * 90 * dt;
      while (carry >= 1) {
        carry -= 1;
        const side = rand() < 0.5 ? -1 : 1;
        const out = 18 + rand() * 26;
        points.push({
          x: ship.x * ts + hx * BOW_PX,
          y: ship.y * ts + hy * BOW_PX * STERN_PX.vertical,
          vx: -hy * side * out + hx * 10,
          vy: hx * side * out * STERN_PX.vertical + hy * 10 - 14,
          age: 0,
        });
      }

      g.clear();
      for (const p of points) {
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (!isLand(tileAt(map, x / ts, y / ts))) g.rect(x, y, 1, 1);
      }
      g.fill(0xebede9);
    },
  };
}

// The foremast head in the 96 px brig, relative to the waterline pivot: 0.42 units forward and
// 1.62 up, at 96 / 3.7 px per unit, with the 45 deg camera foreshortening depth by cos 45.
const MAST = { forward: 0.42, up: 1.62, pxPerUnit: 96 / 3.7, foreshorten: Math.SQRT1_2 };
const PENNANT_PX: Record<WindStrength, number> = { calm: 3, light: 5, fresh: 7, strong: 9, gale: 11 };

/** A long, thin pennant streaming downwind from the foremast head, so the ship itself shows the wind. */
export function createPennants() {
  const g = new Graphics();
  return {
    view: g,
    update(ships: { ship: Ship; wind: Wind; x: number; y: number }[], timeS: number) {
      g.clear();
      for (const { ship, wind, x, y } of ships) {
        const rad = (ship.headingDeg * Math.PI) / 180;
        const k = MAST.pxPerUnit;
        const topX = x + Math.sin(rad) * MAST.forward * k;
        const topY = y - Math.cos(rad) * MAST.forward * k * MAST.foreshorten - MAST.up * k * MAST.foreshorten;
        const [vx, vy] = windVector(wind);
        const len = PENNANT_PX[wind.strength];
        for (let i = 1; i <= len; i++) {
          // A ripple that grows toward the tip, like cloth flicking in the wind.
          const wave = Math.sin(timeS * 9 - i * 0.9) * (i / len) * 1.2;
          g.rect(Math.round(topX + vx * i - vy * wave), Math.round(topY + vy * i * MAST.foreshorten + vx * wave), 1, 1);
        }
      }
      g.fill(0xcf573c);
    },
  };
}

const WHITECAPS_PER_S: Record<WindStrength, number> = { calm: 0, light: 0, fresh: 6, strong: 28, gale: 60 };
const WHITECAP_LIFE_S = 0.7;

/** Short white crests that break and vanish across open water as the wind rises. */
export function createWhitecaps(map: TileMap) {
  const g = new Graphics();
  const caps: { x: number; y: number; len: number; age: number }[] = [];
  const ts = map.tileSize;
  let carry = 0;
  let seed = 7;
  const rand = () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x9e3779b9;
    return ((seed >>> 0) % 10000) / 10000;
  };
  return {
    view: g,
    update(wind: Wind, dt: number, view: { x: number; y: number; w: number; h: number }) {
      for (const c of caps) c.age += dt;
      while (caps.length && caps[0]!.age > WHITECAP_LIFE_S) caps.shift();
      carry += WHITECAPS_PER_S[wind.strength] * dt * ((view.w * view.h) / (960 * 540));
      while (carry >= 1) {
        carry -= 1;
        const x = view.x + rand() * view.w;
        const y = view.y + rand() * view.h;
        if (tileAt(map, x / ts, y / ts) === Tile.Deep) caps.push({ x, y, len: 2 + Math.floor(rand() * 4), age: 0 });
      }
      g.clear();
      for (const c of caps) {
        // Grow, then break up into a shorter, broken crest before vanishing.
        const t = c.age / WHITECAP_LIFE_S;
        const len = t < 0.3 ? c.len : t < 0.7 ? c.len - 1 : 1;
        for (let i = 0; i < len; i++) {
          if (t > 0.5 && i % 2 === 1) continue;
          g.rect(Math.round(c.x) + i, Math.round(c.y), 1, 1);
        }
      }
      g.fill(0xebede9);
    },
  };
}
