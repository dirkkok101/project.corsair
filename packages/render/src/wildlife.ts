import type { Ship } from '@corsair/core';
import { isLand, Tile, tileAt } from '@corsair/data';
import type { TileMap } from '@corsair/data';
import { Container, Graphics, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';

// Sea life is decoration, not simulation: it lives only in the renderer, so its randomness never
// touches the deterministic world state. Each kind is a rare, short event tied to where the ship is,
// and each tells the player something (open ocean, land near, a calm night) as well as looking alive.

/** Sprite metadata from art/generated/wildlife/wildlife.json, keyed by `wildlife.{animal}.{anim}`. */
export type WildlifeDefs = Record<string, { cell: [number, number]; facings: number; frames: number; pivot: [number, number] }>;

export type WildlifeSound = (id: string, opts: { gain: number; pan: number; lowpass?: number; rate?: number }) => void;

export interface WildlifeContext {
  ship: Ship;
  /** Speed as a fraction of the ship's top speed. */
  drive: number;
  hour: number;
  dt: number;
  /** 1 on the coast, 0 beyond the coastal band. */
  coast: number;
  view: { x: number; y: number; w: number; h: number };
}

const between = (a: number, b: number) => a + Math.random() * (b - a);
const facingOf = (deg: number) => ((Math.round((((deg % 360) + 360) % 360) / 45) % 8) + 8) % 8;
const FRAME_S = 0.12;

interface Actor {
  sprite: Sprite;
  update(dt: number): boolean; // false when finished
}

/** White water: droplets thrown up and falling back, plus a brief dotted ring. Procedural VFX. */
function splash(g: Graphics, x: number, y: number, size: number) {
  const drops = Array.from({ length: 4 + size * 4 }, () => ({
    x,
    y,
    vx: between(-1, 1) * (12 + size * 10),
    vy: -between(20, 40 + size * 25),
  }));
  let age = 0;
  return (dt: number) => {
    age += dt;
    for (const d of drops) {
      d.vy += 140 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y < y) g.rect(Math.round(d.x), Math.round(d.y), 1, 1);
    }
    // A widening ring of foam on the surface, drawn as dotted pixels.
    const r = 2 + age * (14 + size * 10);
    const dots = 10 + size * 4;
    for (let i = 0; i < dots && age < 0.6; i++) {
      const a = (i / dots) * Math.PI * 2;
      g.rect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * 0.5), 1, 1);
    }
    return age < 0.9;
  };
}

/** A whale's blow: a column of white puffs rising and drifting apart. */
function spout(g: Graphics, x: number, y: number) {
  const puffs = Array.from({ length: 18 }, () => ({ x, y, vx: between(-6, 6), vy: -between(30, 55), life: between(0.7, 1.2) }));
  let age = 0;
  return (dt: number) => {
    age += dt;
    for (const p of puffs) {
      if (age > p.life) continue;
      p.vy *= 0.97;
      p.vx *= 1.02;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      g.rect(Math.round(p.x), Math.round(p.y), age < 0.4 ? 2 : 1, age < 0.4 ? 2 : 1);
    }
    return age < 1.3;
  };
}

export function createWildlife(map: TileMap, frames: Record<string, Texture[]>, defs: WildlifeDefs, sound: WildlifeSound) {
  const ts = map.tileSize;
  /** In the water: drawn under the ships. */
  const water = new Container();
  const vfx = new Graphics();
  water.addChild(vfx);
  /** In the air: drawn above the ships and clouds. */
  const air = new Container();
  const actors: Actor[] = [];
  let effects: ((dt: number) => boolean)[] = [];
  const timers = { dolphins: between(20, 40), flyingFish: between(6, 12), whale: between(45, 90), pelicans: between(10, 20), frigate: between(15, 30), fishJump: between(3, 7) };
  let view = { x: 0, y: 0, w: 960, h: 540 };

  const has = (id: string) => Boolean(frames[`${id}.d0`]?.length && defs[id]);
  const texture = (id: string, facing: number, frame: number) => {
    const list = frames[`${id}.d${facing}`];
    return list?.[Math.min(frame, list.length - 1)];
  };
  const makeSprite = (id: string, parent: Container) => {
    const def = defs[id]!;
    const sprite = new Sprite(texture(id, 0, 0)!);
    sprite.anchor.set(def.pivot[0], def.pivot[1]);
    parent.addChild(sprite);
    return sprite;
  };
  const panOf = (x: number) => Math.max(-1, Math.min(1, (x - (view.x + view.w / 2)) / (view.w / 2)));
  const isWater = (x: number, y: number) => !isLand(tileAt(map, x / ts, y / ts));
  const isDeep = (x: number, y: number) => tileAt(map, x / ts, y / ts) === Tile.Deep;

  /** A pod riding the bow wave, surfacing and leaping, then dropping astern. */
  const dolphins = (ship: Ship) => {
    const count = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const offset = { across: side * between(34, 60), along: between(10, 60) };
      const sprite = makeSprite('wildlife.dolphin.swim', water);
      let state: 'swim' | 'leap' = 'swim';
      let t = 0;
      let nextLeap = between(0.6, 2.2);
      let life = between(10, 14);
      let behind = 0;
      actors.push({
        sprite,
        update(dt) {
          life -= dt;
          t += dt;
          // Once their time is up they drop back astern and are gone.
          if (life < 0) behind += 60 * dt;
          const rad = (ship.headingDeg * Math.PI) / 180;
          const hx = Math.sin(rad);
          const hy = -Math.cos(rad);
          const along = offset.along - behind;
          const wobble = Math.sin(t * 1.7 + i) * 4;
          const x = ship.x * ts + hx * along - hy * (offset.across + wobble);
          const y = ship.y * ts + (hy * along + hx * (offset.across + wobble)) * Math.SQRT1_2;
          const facing = facingOf(ship.headingDeg);
          if (state === 'swim' && t > nextLeap) {
            state = 'leap';
            t = 0;
          }
          if (state === 'leap') {
            const frame = Math.floor(t / FRAME_S);
            sprite.texture = texture('wildlife.dolphin.leap', facing, frame)!;
            if (frame >= (defs['wildlife.dolphin.leap']?.frames ?? 4)) {
              effects.push(splash(vfx, x, y, 1));
              sound('splash_big', { gain: 0.25, pan: panOf(x), rate: between(1.1, 1.3) });
              if (Math.random() < 0.35) sound('dolphin', { gain: 0.3, pan: panOf(x), lowpass: 4000 });
              state = 'swim';
              t = 0;
              nextLeap = between(1.2, 3.5);
            }
          } else {
            sprite.texture = texture('wildlife.dolphin.swim', facing, Math.floor(t / 0.35) % 2)!;
          }
          sprite.position.set(Math.round(x), Math.round(y));
          return behind < 220 && isWater(x, y);
        },
      });
    }
    sound('dolphin', { gain: 0.35, pan: 0, lowpass: 4000 });
  };

  /** A shoal bursting away from the bow, gliding a moment and dropping back in. */
  const flyingFish = (ship: Ship) => {
    const count = 4 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const dir = ship.headingDeg + between(-70, 70);
      const rad = (dir * Math.PI) / 180;
      const start = between(40, 100);
      const sr = (ship.headingDeg * Math.PI) / 180;
      let x = ship.x * ts + Math.sin(sr) * start + between(-20, 20);
      let y = ship.y * ts - Math.cos(sr) * start * Math.SQRT1_2 + between(-10, 10);
      const speed = between(110, 170);
      let life = between(0.6, 1.2);
      let t = 0;
      const sprite = makeSprite('wildlife.flying_fish.glide', water);
      actors.push({
        sprite,
        update(dt) {
          t += dt;
          life -= dt;
          x += Math.sin(rad) * speed * dt;
          y -= Math.cos(rad) * speed * dt * Math.SQRT1_2;
          sprite.texture = texture('wildlife.flying_fish.glide', facingOf(dir), Math.floor(t / 0.08) % 2)!;
          sprite.position.set(Math.round(x), Math.round(y));
          if (life <= 0 || !isWater(x, y)) {
            effects.push(splash(vfx, x, y, 0));
            return false;
          }
          return true;
        },
      });
    }
    sound('splash_small', { gain: 0.15, pan: 0, rate: 1.4 });
  };

  /** Far off: a blow, the back rolling, then the flukes. The ship sails past it. */
  const whale = (ship: Ship) => {
    const angle = Math.random() * Math.PI * 2;
    const dist = between(260, 380);
    const x = ship.x * ts + Math.cos(angle) * dist;
    const y = ship.y * ts + Math.sin(angle) * dist * Math.SQRT1_2;
    if (!isDeep(x, y)) return;
    const facing = Math.floor(Math.random() * 8);
    const sprite = makeSprite('wildlife.whale.surface', water);
    let t = 0;
    effects.push(spout(vfx, x, y - 4));
    sound('whale_blow', { gain: 0.25, pan: panOf(x), lowpass: 1500 });
    actors.push({
      sprite,
      update(dt) {
        t += dt;
        if (t < 2.4) sprite.texture = texture('wildlife.whale.surface', facing, Math.floor(t / 0.6) % 2)!;
        else if (t < 2.4 + 3 * 0.4) sprite.texture = texture('wildlife.whale.fluke', facing, Math.floor((t - 2.4) / 0.4))!;
        else {
          effects.push(splash(vfx, x, y, 2));
          return false;
        }
        sprite.position.set(Math.round(x), Math.round(y));
        return true;
      },
    });
  };

  /** Pelicans beat along the coast; now and then one folds and plunges for a fish. */
  const pelicans = () => {
    const count = 1 + Math.floor(Math.random() * 3);
    const dir = Math.random() * 360;
    const rad = (dir * Math.PI) / 180;
    // Enter from the edge of the view the birds are flying away from.
    let x = view.x + view.w / 2 - Math.sin(rad) * view.w * 0.55;
    let y = view.y + view.h / 2 + Math.cos(rad) * view.h * 0.55;
    for (let i = 0; i < count; i++) {
      let px = x - Math.sin(rad) * i * 22 + i * 10;
      let py = y + Math.cos(rad) * i * 22;
      const sprite = makeSprite('wildlife.pelican.fly', air);
      let t = Math.random();
      let diveAt = Math.random() < 0.6 ? between(1.5, 5) : Infinity;
      let diving = 0;
      actors.push({
        sprite,
        update(dt) {
          t += dt;
          if (t > diveAt && isWater(px, py + 30)) {
            diving += dt;
            sprite.texture = texture('wildlife.pelican.dive', facingOf(dir), diving < 0.2 ? 0 : 1)!;
            py += 80 * dt;
            if (diving > 0.4) {
              effects.push(splash(vfx, px, py, 1));
              sound('splash_big', { gain: 0.3, pan: panOf(px) });
              return false;
            }
          } else {
            px += Math.sin(rad) * 70 * dt;
            py -= Math.cos(rad) * 70 * dt * Math.SQRT1_2;
            sprite.texture = texture('wildlife.pelican.fly', facingOf(dir), Math.floor(t / 0.3) % 2)!;
          }
          sprite.position.set(Math.round(px), Math.round(py));
          const inView = px > view.x - 80 && px < view.x + view.w + 80 && py > view.y - 80 && py < view.y + view.h + 80;
          return inView || t < 2;
        },
      });
    }
    x = 0;
    y = 0;
  };

  /** A frigatebird circling high overhead, drifting with the air. */
  const frigate = () => {
    const sprite = makeSprite('wildlife.frigatebird.soar', air);
    const cx = view.x + between(0.2, 0.8) * view.w;
    const cy = view.y + between(0.2, 0.8) * view.h;
    const r = between(60, 120);
    let t = 0;
    const life = between(14, 24);
    actors.push({
      sprite,
      update(dt) {
        t += dt;
        const a = t * 0.35;
        const x = cx + Math.cos(a) * r + t * 6;
        const y = cy + Math.sin(a) * r * 0.6;
        // Heading is the tangent of the circle.
        const heading = (Math.atan2(-Math.sin(a), -Math.cos(a) * 0.6) * 180) / Math.PI + 90;
        sprite.texture = texture('wildlife.frigatebird.soar', facingOf(heading), Math.floor(t / 0.9) % 2)!;
        sprite.position.set(Math.round(x), Math.round(y));
        return t < life;
      },
    });
  };

  return {
    water,
    air,
    update(c: WildlifeContext) {
      view = c.view;
      const { ship } = c;
      const px = ship.x * ts;
      const py = ship.y * ts;
      const day = c.hour >= 6 && c.hour < 19;
      const openSea = c.coast < 0.3 && isDeep(px, py);
      for (const k of Object.keys(timers) as (keyof typeof timers)[]) timers[k] -= c.dt;

      if (timers.dolphins <= 0) {
        if (openSea && c.drive > 0.45 && has('wildlife.dolphin.swim') && has('wildlife.dolphin.leap')) dolphins(ship);
        timers.dolphins = between(35, 80);
      }
      if (timers.flyingFish <= 0) {
        if (openSea && day && c.drive > 0.3 && has('wildlife.flying_fish.glide')) flyingFish(ship);
        timers.flyingFish = between(10, 25);
      }
      if (timers.whale <= 0) {
        if (openSea && c.coast < 0.05 && has('wildlife.whale.surface') && has('wildlife.whale.fluke')) whale(ship);
        timers.whale = between(90, 180);
      }
      if (timers.pelicans <= 0) {
        if (day && c.coast > 0.3 && has('wildlife.pelican.fly') && has('wildlife.pelican.dive')) pelicans();
        timers.pelicans = between(20, 40);
      }
      if (timers.frigate <= 0) {
        if (day && c.coast > 0.1 && has('wildlife.frigatebird.soar')) frigate();
        timers.frigate = between(25, 45);
      }
      if (timers.fishJump <= 0) {
        // A fish breaks the surface somewhere near: a plop and a ring. No sprite needed.
        const x = px + between(-150, 150);
        const y = py + between(-90, 90);
        if (isWater(x, y)) {
          effects.push(splash(vfx, x, y, 0));
          sound('splash_small', { gain: 0.18, pan: panOf(x), rate: between(0.9, 1.3) });
        }
        timers.fishJump = between(4, 10);
      }

      for (let i = actors.length - 1; i >= 0; i--) {
        if (!actors[i]!.update(c.dt)) {
          actors[i]!.sprite.destroy();
          actors.splice(i, 1);
        }
      }
      vfx.clear();
      effects = effects.filter((step) => step(c.dt));
      vfx.fill(0xebede9);
    },
  };
}
