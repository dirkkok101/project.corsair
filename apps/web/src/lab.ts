import type { WindStrength, WorldState } from '@corsair/core';
import { decodeRasterMap, isLand, loadContent, placeSettlements, tileAt } from '@corsair/data';
import type { BattleViewState } from '@corsair/render/battle';
import { createSeaRenderer } from '@corsair/render3d';
import { createWorld } from '@corsair/systems-navigation';

// The ocean lab (dev server: /lab.html): the 3D sea renderer on its own, off a real island, with a stand-in ship
// sailing circles, for judging the water at the three zooms, in battle, at any hour and in any wind. Every
// control is also a URL parameter, and `window.__lab` drives it from scripts (frames at exact times, for diffs):
//   ?zoom=close|sail|region|<tiles>  ?mode=map|battle  ?wind=<from deg>  ?strength=calm|light|fresh|strong|gale
//   ?hour=<0..24>  ?sea=plain,flecks,...  ?at=<x>,<y>  ?chase (from astern)  ?pace=<speed points>
//   ?manual (no animation loop; drive it with __lab.frame)  ?ui=0  ?course=straight (east and back round)

const params = new URLSearchParams(location.search);
const ZOOMS: Record<string, number> = { close: 9, sail: 32, region: 420 };
const content = loadContent();
const def = content.maps.caribbean;
const mapFiles = import.meta.glob<string>('../../../packages/data/content/maps/caribbean/*.png', { eager: true, query: '?url', import: 'default' });
const layer = async (name: string) => {
  const url = Object.entries(mapFiles).find(([path]) => path.endsWith(`/${name}`))?.[1];
  if (!url) throw new Error(`map layer ${name} not found`);
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
};
const map = decodeRasterMap(def, {
  terrain: await layer(def.layers.terrain),
  elevation: await layer(def.layers.elevation),
  zones: await layer(def.layers.zones),
});
const settlements = placeSettlements(def, map, content.settlements);
const world = createWorld(def);
const start = world.ships[def.start.shipId]!;

const lab = {
  zoom: ZOOMS[params.get('zoom') ?? 'sail'] ?? (Number(params.get('zoom')) || 32),
  mode: params.get('mode') === 'battle' ? 'battle' : 'map',
  windFrom: Number(params.get('wind') ?? 70),
  strength: (params.get('strength') ?? 'fresh') as WindStrength,
  hour: Number(params.get('hour') ?? 12),
  /** Knots of the stand-in, as speed points (a brisk pace is about 4.5). */
  pace: Number(params.get('pace') ?? 4.5),
};

/** Open water for the circles: the nearest point to the start whose circle and a margin round it are all sea. */
const RADIUS = 9;
const center = (() => {
  const asked = params.get('at')?.split(',').map(Number);
  if (asked?.length === 2 && asked.every(Number.isFinite)) return { x: asked[0]!, y: asked[1]! };
  const clear = (x: number, y: number) => {
    for (let a = 0; a < 32; a++) {
      for (const r of [0, RADIUS * 0.5, RADIUS, RADIUS + 3]) {
        if (isLand(tileAt(map, x + Math.cos((a / 32) * Math.PI * 2) * r, y + Math.sin((a / 32) * Math.PI * 2) * r))) return false;
      }
    }
    return true;
  };
  for (let ring = 0; ring < 80; ring++) {
    for (let a = 0; a < 16; a++) {
      const x = start.x + Math.cos((a / 16) * Math.PI * 2) * ring;
      const y = start.y + Math.sin((a / 16) * Math.PI * 2) * ring;
      if (clear(x, y)) return { x, y };
    }
  }
  return { x: start.x, y: start.y };
})();

const sea = await createSeaRenderer(content, map, {
  playerId: 'player',
  settlements,
  windAt: () => ({ fromDeg: lab.windFrom, strength: lab.strength }),
  sea: params.get('sea')?.split(',') ?? undefined,
});
document.body.prepend(sea.canvas);
const resize = () => sea.resize(innerWidth, innerHeight);
resize();
addEventListener('resize', resize);
sea.setSkyHour(lab.hour);
if (params.has('chase')) sea.toggleChase();

// The camera starts at 32 tiles; zoom by wheel steps of 1.12 to the asked distance.
let zoomNow = 32;
const zoomTo = (tiles: number) => {
  sea.zoom(Math.log(tiles / zoomNow) / Math.log(1.12));
  zoomNow = tiles;
};
zoomTo(lab.zoom);

/** The scene at a moment: the stand-in sailing her circle (and a second ship on a wider one), or the fight. */
/** How far round her circle each ship has come (radians), advanced frame by frame so she can slow or stop in place. */
const travelled = new Map<string, number>();
let lastMs: number | undefined;
const at = (ms: number) => {
  const dt = lastMs === undefined ? 0 : Math.min(0.1, Math.max(0, (ms - lastMs) / 1000));
  lastMs = ms;
  const speed = lab.pace * content.navigation.tilesPerSecondPerSpeedPoint;
  const straight = params.get('course') === 'straight';
  const ship = (id: string, r: number, phase: number, dir: number, v: number, extra: object = {}) => {
    // The map's ships and the fight's are kept apart by their circles.
    const key = `${id}:${r}`;
    const a = (travelled.get(key) ?? phase) + (dir * v * dt) / r;
    travelled.set(key, a);
    if (straight) {
      // East along a line through the centre, 4r long, then back to its start (a fresh wake).
      const run = ((((a - phase) * r) % (r * 4)) + r * 4) % (r * 4);
      return {
        id,
        classId: 'ship.brig',
        x: center.x - r * 2 + run,
        y: center.y + (phase ? r * 0.6 : 0),
        headingDeg: 90,
        speed: v,
        helm: 0,
        sails: 'full',
        blocked: false,
        cargo: {},
        ...extra,
      };
    }
    return {
      id,
      classId: 'ship.brig',
      x: center.x + Math.sin(a) * r,
      y: center.y - Math.cos(a) * r,
      headingDeg: ((((a * 180) / Math.PI + dir * 90) % 360) + 360) % 360,
      speed: v,
      helm: 0,
      sails: 'full',
      blocked: false,
      cargo: {},
      ...extra,
    };
  };
  return {
    world: {
      tick: 0,
      wind: { fromDeg: lab.windFrom, strength: lab.strength },
      ships: { player: ship('player', RADIUS, 0, 1, speed), merchant: ship('merchant', RADIUS, Math.PI, 1, speed * 0.8, { ai: { nation: 'spain' } }) },
    } as unknown as WorldState,
    battle: (): BattleViewState => {
      const bs = lab.pace * content.combat.battle.tilesPerSecondPerSpeedPoint;
      const p = ship('player', 4, 0, 1, bs);
      const e = ship('enemy', 4, Math.PI, 1, bs);
      return {
        tick: 0,
        wind: { fromDeg: lab.windFrom, strength: lab.strength },
        ships: { player: { ...p, sails: 'full', speed: bs }, enemy: { ...e, sails: 'full', speed: bs } },
        shots: [],
        effects: [],
      } as BattleViewState;
    },
  };
};

const frameTimes: number[] = [];
let lastFrame = 0;
const frame = (ms: number) => {
  const scene = at(ms);
  if (lab.mode === 'battle') sea.renderBattle(scene.battle(), ms, 'spain');
  else sea.render(scene.world, ms);
};

const manual = params.has('manual');
const stats = document.createElement('div');
stats.id = 'stats';
if (!manual) {
  const loop = (ms: number) => {
    if (lastFrame) frameTimes.push(ms - lastFrame);
    if (frameTimes.length > 120) frameTimes.shift();
    lastFrame = ms;
    frame(ms);
    if (frameTimes.length) {
      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      stats.textContent = `${(1000 / avg).toFixed(0)} fps · ${avg.toFixed(1)} ms · ${sea.canvas.width}x${sea.canvas.height}`;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// The controls.
const panel = document.getElementById('panel')!;
if (params.get('ui') === '0') panel.classList.add('hidden');
const row = (label: string, input: HTMLElement) => {
  const l = document.createElement('label');
  l.append(label, input);
  panel.append(l);
};
const buttons = document.createElement('div');
for (const [name, tiles] of Object.entries(ZOOMS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => {
    lab.mode = 'map';
    zoomTo(tiles);
  };
  buttons.append(b, ' ');
}
const battle = document.createElement('button');
battle.textContent = 'battle';
battle.onclick = () => (lab.mode = lab.mode === 'battle' ? 'map' : 'battle');
const chase = document.createElement('button');
chase.textContent = 'astern';
chase.onclick = () => sea.toggleChase();
buttons.append(battle, ' ', chase);
panel.append(buttons);
const slider = (min: number, max: number, step: number, value: number, set: (v: number) => void) => {
  const s = document.createElement('input');
  Object.assign(s, { type: 'range', min, max, step, value });
  s.oninput = () => set(Number(s.value));
  return s;
};
row('wind from', slider(0, 359, 1, lab.windFrom, (v) => (lab.windFrom = v)));
const strengths = document.createElement('select');
for (const k of Object.keys(content.navigation.windStrength)) strengths.add(new Option(k, k, false, k === lab.strength));
strengths.onchange = () => (lab.strength = strengths.value as WindStrength);
row('strength', strengths);
row('hour', slider(0, 24, 0.25, lab.hour, (v) => sea.setSkyHour((lab.hour = v))));
row('pace', slider(0, 7, 0.5, lab.pace, (v) => (lab.pace = v)));
const layers = document.createElement('input');
layers.value = params.get('sea') ?? '';
layers.placeholder = 'plain,flecks,…';
layers.onchange = () => {
  params.set('sea', layers.value);
  if (!layers.value) params.delete('sea');
  location.search = params.toString();
};
row('sea', layers);
panel.append(stats);

declare global {
  interface Window {
    __lab: {
      /** Draws one frame at this time (ms); with ?manual nothing else draws. */
      frame(ms: number): void;
      /** Draws `count` frames from `ms`, waiting for each to finish on the GPU; the mean milliseconds a frame. */
      bench(ms: number, count: number): number;
      zoom(tiles: number): void;
      set(next: Partial<typeof lab>): void;
      center: { x: number; y: number };
    };
  }
}
const gl = sea.canvas.getContext('webgl2')!;
const pixel = new Uint8Array(4);
window.__lab = {
  frame,
  bench(ms, count) {
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      frame(ms + (i * 1000) / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    }
    return (performance.now() - start) / count;
  },
  zoom: zoomTo,
  set(next) {
    Object.assign(lab, next);
    if (next.hour !== undefined) sea.setSkyHour(next.hour);
  },
  center,
};
