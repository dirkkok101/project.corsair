import type { Ship, WorldState } from '@corsair/core';
import type { ContentPack, TileMap } from '@corsair/data';
import { Application, Assets, Container, Sprite, Texture, TextureSource, TilingSprite } from 'pixi.js';
import type { Texture as PixiTexture } from 'pixi.js';
import { createWake, createWindStreaks, windVector } from './effects';
import { normalizeDeg, pointOfSail } from '@corsair/systems-navigation';
import { facingIndex } from './facing';
import { paintCoast, paintDeepWater } from './water';

export { facingIndex } from './facing';

/** Logical frame from the art pipeline: everything is composed at 480x270 and integer-scaled. */
export const VIEW_WIDTH = 480;
export const VIEW_HEIGHT = 270;

// How fast the deep-water swatch drifts downwind, in px/s per unit of wind strength multiplier.
const SWELL_DRIFT_PX = 6;
// In irons the slack canvas flaps between two frames.
const LUFF_FRAME_MS = 180;

export interface Renderer {
  canvas: HTMLCanvasElement;
  /** `nowMs` is the frame time (requestAnimationFrame's timestamp); it only drives visual effects. */
  render(state: WorldState, nowMs: number): void;
}

/** `spriteUrls` maps `{sprite}.{anim}` (e.g. `ship.brig.world.sail_full`) to frame URLs ordered f00..fNN. */
export async function createRenderer(
  content: ContentPack,
  map: TileMap,
  spriteUrls: Record<string, string[]>,
): Promise<Renderer> {
  // Must be set before any texture loads, or sprites get smoothed.
  TextureSource.defaultOptions.scaleMode = 'nearest';

  const app = new Application();
  // autoStart off: the game loop calls render() after sim ticks instead of Pixi's ticker.
  await app.init({
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    antialias: false,
    resolution: 1,
    background: '#3c5e8b',
    autoStart: false,
  });

  const world = new Container();
  app.stage.addChild(world);
  const ts = map.tileSize;
  const worldW = map.width * ts;
  const worldH = map.height * ts;
  const swell = new TilingSprite({ texture: Texture.from(paintDeepWater()), width: worldW, height: worldH });
  const streaks = createWindStreaks(map);
  const wake = createWake(map);
  world.addChild(swell, new Sprite(Texture.from(paintCoast(map))), streaks.view, wake.view);

  const frames: Record<string, PixiTexture[]> = {};
  for (const [id, urls] of Object.entries(spriteUrls)) {
    frames[id] = await Promise.all(urls.map((u) => Assets.load<PixiTexture>(u)));
  }

  const shipSprites = new Map<string, Sprite>();

  const sailAnim = (ship: Ship, state: WorldState, nowMs: number): string => {
    if (ship.sails === 'furled') return 'sail_furled';
    // Wind angle relative to the bow: positive means the wind comes over the starboard side.
    let rel = normalizeDeg(state.wind.fromDeg - ship.headingDeg);
    if (rel > 180) rel -= 360;
    const tack = rel >= 0 ? 's' : 'p';
    const point = pointOfSail(content, Math.abs(rel)).id;
    const base = `sail_${ship.sails}_${point}`;
    if (point === 'run') return base;
    if (point === 'irons') return `${base}_${tack}${Math.floor(nowMs / LUFF_FRAME_MS) % 2}`;
    return `${base}_${tack}`;
  };
  let lastMs: number | undefined;
  let swellX = 0;
  let swellY = 0;

  return {
    canvas: app.canvas,
    render(state, nowMs) {
      const dt = lastMs === undefined ? 0 : Math.min((nowMs - lastMs) / 1000, 0.1);
      lastMs = nowMs;
      for (const ship of Object.values(state.ships)) {
        const spriteId = content.ships[ship.classId]!.sprites.world;
        const def = content.sprites[spriteId]!;
        let sprite = shipSprites.get(ship.id);
        if (!sprite) {
          sprite = new Sprite();
          sprite.anchor.set(def.pivot.x, def.pivot.y);
          world.addChild(sprite);
          shipSprites.set(ship.id, sprite);
        }
        sprite.texture = frames[`${spriteId}.${sailAnim(ship, state, nowMs)}`]![facingIndex(ship.headingDeg, def.facings)]!;
        // Whole pixels only, so the 1 px outline never shimmers.
        sprite.position.set(Math.round(ship.x * ts), Math.round(ship.y * ts));
      }

      const player = state.ships.player;
      if (player) {
        const cx = Math.round(player.x * ts - VIEW_WIDTH / 2);
        const cy = Math.round(player.y * ts - VIEW_HEIGHT / 2);
        world.position.set(-clamp(cx, 0, worldW - VIEW_WIDTH), -clamp(cy, 0, worldH - VIEW_HEIGHT));
        wake.update(player, dt);
      }

      const [vx, vy] = windVector(state.wind);
      const drift = SWELL_DRIFT_PX * content.navigation.windStrength[state.wind.strength]! * dt;
      swellX += vx * drift;
      swellY += vy * drift;
      swell.tilePosition.set(Math.round(swellX), Math.round(swellY));
      streaks.update(state.wind, dt, { x: -world.position.x, y: -world.position.y, w: VIEW_WIDTH, h: VIEW_HEIGHT });
      app.render();
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
