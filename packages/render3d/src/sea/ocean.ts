import * as THREE from 'three';
import { coastTexture, detailTexture } from './textures';
import { screen, SCREEN_TO_SCENE, toScreen } from './tone';
import { createWakes, WAKE_MARGIN, WAKE_WIDENING } from './wakes';
import type { WakeShip } from './wakes';

// The sea (art direction: Sid Meier's Pirates! 2004, in HD; see docs/reference/ocean-renderer.md): one soft,
// even cerulean with a fine hammered texture and pale flecks along the wind, turquoise shallows round the
// islands with surf on the shore, and ships' wakes, all on one camera-following mesh and worked out in its
// fragment shader. The mesh carries only a few long, low swells for the ships to ride.
//
// Two rules keep it calm and clean at every zoom. Every pattern finer than the mesh comes from a mipmapped
// texture or is faded out (fwidth) before it gets finer than a couple of pixels, so nothing aliases into stripes
// or shimmers. And everything on the water drifts the one way, downwind, at speeds that belong together.

export type { WakeShip } from './wakes';

/**
 * Clouds and their shadows drift downwind this many tiles a second at full strength: slowly (an unhurried drift
 * across the view, not a sweep), so the wind reads without hurrying the eye.
 */
export const CLOUD_SPEED = 0.25;

/** The sea's state: it moves toward `toDeg` (where the wind goes, clockwise from north), as hard as `strength` (0..1). */
export interface SeaState {
  toDeg: number;
  strength: number;
}

export interface SeaLight {
  sunDir: THREE.Vector3;
  sun: THREE.Color;
  sky: THREE.Color;
  /** 0..1, night to full day. */
  level: number;
  fog: THREE.Color;
  fogDensity: number;
}

export interface Ocean {
  mesh: THREE.Mesh;
  /** Each frame: follow the camera's target, move the sea with the wind, light the water. */
  update(at: THREE.Vector3, sea: SeaState, t: number, light: SeaLight): void;
  /** Each frame: the ships whose wakes, bow waves and hull foam to draw. */
  ships(ships: WakeShip[]): void;
  /** The height of the water (the swell the mesh rolls) at a point, as of the last update, for ships riding it. */
  heightAt(x: number, z: number): number;
}


// The palette, as it should look on screen at midday (measured from the reference footage: the open sea about
// hue 209, saturation 0.52, value 0.76; the shallows a bright turquoise with sand showing through).
const PALETTE = {
  deep: '#5d91c2',
  shelf: '#4fa8d0',
  apron: '#3fcdd3',
  shallow: '#8fe3d8',
  sand: '#d8ecd0',
  foam: '#e8f4f7',
};

/** Swells: wavelength (tiles), height at full strength (tiles), angle off the wind (degrees), speed (tiles a second). */
const SWELLS: [length: number, height: number, offDeg: number, speed: number][] = [
  [26, 0.07, 0, 0.42],
  [15, 0.04, 17, 0.3],
  [9.5, 0.022, -21, 0.24],
];
/**
 * The grid: polar round the camera's target, its spacing growing with the radius (RING_STEP + RING_GROWTH * r)
 * out to the horizon. A swell is rolled only where the grid has at least six points to its wavelength, so it
 * fades out with distance before it could alias.
 */
const SEGMENTS = 256;
const RING_STEP = 0.35;
const RING_GROWTH = 0.03;
const RADIUS = 3000;
/** The surface drift (tiles a second), at no wind and at full strength: the texture, flecks and wakes all move at it. */
const DRIFT = [0.025, 0.09];
/** How fast the swell turns to a new wind, and grows or dies with it (per second): slowly, as a sea does. */
const SEA_EASE = 0.08;
/** The wakes' area round the target, in camera distances, and its limits (tiles). */
const WAKE_AREA = { perDistance: 2.4, min: 30, max: 260 };

const VERT = /* glsl */ `
uniform vec2 uCenter;
uniform vec4 uSwell[3];
uniform float uPhase[3];
uniform vec2 uSwellFade[3];
uniform sampler2D uCoast;
uniform vec2 uMapSize;
varying vec3 vWorld;
varying float vRadius;
void main() {
  vec2 xz = position.xz + uCenter;
  float r = length(position.xz);
  // No swell on the beach itself, so the waterline stays where the land has it.
  float beach = 1.0 - smoothstep(0.9, 0.985, texture2D(uCoast, xz / uMapSize).r);
  float h = 0.0;
  for (int i = 0; i < 3; i++) {
    float fade = 1.0 - smoothstep(uSwellFade[i].x, uSwellFade[i].y, r);
    h += uSwell[i].w * fade * sin(dot(uSwell[i].xy, xz) * uSwell[i].z - uPhase[i]);
  }
  vec3 world = vec3(xz.x, h * beach, xz.y);
  vWorld = world;
  vRadius = r;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
${SCREEN_TO_SCENE}
uniform sampler2D uCoast;
uniform sampler2D uDetail;
uniform sampler2D uWake;
uniform vec3 uWakeArea;
uniform vec2 uMapSize;
uniform float uTime;
uniform vec4 uSwell[3];
uniform float uPhase[3];
uniform vec2 uSwellFade[3];
// The wind's frame for the texture: rows along and across the wind, and its drifting offset.
uniform vec4 uFrame;
uniform vec2 uOffset;
uniform vec2 uCloudOffset;
uniform vec2 uWindDir;
uniform float uStrength;
uniform vec3 uDeep, uShelf, uApron, uShallow, uSand, uFoam;
uniform vec3 uLight;
uniform vec3 uSkyLit;
uniform vec2 uSunFlat;
uniform vec3 uFogColor;
uniform float uFogDensity;
// Layers, for review: swell, ripples, flecks, shadows, surf (1 shown, 0 hidden).
uniform float uShowSwell, uShowRipples, uShowFlecks, uShowShadows, uShowSurf;
varying vec3 vWorld;
varying float vRadius;

void main() {
  vec2 xz = vWorld.xz;
  vec2 uv = vec2(dot(uFrame.xy, xz), dot(uFrame.zw, xz)) + uOffset;
  // Detail stays to about nine texture reads a pixel on open water (CPU-rendered WebGL must keep up too); the
  // shallows and the wakes read more only where they are. Their branches start and end where what they add is
  // nil, and every screen-space derivative is taken before them.

  // Shallows: the floor's height, its smoothed shallowness, and the way to the shore. The lookups wander a
  // little with a medium noise, so the map's one-texel-a-tile grid never shows in the coast.
  vec4 medium = texture2D(uDetail, xz / 23.0);
  float wobble = medium.a - 0.5;
  float wobble2 = medium.b - 0.5;
  vec4 coastNear = texture2D(uCoast, (xz + vec2(wobble, wobble2) * 0.35) / uMapSize);
  vec4 coastWide = texture2D(uCoast, (xz + vec2(wobble2, -wobble) * 1.4) / uMapSize);
  float floorH = coastNear.r;
  float shallow = coastWide.g;
  float open = 1.0 - smoothstep(0.55, 0.8, shallow);
  float linesWidth = fwidth(floorH) * 13.0;

  // The water's colour by depth: cerulean, a brighter shelf, the turquoise apron.
  vec3 col = uDeep;
  col = mix(col, uShelf, smoothstep(0.42, 0.62, shallow));
  col = mix(col, uApron, smoothstep(0.6, 0.8, shallow));

  // The hammered surface: two scales of shallow dents, drifting with the water; fades out with distance on its own (mipmaps).
  float dents = (texture2D(uDetail, uv / 5.3).r - 0.5) * 0.6 + (texture2D(uDetail, uv / 2.2 + vec2(0.37, 0.61)).r - 0.5) * 0.4;
  col *= 1.0 + dents * 0.075 * uShowRipples * mix(0.6, 1.0, open);

  // The swell's own light: brighter on faces toward the sun, worked out per pixel.
  vec2 slope = vec2(0.0);
  for (int i = 0; i < 3; i++) {
    float phase = dot(uSwell[i].xy, xz) * uSwell[i].z - uPhase[i];
    // Gone before a wavelength spans fewer than about 150 pixels: any shorter and a swell reads as stripes.
    float fine = 1.0 - smoothstep(0.025, 0.045, fwidth(phase));
    slope += uSwell[i].xy * uSwell[i].z * uSwell[i].w * cos(phase) * fine;
  }
  col *= 1.0 + dot(slope, uSunFlat) * 1.6 * uShowSwell;

  // Cloud shadows: large, very soft, a few percent darker, drifting with the clouds.
  float cloud = texture2D(uDetail, (xz + uCloudOffset) / 150.0).b;
  col *= 1.0 - 0.08 * smoothstep(0.52, 0.74, cloud) * uShowShadows;

  // Whitecap flecks: small soft flecks drawn out along the wind, showing in patches that come and go slowly
  // (the patches drift a little slower than the water, so each fleck fades in and out as it goes).
  float fleck = texture2D(uDetail, vec2(uv.x / 24.0, uv.y / 9.0)).g;
  float patches = smoothstep(0.62 - uStrength * 0.16, 0.78 - uStrength * 0.08, texture2D(uDetail, uv / 47.0 + vec2(uTime * 0.0011, 0.21)).b);
  float whitecap = fleck * patches * smoothstep(0.2, 1.0, uStrength) * 0.8 * open * uShowFlecks;
  col = mix(col, uFoam, clamp(whitecap, 0.0, 1.0));

  // Near the shore: sand showing through, white water on the beach, gently breathing, and soft broken wave
  // lines rolling in across the shallows, strongest where the wind blows onshore.
  if (floorH > 0.6) {
    col = mix(col, uShallow, smoothstep(0.83, 0.96, floorH + wobble * 0.05));
    float ribs = texture2D(uDetail, uv / 3.1 + 0.5).a;
    col = mix(col, uSand, smoothstep(0.93, 0.99, floorH + (ribs - 0.5) * 0.04));
    float breathe = sin(uTime * 0.5 + wobble * 9.0) * 0.006;
    float surf = smoothstep(0.952, 0.982, floorH + wobble * 0.025 + breathe) * (0.75 + 0.25 * ribs);
    vec2 toShore = coastWide.ba * 2.0 - 1.0;
    float onshore = mix(0.35, 1.0, smoothstep(-0.2, 0.6, dot(uWindDir, toShore)));
    float lines = floorH * 13.0 - uTime * 0.06;
    float crest = fract(lines);
    float line = smoothstep(0.0, 0.1, crest) * (1.0 - smoothstep(0.1, 0.45, crest));
    line *= 1.0 - smoothstep(0.12, 0.3, linesWidth);
    float broken = smoothstep(0.45, 0.62, texture2D(uDetail, xz / 15.0 + vec2(lines * 0.012, 0.0)).a);
    float waves = line * broken * smoothstep(0.62, 0.8, floorH) * (1.0 - smoothstep(0.93, 0.96, floorH)) * onshore * 0.55;
    col = mix(col, uFoam, clamp(max(surf, waves) * uShowSurf, 0.0, 1.0));
  }

  // Wakes: read from the stamped target. A churned white track straight behind her, the V's two arms, and
  // faint combed streaks between them that run with her track and fan out as the wake widens.
  vec2 wuv = (xz - uWakeArea.xy) / uWakeArea.z;
  vec2 edge = smoothstep(0.0, 0.08, wuv) * smoothstep(0.0, 0.08, 1.0 - wuv);
  vec4 w = texture2D(uWake, wuv) * edge.x * edge.y;
  float combWidth = fwidth(w.g) * ${(5 * WAKE_MARGIN).toFixed(3)};
  if (w.r + w.a > 0.002) {
    // Across the wake (0 her track .. 1 the V's arms), and how far behind her, in her lengths.
    float n = (1.0 - w.g) * ${WAKE_MARGIN.toFixed(3)};
    float behind = w.b;
    // Across in half-beams, for the churned track that stays about her width as the V opens round it.
    float beams = n * (1.0 + behind * ${WAKE_WIDENING.toFixed(4)});
    vec4 churn = texture2D(uDetail, vec2(behind * 0.25, n * 0.08));
    float mottle = texture2D(uDetail, vec2(behind * 0.9, n * 0.3) + 0.13).a;
    float comb = n * 5.0 + (churn.a - 0.5) * 1.6;
    float streak = pow(0.5 + 0.5 * cos(6.2832 * comb), 3.0) * smoothstep(0.35, 0.6, churn.b + 0.1);
    streak = mix(streak, 0.12, smoothstep(0.15, 0.4, combWidth));
    float arms = smoothstep(0.72, 0.92, n) * (1.0 - smoothstep(0.95, 1.2, n)) * (1.0 - smoothstep(1.5, 3.8, behind));
    float track = (1.0 - smoothstep(0.2, 1.1 + behind * 0.9, beams)) * (1.0 - smoothstep(1.0, 3.0, behind));
    float inside = 1.0 - smoothstep(0.95, 1.2, n);
    float spray = 0.5 + 0.8 * texture2D(uDetail, xz / 0.8 + 0.4).a;
    float wake = w.r * spray * max(track * smoothstep(0.1, 0.55, mottle + 0.4 * (1.0 - behind * 0.5)), max(arms * 0.5, streak * 0.45 * inside) * (0.5 + 0.6 * mottle));
    float hull = w.a * smoothstep(0.15, 0.6, w.a * (0.4 + 0.85 * spray));
    col = mix(col, uFoam, clamp(max(wake, hull), 0.0, 1.0));
  }

  // Painted, not mirrored: lit by the hour, the sky's colour creeping in toward the horizon, then the haze;
  // all in screen colours, carried back to the scene's linear light at the end.
  col *= uLight;
  vec3 view = normalize(cameraPosition - vWorld);
  float fresnel = pow(1.0 - max(view.y, 0.0), 5.0);
  col = mix(col, uSkyLit, fresnel * 0.35);
  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(screenToScene(col), 1.0);
}
`;

interface Swell {
  dir: THREE.Vector2;
  k: number;
  height: number;
  phase: number;
}

/**
 * The sea over a map of `mapW` x `mapH` tiles; `depth` is the game's sea-floor texture (one texel a tile: R the
 * floor's height, 0 deep .. 1 at the shoreline; G nearness to land). For review, `shown` hides layers by name
 * (`?sea=plain,flecks`): swell, ripples (the hammered texture), flecks, shadows (the clouds'), surf.
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

  const swells: Swell[] = SWELLS.map(([length, height]) => ({ dir: new THREE.Vector2(0, -1), k: (Math.PI * 2) / length, height, phase: 0 }));
  // Where each swell must be gone by: the radius at which the grid has six points to its wavelength.
  const fadeAt = SWELLS.map(([length]) => {
    const r = (length / 6 - RING_STEP) / RING_GROWTH;
    return new THREE.Vector2(r * 0.6, r);
  });
  const detail = detailTexture();
  const wakes = createWakes();
  const show = (layer: string) => (shown(layer) ? 1 : 0);
  const uniforms = {
    uCenter: { value: new THREE.Vector2() },
    uSwell: { value: swells.map(() => new THREE.Vector4()) },
    uPhase: { value: swells.map(() => 0) },
    uSwellFade: { value: fadeAt },
    uCoast: { value: coastTexture(depth, mapW, mapH) },
    uMapSize: { value: new THREE.Vector2(mapW, mapH) },
    uDetail: { value: detail },
    uWake: { value: wakes.texture },
    uWakeArea: { value: wakes.area },
    uTime: { value: 0 },
    uFrame: { value: new THREE.Vector4(0, -1, 1, 0) },
    uOffset: { value: new THREE.Vector2() },
    uCloudOffset: { value: new THREE.Vector2() },
    uWindDir: { value: new THREE.Vector2(0, -1) },
    uStrength: { value: 0.5 },
    uDeep: { value: screen(PALETTE.deep) },
    uShelf: { value: screen(PALETTE.shelf) },
    uApron: { value: screen(PALETTE.apron) },
    uShallow: { value: screen(PALETTE.shallow) },
    uSand: { value: screen(PALETTE.sand) },
    uFoam: { value: screen(PALETTE.foam) },
    uLight: { value: new THREE.Color(1, 1, 1) },
    uSkyLit: { value: new THREE.Color() },
    uExposure: { value: 1 },
    uSunFlat: { value: new THREE.Vector2() },
    uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: 0 },
    uShowSwell: { value: show('swell') },
    uShowRipples: { value: show('ripples') },
    uShowFlecks: { value: show('flecks') },
    uShowShadows: { value: show('shadows') },
    uShowSurf: { value: show('surf') },
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
  const swellOn = shown('swell') ? 1 : 0;
  // Midday's light, so the palette shows as authored at noon.
  const NOON_SUN = new THREE.Color('#fff4d6');
  const NOON_SKY = new THREE.Color('#9fd3f0');
  const SUN_SHARE = 0.65;
  /** How much of the hour's colour the water takes, and how bright it is at night (share of noon, on screen). */
  const TINT = 0.2;
  const NIGHT_VALUE = 0.45;
  const NOON = NOON_SUN.clone().multiplyScalar(SUN_SHARE * Math.sin((70 * Math.PI) / 180)).add(NOON_SKY.clone().multiplyScalar(1 - SUN_SHARE));
  let shipsThisFrame: WakeShip[] = [];

  /** Turns the texture's frame to a new heading, keeping it still at the anchor (else far water would race round). */
  const setFrame = (to: number) => {
    const before = new THREE.Vector2(along.dot(anchor), across.dot(anchor));
    along.set(Math.sin(to), -Math.cos(to));
    across.set(Math.cos(to), Math.sin(to));
    const after = new THREE.Vector2(along.dot(anchor), across.dot(anchor));
    uniforms.uOffset.value.add(before).sub(after);
    uniforms.uFrame.value.set(along.x, along.y, across.x, across.y);
  };

  mesh.onBeforeRender = (renderer, _scene, camera) => {
    uniforms.uExposure.value = renderer.toneMappingExposure;
    // Before the water draws: stamp the wakes round the target, over an area that grows with the view.
    const view = camera.position.distanceTo(new THREE.Vector3(anchor.x, 0, anchor.y));
    wakes.render(renderer, anchor.x, anchor.y, THREE.MathUtils.clamp(view * WAKE_AREA.perDistance, WAKE_AREA.min, WAKE_AREA.max));
  };

  return {
    mesh,
    update(at, sea, t, light) {
      const dt = last === undefined ? 0 : THREE.MathUtils.clamp(t - last, 0, 0.1);
      last = t;
      anchor.set(at.x, at.z);
      // Ease toward the wind (the short way round); the swell and texture turn about the camera's target.
      const want = (sea.toDeg * Math.PI) / 180;
      if (heading === undefined) {
        heading = want;
        strength = sea.strength;
      } else {
        const turn = Math.atan2(Math.sin(want - heading), Math.cos(want - heading));
        heading += turn * (1 - Math.exp(-dt * SEA_EASE));
        strength += (sea.strength - strength) * (1 - Math.exp(-dt * SEA_EASE));
      }
      for (let i = 0; i < swells.length; i++) {
        const s = swells[i]!;
        const [, height, offDeg, speed] = SWELLS[i]!;
        const a = heading + (offDeg * Math.PI) / 180;
        const dir = new THREE.Vector2(Math.sin(a), -Math.cos(a));
        // Keep the swell's phase where the camera is as it turns.
        s.phase += s.k * (dir.dot(anchor) - s.dir.dot(anchor));
        s.dir.copy(dir);
        s.phase += s.k * speed * dt;
        s.height = height * (0.25 + 0.75 * strength) * swellOn;
        uniforms.uSwell.value[i]!.set(s.dir.x, s.dir.y, s.k, s.height);
        uniforms.uPhase.value[i] = s.phase;
      }
      setFrame(heading);
      // The texture drifts downwind: in the wind's frame, along its first axis.
      const pace = THREE.MathUtils.lerp(DRIFT[0]!, DRIFT[1]!, strength);
      uniforms.uOffset.value.x -= pace * dt;
      drift.set(along.x * pace, along.y * pace);
      uniforms.uCloudOffset.value.addScaledVector(along, -strength * CLOUD_SPEED * dt);
      uniforms.uWindDir.value.copy(along);
      uniforms.uStrength.value = strength;
      uniforms.uTime.value = t;
      // The grid follows the target, snapped so its points don't slide over the swell.
      uniforms.uCenter.value.set(Math.round(at.x * 2) / 2, Math.round(at.z * 2) / 2);
      wakes.update(shipsThisFrame, dt, drift);
      shipsThisFrame = [];

      // The hour's light, as a share of noon's, so midday shows the palette as authored.
      const sunUp = Math.max(0, light.sunDir.y);
      const lit = light.sun.clone().multiplyScalar(SUN_SHARE * sunUp).add(light.sky.clone().multiplyScalar(1 - SUN_SHARE));
      // Painted light: the water keeps its own hues (a sunset sea is still blue, not grey), taking a touch of the
      // hour's colour as a share of noon's, and dims toward a moonlit night that still reads.
      const r = lit.r / NOON.r;
      const g = lit.g / NOON.g;
      const b = lit.b / NOON.b;
      const peak = Math.max(r, g, b) || 1;
      const bright = THREE.MathUtils.lerp(NIGHT_VALUE, 1, THREE.MathUtils.smoothstep(light.level, 0.55, 1));
      uniforms.uLight.value.setRGB(1 + (r / peak - 1) * TINT, 1 + (g / peak - 1) * TINT, 1 + (b / peak - 1) * TINT).multiplyScalar(bright);
      // The sky and the haze as the dome shows them on screen, so the water meets the horizon in its colour.
      const exposure = uniforms.uExposure.value;
      toScreen(light.sky, exposure, uniforms.uSkyLit.value);
      uniforms.uSunFlat.value.set(light.sunDir.x, light.sunDir.z);
      if (uniforms.uSunFlat.value.lengthSq() > 1e-6) uniforms.uSunFlat.value.normalize();
      toScreen(light.fog, exposure, uniforms.uFogColor.value);
      uniforms.uFogDensity.value = light.fogDensity;
    },
    ships(ships) {
      shipsThisFrame = ships;
    },
    // The full swell everywhere: the mesh fades it out far from the target (where its grid gets coarse), but
    // ships that far off are drawn too small for the difference to show.
    heightAt(x, z) {
      let h = 0;
      for (const s of swells) h += s.height * Math.sin((s.dir.x * x + s.dir.y * z) * s.k - s.phase);
      return h;
    },
  };
}
