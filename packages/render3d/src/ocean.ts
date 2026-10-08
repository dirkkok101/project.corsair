import * as THREE from 'three';

// The sea (art direction: Sid Meier's Pirates! 2004, a bright "Technicolor" sea): a few Gerstner waves rolled
// downwind, aqua over the shallows and deep blue offshore, surf where it meets the land, whitecaps in a
// blow, the sky's colour at a glancing angle and the sun's glint. One plane that follows the camera.
// Distances are in map tiles (one tile is about 2.5 km; ships and swells are drawn far larger than life).

/** One swell: its direction off the wind (degrees), wavelength and height in tiles, and steepness. */
interface Swell {
  offDeg: number;
  length: number;
  amp: number;
  steep: number;
}
const SWELLS: Swell[] = [
  { offDeg: 0, length: 9, amp: 0.07, steep: 0.5 },
  { offDeg: 28, length: 5.3, amp: 0.045, steep: 0.45 },
  { offDeg: -36, length: 3.1, amp: 0.025, steep: 0.4 },
  { offDeg: 64, length: 1.7, amp: 0.012, steep: 0.35 },
];
const GRAVITY = 9.8;
/** Swell speed is scaled down from deep-water physics to read as a lazy roll at this scale. */
const SPEED = 0.12;

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

/** The sea's height at a point and time, for ships riding it (the shader's displacement, vertically). */
export function seaHeight(sea: SeaState, x: number, z: number, t: number): number {
  let y = 0;
  for (const s of SWELLS) {
    const [dx, dz] = swellDir(sea, s);
    const k = (2 * Math.PI) / s.length;
    const c = Math.sqrt(GRAVITY / k) * SPEED;
    y += s.amp * sea.strength * Math.sin(k * (dx * x + dz * z) - k * c * t);
  }
  return y;
}

// The mesh carries only the swells long enough for its grid (shorter ones would alias into stripes); the
// fragment shader lights every swell, per pixel, fading the short ones out with distance.
const MESH_SWELLS = 2;

const VERT = /* glsl */ `
uniform float uTime;
uniform vec4 uSwell[${SWELLS.length}];   // dir.x, dir.z, wavelength, amplitude
uniform float uSteep[${SWELLS.length}];
varying vec3 vWorld;
varying float vCrest;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 p = world.xyz;
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
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
uniform sampler2D uDepth;     // the sea floor: 0 deep .. 1 at the shore and above (see depthTexture)
uniform vec2 uMapSize;
uniform vec3 uDeep;
uniform vec3 uShallow;
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
  // The surface's slope from every swell, the short ones fading out with distance (they'd shimmer).
  vec2 slope = vec2(0.0);
  for (int i = 0; i < ${SWELLS.length}; i++) {
    vec2 d = uSwell[i].xy;
    float k = 6.2831853 / uSwell[i].z;
    float c = sqrt(${GRAVITY.toFixed(1)} / k) * ${SPEED.toFixed(3)};
    float f = k * (dot(d, vWorld.xz) - c * uTime);
    float fade = 1.0 - smoothstep(uSwell[i].z * 6.0, uSwell[i].z * 30.0, dist);
    slope += d * k * uSwell[i].w * cos(f) * fade;
  }
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 v = normalize(cameraPosition - vWorld);
  float floorUp = texture2D(uDepth, vWorld.xz / uMapSize).r;
  // Deep blue offshore, bright aqua over the shallows (Pirates!'s Caribbean).
  vec3 water = mix(uDeep, uShallow, smoothstep(0.35, 0.8, floorUp));
  // The sky in the water at a glancing angle, and the sun's glint.
  float fresnel = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 col = mix(water * uLight, uSky, fresnel * 0.55);
  // Sun sparkle, not a mirrored sun: points of light winking on the ripples (Pirates!'s glittering sea),
  // faded out once a point would be smaller than a pixel (they'd blur into a glare).
  vec2 cell = floor(vWorld.xz * 7.0);
  float wink = step(0.992, hash(cell + floor(uTime * 3.0 + hash(cell) * 7.0)));
  float pixel = length(fwidth(vWorld.xz)) * 7.0;
  col += uSunColor * wink * uLight * (1.0 - smoothstep(0.35, 0.9, pixel)) * 0.9;
  // Surf along the shore, broken up and drifting; whitecaps on the crests in a blow.
  float shore = smoothstep(0.84, 0.97, floorUp) * (0.55 + 0.45 * noise(vWorld.xz * 2.2 + uTime * 0.35));
  float caps = smoothstep(0.08, 0.16, vCrest) * smoothstep(0.85, 1.0, uStrength) * noise(vWorld.xz * 3.0 - uTime * 0.2);
  col = mix(col, vec3(0.95) * max(uLight, 0.25), clamp(shore + caps * 0.7, 0.0, 1.0));
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Plane size in tiles and its grid: dense enough near the camera for the swell to roll. */
const SIZE = 900;
const SEGMENTS = 512;

export interface Ocean {
  mesh: THREE.Mesh;
  /** Each frame: follow the camera's target, set the swell to the wind, light the water for the hour. */
  update(at: THREE.Vector3, sea: SeaState, t: number, light: { sunDir: THREE.Vector3; sun: THREE.Color; sky: THREE.Color; level: number; fog: THREE.Color; fogDensity: number }): void;
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
      uMapSize: { value: new THREE.Vector2(mapW, mapH) },
      uDeep: { value: new THREE.Color('#1a6cb5') },
      uShallow: { value: new THREE.Color('#2fd0cf') },
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
