import * as THREE from 'three';

// The sea (art direction: Sid Meier's Pirates! 2004, a bright "Technicolor" sea, docs/reference/pirates-3d-style.md):
// long swells rolled downwind, fine ripples over them, aqua over the shallows with the sand showing through and
// light dappling it, surf rolling in along the depth contours, long white streaks of wind across open water,
// whitecaps in a blow, sun sparkle, and the sky's colour at a glancing angle. One plane that follows the camera.
// Distances are in map tiles (one tile is about 2.5 km; ships and swells are drawn far larger than life).

/** One swell: its direction off the wind (degrees), wavelength and height in tiles, and steepness. */
interface Swell {
  offDeg: number;
  length: number;
  amp: number;
  steep: number;
}
// A calm, painterly sea (Pirates! ships glide): low, long swells; the fine chop is only in the shading.
const SWELLS: Swell[] = [
  { offDeg: 0, length: 11, amp: 0.045, steep: 0.45 },
  { offDeg: 28, length: 6.5, amp: 0.025, steep: 0.4 },
  { offDeg: -36, length: 3.1, amp: 0.012, steep: 0.35 },
  { offDeg: 64, length: 1.7, amp: 0.006, steep: 0.3 },
];
const GRAVITY = 9.8;
/** Swell speed is scaled down from deep-water physics to read as a lazy roll at this scale. */
const SPEED = 0.12;
// The mesh carries only the swells long enough for its grid (shorter ones would alias into stripes); the
// fragment shader lights every swell, per pixel, fading the short ones out with distance.
const MESH_SWELLS = 2;

/** The sea's state: swells blow toward `toDeg` (where the wind goes), their height scaled by `strength`. */
export interface SeaState {
  toDeg: number;
  strength: number;
}

const swellDir = (sea: SeaState, s: Swell) => {
  // Map headings are clockwise from north (-z); x east.
  const a = ((sea.toDeg + s.offDeg) * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)] as const;
};

/** The height of the long swells (the ones the mesh rolls) at a point and time, for ships riding them. */
export function seaHeight(sea: SeaState, x: number, z: number, t: number): number {
  let y = 0;
  for (const s of SWELLS.slice(0, MESH_SWELLS)) {
    const [dx, dz] = swellDir(sea, s);
    const k = (2 * Math.PI) / s.length;
    const c = Math.sqrt(GRAVITY / k) * SPEED;
    y += s.amp * sea.strength * Math.sin(k * (dx * x + dz * z) - k * c * t);
  }
  return y;
}

/**
 * Fine ripples, drawn once: a tiling normal map of a few octaves of periodic noise (so it wraps seamlessly),
 * read twice in the shader at two scales drifting different ways. Alpha holds the height, for patterns.
 */
function rippleTexture(size = 256): THREE.DataTexture {
  const grid = (cells: number, seed: number) => {
    const g = new Float32Array(cells * cells);
    let s = seed;
    for (let i = 0; i < g.length; i++) {
      s = (s * 16807) % 2147483647;
      g[i] = s / 2147483647;
    }
    return g;
  };
  const octaves = [
    { cells: 8, amp: 1, g: grid(8, 11) },
    { cells: 16, amp: 0.5, g: grid(16, 23) },
    { cells: 32, amp: 0.25, g: grid(32, 37) },
    { cells: 64, amp: 0.12, g: grid(64, 41) },
  ];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const wrap = (i: number, n: number) => ((i % n) + n) % n;
  const heightAt = (x: number, y: number) => {
    let h = 0;
    for (const o of octaves) {
      const fx = (x / size) * o.cells;
      const fy = (y / size) * o.cells;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = smooth(fx - ix);
      const ty = smooth(fy - iy);
      const at = (a: number, b: number) => o.g[wrap(b, o.cells) * o.cells + wrap(a, o.cells)]!;
      const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
      const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
      h += (top + (bottom - top) * ty) * o.amp;
    }
    return h / 1.87;
  };
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) heights[y * size + x] = heightAt(x, y);
  const data = new Uint8Array(size * size * 4);
  const h = (x: number, y: number) => heights[wrap(y, size) * size + wrap(x, size)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * 6;
      const dy = (h(x, y + 1) - h(x, y - 1)) * 6;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      data[i + 3] = Math.round(Math.min(1, h(x, y)) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Wind streaks, painted once (Pirates! 2004's sea map): thin white brush strokes of foam, tapered at both ends and
 * a little curved, in loose clusters, on a tile that wraps. The shader lays it along the wind and drifts it.
 */
function streakTexture(size = 1024): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let seed = 9;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  g.lineCap = 'round';
  const stroke = (x: number, y: number, length: number, width: number, bend: number, alpha: number) => {
    // Drawn as short segments, widest and brightest in the middle, so each stroke tapers to nothing.
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const taper = Math.sin(Math.PI * (t0 + t1) / 2);
      g.strokeStyle = `rgba(255,255,255,${alpha * taper})`;
      g.lineWidth = Math.max(0.6, width * taper);
      g.beginPath();
      g.moveTo(x + t0 * length, y + Math.sin(t0 * Math.PI) * bend);
      g.lineTo(x + t1 * length, y + Math.sin(t1 * Math.PI) * bend);
      g.stroke();
    }
  };
  for (let k = 0; k < 18; k++) {
    // A cluster: a few strokes laid close and nearly parallel, like spume drawn out by the wind.
    const cx = rand() * size;
    const cy = rand() * size;
    const n = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const length = 70 + rand() * 230;
      const x = cx + (rand() - 0.5) * 120;
      const y = cy + (rand() - 0.5) * 26;
      const width = 1.2 + rand() * 2.6;
      const bend = (rand() - 0.5) * 10;
      const alpha = 0.35 + rand() * 0.55;
      // Drawn at each wrap offset, so the tile repeats without seams.
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) stroke(x + ox, y + oy, length, width, bend, alpha);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const VERT = /* glsl */ `
uniform float uTime;
uniform vec4 uSwell[${SWELLS.length}];   // dir.x, dir.z, wavelength, amplitude
uniform float uSteep[${SWELLS.length}];
varying vec3 vWorld;
varying float vCrest;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 p = world.xyz;
  float crest = 0.0;
  for (int i = 0; i < ${MESH_SWELLS}; i++) {
    vec2 d = uSwell[i].xy;
    float k = 6.2831853 / uSwell[i].z;
    float a = uSwell[i].w;
    float c = sqrt(${GRAVITY.toFixed(1)} / k) * ${SPEED.toFixed(3)};
    float f = k * (dot(d, world.xz) - c * uTime);
    float q = uSteep[i];
    p.x += d.x * q * a * cos(f);
    p.z += d.y * q * a * cos(f);
    p.y += a * sin(f);
    crest += a * sin(f);
  }
  vWorld = p;
  vCrest = crest;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D uDepth;     // the sea floor: 0 deep .. 1 at the shore and above (see Ground.depth)
uniform sampler2D uRipple;    // tiling ripple normals (rgb) and heights (a)
uniform sampler2D uStreaks;   // wind streaks: white strokes along u
uniform vec2 uMapSize;
uniform vec2 uWindDir;        // where the wind blows to, in the xz plane
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uSand;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uLight;
uniform float uStrength;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec4 uSwell[${SWELLS.length}];
varying vec3 vWorld;
varying float vCrest;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  float dist = length(cameraPosition - vWorld);
  // How many tiles one pixel spans here: detail finer than a pixel fades out rather than shimmering.
  float footprint = length(fwidth(vWorld.xz));

  // The surface's slope from every swell, the short ones fading out with distance.
  vec2 slope = vec2(0.0);
  for (int i = 0; i < ${SWELLS.length}; i++) {
    vec2 d = uSwell[i].xy;
    float k = 6.2831853 / uSwell[i].z;
    float c = sqrt(${GRAVITY.toFixed(1)} / k) * ${SPEED.toFixed(3)};
    float f = k * (dot(d, vWorld.xz) - c * uTime);
    float fade = 1.0 - smoothstep(uSwell[i].z * 6.0, uSwell[i].z * 30.0, dist);
    slope += d * k * uSwell[i].w * cos(f) * fade;
  }
  // Fine ripples on top, two layers drifting downwind at different scales.
  vec2 drift = uWindDir * uTime;
  vec3 r1 = texture2D(uRipple, vWorld.xz * 0.9 + drift * 0.06).xyz * 2.0 - 1.0;
  vec3 r2 = texture2D(uRipple, vWorld.xz * 2.3 - drift.yx * 0.09 + 0.37).xyz * 2.0 - 1.0;
  float rippleFade = (1.0 - smoothstep(0.08, 0.6, footprint)) * (0.35 + 0.65 * uStrength);
  slope += (r1.xy * 0.22 + r2.xy * 0.12) * rippleFade;
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 v = normalize(cameraPosition - vWorld);

  float floorUp = texture2D(uDepth, vWorld.xz / uMapSize).r;
  // Deep cerulean offshore, a brighter blue over the banks, aqua over the shallows (Pirates!'s Caribbean).
  vec3 water = mix(uDeep, uMid, smoothstep(0.15, 0.55, floorUp));
  water = mix(water, uShallow, smoothstep(0.55, 0.82, floorUp));
  // The sand showing through the shallowest water, dappled by the light through the ripples.
  float sandy = smoothstep(0.82, 0.97, floorUp);
  float caustic = smoothstep(0.55, 0.85, texture2D(uRipple, vWorld.xz * 1.6 + drift * 0.03).a) * (1.0 - smoothstep(0.1, 0.5, footprint));
  water = mix(water, uSand, sandy * 0.55) + vec3(caustic * smoothstep(0.6, 0.9, floorUp) * 0.12);

  // The water takes the light's colour: golden at sunrise and sunset, blue under the moon.
  vec3 tint = uSunColor / max(max(uSunColor.r, uSunColor.g), max(uSunColor.b, 0.001));
  water *= mix(vec3(1.0), tint, 0.4);
  // The sky in the water at a glancing angle.
  float fresnel = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 col = mix(water * uLight, uSky, fresnel * 0.5);
  // A broad, soft sheen from the sun across the swell (no mirrored disc).
  vec3 h = normalize(uSunDir + v);
  col += uSunColor * pow(max(dot(n, h), 0.0), 60.0) * 0.12 * uLight;
  // Sun sparkle at two sizes: fine specks close in, coarser ones that still show zoomed out (the sea glitters
  // all over, a pixel or two in a hundred), each fading out before it would be smaller than a pixel.
  // Each glint is a small round point at a random spot in its cell, about a pixel and a half across, never
  // the whole cell (which would show as a square).
  vec2 cell = floor(vWorld.xz * 7.0);
  vec2 spot = vec2(hash(cell + 3.1), hash(cell + 7.7)) * 0.6 + 0.2;
  float dot1 = 1.0 - smoothstep(0.0, footprint * 7.0 * 0.9 + 0.04, length(fract(vWorld.xz * 7.0) - spot));
  float wink = step(0.975, hash(cell + floor(uTime * 3.0 + hash(cell) * 7.0))) * dot1 * (1.0 - smoothstep(0.05, 0.13, footprint));
  vec2 cell2 = floor(vWorld.xz * 1.6);
  vec2 spot2 = vec2(hash(cell2 + 5.3), hash(cell2 + 9.1)) * 0.6 + 0.2;
  float dot2 = 1.0 - smoothstep(0.0, footprint * 1.6 * 0.9, length(fract(vWorld.xz * 1.6) - spot2));
  float wink2 = step(0.97, hash(cell2 + 17.0 + floor(uTime * 2.0 + hash(cell2) * 5.0))) * dot2 * smoothstep(0.08, 0.2, footprint) * (1.0 - smoothstep(0.6, 1.4, footprint));
  col += uSunColor * (wink + wink2) * uLight * 0.85;

  // Wind streaks: long thin white lines laid along the wind across open water (Pirates!'s sea map).
  vec2 across = vec2(-uWindDir.y, uWindDir.x);
  vec2 w = vec2(dot(vWorld.xz, uWindDir), dot(vWorld.xz, across));
  // Painted strokes laid along the wind at two scales, drifting downwind, in patches that come and go.
  float s1 = texture2D(uStreaks, vec2(w.x / 26.0 - uTime * 0.012, w.y / 26.0)).a;
  float s2 = texture2D(uStreaks, vec2(w.x / 41.0 - uTime * 0.008 + 0.31, w.y / 41.0 + 0.57)).a;
  float patches = smoothstep(0.5, 0.85, noise(vWorld.xz * 0.035 + uWindDir * uTime * 0.01));
  float streak = max(s1, s2 * 0.7) * patches;
  streak *= (1.0 - smoothstep(0.35, 0.6, floorUp)) * (0.45 + 0.55 * uStrength) * (1.0 - smoothstep(0.12, 0.6, footprint));
  // Surf: bands of foam rolling in along the depth contours, broken up, densest at the waterline.
  float band = 0.5 + 0.5 * sin(floorUp * 46.0 - uTime * 1.6 + noise(vWorld.xz * 0.6) * 4.0);
  float surf = smoothstep(0.86, 0.97, floorUp) * smoothstep(0.55, 1.0, band) * (0.5 + 0.5 * noise(vWorld.xz * 3.0 + uTime * 0.3));
  float shoreline = smoothstep(0.955, 0.995, floorUp);
  // Whitecaps on the swell's crests in a blow.
  float caps = smoothstep(0.08, 0.15, vCrest) * smoothstep(0.85, 1.0, uStrength) * noise(vWorld.xz * 3.0 - uTime * 0.2);
  float foam = clamp(streak * 0.45 + surf * 0.8 + shoreline * 0.9 + caps * 0.6, 0.0, 1.0);
  col = mix(col, vec3(0.96, 0.98, 1.0) * max(uLight, 0.3), foam);

  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Plane size in tiles and its grid: dense enough near the camera for the swell to roll. */
const SIZE = 900;
const SEGMENTS = 512;

export interface SeaLight {
  sunDir: THREE.Vector3;
  sun: THREE.Color;
  sky: THREE.Color;
  level: number;
  fog: THREE.Color;
  fogDensity: number;
}

export interface Ocean {
  mesh: THREE.Mesh;
  /** Each frame: follow the camera's target, set the swell and ripples to the wind, light the water. */
  update(at: THREE.Vector3, sea: SeaState, t: number, light: SeaLight): void;
}

export function createOcean(depth: THREE.Texture, mapW: number, mapH: number): Ocean {
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uSwell: { value: SWELLS.map(() => new THREE.Vector4()) },
      uSteep: { value: SWELLS.map((s) => s.steep) },
      uDepth: { value: depth },
      uRipple: { value: rippleTexture() },
      uStreaks: { value: streakTexture() },
      uMapSize: { value: new THREE.Vector2(mapW, mapH) },
      uWindDir: { value: new THREE.Vector2(0, 1) },
      // Softer than pure cerulean (measured against reference footage: saturation about 0.3), paler shallows.
      uDeep: { value: new THREE.Color('#2a68a3') },
      uMid: { value: new THREE.Color('#3f86bd') },
      uShallow: { value: new THREE.Color('#68c2c6') },
      uSand: { value: new THREE.Color('#d9e8c4') },
      uSky: { value: new THREE.Color('#9fd3f0') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color('#fff4d6') },
      uLight: { value: 1 },
      uStrength: { value: 0.8 },
      uFogColor: { value: new THREE.Color('#bfe3f2') },
      uFogDensity: { value: 0.002 },
    },
  });
  const mesh = new THREE.Mesh(geometry, material);
  // The plane moves with the camera; culling it by its first position would lose it.
  mesh.frustumCulled = false;
  const u = material.uniforms as Record<string, THREE.IUniform>;
  return {
    mesh,
    update(at, sea, t, light) {
      // Snapped to the grid spacing, so the swell doesn't swim as the plane follows the ship.
      const step = SIZE / SEGMENTS;
      mesh.position.set(Math.round(at.x / step) * step, 0, Math.round(at.z / step) * step);
      u.uTime!.value = t;
      SWELLS.forEach((s, i) => {
        const [dx, dz] = swellDir(sea, s);
        (u.uSwell!.value as THREE.Vector4[])[i]!.set(dx, dz, s.length, s.amp * sea.strength);
      });
      const a = (sea.toDeg * Math.PI) / 180;
      (u.uWindDir!.value as THREE.Vector2).set(Math.sin(a), -Math.cos(a));
      u.uStrength!.value = sea.strength;
      (u.uSunDir!.value as THREE.Vector3).copy(light.sunDir);
      (u.uSunColor!.value as THREE.Color).copy(light.sun);
      (u.uSky!.value as THREE.Color).copy(light.sky);
      (u.uFogColor!.value as THREE.Color).copy(light.fog);
      u.uLight!.value = light.level;
      u.uFogDensity!.value = light.fogDensity;
    },
  };
}
