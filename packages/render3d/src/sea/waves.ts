import * as THREE from 'three';

// Water that ships push: a dynamic wave simulation round the camera's target (after Crest's dynamic waves and
// Evan Wallace's WebGL Water). A grid of water heights is stepped with the wave equation on the GPU each frame.
// Every ship near the camera raises a hump under her bow and draws a hollow under her stern, as hard as she is
// going, so the bow waves and the V of her wake come out of the water itself, and run into other ships and
// each other. Cannonballs falling in the sea throw rings out.
//
// The grid follows the target in whole cells (so the waves stay where they are in the water as it moves), lets
// waves out at its edges without them bouncing back, and damps them, so every disturbance dies away within a few
// seconds and nothing builds into a standing pattern.
//
// It also carries the foam (after Sea of Thieves' and Crest's foam buffers): the white water a hull churns at
// her waterline, bow and stern, and crests of the water she pushes where they break, injected each step, then
// spreading and fading where it was left. Two channels: all the foam, and how fresh it is (fresh foam is white
// and finely broken; old foam thins to lace and is gone after some seconds).

/** Cells a side, and a cell's size in tiles: 32 tiles round the target, fine enough for a ship's own ripples. */
export const WAVE_GRID = 256;
export const WAVE_CELL = 0.125;
/** The waves' speed, tiles a second: slower than a ship under way, so she outruns her own and leaves a V. */
const WAVE_SPEED = 0.9;
/** The simulation's step (seconds) and the most steps a frame. */
const STEP = 1 / 45;
const MAX_STEPS = 4;
/** What a wave keeps of itself each step (it dies away over a few seconds). */
const DAMPING = 0.996;
/**
 * The hump a ship holds up under her bow (and the hollow under her stern), tiles high at a brisk pace and
 * above: the hull holds the water to that shape, and the shape, moving, throws off the waves.
 */
const HUMP = 0.06;
/** Her speed at which the hump is full height, tiles a second. */
const BRISK_SPEED = 2.6;
/** How firmly the hull holds the water to its shape each step (0..1). */
const HOLD = 0.35;
/**
 * Foam: what of it is kept each step (all of it fades over several seconds; its freshness within a second or
 * so), how far it spreads each step, and how much a hull churns at full pace each second.
 */
const FOAM_KEEP = 0.995;
const FRESH_KEEP = 0.975;
const FOAM_SPREAD = 0.1;
const FOAM_CHURN = 2.6;
const MAX_SHIPS = 8;
const MAX_SPLASHES = 16;

export interface WaveShip {
  x: number;
  z: number;
  headingDeg: number;
  /** Tiles a second. */
  speed: number;
  /** Her drawn length, tiles. */
  length: number;
}

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const STEP_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uState;      // R the height now, G the height a step ago, B foam, A how fresh the foam is
uniform vec2 uShift;           // cells the grid moved since the last step
uniform float uCourant2;       // (speed * step / cell)^2
uniform float uDamping;
uniform float uAdvance;   // 0: only follow the grid's move this pass, no time passes
uniform vec4 uShips[${MAX_SHIPS}];   // her middle (cells), heading (radians), the hump's height (tiles)
uniform vec2 uHulls[${MAX_SHIPS}];   // her half-length and half-beam (cells)
uniform int uShipCount;
uniform vec4 uSplashes[${MAX_SPLASHES}];   // where (cells), radius (cells), how hard (tiles)
uniform int uSplashCount;
varying vec2 vUv;

const float N = ${WAVE_GRID.toFixed(1)};

// The grid as it was, at a cell of the grid as it is now; still water beyond its edges.
vec4 was(vec2 cell) {
  vec2 c = cell + uShift;
  if (c.x < 0.0 || c.y < 0.0 || c.x > N - 1.0 || c.y > N - 1.0) return vec4(0.0);
  return texture2D(uState, (c + 0.5) / N);
}

void main() {
  vec2 cell = floor(vUv * N);
  vec4 h = was(cell);
  if (uAdvance < 0.5) {
    gl_FragColor = h;
    return;
  }
  vec4 e = was(cell + vec2(1.0, 0.0));
  vec4 w = was(cell - vec2(1.0, 0.0));
  vec4 s = was(cell + vec2(0.0, 1.0));
  vec4 n = was(cell - vec2(0.0, 1.0));
  float lap = e.r + w.r + s.r + n.r - 4.0 * h.r;
  float next = (2.0 * h.r - h.g + uCourant2 * lap) * uDamping;
  // A soft border that swallows waves reaching the grid's edge rather than throwing them back.
  float edge = min(min(vUv.x, vUv.y), min(1.0 - vUv.x, 1.0 - vUv.y));
  float sponge = mix(0.9, 1.0, smoothstep(0.0, 0.1, edge));
  next *= sponge;
  float prev = h.r * sponge;

  // Ships: the hull holds the water to a hump under her bow and a hollow under her stern (higher the faster
  // she goes); as she moves on, the shape left behind runs off as waves.
  vec2 here = cell + 0.5;
  // Foam: spread a little among neighbours, fading; its freshness fades faster.
  float foam = mix(h.b, (e.b + w.b + s.b + n.b) * 0.25, ${FOAM_SPREAD.toFixed(3)}) * ${FOAM_KEEP.toFixed(5)};
  float fresh = h.a * ${FRESH_KEEP.toFixed(4)};
  float churned = 0.0;
  for (int i = 0; i < ${MAX_SHIPS}; i++) {
    if (i >= uShipCount) break;
    vec2 d = here - uShips[i].xy;
    float a = uShips[i].z;
    float along = dot(d, vec2(sin(a), -cos(a))) / uHulls[i].x;
    float across = dot(d, vec2(cos(a), sin(a))) / uHulls[i].y;
    float bow = exp(-((along - 0.8) * (along - 0.8) * 30.0 + across * across * 3.0));
    float stern = exp(-((along + 0.85) * (along + 0.85) * 20.0 + across * across * 3.0));
    float hold = clamp(max(bow, stern) * 1.3, 0.0, 1.0) * ${HOLD.toFixed(3)};
    next = mix(next, (bow - 0.75 * stern) * uShips[i].w, hold);
    // White water she churns (as hard as she is going): along her waterline, most at the bow, and the
    // churned water just astern, her own width.
    float pace = uShips[i].w / ${HUMP.toFixed(4)};
    float hull = length(vec2(along, across * 0.85));
    float waterline = smoothstep(0.8, 1.0, hull) * (1.0 - smoothstep(1.0, 1.35, hull)) * mix(0.25, 1.0, smoothstep(-0.2, 0.8, along));
    float astern = smoothstep(-0.85, -1.05, along) * (1.0 - smoothstep(-1.05, -1.6, along)) * (1.0 - smoothstep(0.5, 1.1, abs(across)));
    churned = max(churned, (waterline + astern * 1.4) * pace);
  }
  // Crests of the pushed water steep enough to break (the bow waves' arms, a splash's ring).
  float breaking = smoothstep(0.01, 0.025, -lap) * smoothstep(0.02, 0.04, h.r);
  float add = (churned + breaking * 0.3) * ${FOAM_CHURN.toFixed(2)} / 45.0;
  foam = clamp(foam + add, 0.0, 1.0);
  fresh = clamp(fresh + add * 1.5, 0.0, 1.0);
  // Splashes: a ring thrown out from where something fell into the sea.
  for (int i = 0; i < ${MAX_SPLASHES}; i++) {
    if (i >= uSplashCount) break;
    float r2 = dot(here - uSplashes[i].xy, here - uSplashes[i].xy) / (uSplashes[i].z * uSplashes[i].z);
    next += uSplashes[i].w * (1.0 - r2) * exp(-r2);
    // White water thrown up where it fell.
    float ring = exp(-r2 * 1.5) * min(1.0, uSplashes[i].w * 25.0);
    foam = max(foam, ring);
    fresh = max(fresh, ring);
  }
  // Never keep a value that isn't a sane height: one bad number (a NaN) would otherwise spread through the whole
  // grid and stay there, lifting the sea into walls. Anything out of bounds is still water.
  if (!(abs(next) < 2.0)) next = 0.0;
  if (!(abs(prev) < 2.0)) prev = 0.0;
  if (!(foam >= 0.0 && foam <= 1.0)) foam = 0.0;
  if (!(fresh >= 0.0 && fresh <= 1.0)) fresh = 0.0;
  // Foam reaching the grid's edge goes with the sponge.
  gl_FragColor = vec4(next, prev, foam * sponge, fresh * sponge);
}
`;

export interface Waves {
  /** The grid's heights (R, in tiles) and foam (B all of it, A how fresh), and where it lies: x, z of its corner, side (tiles). */
  texture: THREE.Texture;
  area: THREE.Vector3;
  /** Something fell into the sea here (a cannonball, a mast, a ship going down): `size` in tiles. */
  splash(x: number, z: number, size: number): void;
  /** Steps the water by `dt` seconds round (cx, cz), with these ships pushing it. */
  step(renderer: THREE.WebGLRenderer, cx: number, cz: number, dt: number, ships: WaveShip[]): void;
}

export function createWaves(): Waves {
  const target = () =>
    new THREE.WebGLRenderTarget(WAVE_GRID, WAVE_GRID, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
    });
  let read = target();
  let write = target();
  const area = new THREE.Vector3(0, 0, WAVE_GRID * WAVE_CELL);
  const uniforms = {
    uState: { value: read.texture as THREE.Texture },
    uShift: { value: new THREE.Vector2() },
    uCourant2: { value: ((WAVE_SPEED * STEP) / WAVE_CELL) ** 2 },
    uDamping: { value: DAMPING },
    uAdvance: { value: 1 },
    uShips: { value: Array.from({ length: MAX_SHIPS }, () => new THREE.Vector4()) },
    uHulls: { value: Array.from({ length: MAX_SHIPS }, () => new THREE.Vector2()) },
    uShipCount: { value: 0 },
    uSplashes: { value: Array.from({ length: MAX_SPLASHES }, () => new THREE.Vector4()) },
    uSplashCount: { value: 0 },
  };
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: STEP_FRAG, uniforms, depthTest: false, depthWrite: false }),
  );
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.Camera();
  const splashes: [number, number, number][] = [];
  let origin: THREE.Vector2 | undefined;
  let owed = 0;

  return {
    get texture() {
      return read.texture;
    },
    area,
    splash(x, z, size) {
      if (splashes.length < MAX_SPLASHES) splashes.push([x, z, size]);
    },
    step(renderer, cx, cz, dt, ships) {
      // The grid's corner, snapped to whole cells round the target; how many cells it moved.
      const side = WAVE_GRID * WAVE_CELL;
      const corner = new THREE.Vector2(Math.round((cx - side / 2) / WAVE_CELL), Math.round((cz - side / 2) / WAVE_CELL));
      const moved = origin ? corner.clone().sub(origin) : new THREE.Vector2();
      // A jump (a new place on the map) starts with still water.
      if (Math.abs(moved.x) > WAVE_GRID / 2 || Math.abs(moved.y) > WAVE_GRID / 2) moved.set(WAVE_GRID * 4, 0);
      origin = corner;
      area.set(corner.x * WAVE_CELL, corner.y * WAVE_CELL, side);

      owed = Math.min(owed + dt, STEP * MAX_STEPS);
      const steps = Math.floor(owed / STEP);
      if (!steps && !moved.lengthSq()) return;
      owed -= steps * STEP;

      // The ships near enough to push this grid, in its cells.
      let n = 0;
      for (const s of ships) {
        if (n >= MAX_SHIPS) break;
        // A ship with no sane position, heading, speed or size pushes nothing (it would poison the grid).
        if (![s.x, s.z, s.headingDeg, s.speed, s.length].every(Number.isFinite) || s.length <= 0) continue;
        const gx = (s.x - area.x) / WAVE_CELL;
        const gz = (s.z - area.y) / WAVE_CELL;
        if (gx < -s.length / WAVE_CELL || gz < -s.length / WAVE_CELL || gx > WAVE_GRID + s.length / WAVE_CELL || gz > WAVE_GRID + s.length / WAVE_CELL) continue;
        uniforms.uShips.value[n]!.set(gx, gz, (s.headingDeg * Math.PI) / 180, HUMP * Math.min(1, s.speed / BRISK_SPEED));
        uniforms.uHulls.value[n]!.set((s.length * 0.5) / WAVE_CELL, Math.max(1.5, (s.length * 0.12) / WAVE_CELL));
        n++;
      }
      uniforms.uShipCount.value = n;

      const previous = renderer.getRenderTarget();
      // At least one pass when the grid moved, so the heights follow it.
      for (let i = 0; i < Math.max(1, steps); i++) {
        uniforms.uShift.value.copy(i === 0 ? moved : new THREE.Vector2());
        // Splashes go in on the first step only.
        uniforms.uSplashCount.value = i === 0 ? splashes.length : 0;
        if (i === 0) {
          splashes.forEach(([x, z, size], k) => {
            uniforms.uSplashes.value[k]!.set((x - area.x) / WAVE_CELL, (z - area.y) / WAVE_CELL, Math.max(1.5, size / WAVE_CELL), size * 0.08);
          });
        }
        uniforms.uAdvance.value = steps ? 1 : 0;
        uniforms.uState.value = read.texture;
        renderer.setRenderTarget(write);
        renderer.render(scene, camera);
        [read, write] = [write, read];
      }
      splashes.length = 0;
      renderer.setRenderTarget(previous);
    },
  };
}
