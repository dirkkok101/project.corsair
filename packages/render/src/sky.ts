import type { Storm, Wind, WindStrength } from '@corsair/core';
import { Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { Texture as PixiTexture } from 'pixi.js';
import { windVector } from './effects';

// Clouds drift in code (scenes doc S1: four shapes, no outline). Stand-in pixel puffs are painted
// once at 1:1 from corsair.gpl; storms reuse them in grey, arranged as rotating spiral bands.
const FAIR = ['#a8b5b2', '#c7cfcc', '#ebede9'];
const STORM = ['#394a50', '#577277', '#819796'];
const PUFF_SHAPES = [
  [
    [14, 14, 10],
    [26, 10, 12],
    [38, 15, 9],
  ],
  [
    [12, 12, 9],
    [24, 9, 11],
    [36, 12, 9],
    [46, 15, 7],
  ],
  [
    [10, 10, 8],
    [20, 8, 9],
    [28, 12, 7],
  ],
  [
    [12, 13, 9],
    [24, 11, 11],
    [36, 13, 9],
  ],
] as const;

const CLOUD_COUNT = 7;
const CLOUD_DRIFT_PX: Record<WindStrength, number> = { calm: 2, light: 8, fresh: 16, strong: 24, gale: 34 };
const STORM_ARMS = 3;
const ARM_TURNS = 1.3; // each band winds this many turns from the eye wall to the edge
const ARM_SPACING_PX = 26; // distance between puffs along a band
const OVERCAST_PER_VIEW = 26; // scattered puffs filling the storm, per screenful of area
const STORM_SPIN = 0.08; // radians per second
const SHIP_CLEARANCE_PX = 70; // storm puffs never cover the player's ship

function paintPuff(circles: readonly (readonly [number, number, number])[], ramp: string[]): PixiTexture {
  const w = Math.max(...circles.map(([x, , r]) => x + r)) + 1;
  const h = Math.max(...circles.map(([, y, r]) => y + r)) + 1;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Lit from the north-west: test the pixel against each circle shifted toward the light.
      const inside = (dx: number, dy: number) => circles.some(([cx, cy, r]) => (x - cx + dx) ** 2 + (y - cy + dy) ** 2 <= r * r);
      if (!inside(0, 0)) continue;
      const tone = !inside(-2, -2) ? 0 : inside(2, 2) ? 2 : 1;
      ctx.fillStyle = ramp[tone]!;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return Texture.from(canvas);
}

/** One dark pixel in each 2x2: a 25% screen that darkens the sea without hiding it. */
function ditherTexture(colour: string): PixiTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 1, 1);
  return Texture.from(canvas);
}

/** Hash for stable per-puff jitter. */
const jitter = (i: number, salt: number) => {
  const h = Math.imul(i * 374761393 + salt * 668265263, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function createSky(viewW: number, viewH: number, tileSize: number) {
  const fair = PUFF_SHAPES.map((s) => paintPuff(s, FAIR));
  const grey = PUFF_SHAPES.map((s) => paintPuff(s, STORM));
  const layer = new Container();
  const gloom = new TilingSprite({ texture: ditherTexture('#151d28'), width: viewW, height: viewH });
  gloom.visible = false;

  const clouds = Array.from({ length: CLOUD_COUNT }, (_, i) => {
    const sprite = new Sprite(fair[i % fair.length]!);
    sprite.anchor.set(0.5);
    layer.addChild(sprite);
    return { sprite, x: Number.NaN, y: 0 };
  });

  const stormSprites = new Map<string, Sprite[]>();
  let spin = 0;

  return {
    /** World-space layer above the ships. */
    layer,
    /** View-sized overlay for the world (under ships) that darkens the sea inside a storm. */
    gloom,
    update(
      wind: Wind,
      storms: Storm[],
      dt: number,
      view: { x: number; y: number },
      ship: { x: number; y: number } | undefined,
    ) {
      // Fair-weather clouds drift downwind and wrap around the view, so wind shows from the sky too.
      const [vx, vy] = windVector(wind);
      const drift = CLOUD_DRIFT_PX[wind.strength] * dt;
      const margin = 80;
      for (const [i, c] of clouds.entries()) {
        if (Number.isNaN(c.x)) {
          c.x = view.x + jitter(i, 1) * viewW;
          c.y = view.y + jitter(i, 2) * viewH;
        }
        c.x += vx * drift;
        c.y += vy * drift;
        if (c.x < view.x - margin) c.x += viewW + 2 * margin;
        if (c.x > view.x + viewW + margin) c.x -= viewW + 2 * margin;
        if (c.y < view.y - margin) c.y += viewH + 2 * margin;
        if (c.y > view.y + viewH + margin) c.y -= viewH + 2 * margin;
        c.sprite.position.set(Math.round(c.x), Math.round(c.y));
      }

      // Storms: puffs along spiral bands, turning counter-clockwise like the wind inside them.
      spin += STORM_SPIN * dt;
      const live = new Set(storms.map((s) => s.id));
      for (const [id, sprites] of stormSprites) {
        if (live.has(id)) continue;
        for (const s of sprites) s.destroy();
        stormSprites.delete(id);
      }
      const centre = { x: view.x + viewW / 2, y: view.y + viewH / 2 };
      // Judge "in the storm" at the ship, like the HUD; the view centre only when there is no ship.
      const here = ship ?? centre;
      const reach = Math.hypot(viewW, viewH);
      let inStorm = false;
      for (const storm of storms) {
        const cx = storm.x * tileSize;
        const cy = storm.y * tileSize;
        const r = storm.radius * tileSize;
        if (Math.hypot(here.x - cx, here.y - cy) < r) inStorm = true;
        // Storms far from the view build no sprites, and hide any they have.
        if (Math.hypot(centre.x - cx, centre.y - cy) - r > reach) {
          for (const s of stormSprites.get(storm.id) ?? []) s.visible = false;
          continue;
        }
        // Puff counts scale with the storm: bands keep an even spacing, overcast an even density.
        const bandLength = 2 * Math.PI * ARM_TURNS * r * 0.56;
        const perArm = Math.ceil(bandLength / ARM_SPACING_PX);
        const overcast = Math.ceil((Math.PI * r * r * OVERCAST_PER_VIEW) / (viewW * viewH));
        let sprites = stormSprites.get(storm.id);
        if (!sprites) {
          sprites = Array.from({ length: STORM_ARMS * perArm + overcast }, (_, i) => {
            const sprite = new Sprite(grey[i % grey.length]!);
            sprite.anchor.set(0.5);
            layer.addChild(sprite);
            return sprite;
          });
          stormSprites.set(storm.id, sprites);
        }
        for (const [i, sprite] of sprites.entries()) {
          let radius: number;
          let angle: number;
          if (i < STORM_ARMS * perArm) {
            const arm = Math.floor(i / perArm);
            const t = (i % perArm) / perArm + jitter(i, 3) * (1 / perArm);
            radius = r * (0.12 + 0.88 * t) + (jitter(i, 4) - 0.5) * 30;
            // Screen y grows downward, so a decreasing angle turns counter-clockwise on screen.
            angle = (arm * 2 * Math.PI) / STORM_ARMS - t * ARM_TURNS * 2 * Math.PI - spin;
          } else {
            // Overcast: an even scatter (sqrt keeps area density uniform) outside the clear eye.
            radius = r * Math.sqrt(0.02 + 0.98 * jitter(i, 5));
            angle = jitter(i, 6) * 2 * Math.PI - spin * 0.7;
          }
          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle) * radius;
          const onScreen = x > view.x - margin && x < view.x + viewW + margin && y > view.y - margin && y < view.y + viewH + margin;
          const overShip = ship && Math.hypot(x - ship.x, y - ship.y) < SHIP_CLEARANCE_PX;
          sprite.visible = onScreen && !overShip;
          if (sprite.visible) sprite.position.set(Math.round(x), Math.round(y));
        }
      }
      gloom.visible = inStorm;
      for (const c of clouds) c.sprite.visible = !inStorm;
    },
  };
}
