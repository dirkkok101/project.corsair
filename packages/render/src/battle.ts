import type { ContentPack, TileMap } from '@corsair/data';
import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { Texture as PixiTexture } from 'pixi.js';
import type { Wind } from '@corsair/core';
import { createPennants, createWindStreaks } from './effects';
import { facingIndex } from './facing';
import { sailAnim } from './sails';
import type { FlagNation } from './flags';
import { paintDeepWater, paintTerrainChunk } from './water';

// The sea battle view (scenes doc S3): the world map at battle scale around the fight, the two ships
// from their 192 px combat sets, balls in flight, and smoke, splashes and splinters drawn as a few pixels, like
// the wake and spray on the world map. Structural types keep the renderer free of the battle module.

export interface BattleViewShip {
  x: number;
  y: number;
  headingDeg: number;
  classId: string;
  sails: 'full' | 'half' | 'furled';
  /** Her state, drawn: sails shot to rags show as less canvas set, a hurt hull smokes and then burns. */
  sailCondition?: number;
  hull?: number;
  hullMax?: number;
}
export interface BattleViewState {
  tick: number;
  wind: Wind;
  ships: { player: BattleViewShip; enemy: BattleViewShip };
  shots: { x: number; y: number; tx: number; ty: number; t: number; flight: number; ammo?: 'round' | 'chain' | 'grape' }[];
  effects: { kind: 'smoke' | 'splash' | 'hit' | 'sail' | 'grape'; x: number; y: number; at: number }[];
  /** The player's firing arcs: degrees either side of each beam, reach in tiles for the shot loaded, and
   * whether each broadside can fire now (as the battle's aim reports it). */
  arcs?: { arcDeg: number; rangeTiles: number; port: string; starboard: string };
  /** She has gone down: barrels and men in the water where she sank. */
  wreck?: { barrels: { x: number; y: number }[]; survivors: { x: number; y: number; men: number }[] };
}

const EFFECT_SECONDS = 0.6;
// Terrain is painted in chunks as the camera reaches them. Small chunks, since a tile here is 48 px:
// painting one is quick enough to do in a frame, and at most one off-screen chunk is painted per frame.
const CHUNK_TILES = 12;
const PREFETCH_PX = 192;
const MAX_CHUNKS = 48;
// Palette colours, so the day/night filter maps them with the rest.
const SMOKE = 0xc7cfcc;
const SPLASH = 0xebede9;
const SPLINTER = 0xde9e41;
const CANVAS = 0xe7d5b3;
const BALL = 0x090a14;
const GOLD = 0xe8c170;
const PALE = 0xebede9;
const BARREL = 0x884b2b;
const FIRE = 0xda863e;
const FLAME = 0xe8c170;
const DARK_SMOKE = 0x577277;
const HOOP = 0x4d2b32;

export function createBattleView(
  content: ContentPack,
  frames: Record<string, PixiTexture[]>,
  mastTops: Record<string, Record<string, [number, number][]>> = {},
) {
  const view = new Container();
  view.visible = false;
  const water = new TilingSprite({ texture: Texture.from(paintDeepWater()), width: 1, height: 1 });
  const world = new Container();
  const terrain = new Container();
  const sprites = { player: new Sprite(), enemy: new Sprite() };
  const fx = new Graphics();
  const arcs = new Graphics();
  // The world's ship sprites at the world's zoom, or the 192 px combat set close up (combat.json battle.sprites).
  const combatSet = content.combat.battle.sprites === 'combat';
  // Colours at the masthead: the cell size over the same 3.7-unit framing.
  const pennants = combatSet ? createPennants(192 / 3.7, [12, 8]) : createPennants();
  view.addChild(water, world);
  world.addChild(terrain, arcs, sprites.enemy, sprites.player, pennants.view, fx);
  // Chunks stay cached between fights over the same world; insertion order doubles as LRU order.
  let painted: Uint8Array | undefined;
  const chunks = new Map<string, Sprite | null>();
  const ensureChunks = (map: TileMap, viewX: number, viewY: number, viewW: number, viewH: number) => {
    if (painted !== map.tiles) {
      for (const chunk of chunks.values()) chunk?.destroy({ texture: true, textureSource: true });
      chunks.clear();
      painted = map.tiles;
    }
    const chunkPx = CHUNK_TILES * map.tileSize;
    let prefetchBudget = 1;
    for (let cy = Math.floor((viewY - PREFETCH_PX) / chunkPx); cy <= Math.floor((viewY + viewH + PREFETCH_PX) / chunkPx); cy++) {
      for (let cx = Math.floor((viewX - PREFETCH_PX) / chunkPx); cx <= Math.floor((viewX + viewW + PREFETCH_PX) / chunkPx); cx++) {
        const key = `${cx},${cy}`;
        let chunk = chunks.get(key);
        if (chunk === undefined) {
          const visible = cx * chunkPx < viewX + viewW && (cx + 1) * chunkPx > viewX && cy * chunkPx < viewY + viewH && (cy + 1) * chunkPx > viewY;
          if (!visible && prefetchBudget-- <= 0) continue;
          const canvas = paintTerrainChunk(map, cx * CHUNK_TILES, cy * CHUNK_TILES, CHUNK_TILES);
          chunk = canvas ? new Sprite(Texture.from(canvas)) : null;
          chunk?.position.set(cx * chunkPx, cy * chunkPx);
          if (chunk) terrain.addChild(chunk);
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

  // Wind streaks on the battle water, as on the sea (made for the battle map when it is first drawn).
  let streaks: ReturnType<typeof createWindStreaks> | undefined;
  let streaksMap: TileMap | undefined;
  let lastMs: number | undefined;
  /** The canvas she shows: what's set, less what shot has torn away (rags at half, bare poles below a quarter). */
  const shown = (ship: BattleViewShip): BattleViewShip => {
    const c = ship.sailCondition ?? 100;
    const sails = c < 25 ? 'furled' : c < 55 && ship.sails === 'full' ? 'half' : ship.sails;
    return sails === ship.sails ? ship : { ...ship, sails };
  };
  /** A ship's sprite, frame and mast tip in the set the battle draws. */
  const look = (ship: BattleViewShip, wind: Wind, nowMs: number) => {
    const sprites = content.ships[ship.classId]!.sprites;
    const spriteId = (combatSet ? sprites.combat : undefined) ?? sprites.world;
    const def = content.sprites[spriteId]!;
    const anim = combatSet ? (def.anims.includes(`sail_${ship.sails}`) ? `sail_${ship.sails}` : def.anims[0]!) : sailAnim(content, ship, wind, nowMs);
    const facing = facingIndex(ship.headingDeg, def.facings);
    return { spriteId, def, anim, facing, top: mastTops[spriteId]?.[anim]?.[facing] };
  };
  const place = (sprite: Sprite, ship: BattleViewShip, wind: Wind, nowMs: number, ts: number) => {
    const { spriteId, def, anim, facing } = look(ship, wind, nowMs);
    sprite.texture = frames[`${spriteId}.${anim}`]?.[facing] ?? Texture.EMPTY;
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
      view.visible = true;
      water.width = viewW;
      water.height = viewH;
      // The camera keeps the player's ship at the centre: the sea runs on in every direction.
      const p = state.ships.player;
      const cx = Math.round(p.x * ts - viewW / 2);
      const cy = Math.round(p.y * ts - viewH / 2);
      ensureChunks(map, cx, cy, viewW, viewH);
      world.position.set(-cx, -cy);
      water.tilePosition.set(-cx + Math.round(nowMs / 400), -cy);
      if (streaksMap !== map) {
        if (streaks) streaks.view.destroy();
        streaks = createWindStreaks(map);
        streaksMap = map;
        world.addChildAt(streaks.view, world.getChildIndex(terrain) + 1);
      }
      streaks!.update(state.wind, Math.min(0.1, (nowMs - (lastMs ?? nowMs)) / 1000), { x: cx, y: cy, w: viewW, h: viewH });
      lastMs = nowMs;
      place(sprites.enemy, shown(state.ships.enemy), state.wind, nowMs, ts);
      // Sunk: her sprite and colours are gone, and the wreckage floats where she went down.
      sprites.enemy.visible = !state.wreck;
      place(sprites.player, shown(state.ships.player), state.wind, nowMs, ts);
      pennants.update(
        (state.wreck ? (['player'] as const) : (['player', 'enemy'] as const)).map((side) => {
          const s = shown(state.ships[side]);
          return {
            ship: { ...s, id: side, speed: 0, helm: 0, blocked: false, cargo: {} },
            wind: state.wind,
            x: Math.round(s.x * ts),
            y: Math.round(s.y * ts),
            mast: look(s, state.wind, nowMs).def.mast,
            top: look(s, state.wind, nowMs).top,
            colour: 0xcf573c,
            flag: side === 'enemy' ? enemyFlag : undefined,
          };
        }),
        nowMs / 1000,
      );

      // Firing arcs on the water, so the player steers to put her inside one: gold when that broadside
      // can fire, a gold edge when she bears but is out of reach, faint otherwise.
      arcs.clear();
      if (state.arcs) {
        const r = state.arcs.rangeTiles * ts;
        for (const side of ['port', 'starboard'] as const) {
          const aim = state.arcs[side];
          const beam = p.headingDeg + (side === 'starboard' ? 90 : -90);
          // Compass degrees (clockwise from north) to the canvas's radians (clockwise from east).
          const from = ((beam - state.arcs.arcDeg - 90) * Math.PI) / 180;
          const to = ((beam + state.arcs.arcDeg - 90) * Math.PI) / 180;
          arcs.moveTo(p.x * ts, p.y * ts).arc(p.x * ts, p.y * ts, r, from, to).closePath();
          if (aim === 'ready') arcs.fill({ color: GOLD, alpha: 0.22 }).stroke({ width: 1, color: GOLD, alpha: 0.8 });
          else if (aim === 'out-of-range') arcs.fill({ color: PALE, alpha: 0.06 }).stroke({ width: 1, color: GOLD, alpha: 0.6 });
          else arcs.fill({ color: PALE, alpha: aim === 'loading' ? 0.03 : 0.07 }).stroke({ width: 1, color: PALE, alpha: 0.15 });
        }
      }

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
        } else if (e.kind === 'grape') {
          // Small shot: a scatter of little strikes across her deck rather than one burst.
          for (let k = 0; k < 9; k++) {
            const a = k * 2.39 + e.at * 7;
            const r = 2 + (k % 4) * 3 + age * 4;
            fx.rect(x + Math.round(Math.cos(a) * r), y + Math.round(Math.sin(a) * r * 0.7), 1, 1);
          }
          fx.fill({ color: PALE, alpha: 1 - age });
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
      // Shot in flight, by what's loaded: a round ball; chain, two balls spinning on their chain; grape, a
      // loose cluster of small shot.
      for (const s of state.shots) {
        const k = 1 - s.t / s.flight;
        const px = Math.round((s.x + (s.tx - s.x) * k) * ts);
        const py = Math.round((s.y + (s.ty - s.y) * k) * ts);
        if (s.ammo === 'chain') {
          const spin = nowMs / 60 + s.flight * 10;
          const dx = Math.round(Math.cos(spin) * 4);
          const dy = Math.round(Math.sin(spin) * 4);
          fx.rect(px + dx - 1, py + dy - 1, 3, 3).rect(px - dx - 1, py - dy - 1, 3, 3);
          fx.moveTo(px + dx, py + dy).lineTo(px - dx, py - dy).stroke({ width: 1, color: BALL });
        } else if (s.ammo === 'grape') {
          for (let j = 0; j < 5; j++) fx.rect(px + Math.round(Math.cos(j * 1.3 + s.flight) * 3), py + Math.round(Math.sin(j * 1.9 + s.flight) * 3), 2, 2);
        } else fx.rect(px - 1, py - 1, 3, 3);
      }
      if (state.shots.length) fx.fill(BALL);
      // A hurt ship smokes from her hull, and below a quarter of it she is afire.
      for (const side of ['player', 'enemy'] as const) {
        const s = state.ships[side];
        if (state.wreck && side === 'enemy') continue;
        const share = s.hull !== undefined && s.hullMax ? s.hull / s.hullMax : 1;
        if (share >= 0.5) continue;
        const x = Math.round(s.x * ts);
        const y = Math.round(s.y * ts);
        // A column of puffs rising and swelling from her deck, drifting a little downwind.
        const puffs = share < 0.25 ? 16 : 10;
        const [wx, wy] = [Math.sin((state.wind.fromDeg * Math.PI) / 180), -Math.cos((state.wind.fromDeg * Math.PI) / 180)];
        for (let k = 0; k < puffs; k++) {
          const life = ((nowMs / 1000 + k * 0.29) % 2.4) / 2.4;
          const size = 3 + Math.round(life * 5);
          const px = x - 6 + ((k * 7) % 13) - Math.round(wx * life * 18);
          const py = y - 8 - Math.round(life * 30) - Math.round(wy * life * 18);
          // Dark where it leaves the hull, pale as it climbs, so it shows against the sea.
          fx.rect(px, py, size, size).fill({ color: life < 0.3 ? DARK_SMOKE : SMOKE, alpha: 0.9 * (1 - life * 0.5) });
        }
        if (share < 0.25) {
          for (let k = 0; k < 8; k++) {
            const flick = Math.abs(Math.sin(nowMs / 90 + k * 1.7));
            fx.rect(x - 8 + k * 2, y - 4 - Math.round(flick * 7), 3, 3 + Math.round(flick * 3));
          }
          fx.fill(FIRE);
          fx.rect(x - 2, y - 7, 3, 4).rect(x + 3, y - 5, 2, 3).fill(FLAME);
        }
      }
      if (state.wreck) {
        // Barrels bob as small staved squares; the men in the water are heads among a little white water.
        const bob = (x: number) => Math.round(Math.sin(nowMs / 500 + x) * 1.5);
        for (const b of state.wreck.barrels) {
          const x = Math.round(b.x * ts);
          const y = Math.round(b.y * ts) + bob(b.x);
          fx.rect(x - 4, y - 3, 8, 6).fill(BARREL);
          fx.rect(x - 4, y - 1, 8, 1).fill(HOOP);
        }
        for (const g of state.wreck.survivors) {
          const x = Math.round(g.x * ts);
          const y = Math.round(g.y * ts);
          for (let k = 0; k < Math.min(6, g.men); k++) {
            const a = k * 2.4;
            const hx = x + Math.round(Math.cos(a) * (3 + k));
            const hy = y + Math.round(Math.sin(a) * (2 + k)) + bob(g.x + k);
            fx.rect(hx - 2, hy, 5, 2).fill({ color: SPLASH, alpha: 0.8 });
            fx.rect(hx - 1, hy - 2, 3, 3).fill(SPLINTER);
          }
        }
      }
    },
  };
}
