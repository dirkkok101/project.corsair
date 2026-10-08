import * as THREE from 'three';

// The sea (art direction: Sid Meier's Pirates! 2004, a bright "Technicolor" sea, docs/reference/pirates-3d-style.md):
// long swells rolled downwind, fine ripples over them that show as a soft hammered texture, aqua over the
// shallows with the sand showing through and light dappling it, surf rolling in along the depth contours, flecks
// of whitecap lying along the wind and coming and going, cloud shadows drifting over, and the sky's
// colour at a glancing angle. One plane that follows the camera.
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
/**
 * Clouds and their shadows drift downwind this many tiles a second at full strength: slowly (an unhurried
 * drift across the view, not a sweep), so the wind reads without hurrying the eye.
 */
export const CLOUD_SPEED = 0.5;
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

const VERT = /* glsl */ `
uniform float uTime;
uniform vec4 uSwell[${SWELLS.length}];   // dir.x, dir.z, wavelength, amplitude
uniform float uSteep[${SWELLS.length}];
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 p = world.xyz;
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
  }
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D uDepth;     // the sea floor: 0 deep .. 1 at the shore and above (see Ground.depth)
uniform sampler2D uRipple;    // tiling ripple normals (rgb) and heights (a)
uniform vec2 uShadowAt;       // how far the cloud shadows have drifted, in tiles
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
uniform vec4 uShow;           // for review: flecks, cloud shadows, ripples, surf (1 shown, 0 hidden)
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec4 uSwell[${SWELLS.length}];
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// Flecks of whitecap (Pirates!'s open sea): short dashes lying along the wind, one at a random spot in some of
// the cells of a grid laid along the wind, each fading in and out on its own few-second life and drifting
// downwind, slowly: the sea should show the wind, not race with it (Pirates! keeps its sea calm and puts the
// wind's direction on the compass). \`w\` is the point in the wind's frame (x downwind), \`scale\` cells a tile, \`density\` the share of
// cells with one. Each dab is about a quarter of a cell long and a third as wide; it fades out before it would be thinner than a pixel.
float flecks(vec2 w, float scale, float density, float footprint, float t) {
  vec2 p = w * scale - vec2(t * 0.08 * scale, 0.0);
  vec2 cell = floor(p);
  float phase = hash(cell + 9.2);
  float cycle = t * 0.11 + phase;
  float life = fract(cycle);
  // Soft, so a gust coming or going fades flecks in and out rather than switching them (a hard cut, swept
  // across the sea by the gusts, read as white dots darting about).
  float alive = smoothstep(1.0 - density, 1.0 - density + 0.12, hash(cell + floor(cycle) * 1.7 + 3.3));
  float fade = smoothstep(0.0, 0.3, life) * (1.0 - smoothstep(0.6, 1.0, life));
  vec2 spot = vec2(hash(cell + 1.3), hash(cell + 4.1)) * 0.5 + 0.25;
  vec2 d = fract(p) - spot;
  d.x *= 0.4;
  float px = footprint * scale;
  float r = 0.066 * (0.7 + 0.6 * hash(cell + 6.6));
  // Soft-edged dabs, not hard slivers.
  float m = 1.0 - smoothstep(r * 0.55 - px * 0.5, r + px * 0.5, length(d));
  return m * alive * fade * (1.0 - smoothstep(0.1, 0.22, px));
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
  vec4 t1 = texture2D(uRipple, vWorld.xz * 0.9 + drift * 0.06);
  vec4 t2 = texture2D(uRipple, vWorld.xz * 2.3 - drift.yx * 0.09 + 0.37);
  vec3 r1 = t1.xyz * 2.0 - 1.0;
  vec3 r2 = t2.xyz * 2.0 - 1.0;
  float rippleFade = (1.0 - smoothstep(0.08, 0.6, footprint)) * (0.35 + 0.65 * uStrength);
  slope += (r1.xy * 0.22 + r2.xy * 0.12) * rippleFade * uShow.z;
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 v = normalize(cameraPosition - vWorld);

  vec2 floorTex = texture2D(uDepth, vWorld.xz / uMapSize).rg;
  float floorUp = floorTex.r;
  // How near land: a wide soft halo, for the bright apron round every island.
  float near = floorTex.g;
  // Deep cerulean offshore, a brighter blue over the banks, aqua over the shallows (Pirates!'s Caribbean).
  vec3 water = mix(uDeep, uMid, smoothstep(0.15, 0.55, floorUp));
  water = mix(water, uShallow, smoothstep(0.55, 0.82, floorUp));
  // The apron: a pale turquoise haze spreading well out from every island (Pirates!'s islands sit in bright halos).
  water = mix(water, mix(uShallow, vec3(0.82, 0.93, 0.92), 0.25), smoothstep(0.15, 0.85, near) * 0.55);
  // The sand showing through the shallowest water, dappled by the light through the ripples.
  float sandy = smoothstep(0.82, 0.97, floorUp);
  float caustic = smoothstep(0.55, 0.85, texture2D(uRipple, vWorld.xz * 1.6 + drift * 0.03).a) * (1.0 - smoothstep(0.1, 0.5, footprint));
  water = mix(water, uSand, sandy * 0.55) + vec3(caustic * smoothstep(0.6, 0.9, floorUp) * 0.12);
  // The ripples show in the water's colour too: a soft, low-contrast hammered texture all over.
  float hammer = (t1.a - 0.5) * 0.16 + (t2.a - 0.5) * 0.08;
  water *= 1.0 + hammer * (1.0 - smoothstep(0.1, 0.7, footprint)) * uShow.z;
  // Cloud shadows: big soft darker patches drifting downwind with the clouds.
  vec2 sp = (vWorld.xz - uShadowAt) * 0.022;
  float cloud = noise(sp) * 0.65 + noise(sp * 2.3 + 5.1) * 0.35;
  water *= 1.0 - smoothstep(0.52, 0.78, cloud) * 0.2 * uShow.y;

  // The water takes the light's colour: golden at sunrise and sunset, blue under the moon.
  vec3 tint = uSunColor / max(max(uSunColor.r, uSunColor.g), max(uSunColor.b, 0.001));
  water *= mix(vec3(1.0), tint, 0.4);
  // A moonlit sea is greyed a little, deep navy rather than an electric blue.
  water = mix(water, vec3(dot(water, vec3(0.3, 0.55, 0.15))), (1.0 - smoothstep(0.55, 0.9, uLight)) * 0.45);
  // The sky in the water at a glancing angle.
  float fresnel = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 col = mix(water * uLight, uSky, fresnel * 0.3);
  // A faint, soft sheen from the sun across the swell (no mirrored disc; more would grey one side of the view).
  vec3 h = normalize(uSunDir + v);
  col += uSunColor * pow(max(dot(n, h), 0.0), 60.0) * 0.04 * uLight;

  // Whitecaps: flecks lying along the wind, more of them the harder it blows, gathered in gusty patches; fine
  // ones close in and coarser ones further out (so on screen they stay about the same size at every zoom),
  // kept off the shallows.
  vec2 across = vec2(-uWindDir.y, uWindDir.x);
  vec2 w = vec2(dot(vWorld.xz, uWindDir), dot(vWorld.xz, across));
  // The gusty patches drift downwind no faster than the flecks themselves.
  float gust = smoothstep(0.25, 0.75, noise((vWorld.xz - uWindDir * uTime * 0.08) * 0.045));
  float density = clamp((uStrength - 0.25) * 0.55, 0.0, 0.42) * (0.3 + 0.7 * gust);
  float close = flecks(w + 12.3, 3.2, density, footprint, uTime) * (1.0 - smoothstep(0.065, 0.085, footprint * 3.2));
  float fine = flecks(w, 1.6, density, footprint, uTime) * smoothstep(0.065, 0.085, footprint * 3.2);
  float coarse = flecks(w + 31.7, 0.4, density * 0.8, footprint, uTime) * smoothstep(0.1, 0.2, footprint * 1.6);
  float caps = max(max(close, fine), coarse) * (1.0 - smoothstep(0.35, 0.6, floorUp)) * uShow.x;
  // Surf: bands of foam rolling in along the depth contours, broken up, densest at the waterline.
  float band = 0.5 + 0.5 * sin(floorUp * 46.0 - uTime * 1.6 + noise(vWorld.xz * 0.6) * 4.0);
  float surf = smoothstep(0.86, 0.97, floorUp) * smoothstep(0.55, 1.0, band) * (0.5 + 0.5 * noise(vWorld.xz * 3.0 + uTime * 0.3));
  float shoreline = smoothstep(0.955, 0.995, floorUp);
  // Wave lines: thin white crests running parallel to the coast across the apron, rolling slowly in, broken up.
  float crest = smoothstep(0.93, 0.99, 0.5 + 0.5 * sin(near * 34.0 - uTime * 0.9 + noise(vWorld.xz * 0.35) * 3.0));
  float waves = crest * smoothstep(0.2, 0.5, near) * (1.0 - smoothstep(0.85, 0.97, floorUp)) * smoothstep(0.45, 0.8, noise(vWorld.xz * 0.9 + uTime * 0.05));
  waves *= 1.0 - smoothstep(0.15, 0.6, footprint);
  float foam = clamp((surf * 0.8 + waves * 0.75) * uShow.w + shoreline * 0.9, 0.0, 1.0);
  col = mix(col, vec3(0.96, 0.98, 1.0) * max(uLight, 0.3), foam);
  // Whitecaps are pale and a little blue, not pure white (in the reference they hardly ever reach white).
  // At night they are only a faint glimmer.
  col = mix(col, mix(col, vec3(1.0), 0.6) * max(uLight, 0.3), caps * 0.55 * mix(0.35, 1.0, smoothstep(0.6, 1.0, uLight)));

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

/**
 * For review, the sea's layers that can be hidden (`?sea=plain` hides them all, `?sea=plain,flecks` brings one
 * back): flecks of whitecap, cloud shadows, ripples (and their texture), surf and wave lines.
 */
export const SEA_LAYERS = ['flecks', 'shadows', 'ripples', 'surf'] as const;

export function createOcean(depth: THREE.Texture, mapW: number, mapH: number, shown: (layer: string) => boolean = () => true): Ocean {
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
      uShadowAt: { value: new THREE.Vector2() },
      uMapSize: { value: new THREE.Vector2(mapW, mapH) },
      uWindDir: { value: new THREE.Vector2(0, 1) },
      // Softer than pure cerulean (measured against reference footage: saturation about 0.3), paler shallows.
      uDeep: { value: new THREE.Color('#4685c4') },
      uMid: { value: new THREE.Color('#4c92cf') },
      uShallow: { value: new THREE.Color('#68c2c6') },
      uSand: { value: new THREE.Color('#d9e8c4') },
      uSky: { value: new THREE.Color('#9fd3f0') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color('#fff4d6') },
      uLight: { value: 1 },
      uStrength: { value: 0.8 },
      uShow: { value: new THREE.Vector4(1, 1, 1, 1) },
      uFogColor: { value: new THREE.Color('#bfe3f2') },
      uFogDensity: { value: 0.002 },
    },
  });
  const mesh = new THREE.Mesh(geometry, material);
  // The plane moves with the camera; culling it by its first position would lose it.
  mesh.frustumCulled = false;
  const u = material.uniforms as Record<string, THREE.IUniform>;
  (u.uShow!.value as THREE.Vector4).set(...(SEA_LAYERS.map((l) => (shown(l) ? 1 : 0)) as [number, number, number, number]));
  let lastT: number | undefined;
  return {
    mesh,
    update(at, sea, t, light) {
      // Snapped to the grid spacing, so the swell doesn't swim as the plane follows the ship.
      const step = SIZE / SEGMENTS;
      mesh.position.set(Math.round(at.x / step) * step, 0, Math.round(at.z / step) * step);
      u.uTime!.value = t;
      // Cloud shadows drift downwind at the clouds' own speed.
      const dt = lastT === undefined ? 0 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      const to = (sea.toDeg * Math.PI) / 180;
      (u.uShadowAt!.value as THREE.Vector2).x += Math.sin(to) * sea.strength * CLOUD_SPEED * dt;
      (u.uShadowAt!.value as THREE.Vector2).y -= Math.cos(to) * sea.strength * CLOUD_SPEED * dt;
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
