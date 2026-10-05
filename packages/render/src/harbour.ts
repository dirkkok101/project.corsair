import { Assets, Container, Graphics, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';

// The harbour scene behind the port screen (scenes doc: harbour). Layers are 960x540 Blender
// renders stacked back to front; the sea animates; the game adds the nation's flag on the
// scene's pole and the player's ship at its anchorage. It sits under the stage's day/night filter.

export const HARBOUR_WIDTH = 960;
export const HARBOUR_HEIGHT = 540;
const SEA_FRAME_MS = 400;
const FLAG_W = 14;
const FLAG_H = 9;

export type FlagNation = 'spain' | 'england' | 'france' | 'netherlands' | 'pirate';

export interface HarbourScene {
  /** Back to front; a layer with several URLs animates through them. */
  layers: string[][];
  /** Top of the flagpole and the anchorage, in scene pixels; an interior has neither. */
  flag?: [number, number];
  anchor?: [number, number];
  nation: FlagNation;
}

// Palette colours only, so the day/night filter maps them like the rest of the scene.
const WHITE = 0xebede9;
const RED = 0xa53030;
const BLUE = 0x253a5e;
const GOLD = 0xe8c170;
const BLACK = 0x090a14;

/** Colour of flag pixel (x, y) on a FLAG_W x FLAG_H cloth. */
function flagPixel(nation: FlagNation, x: number, y: number): number {
  const cx = Math.floor(FLAG_W / 2);
  const cy = Math.floor(FLAG_H / 2);
  switch (nation) {
    case 'england': // St George's cross
      return x === cx || x === cx - 1 || y === cy ? RED : WHITE;
    case 'spain': {
      // Cross of Burgundy: a ragged red saltire on white
      const d = (x / (FLAG_W - 1)) * (FLAG_H - 1);
      return Math.abs(y - d) < 1 || Math.abs(FLAG_H - 1 - y - d) < 1 ? RED : WHITE;
    }
    case 'france': // Bourbon white, a few gold lilies
      return (x % 5 === 2 && y % 4 === 2) ? GOLD : WHITE;
    case 'netherlands': // red, white and blue bands
      return y < 3 ? RED : y < 6 ? WHITE : BLUE;
    case 'pirate': // black with a white mark
      return (x >= 5 && x <= 7 && y >= 2 && y <= 4) || (y === 6 && (x === 4 || x === 8)) ? WHITE : BLACK;
  }
}

export function createHarbour(shipFrame: () => Texture | undefined) {
  const view = new Container();
  view.visible = false;
  const backdrop = new Graphics();
  const scene = new Container();
  const flag = new Graphics();
  const ship = new Sprite();
  ship.anchor.set(0.5, 0.8);
  view.addChild(backdrop, scene);
  let layers: { sprite: Sprite; frames: Texture[] }[] = [];
  let shown: HarbourScene | undefined;
  let loading: HarbourScene | undefined;
  let viewW = HARBOUR_WIDTH;
  let viewH = HARBOUR_HEIGHT;

  const layout = () => {
    // Whole-pixel scale, centred; the margins carry on the sky above and the sea below.
    const s = Math.max(1, Math.floor(Math.min(viewW / HARBOUR_WIDTH, viewH / HARBOUR_HEIGHT)));
    scene.scale.set(s);
    scene.position.set(Math.round((viewW - HARBOUR_WIDTH * s) / 2), Math.round((viewH - HARBOUR_HEIGHT * s) / 2));
    const horizon = scene.position.y + 250 * s;
    backdrop.clear().rect(0, 0, viewW, horizon).fill(0x4f8fba).rect(0, horizon, viewW, viewH - horizon).fill(BLUE);
  };

  return {
    view,
    /** Scene pixels to view pixels, for overlays such as the hotspots. */
    transform() {
      return { x: scene.position.x, y: scene.position.y, scale: scene.scale.x };
    },
    resize(width: number, height: number) {
      viewW = width;
      viewH = height;
      layout();
    },
    /** Show a scene (loading its layers on first use), or hide it with undefined. */
    async show(next: HarbourScene | undefined) {
      if (!next) {
        // Leaving port: hide at once, and drop a scene still loading so it can't pop up at sea.
        shown = undefined;
        loading = undefined;
        view.visible = false;
        return;
      }
      if (next === shown || next === loading) return;
      loading = next;
      const textures = await Promise.all(next.layers.map((urls) => Promise.all(urls.map((u) => Assets.load<Texture>(u)))));
      // A newer request (or leaving port) while loading wins.
      if (loading !== next) return;
      loading = undefined;
      scene.removeChildren();
      layers = textures.map((frames) => ({ sprite: scene.addChild(new Sprite(frames[0]!)), frames }));
      // The sea is painted over the whole bay, so the ship rides on top of it; the flag flies above all.
      scene.addChild(ship, flag);
      ship.visible = Boolean(next.anchor);
      if (next.anchor) ship.position.set(next.anchor[0], next.anchor[1]);
      shown = next;
      layout();
      view.visible = true;
    },
    /** Starts loading a scene's textures now, so showing it later doesn't flash the previous one. */
    preload(next: HarbourScene) {
      for (const urls of next.layers) for (const u of urls) void Assets.load<Texture>(u);
    },
    get visible() {
      return view.visible;
    },
    update(nowMs: number) {
      if (!shown) return;
      const step = Math.floor(nowMs / SEA_FRAME_MS);
      for (const l of layers) if (l.frames.length > 1) l.sprite.texture = l.frames[step % l.frames.length]!;
      const tex = shipFrame();
      if (tex) ship.texture = tex;
      if (shown.anchor) ship.y = shown.anchor[1] + Math.round(Math.sin(nowMs / 900));
      flag.clear();
      if (!shown.flag) return;
      // The cloth flies from the pole top, each column lifted by a slow wave travelling out to the fly.
      const [fx, fy] = shown.flag;
      for (let x = 0; x < FLAG_W; x++) {
        const lift = Math.round(Math.sin(nowMs / 260 - x * 0.7) * (x / FLAG_W) * 1.5);
        for (let y = 0; y < FLAG_H; y++) flag.rect(fx + 1 + x, fy + y + lift, 1, 1).fill(flagPixel(shown.nation, x, y));
      }
    },
  };
}
