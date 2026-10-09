import * as THREE from 'three';
import { chopTexture, coastTexture, detailTexture } from './textures';
import { createWakes, WAKE_MARGIN, WAKE_WIDENING } from './wakes';
import type { WakeShip } from './wakes';
import { createWaves, WAVE_CELL, WAVE_GRID } from './waves';

// The sea (art direction: Assassin's Creed IV: Black Flag; see docs/reference/ocean-renderer.md): a real, rolling
// sea whose state follows the weather, from gentle swells in fair weather to big, breaking seas in a gale. One
// camera-following mesh carries a spectrum of Gerstner waves running with the wind (their crests sharpened, the
// same waves ships ride), and its fragment shader lights the water physically: the sky mirrored at grazing angles
// (Fresnel), the sun's path across it, light glowing through the backs of the crests, foam where they break,
// turquoise over the shallows and white surf on the shore. Ships' wakes and the water they push lie in the same
// surface.
//
// Kept from the first seas: every pattern finer than the mesh is a mipmapped texture or fades out (fwidth) before
// it gets finer than a few pixels, so nothing shimmers; and everything moves coherently with the wind.

export type { WakeShip } from './wakes';

/**
 * Clouds and their shadows drift downwind this many tiles a second at full strength: slowly (an unhurried drift
 * across the view, not a sweep), so the wind reads without hurrying the eye.
 */
export const CLOUD_SPEED = 0.25;

/** The sea's state: it moves toward `toDeg` (where the wind goes, clockwise from north), as hard as `strength` (0..~1.1). */
export interface SeaState {
  toDeg: number;
  strength: number;
}

export interface SeaLight {
  sunDir: THREE.Vector3;
  /** The sun's (or moon's) colour, and its intensity as the scene's directional light has it. */
  sun: THREE.Color;
  power?: number;
  /** The sky at the horizon, and overhead. */
  sky: THREE.Color;
  zenith?: THREE.Color;
  /** The light from the whole sky (the hemisphere's), for the water's body and the foam. */
  ambient?: THREE.Color;
  /** 0..1, night to full day. */
  level: number;
  /** 0 clear .. 1 a storm's overcast: the water greys under the cloud. */
  overcast?: number;
  fog: THREE.Color;
  fogDensity: number;
}

export interface Ocean {
  mesh: THREE.Mesh;
  /** Each frame: follow the camera's target, move the sea with the wind, light the water. */
  update(at: THREE.Vector3, sea: SeaState, t: number, light: SeaLight): void;
  /** Each frame: the ships whose wakes, bow waves and hull foam to draw, and who push the water. */
  ships(ships: WakeShip[]): void;
  /** The height of the water at a point (the waves ships ride), as of the last update. */
  heightAt(x: number, z: number): number;
  /** Something fell into the sea here (a cannonball, a mast, a ship going down): rings run out from it. `size` in tiles. */
  splash(x: number, z: number, size: number): void;
}

// The water's colours, linear. Deep: a dark blue-green that the sky's reflection lightens toward the horizon;
// scatter: the green-turquoise glow in thin, backlit crests; the shallows' turquoise and sand; foam's albedo.
const COLOURS = {
  deep: new THREE.Color('#0d3f5c'),
  stormDeep: new THREE.Color('#1c3238'),
  scatter: new THREE.Color('#2bb3a0'),
  shallow: new THREE.Color('#3fc7c0'),
  sand: new THREE.Color('#cfe3c0'),
  foam: new THREE.Color('#e9f2f2'),
};

/**
 * The sea state by the wind's strength `s` (0.15 calm .. 1.1 gale): the dominant wavelength and the significant
 * height (tiles; at the ships' scale a tile is about ten metres). Fair weather is a gentle swell, a fresh breeze a
 * lively sea, a gale big rolling seas.
 */
const PEAK_LENGTH = (s: number) => 3.5 + 10 * s * s;
const SIGNIFICANT_HEIGHT = (s: number) => 0.04 + 0.62 * s * s * s;
/** How sharp the crests are (Gerstner choppiness, summed over the waves; 1 would fold them over). */
const CHOPPY = (s: number) => 0.45 + 0.35 * Math.min(1, s);
/** Gravity in tiles a second squared (a tile about ten metres), and the waves' pace as a share of a real sea's. */
const GRAVITY = 0.98;
const PACE = 0.75;

/** The spectrum's waves: wavelength as a share of the peak's, angle off the wind (radians), and starting phase. */
const COUNT = 24;
const SPECTRUM = (() => {
  let seed = 4111;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: COUNT }, (_, i) => {
    // Lengths spread evenly on a log scale, each nudged a little so no two line up.
    const ratio = 1.4 * Math.pow(1 / 12, (i + rand() * 0.6) / COUNT);
    // Every wave within ±55° of the wind, alternating sides, so no two run parallel and their crests never line
    // up into stripes.
    const spread = (i % 2 ? 1 : -1) * (0.08 + rand() * 0.88);
    // Height in proportion to length up to the peak (every wave about as steep as the next, as in a real sea's
    // wind-wave range), falling off above it: texture at every scale, no single wave carrying the sea.
    const weight = ratio <= 1 ? ratio : ratio * Math.exp(-(ratio - 1) * 2.5);
    return { ratio, off: spread, weight, phase: rand() * Math.PI * 2 };
  });
})();
// Normalised so the waves' heights add to the significant height: Hs = 4 * sqrt(sum(a^2) / 2).
const WEIGHT_NORM = 1 / (4 * Math.sqrt(SPECTRUM.reduce((n, w) => n + w.weight * w.weight, 0) / 2));

/**
 * The grid: polar round the camera's target, its spacing growing with the radius (RING_STEP + RING_GROWTH * r)
 * out to the horizon. A wave is rolled in the mesh only where the grid has at least six points to its wavelength
 * (shorter ones are drawn by the fragment shader alone), so none aliases.
 */
const SEGMENTS = 256;
const RING_STEP = 0.3;
const RING_GROWTH = 0.028;
const RADIUS = 3000;
/** The surface drift (tiles a second), at no wind and at full strength: the chop, foam and wakes move at it. */
const DRIFT = [0.025, 0.09];
/** How fast the sea turns to a new wind, and grows or dies with it (per second): slowly, as a sea does. */
const SEA_EASE = 0.08;
/** The wakes' area round the target, in camera distances, and its limits (tiles). */
const WAKE_AREA = { perDistance: 2.4, min: 30, max: 260 };

const WAVES_GLSL = /* glsl */ `
uniform vec4 uWave[${COUNT}];    // direction (x, z), wavenumber, height
uniform float uQ[${COUNT}];      // choppiness
uniform float uPhase[${COUNT}];
`;

const VERT = /* glsl */ `
${WAVES_GLSL}
uniform vec2 uCenter;
uniform vec2 uFade[${COUNT}];
uniform sampler2D uCoast;
uniform vec2 uMapSize;
uniform sampler2D uWaves;
uniform vec3 uWaveArea;
uniform float uShowWaves;
uniform float uShowSwell;
varying vec3 vWorld;
varying vec2 vParam;
varying float vRadius;
void main() {
  vec2 xz = position.xz + uCenter;
  float r = length(position.xz);
  // The waves die on the beach itself, so the waterline stays where the land has it.
  float beach = 1.0 - smoothstep(0.9, 0.985, texture2D(uCoast, xz / uMapSize).r);
  vec3 p = vec3(0.0);
  for (int i = 0; i < ${COUNT}; i++) {
    float a = uWave[i].w * (1.0 - smoothstep(uFade[i].x, uFade[i].y, r)) * uShowSwell;
    float arg = uWave[i].z * dot(uWave[i].xy, xz) - uPhase[i];
    float c = cos(arg);
    p.x += uQ[i] * a * uWave[i].x * c;
    p.z += uQ[i] * a * uWave[i].y * c;
    p.y += a * sin(arg);
  }
  // The water ships push (waves.ts), smoothed over a few cells, as the mesh is coarser than its grid.
  vec2 wv = (xz - uWaveArea.xy) / uWaveArea.z;
  if (wv.x > 0.0 && wv.y > 0.0 && wv.x < 1.0 && wv.y < 1.0) {
    float o = 2.0 / ${WAVE_GRID.toFixed(1)};
    float wh = texture2D(uWaves, wv).r * 2.0 + texture2D(uWaves, wv + vec2(o, 0.0)).r + texture2D(uWaves, wv - vec2(o, 0.0)).r
      + texture2D(uWaves, wv + vec2(0.0, o)).r + texture2D(uWaves, wv - vec2(0.0, o)).r;
    vec2 we = smoothstep(0.0, 0.12, wv) * smoothstep(0.0, 0.12, 1.0 - wv);
    p.y += wh / 6.0 * we.x * we.y * uShowWaves;
  }
  vec3 world = vec3(xz.x + p.x * beach, p.y * beach, xz.y + p.z * beach);
  vWorld = world;
  vParam = xz;
  vRadius = r;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
${WAVES_GLSL}
uniform sampler2D uCoast;
uniform sampler2D uDetail;
uniform sampler2D uChop;
uniform sampler2D uWake;
uniform vec3 uWakeArea;
uniform sampler2D uWaves;
uniform vec3 uWaveArea;
uniform vec2 uMapSize;
uniform float uTime;
// The wind's frame for the textures: rows along and across the wind, and its drifting offset.
uniform vec4 uFrame;
uniform vec2 uOffset;
uniform vec2 uCloudOffset;
uniform vec2 uWindDir;
uniform float uStrength;
uniform float uHs;
uniform vec3 uDeep, uScatter, uShallow, uSand, uFoam;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform vec3 uAmbient;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
// Layers, for review: swell, ripples (the fine chop), flecks (whitecaps), shadows, surf, waves, wakes.
uniform float uShowSwell, uShowRipples, uShowFlecks, uShowShadows, uShowSurf, uShowWaves, uShowWakes;
varying vec3 vWorld;
varying vec2 vParam;
varying float vRadius;

void main() {
  vec2 xz = vParam;
  vec2 uv = vec2(dot(uFrame.xy, xz), dot(uFrame.zw, xz)) + uOffset;

  // The waves, per pixel (each one fading out before it gets finer than a few pixels): the surface's tilt, how
  // far up a crest this is, and how pinched (the Gerstner Jacobian, low where a crest is about to break).
  vec3 n = vec3(0.0, 1.0, 0.0);
  float crest = 0.0;
  float pinch = 1.0;
  float spread = 0.0;
  for (int i = 0; i < ${COUNT}; i++) {
    float arg = uWave[i].z * dot(uWave[i].xy, xz) - uPhase[i];
    float fine = 1.0 - smoothstep(0.8, 1.6, fwidth(arg));
    float wa = uWave[i].z * uWave[i].w * fine * uShowSwell;
    float c = cos(arg);
    float s = sin(arg);
    n.x -= uWave[i].x * wa * c;
    n.z -= uWave[i].y * wa * c;
    n.y -= uQ[i] * wa * s;
    pinch -= uQ[i] * wa * s;
    spread += uQ[i] * wa * uQ[i] * wa;
    crest += uWave[i].w * s * fine;
  }
  // The fine chop, two scales drifting with the wind, stronger in a blow; in the wind's frame, turned to the world's.
  vec3 c1 = texture2D(uChop, uv / 2.6 + vec2(uTime * 0.014, 0.0)).rgb;
  vec3 c2 = texture2D(uChop, uv / 0.95 + vec2(uTime * 0.025, 0.37)).rgb;
  vec2 chop = ((c1.rg - 0.5) * 0.6 + (c2.rg - 0.5) * 0.4) * (0.18 + 0.32 * uStrength) * uShowRipples;
  n.xz -= uFrame.xy * chop.x + uFrame.zw * chop.y;

  // The water ships push (waves.ts): its slopes tilt the surface too.
  vec2 gv = (xz - uWaveArea.xy) / uWaveArea.z;
  vec2 ge = smoothstep(0.0, 0.12, gv) * smoothstep(0.0, 0.12, 1.0 - gv);
  float gc = 1.0 / ${WAVE_GRID.toFixed(1)};
  vec2 waveSlope = vec2(
    texture2D(uWaves, gv + vec2(gc, 0.0)).r - texture2D(uWaves, gv - vec2(gc, 0.0)).r,
    texture2D(uWaves, gv + vec2(0.0, gc)).r - texture2D(uWaves, gv - vec2(0.0, gc)).r
  ) / ${(2 * WAVE_CELL).toFixed(4)} * ge.x * ge.y * uShowWaves;
  n.xz -= waveSlope;
  vec3 N = normalize(n);

  // Light.
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uSunDir);
  float NdV = max(dot(N, V), 0.0);
  float NdL = max(dot(N, L), 0.0);
  // Cloud shadows: large soft patches where the sun is dimmed, drifting with the clouds.
  float cloud = texture2D(uDetail, (xz + uCloudOffset) / 150.0).b;
  float sunlit = 1.0 - 0.45 * smoothstep(0.45, 0.8, cloud) * uShowShadows;
  vec3 sun = uSun * sunlit * step(0.0, L.y);

  // The sky mirrored (Fresnel): little looking down, most at a grazing angle. Reflections never look into the sea.
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
  // The sun's path across the water: a tight highlight on a calm sea, broader and broken up in a blow (the
  // normals are filtered, so far out it spreads into a soft glow rather than sparkling).
  vec3 H = normalize(L + V);
  // (Kept broad and soft: a sharper highlight breaks into specks that flicker as the waves move.)
  float shine = mix(420.0, 220.0, clamp(uStrength, 0.0, 1.0));
  float spec = pow(max(dot(N, H), 0.0), shine) * (shine + 8.0) / 25.1 * F * 0.45;

  // The water's body: deep blue-green, lit by the sky and a little by the sun; light glowing green-turquoise
  // through the thin backs of the crests, most when looking toward the sun.
  float up = clamp(crest / (uHs * 0.6 + 0.001) * 0.5 + 0.5, 0.0, 1.0);
  // (The sun's share by the slope's tilt to it: faces toward it lit, the backs of the waves in shade.)
  vec3 body = uDeep * (uAmbient * 0.8 + sun * (0.05 + 0.6 * NdL));
  float through = pow(clamp(dot(V, -vec3(L.x, 0.0, L.z) * 0.8 + vec3(0.0, -0.2, 0.0)) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  // (Only the steep tops: the crests pinch there, so the glow follows the crest lines, never a whole long wave.)
  float tops = smoothstep(0.8, 0.45, pinch) * up;
  body += uScatter * sun * tops * (through * 0.3 + 0.03) * uShowSwell;

  // Shallows: the floor's height, its smoothed shallowness, and the way to the shore. The lookups wander a
  // little with a medium noise, so the map's one-texel-a-tile grid never shows in the coast.
  vec4 medium = texture2D(uDetail, xz / 23.0);
  float wobble = medium.a - 0.5;
  float wobble2 = medium.b - 0.5;
  vec4 coastNear = texture2D(uCoast, (xz + vec2(wobble, wobble2) * 0.35) / uMapSize);
  vec4 coastWide = texture2D(uCoast, (xz + vec2(wobble2, -wobble) * 1.4) / uMapSize);
  float floorH = coastNear.r;
  float shallow = coastWide.g;
  float linesWidth = fwidth(floorH) * 13.0;
  vec3 lit = uAmbient * 0.9 + sun * (0.35 + 0.65 * NdL);
  // Over the shallows the water clears to turquoise, then shows the sand.
  body = mix(body, uShallow * lit * 0.35, smoothstep(0.5, 0.82, shallow));
  vec3 col = mix(body, sky, F) + sun * spec;
  float foam = 0.0;
  if (floorH > 0.6) {
    float ribs = texture2D(uDetail, uv / 3.1 + 0.5).a;
    col = mix(col, uSand * lit * 0.6, smoothstep(0.88, 0.99, floorH + (ribs - 0.5) * 0.04) * (1.0 - F));
    float breathe = sin(uTime * 0.5 + wobble * 9.0) * 0.006;
    float surf = smoothstep(0.952, 0.982, floorH + wobble * 0.025 + breathe) * (0.75 + 0.25 * ribs);
    vec2 toShore = coastWide.ba * 2.0 - 1.0;
    float onshore = mix(0.35, 1.0, smoothstep(-0.2, 0.6, dot(uWindDir, toShore)));
    float lines = floorH * 13.0 - uTime * 0.06;
    float crestLine = fract(lines);
    float line = smoothstep(0.0, 0.1, crestLine) * (1.0 - smoothstep(0.1, 0.45, crestLine));
    line *= 1.0 - smoothstep(0.12, 0.3, linesWidth);
    float broken = smoothstep(0.45, 0.62, texture2D(uDetail, xz / 15.0 + vec2(lines * 0.012, 0.0)).a);
    float waves = line * broken * smoothstep(0.62, 0.8, floorH) * (1.0 - smoothstep(0.93, 0.96, floorH)) * onshore * 0.55;
    foam = max(foam, max(surf, waves) * uShowSurf);
  }

  // Whitecaps: foam where the crests pinch to breaking, more the harder it blows, broken into streaks along the
  // wind.
  float breakup = texture2D(uDetail, vec2(uv.x / 9.0, uv.y / 4.0) + vec2(uTime * 0.006, 0.0)).a;
  // How near breaking: how many standard deviations this crest's sharpness stands above the sea's (so it holds
  // at every zoom, however many of the short waves have faded out). Only the sharpest few percent break in a
  // fresh breeze, a good share of the sea in a gale.
  float breaking = (1.0 - pinch) / max(sqrt(spread * 0.5), 1e-4);
  float caps = smoothstep(mix(2.6, 1.5, smoothstep(0.5, 1.1, uStrength)), mix(3.4, 2.4, smoothstep(0.5, 1.1, uStrength)), breaking) * smoothstep(0.35, 0.7, uStrength);
  // Broken into the streaks and flecks of real whitecaps, drawn out along the wind, never a solid patch.
  // Two fine scales of broken foam: the core of a breaking crest stays fairly whole, its edges fray to flecks.
  float fray = texture2D(uDetail, vec2(uv.x / 1.4, uv.y / 0.55) + vec2(uTime * 0.012, 0.0)).a * 0.6
    + texture2D(uDetail, vec2(uv.x / 0.5, uv.y / 0.22) + vec2(uTime * 0.02, 0.43)).a * 0.4;
  caps = smoothstep(0.7, 0.85, fray + caps * 0.35) * smoothstep(0.05, 0.5, caps) * 0.85;
  // Gone before a whitecap would be a pixel or two (far out they'd make a speckled pattern, not a sea).
  float footprint = length(fwidth(xz));
  caps *= 1.0 - smoothstep(0.12, 0.35, footprint);
  foam = max(foam, caps * uShowFlecks * (1.0 - smoothstep(0.6, 0.85, shallow)));

  // Wakes: read from the stamped target, and alive: wavelets on the V's arms, churned water fixed where she left
  // it, the arms' crests breaking white, and the white water at her hull.
  vec2 wuv = (xz - uWakeArea.xy) / uWakeArea.z;
  vec2 edge = smoothstep(0.0, 0.08, wuv) * smoothstep(0.0, 0.08, 1.0 - wuv);
  vec4 w = texture2D(uWake, wuv) * edge.x * edge.y;
  float wn = (1.0 - w.g) * ${WAKE_MARGIN.toFixed(3)};
  float behind = w.b;
  float divPhase = (wn * 7.0 - behind * 1.3) * 6.2832 - uTime * 2.4;
  float divFine = 1.0 - smoothstep(0.6, 1.2, fwidth(divPhase));
  if (w.r + w.a > 0.002) {
    float life = w.r;
    float beams = wn * (1.0 + behind * ${WAKE_WIDENING.toFixed(4)});
    float armZone = smoothstep(0.3, 0.7, wn) * (1.0 - smoothstep(1.05, 1.35, wn));
    vec2 turn = vec2(uTime * 0.045, uTime * 0.029);
    float boil = texture2D(uDetail, uv / 1.3 + turn).a * 0.6 + texture2D(uDetail, uv / 0.55 - turn * 1.7 + 0.31).a * 0.4;
    float track = (1.0 - smoothstep(0.25, 1.1 + behind * 0.9, beams)) * (1.0 - smoothstep(1.0, 3.2, behind));
    float erode = mix(0.22, 0.72, 1.0 - life);
    float churn = track * smoothstep(erode, erode + 0.16, boil);
    float crests = smoothstep(0.5, 0.95, sin(divPhase)) * armZone * divFine * (1.0 - smoothstep(0.6, 2.4, behind)) * smoothstep(0.3, 0.6, boil);
    float spray = 0.5 + 0.8 * texture2D(uDetail, uv / 0.8 + 0.4 + turn * 0.5).a;
    float hull = w.a * smoothstep(0.15, 0.6, w.a * (0.4 + 0.85 * spray));
    foam = max(foam, max(life * max(churn * 0.95, crests * 0.6), hull) * uShowWakes);
  }

  // Foam lies on the water, lit by the sky and the sun (as a white surface is: bright, never glowing).
  col = mix(col, uFoam * min(lit * 0.5, vec3(1.15)), clamp(foam, 0.0, 1.0));

  // Haze toward the horizon.
  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, 1.0);
}
`;

interface Wave {
  dir: THREE.Vector2;
  k: number;
  height: number;
  q: number;
  phase: number;
  omega: number;
}

/**
 * The sea over a map of `mapW` x `mapH` tiles; `depth` is the game's sea-floor texture (one texel a tile: R the
 * floor's height, 0 deep .. 1 at the shoreline; G nearness to land). For review, `shown` hides layers by name
 * (`?sea=plain,flecks`): swell (the waves), ripples (the fine chop), flecks (whitecaps), shadows (the clouds'),
 * surf, waves (the water ships push), wakes.
 */
export function createOcean(depth: THREE.Texture, mapW: number, mapH: number, shown: (layer: string) => boolean = () => true): Ocean {
  // The grid: rings out to the horizon, spaced as RING_STEP + RING_GROWTH * r.
  const radii = [0];
  while (radii.at(-1)! < RADIUS) radii.push(radii.at(-1)! + RING_STEP + RING_GROWTH * radii.at(-1)!);
  const positions = new Float32Array(radii.length * (SEGMENTS + 1) * 3);
  radii.forEach((r, j) => {
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      positions.set([Math.cos(a) * r, 0, Math.sin(a) * r], (j * (SEGMENTS + 1) + i) * 3);
    }
  });
  const index: number[] = [];
  for (let j = 0; j + 1 < radii.length; j++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * (SEGMENTS + 1) + i;
      const b = a + SEGMENTS + 1;
      // Wound to face up.
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);

  const waves: Wave[] = SPECTRUM.map((s) => ({ dir: new THREE.Vector2(0, -1), k: 1, height: 0, q: 0, phase: s.phase, omega: 0 }));
  const detail = detailTexture();
  const wakes = createWakes();
  const pushed = createWaves();
  const show = (layer: string) => (shown(layer) ? 1 : 0);
  const uniforms = {
    uCenter: { value: new THREE.Vector2() },
    uWave: { value: waves.map(() => new THREE.Vector4()) },
    uQ: { value: waves.map(() => 0) },
    uPhase: { value: waves.map(() => 0) },
    uFade: { value: waves.map(() => new THREE.Vector2()) },
    uCoast: { value: coastTexture(depth, mapW, mapH) },
    uMapSize: { value: new THREE.Vector2(mapW, mapH) },
    uDetail: { value: detail },
    uChop: { value: chopTexture() },
    uWake: { value: wakes.texture },
    uWakeArea: { value: wakes.area },
    uWaves: { value: pushed.texture },
    uWaveArea: { value: pushed.area },
    uTime: { value: 0 },
    uFrame: { value: new THREE.Vector4(0, -1, 1, 0) },
    uOffset: { value: new THREE.Vector2() },
    uCloudOffset: { value: new THREE.Vector2() },
    uWindDir: { value: new THREE.Vector2(0, -1) },
    uStrength: { value: 0.5 },
    uHs: { value: 0.1 },
    uDeep: { value: COLOURS.deep.clone() },
    uScatter: { value: COLOURS.scatter.clone() },
    uShallow: { value: COLOURS.shallow.clone() },
    uSand: { value: COLOURS.sand.clone() },
    uFoam: { value: COLOURS.foam.clone() },
    uSun: { value: new THREE.Color(2, 2, 2) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uAmbient: { value: new THREE.Color(0.6, 0.7, 0.8) },
    uZenith: { value: new THREE.Color(0.1, 0.3, 0.7) },
    uHorizon: { value: new THREE.Color(0.6, 0.75, 0.9) },
    uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: 0 },
    uShowSwell: { value: show('swell') },
    uShowRipples: { value: show('ripples') },
    uShowFlecks: { value: show('flecks') },
    uShowShadows: { value: show('shadows') },
    uShowSurf: { value: show('surf') },
    uShowWaves: { value: show('waves') },
    uShowWakes: { value: show('wakes') },
  };
  const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Water first among the opaque things, so the islands and hulls draw over it.
  mesh.renderOrder = -1;

  // The sea's state, eased toward the wind's: the direction it moves (radians, clockwise from north) and how hard.
  let heading: number | undefined;
  let strength = 0.5;
  let last: number | undefined;
  const anchor = new THREE.Vector2();
  const drift = new THREE.Vector2();
  const along = new THREE.Vector2();
  const across = new THREE.Vector2();
  let shipsThisFrame: WakeShip[] = [];
  // The water ships push steps when the renderer draws (it draws into its own targets): the frame's time and ships.
  let pushDt = 0;
  let pushShips: WakeShip[] = [];

  /** Turns the textures' frame to a new heading, keeping them still at the anchor (else far water would race round). */
  const setFrame = (to: number) => {
    const before = new THREE.Vector2(along.dot(anchor), across.dot(anchor));
    along.set(Math.sin(to), -Math.cos(to));
    across.set(Math.cos(to), Math.sin(to));
    const after = new THREE.Vector2(along.dot(anchor), across.dot(anchor));
    uniforms.uOffset.value.add(before).sub(after);
    uniforms.uFrame.value.set(along.x, along.y, across.x, across.y);
  };

  /** The waves' horizontal push and height at a point of the undisturbed surface. */
  const gerstner = (x: number, z: number) => {
    let dx = 0;
    let dz = 0;
    let h = 0;
    for (const w of waves) {
      const arg = w.k * (w.dir.x * x + w.dir.y * z) - w.phase;
      const c = Math.cos(arg);
      dx += w.q * w.height * w.dir.x * c;
      dz += w.q * w.height * w.dir.y * c;
      h += w.height * Math.sin(arg);
    }
    return [dx, dz, h] as const;
  };

  mesh.onBeforeRender = (renderer, _scene, camera) => {
    // Before the water draws: step the water ships push, and stamp the wakes, round the target.
    pushed.step(renderer, anchor.x, anchor.y, pushDt, pushShips);
    uniforms.uWaves.value = pushed.texture;
    pushDt = 0;
    const view = camera.position.distanceTo(new THREE.Vector3(anchor.x, 0, anchor.y));
    wakes.render(renderer, anchor.x, anchor.y, THREE.MathUtils.clamp(view * WAKE_AREA.perDistance, WAKE_AREA.min, WAKE_AREA.max));
  };

  return {
    mesh,
    update(at, sea, t, light) {
      const dt = last === undefined ? 0 : THREE.MathUtils.clamp(t - last, 0, 0.1);
      last = t;
      anchor.set(at.x, at.z);
      // Ease toward the wind (the short way round); the waves and textures turn about the camera's target.
      const want = (sea.toDeg * Math.PI) / 180;
      if (heading === undefined) {
        heading = want;
        strength = sea.strength;
      } else {
        const turn = Math.atan2(Math.sin(want - heading), Math.cos(want - heading));
        heading += turn * (1 - Math.exp(-dt * SEA_EASE));
        strength += (sea.strength - strength) * (1 - Math.exp(-dt * SEA_EASE));
      }
      const swellOn = shown('swell') ? 1 : 0;
      const peak = PEAK_LENGTH(strength);
      const hs = SIGNIFICANT_HEIGHT(strength);
      const heights = SPECTRUM.map((s) => s.weight * WEIGHT_NORM * hs * swellOn);
      const choppy = CHOPPY(strength);
      const sumKA = SPECTRUM.reduce((n, s, i) => n + ((Math.PI * 2) / (peak * s.ratio)) * heights[i]!, 0) || 1;
      waves.forEach((w, i) => {
        const s = SPECTRUM[i]!;
        const k = (Math.PI * 2) / (peak * s.ratio);
        const a = heading! + s.off;
        const dir = new THREE.Vector2(Math.sin(a), -Math.cos(a));
        // Keep each wave's phase where the camera is as the sea turns and grows (else the water there would jump).
        w.phase += k * dir.dot(anchor) - w.k * w.dir.dot(anchor);
        w.k = k;
        w.dir.copy(dir);
        w.omega = Math.sqrt(GRAVITY * k) * PACE;
        w.phase = (w.phase + w.omega * dt) % (Math.PI * 2);
        w.height = heights[i]!;
        // Choppiness shared out by each wave's steepness, so all of them together sharpen the crests by `choppy`.
        w.q = choppy / sumKA;
        uniforms.uWave.value[i]!.set(w.dir.x, w.dir.y, w.k, w.height);
        uniforms.uQ.value[i] = w.q;
        uniforms.uPhase.value[i] = w.phase;
        // Rolled in the mesh only where its grid has six points to the wavelength.
        const fadeAt = ((peak * s.ratio) / 6 - RING_STEP) / RING_GROWTH;
        uniforms.uFade.value[i]!.set(Math.max(0, fadeAt * 0.6), Math.max(0.001, fadeAt));
      });
      uniforms.uHs.value = hs;
      setFrame(heading);
      // The textures drift downwind: in the wind's frame, along its first axis.
      const pace = THREE.MathUtils.lerp(DRIFT[0]!, DRIFT[1]!, Math.min(1, strength));
      uniforms.uOffset.value.x -= pace * dt;
      drift.set(along.x * pace, along.y * pace);
      uniforms.uCloudOffset.value.addScaledVector(along, -strength * CLOUD_SPEED * dt);
      uniforms.uWindDir.value.copy(along);
      uniforms.uStrength.value = strength;
      uniforms.uTime.value = t;
      // The grid follows the target, snapped so its points don't slide over the waves.
      uniforms.uCenter.value.set(Math.round(at.x * 2) / 2, Math.round(at.z * 2) / 2);
      wakes.update(shipsThisFrame, dt, drift);
      pushDt += dt;
      pushShips = shipsThisFrame;
      shipsThisFrame = [];

      // The light, as the scene has it (linear).
      // Under cloud the deep water loses its blue to a grey-green.
      uniforms.uDeep.value.copy(COLOURS.deep).lerp(COLOURS.stormDeep, (light.overcast ?? 0) * 0.85);
      uniforms.uSunDir.value.copy(light.sunDir);
      uniforms.uSun.value.copy(light.sun).multiplyScalar(light.power ?? 2);
      uniforms.uHorizon.value.copy(light.sky);
      uniforms.uZenith.value.copy(light.zenith ?? light.sky.clone().multiplyScalar(0.5));
      uniforms.uAmbient.value.copy(light.ambient ?? light.sky);
      uniforms.uFogColor.value.copy(light.fog);
      uniforms.uFogDensity.value = light.fogDensity;
    },
    ships(ships) {
      shipsThisFrame = ships;
    },
    splash(x, z, size) {
      pushed.splash(x, z, size);
    },
    // The surface under a point: the waves push the water sideways as well as up, so find which undisturbed point
    // lands here (two steps of refinement are plenty), then take its height. The mesh fades the shortest waves out
    // far from the target, but ships that far off are drawn too small for the difference to show.
    heightAt(x, z) {
      let px = x;
      let pz = z;
      for (let i = 0; i < 2; i++) {
        const [dx, dz] = gerstner(px, pz);
        px = x - dx;
        pz = z - dz;
      }
      return gerstner(px, pz)[2];
    },
  };
}
