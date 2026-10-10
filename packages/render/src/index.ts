import type { WorldState } from '@corsair/core';
import type { ContentPack } from '@corsair/data';
import { Application, Assets, Rectangle, Texture, TextureSource } from 'pixi.js';
import type { Texture as PixiTexture } from 'pixi.js';
import { createDaylight } from './daylight';
import { facingIndex } from './facing';
import { createHarbour } from './harbour';
import type { HarbourScene } from './harbour';
import { MIN_VIEW_HEIGHT, MIN_VIEW_WIDTH } from './view';

// The illustrated harbour scenes behind the port screens (the sea and its battles are drawn in 3D by
// @corsair/render3d): the scene's layers, the nation's flag, the player's ship at anchor, under the day/night
// palette filter.

export { facingIndex } from './facing';
export * from './view';
export type { HarbourScene } from './harbour';
export type { FlagNation } from './flags';
export { HARBOUR_HEIGHT, HARBOUR_WIDTH } from './harbour';
export { parseGpl, rowsAt } from './daylight';

export interface HarbourRenderer {
  canvas: HTMLCanvasElement;
  /** Draws the harbour scene shown (its sea animates); `nowMs` is the frame time. */
  render(state: WorldState, nowMs: number): void;
  /** Resize the logical view (see fitView); the canvas is CSS-scaled by the caller. */
  resize(width: number, height: number): void;
  /** The harbour scene shown in port; `show(undefined)` hides it. */
  harbour: {
    show(scene: HarbourScene | undefined): Promise<void>;
    transform(): { x: number; y: number; scale: number };
    /** Loads a scene's textures ahead of showing it. */
    preload(scene: HarbourScene): void;
    /** True while a harbour scene is showing. */
    readonly visible: boolean;
  };
}

export async function createHarbourRenderer(
  content: ContentPack,
  options: {
    /** Ship sprite atlases by sprite id (tools/art/pack_ships.ts): the player's ship lies at anchor in the scene. */
    atlases?: Record<string, string>;
    /** Day, dusk and night palette rows (same indices) for the day/night swap; omit for always-day. */
    palettes?: [number, number, number][][];
  } = {},
): Promise<HarbourRenderer> {
  // Must be set before any texture loads, or sprites get smoothed.
  TextureSource.defaultOptions.scaleMode = 'nearest';
  const app = new Application();
  // autoStart off: the game loop calls render() instead of Pixi's ticker.
  await app.init({
    width: MIN_VIEW_WIDTH,
    height: MIN_VIEW_HEIGHT,
    antialias: false,
    resolution: 1,
    background: '#090a14',
    autoStart: false,
    // The day/night palette filter is a GLSL shader.
    preference: 'webgl',
  });
  const daylight = options.palettes ? createDaylight(options.palettes) : undefined;
  if (daylight) app.stage.filters = [daylight.filter];

  // Ship atlases: facings across, anims down in sprites.json order. The harbour wants only her furled frames.
  const frames: Record<string, PixiTexture[]> = {};
  for (const [spriteId, url] of Object.entries(options.atlases ?? {})) {
    const def = content.sprites[spriteId];
    if (!def) continue;
    const sheet = await Assets.load<PixiTexture>(url);
    def.anims.forEach((anim, row) => {
      frames[`${spriteId}.${anim}`] = Array.from(
        { length: def.facings },
        (_, f) => new Texture({ source: sheet.source, frame: new Rectangle(f * def.cell, row * def.cell, def.cell, def.cell) }),
      );
    });
  }

  let lastState: WorldState | undefined;
  // The player's ship lies at anchor, sails furled, broadside on.
  const harbour = createHarbour(() => {
    const player = lastState?.ships.player;
    if (!player) return undefined;
    const spriteId = content.ships[player.classId]!.sprites.world;
    return frames[`${spriteId}.sail_furled`]?.[facingIndex(270, content.sprites[spriteId]!.facings)];
  });
  app.stage.addChild(harbour.view);

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
    resize(width, height) {
      app.renderer.resize(width, height);
      harbour.resize(width, height);
    },
    render(state, nowMs) {
      const tpd = content.calendar.ticksPerDay;
      daylight?.setHour(((state.tick % tpd) / tpd) * 24);
      lastState = state;
      harbour.update(nowMs);
      app.render();
    },
  };
}
