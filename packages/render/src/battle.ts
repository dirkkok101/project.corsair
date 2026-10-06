import type { ContentPack, TileMap } from '@corsair/data';
import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { Texture as PixiTexture } from 'pixi.js';
import type { Wind } from '@corsair/core';
import { createPennants } from './effects';
import { facingIndex } from './facing';
import type { FlagNation } from './flags';
import { paintDeepWater, paintTerrainChunk } from './water';

// The sea battle view (scenes doc S3): the local map at battle scale, the two ships from their
// 192 px combat sets, balls in flight, and smoke, splashes and splinters drawn as a few pixels, like
// the wake and spray on the world map. Structural types keep the renderer free of the battle module.

export interface BattleViewShip {
  x: number;
  y: number;
  headingDeg: number;
  classId: string;
  sails: 'full' | 'half' | 'furled';
}
export interface BattleViewState {
  tick: number;
  wind: Wind;
  ships: { player: BattleViewShip; enemy: BattleViewShip };
  shots: { x: number; y: number; tx: number; ty: number; t: number; flight: number }[];
  effects: { kind: 'smoke' | 'splash' | 'hit' | 'sail'; x: number; y: number; at: number }[];
}

const EFFECT_SECONDS = 0.6;
// Palette colours, so the day/night filter maps them with the rest.
const SMOKE = 0xc7cfcc;
const SPLASH = 0xebede9;
const SPLINTER = 0xde9e41;
const CANVAS = 0xe7d5b3;
const BALL = 0x090a14;

export function createBattleView(
  content: ContentPack,
  frames: Record<string, PixiTexture[]>,
  mastTops: Record<string, Record<string, [number, number][]>> = {},
) {
  const view = new Container();
  view.visible = false;
  const water = new TilingSprite({ texture: Texture.from(paintDeepWater()), width: 1, height: 1 });
  const world = new Container();
  const terrain = new Sprite();
  const sprites = { player: new Sprite(), enemy: new Sprite() };
  const fx = new Graphics();
  // Colours at the masthead at battle scale: 192 px cells over the same 3.7-unit framing.
  const pennants = createPennants(192 / 3.7, [12, 8]);
  view.addChild(water, world);
  world.addChild(terrain, sprites.enemy, sprites.player, pennants.view, fx);
  let painted: TileMap | undefined;

  const place = (sprite: Sprite, ship: BattleViewShip, ts: number) => {
    const spriteId = content.ships[ship.classId]!.sprites.combat ?? content.ships[ship.classId]!.sprites.world;
    const def = content.sprites[spriteId]!;
    const anim = def.anims.includes(`sail_${ship.sails}`) ? `sail_${ship.sails}` : def.anims[0]!;
    sprite.texture = frames[`${spriteId}.${anim}`]?.[facingIndex(ship.headingDeg, def.facings)] ?? Texture.EMPTY;
    sprite.anchor.set(def.pivot.x, def.pivot.y);
    sprite.position.set(Math.round(ship.x * ts), Math.round(ship.y * ts));
  };

  return {
    view,
    get visible() {
      return view.visible;
    },
    hide() {
      view.visible = false;
    },
    update(state: BattleViewState, map: TileMap, viewW: number, viewH: number, nowMs: number, enemyFlag?: FlagNation) {
      const ts = map.tileSize;
      if (painted !== map) {
        // The battle map is painted once, whole: it is a screen or two across.
        const canvas = paintTerrainChunk(map, 0, 0, Math.max(map.width, map.height));
        terrain.texture = canvas ? Texture.from(canvas) : Texture.EMPTY;
        painted = map;
      }
      view.visible = true;
      water.width = viewW;
      water.height = viewH;
      // The camera follows the player's ship, clamped to the battle map.
      const p = state.ships.player;
      const cx = Math.max(0, Math.min(map.width * ts - viewW, Math.round(p.x * ts - viewW / 2)));
      const cy = Math.max(0, Math.min(map.height * ts - viewH, Math.round(p.y * ts - viewH / 2)));
      world.position.set(-cx, -cy);
      water.tilePosition.set(-cx + Math.round(nowMs / 400), -cy);
      place(sprites.enemy, state.ships.enemy, ts);
      place(sprites.player, state.ships.player, ts);
      const mastOf = (s: BattleViewShip) => content.sprites[content.ships[s.classId]!.sprites.combat ?? '']?.mast;
      const topOf = (s: BattleViewShip) => {
        const id = content.ships[s.classId]!.sprites.combat ?? '';
        const def = content.sprites[id];
        return def ? mastTops[id]?.[`sail_${s.sails}`]?.[facingIndex(s.headingDeg, def.facings)] : undefined;
      };
      pennants.update(
        (['player', 'enemy'] as const).map((side) => {
          const s = state.ships[side];
          return {
            ship: { ...s, id: side, speed: 0, helm: 0, blocked: false, cargo: {} },
            wind: state.wind,
            x: Math.round(s.x * ts),
            y: Math.round(s.y * ts),
            mast: mastOf(s),
            top: topOf(s),
            colour: 0xcf573c,
            flag: side === 'enemy' ? enemyFlag : undefined,
          };
        }),
        nowMs / 1000,
      );

      fx.clear();
      const now = state.tick / 30;
      for (const e of state.effects) {
        const age = (now - e.at) / EFFECT_SECONDS;
        if (age < 0 || age > 1) continue;
        const x = Math.round(e.x * ts);
        const y = Math.round(e.y * ts);
        if (e.kind === 'smoke') {
          // A puff that swells and thins.
          const r = Math.round(6 + age * 18);
          for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2 + e.at;
            fx.rect(x + Math.round(Math.cos(a) * r * (0.5 + (k % 3) * 0.25)), y + Math.round(Math.sin(a) * r * 0.6), 3, 3);
          }
          fx.fill({ color: SMOKE, alpha: 1 - age });
        } else {
          const colour = e.kind === 'splash' ? SPLASH : e.kind === 'hit' ? SPLINTER : CANVAS;
          const r = Math.round(2 + age * 8);
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            fx.rect(x + Math.round(Math.cos(a) * r), y + Math.round(Math.sin(a) * r) - (e.kind === 'splash' ? Math.round(age * 6) : 0), 2, 2);
          }
          fx.fill({ color: colour, alpha: 1 - age });
        }
      }
      for (const s of state.shots) {
        const k = 1 - s.t / s.flight;
        fx.rect(Math.round((s.x + (s.tx - s.x) * k) * ts) - 1, Math.round((s.y + (s.ty - s.y) * k) * ts) - 1, 3, 3);
      }
      if (state.shots.length) fx.fill(BALL);
    },
  };
}
