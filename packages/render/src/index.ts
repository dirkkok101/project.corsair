import type { Ship, Wind, WorldState } from '@corsair/core';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';
import { Application, Assets, Container, Sprite, Texture, TextureSource, TilingSprite } from 'pixi.js';
import type { Texture as PixiTexture } from 'pixi.js';
import { createPennants, createSpray, createWake, createWhitecaps, createWindStreaks, windVector } from './effects';
import { createDaylight } from './daylight';
import { normalizeDeg, pointOfSail } from '@corsair/systems-navigation';
import { facingIndex } from './facing';
import { createHarbour } from './harbour';
import type { HarbourScene } from './harbour';
import { createSky } from './sky';
import { createWildlife } from './wildlife';
import type { WildlifeDefs, WildlifeSound } from './wildlife';
import { paintDeepWater, paintTerrainChunk } from './water';

export { facingIndex } from './facing';

import { MIN_VIEW_HEIGHT, MIN_VIEW_WIDTH } from './view';

export * from './view';
export type { WildlifeDefs, WildlifeSound } from './wildlife';
export type { FlagNation, HarbourScene } from './harbour';
export { HARBOUR_HEIGHT, HARBOUR_WIDTH } from './harbour';
export { parseGpl, rowsAt } from './daylight';

// How fast the deep-water swatch drifts downwind, in px/s per unit of wind strength multiplier.
const SWELL_DRIFT_PX = 9;
// Terrain is painted lazily in square chunks around the camera; a full map is far too big for one texture.
const CHUNK_TILES = 32;
const MAX_CHUNKS = 30;
// Chunks within this many pixels beyond the view are painted ahead, one per frame, so sailing into
// a new chunk rarely has to paint it on the spot (each is ~590k pixels).
const PREFETCH_PX = 384;
// In irons the slack canvas flaps between two frames.
const LUFF_FRAME_MS = 180;

export interface Renderer {
  canvas: HTMLCanvasElement;
  /** `nowMs` is the frame time (requestAnimationFrame's timestamp); it only drives visual effects. */
  render(state: WorldState, nowMs: number): void;
  /** Top-left of the view in world pixels, for overlays such as town labels. */
  camera(): { x: number; y: number };
  /** Logical view size in art pixels. */
  view(): { width: number; height: number };
  /** Resize the logical view (see fitView); the canvas is CSS-scaled by the caller. */
  resize(width: number, height: number): void;
  /** Called at each lightning flash, so the app can roll thunder. */
  onLightning(cb: () => void): void;
  /** The harbour scene shown in port; `show(undefined)` returns to the sea. */
  harbour: {
    show(scene: HarbourScene | undefined): Promise<void>;
    transform(): { x: number; y: number; scale: number };
    /** Loads a scene's textures ahead of showing it. */
    preload(scene: HarbourScene): void;
    /** True while the harbour scene covers the sea view. */
    readonly visible: boolean;
  };
  /** Debug: start a sea-life event now, and count the animals on screen. */
  wildlife: { spawn(kind: 'dolphins' | 'flyingFish' | 'whale' | 'pelicans' | 'frigatebird'): void; readonly count: number };
}

/** `spriteUrls` maps `{sprite}.{anim}` (e.g. `ship.brig.world.sail_full`) to frame URLs ordered f00..fNN. */
export async function createRenderer(
  content: ContentPack,
  map: TileMap,
  spriteUrls: Record<string, string[]>,
  options: {
    settlements?: PlacedSettlement[];
    /** Wind at a tile; defaults to the single global wind of the test maps. */
    windAt?: (state: WorldState, x: number, y: number) => Wind;
    /** Day, dusk and night palette rows (same indices) for the day/night swap; omit for always-day. */
    palettes?: [number, number, number][][];
    /** Sea life sprites and the sound hook it calls; omit for no wildlife. */
    wildlife?: { defs: WildlifeDefs; sound: WildlifeSound; coastNearness: (x: number, y: number) => number };
  } = {},
): Promise<Renderer> {
  const settlements = options.settlements ?? [];
  const windAt = options.windAt ?? ((state: WorldState) => state.wind);
  const palettes = options.palettes;
  // Must be set before any texture loads, or sprites get smoothed.
  TextureSource.defaultOptions.scaleMode = 'nearest';

  const app = new Application();
  // autoStart off: the game loop calls render() after sim ticks instead of Pixi's ticker.
  await app.init({
    width: MIN_VIEW_WIDTH,
    height: MIN_VIEW_HEIGHT,
    antialias: false,
    resolution: 1,
    background: '#3c5e8b',
    autoStart: false,
    // The day/night palette filter is a GLSL shader.
    preference: 'webgl',
  });

  const world = new Container();
  app.stage.addChild(world);
  const ts = map.tileSize;
  const worldW = map.width * ts;
  const worldH = map.height * ts;
  // Deep water is one screen-sized tiling sprite under the world, scrolled with the camera.
  let viewW = MIN_VIEW_WIDTH;
  let viewH = MIN_VIEW_HEIGHT;
  const swell = new TilingSprite({ texture: Texture.from(paintDeepWater()), width: viewW, height: viewH });
  app.stage.addChildAt(swell, 0);
  const terrain = new Container();
  const streaks = createWindStreaks(map);
  const wake = createWake(map);
  const spray = createSpray(map);
  const pennants = createPennants();
  const whitecaps = createWhitecaps(map);
  world.addChild(terrain, whitecaps.view, streaks.view, wake.view, spray.view);
  const daylight = palettes ? createDaylight(palettes) : undefined;
  if (daylight) app.stage.filters = [daylight.filter];
  // Clouds and storms are sky: a layer above the world (and its ships) that scrolls with it.
  const sky = createSky(viewW, viewH, ts);
  // The storm gloom darkens the sea under the ships; the clouds go above everything.
  world.addChildAt(sky.gloom, 1);
  app.stage.addChild(sky.layer, sky.weather);

  const chunkPx = CHUNK_TILES * ts;
  // Insertion order doubles as LRU order: a chunk is re-inserted whenever it's on screen.
  const chunks = new Map<string, Sprite | null>();
  const paint = (cx: number, cy: number) => {
    const canvas = paintTerrainChunk(map, cx * CHUNK_TILES, cy * CHUNK_TILES, CHUNK_TILES);
    const chunk = canvas ? new Sprite(Texture.from(canvas)) : null;
    chunk?.position.set(cx * chunkPx, cy * chunkPx);
    if (chunk) terrain.addChild(chunk);
    return chunk;
  };
  const ensureChunks = (viewX: number, viewY: number) => {
    let prefetchBudget = 1;
    const x0 = Math.floor((viewX - PREFETCH_PX) / chunkPx);
    const x1 = Math.floor((viewX + viewW + PREFETCH_PX) / chunkPx);
    const y0 = Math.floor((viewY - PREFETCH_PX) / chunkPx);
    const y1 = Math.floor((viewY + viewH + PREFETCH_PX) / chunkPx);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = `${cx},${cy}`;
        let chunk = chunks.get(key);
        if (chunk === undefined) {
          const visible =
            cx * chunkPx < viewX + viewW &&
            (cx + 1) * chunkPx > viewX &&
            cy * chunkPx < viewY + viewH &&
            (cy + 1) * chunkPx > viewY;
          if (!visible && prefetchBudget-- <= 0) continue;
          chunk = paint(cx, cy);
        }
        chunks.delete(key);
        chunks.set(key, chunk);
      }
    }
    while (chunks.size > MAX_CHUNKS) {
      const [oldest, chunk] = chunks.entries().next().value!;
      chunks.delete(oldest);
      chunk?.destroy({ texture: true, textureSource: true });
    }
  };

  const frames: Record<string, PixiTexture[]> = {};
  for (const [id, urls] of Object.entries(spriteUrls)) {
    frames[id] = await Promise.all(urls.map((u) => Assets.load<PixiTexture>(u)));
  }

  // Towns sit between the water effects and the ships, which are added later and so draw on top.
  const town = content.sprites.settlement;
  for (const s of settlements) {
    if (!town) break;
    const anim = s.type === 'haven' ? 'pirate.haven' : `${s.nation}.${s.size}`;
    const sprite = new Sprite(frames[`settlement.${anim}`]![0]!);
    sprite.anchor.set(town.pivot.x, town.pivot.y);
    sprite.position.set(Math.round(s.x * ts), Math.round(s.y * ts));
    world.addChild(sprite);
  }

  const shipSprites = new Map<string, Sprite>();
  // Sea life: swimmers under the ships, birds above everything but the storm weather.
  const wildlife = options.wildlife ? createWildlife(map, frames, options.wildlife.defs, options.wildlife.sound) : undefined;
  if (wildlife) {
    world.addChild(wildlife.water);
    app.stage.addChildAt(wildlife.air, app.stage.getChildIndex(sky.weather));
  }

  const sailAnim = (ship: Ship, state: WorldState, nowMs: number): string => {
    if (ship.sails === 'furled') return 'sail_furled';
    // Wind angle relative to the bow: positive means the wind comes over the starboard side.
    let rel = normalizeDeg(windAt(state, ship.x, ship.y).fromDeg - ship.headingDeg);
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

  // In port the harbour scene replaces the sea view; the player's brig lies at anchor, sails furled, broadside on.
  const harbour = createHarbour(() => {
    const player = lastState?.ships.player;
    if (!player) return undefined;
    const spriteId = content.ships[player.classId]!.sprites.world;
    return frames[`${spriteId}.sail_furled`]?.[facingIndex(270, content.sprites[spriteId]!.facings)];
  });
  app.stage.addChild(harbour.view);
  let lastState: WorldState | undefined;

  return {
    canvas: app.canvas,
    harbour: {
      show: (scene) => harbour.show(scene),
      transform: () => harbour.transform(),
      preload: (scene) => harbour.preload(scene),
      get visible() {
        return harbour.visible;
      },
    },
    camera: () => ({ x: -world.position.x, y: -world.position.y }),
    view: () => ({ width: viewW, height: viewH }),
    onLightning: (cb) => sky.onLightning(cb),
    wildlife: {
      spawn: (kind) => wildlife?.spawn(kind),
      get count() {
        return wildlife?.count ?? 0;
      },
    },
    resize(width, height) {
      if (width === viewW && height === viewH) return;
      viewW = width;
      viewH = height;
      app.renderer.resize(width, height);
      harbour.resize(width, height);
      swell.width = width;
      swell.height = height;
      sky.resize(width, height);
    },
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
        // A one-pixel bob on the swell, out of step between ships.
        const bob = Math.round(Math.sin(nowMs / 650 + ship.x) * 0.9);
        sprite.position.set(Math.round(ship.x * ts), Math.round(ship.y * ts) + bob);
      }

      const player = state.ships.player;
      if (player) {
        const cx = Math.round(player.x * ts - viewW / 2);
        const cy = Math.round(player.y * ts - viewH / 2);
        world.position.set(-clamp(cx, 0, worldW - viewW), -clamp(cy, 0, worldH - viewH));
        wake.update(player, dt);
        const cls = content.ships[player.classId]!;
        const drive = player.speed / (cls.speed * content.navigation.tilesPerSecondPerSpeedPoint);
        spray.update(player, drive, dt);
        if (wildlife && options.wildlife) {
          const tpd = content.calendar.ticksPerDay;
          wildlife.update({
            ship: player,
            drive,
            hour: ((state.tick % tpd) / tpd) * 24,
            dt,
            coast: options.wildlife.coastNearness(player.x, player.y),
            view: { x: -world.position.x, y: -world.position.y, w: viewW, h: viewH },
          });
          wildlife.air.position.copyFrom(world.position);
        }
      }

      // Water and sky show the wind where the camera is looking: the player's ship, or the view centre.
      const view = { x: -world.position.x, y: -world.position.y };
      const wind = player
        ? windAt(state, player.x, player.y)
        : windAt(state, (view.x + viewW / 2) / ts, (view.y + viewH / 2) / ts);
      const [vx, vy] = windVector(wind);
      const drift = SWELL_DRIFT_PX * content.navigation.windStrength[wind.strength]! * dt;
      swellX += vx * drift;
      swellY += vy * drift;
      swell.tilePosition.set(Math.round(world.position.x + swellX), Math.round(world.position.y + swellY));
      ensureChunks(-world.position.x, -world.position.y);
      streaks.update(wind, dt, { ...view, w: viewW, h: viewH });
      sky.layer.position.copyFrom(world.position);
      sky.gloom.position.set(view.x, view.y);
      sky.update(wind, state.weather?.storms ?? [], dt, view, player && { x: player.x * ts, y: player.y * ts });
      whitecaps.update(wind, dt, { ...view, w: viewW, h: viewH });
      // Pennants go above the ship sprites, which are added to the world after it.
      if (pennants.view.parent !== world || world.getChildIndex(pennants.view) !== world.children.length - 1) {
        world.addChild(pennants.view);
      }
      pennants.update(
        Object.values(state.ships).map((ship) => ({
          ship,
          wind: windAt(state, ship.x, ship.y),
          x: Math.round(ship.x * ts),
          y: Math.round(ship.y * ts) + Math.round(Math.sin(nowMs / 650 + ship.x) * 0.9),
        })),
        nowMs / 1000,
      );
      const tpd = content.calendar.ticksPerDay;
      daylight?.setHour(((state.tick % tpd) / tpd) * 24);
      lastState = state;
      harbour.update(nowMs);
      // The opaque scene covers the sea view, so nothing under it needs drawing.
      for (const child of app.stage.children) if (child !== harbour.view) child.visible = !harbour.visible;
      app.render();
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
