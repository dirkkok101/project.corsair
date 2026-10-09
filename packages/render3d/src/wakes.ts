import * as THREE from 'three';

// The water a ship works (Pirates! 2004): a wake of fine combed white streaks fanning out astern in a V, with
// churned water just aft of her; a line of foam hugging her hull at the waterline; and a bow wave, white water
// at her stem curling out and back along both sides, all of it stronger the faster she goes. Both lie on the
// swell (each point at the sea's height there), so a crest never buries them.
//
// The wake is kept in world positions, so a ship turning leaves a curved wake.

/** Trail points a wake keeps at most, and how far apart (tiles) they are laid. */
const POINTS = 64;
const SPACING = 0.18;
/**
 * Each stretch of wake lives this many seconds, fading as it ages, then is gone: the wake trails her and
 * dies away behind her rather than drawing a line on the sea.
 */
const LIFE = 6;
/** Half-width where the wake leaves her side, and how much it widens per tile astern (the wake's spread). */
const HALF_WIDTH = 0.16;
const SPREAD = 0.16;
/** How far above the sea the foam lies, so the sea's own surface never shows through it. */
const LIFT = 0.03;
/** A ship's half-beam as a share of her length (the brig's, 0.2 over 2.4). */
const BEAM_SHARE = 0.085;
/** The foam patch round her hull, in her half-lengths along her and her half-beams across. */
const PATCH = { aft: -1.25, fore: 1.45, across: 5, nx: 28, ny: 16 };

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
`;

const WAKE_VERT = /* glsl */ `
attribute float aAge;     // 0 laid just now .. 1 at the end of its life
attribute float aSide;    // -1 port edge .. 1 starboard edge
varying float vAge;
varying float vSide;
varying vec3 vWorld;
void main() {
  vAge = aAge;
  vSide = aSide;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const WAKE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLight;
uniform float uPace;
varying float vAge;
varying float vSide;
varying vec3 vWorld;
${NOISE}
void main() {
  float side = abs(vSide);
  // Combed: many fine streaks running along the wake, each broken into lengths, densest in the two arms of
  // the V and fading in toward the middle; churned water down the middle just astern of her. The breaks are
  // fixed in the water where she left them (not to the ribbon, which moves on with her), so the wake ages in
  // place behind her instead of crawling.
  float combs = smoothstep(0.35, 0.95, 0.5 + 0.5 * sin(vSide * 26.0 + noise(vWorld.xz * 0.9) * 3.0));
  float broken = smoothstep(0.25, 0.75, noise(vWorld.xz * 3.2 + vSide * 2.0));
  float arms = smoothstep(0.35, 0.85, side) * (1.0 - smoothstep(0.9, 1.0, side));
  float streaks = combs * broken * (0.35 + 0.65 * arms);
  float churn = (1.0 - smoothstep(0.0, 0.55, side)) * (1.0 - smoothstep(0.02, 0.3, vAge)) * (0.5 + 0.5 * noise(vWorld.xz * 7.0));
  float a = max(streaks, churn * 0.9) * (1.0 - smoothstep(0.1, 1.0, vAge)) * (0.35 + 0.65 * uPace);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.96, 0.99, 1.0) * max(uLight, 0.35), min(1.0, a));
  #include <colorspace_fragment>
}
`;

const HULL_VERT = /* glsl */ `
attribute vec2 aLocal;    // her half-lengths along (bow +1), her half-beams across (starboard +)
varying vec2 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = aLocal;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const HULL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLight;
uniform float uPace;      // 0 at rest .. 1 a fast ship at full speed
uniform float uLength;    // her length, tiles (for the foam's scale)
uniform float uSpeed;     // tiles a second through the water
varying vec2 vLocal;
varying vec3 vWorld;
${NOISE}
void main() {
  float u = vLocal.x;
  float w = abs(vLocal.y);
  // Her waterline: full amidships, fining to the stem and a narrower stern.
  float hw = u > 0.0 ? pow(max(0.0, 1.0 - u * u), 0.55) : pow(max(0.0, 1.0 - pow(-u / 1.02, 2.4)), 0.5) * 0.9;
  float d = w - hw;                                 // half-beams out from her side
  if (d < -0.05) discard;
  // Water flowing aft past her at exactly her speed through it (the pattern's scale is per tile along her).
  float along = u * uLength * 0.5;
  float flow = uTime * uSpeed;
  float n = noise(vec2((along + flow) * 4.4, w * 2.5)) * 0.6 + noise(vec2((along + flow) * 10.0, w * 6.0)) * 0.4;
  // A line of foam where hull meets water, all round her; brighter forward.
  float lap = exp(-max(d, 0.0) * 6.0) * (0.25 + 0.75 * smoothstep(-0.4, 0.8, u));
  // The bow wave: a crest thrown out from the stem and curling back along each side, spreading as it goes.
  float spread = (1.0 - u) * (0.9 + 1.4 * uPace);
  float crest = exp(-abs(d - spread) * (3.5 - 1.5 * uPace)) * smoothstep(-0.6, 0.6, u) * smoothstep(1.15, 0.85, u);
  // White water at the stem, heaped up in front of her.
  float stem = exp(-(pow(max(u - 0.92, 0.0) * 6.0, 2.0) + w * w * 2.5)) * smoothstep(0.7, 0.95, u);
  float pace = smoothstep(0.0, 0.9, uPace);
  float foam = lap * (0.35 + 0.65 * pace) + crest * pace * 0.95 + stem * pace * 1.2;
  foam *= 0.55 + 0.75 * n;
  // Broken into the white flecks and streaks of real foam, not a smooth band.
  foam *= smoothstep(0.15, 0.55, n + foam * 0.35);
  float a = clamp(foam, 0.0, 1.0);
  if (a < 0.02) discard;
  gl_FragColor = vec4(vec3(0.97, 0.99, 1.0) * max(uLight, 0.35), a);
  #include <colorspace_fragment>
}
`;

interface Wake {
  mesh: THREE.Mesh;
  hull: THREE.Mesh;
  /** Where she has been, newest first, and when she was there (renderer seconds). */
  trail: { at: THREE.Vector2; born: number }[];
}

export interface WakeShip {
  id: string;
  x: number;
  z: number;
  headingDeg: number;
  /** Tiles a second, and as a share of a fast ship's full speed (0..1). */
  speed: number;
  pace: number;
  /** Her drawn length, tiles. */
  length: number;
}

export interface Wakes {
  /** Each frame: lay each ship's wake and the water at her hull; `heightAt` is the sea's height there. */
  update(ships: WakeShip[], dt: number, t: number, light: number, heightAt: (x: number, z: number) => number): void;
}

export function createWakes(scene: THREE.Scene): Wakes {
  const wakeMaterial = new THREE.ShaderMaterial({
    vertexShader: WAKE_VERT,
    fragmentShader: WAKE_FRAG,
    uniforms: { uTime: { value: 0 }, uLight: { value: 1 }, uPace: { value: 0 } },
    transparent: true,
    depthWrite: false,
    // The ribbon's winding follows the way she sailed, so it can face down: drawn from both sides.
    side: THREE.DoubleSide,
  });
  const hullMaterial = new THREE.ShaderMaterial({
    vertexShader: HULL_VERT,
    fragmentShader: HULL_FRAG,
    uniforms: { uTime: { value: 0 }, uLight: { value: 1 }, uPace: { value: 0 }, uLength: { value: 2.6 }, uSpeed: { value: 0 } },
    transparent: true,
    depthWrite: false,
  });
  const wakes = new Map<string, Wake>();

  const make = (): Wake => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POINTS * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const age = new Float32Array(POINTS * 2);
    const side = new Float32Array(POINTS * 2);
    for (let i = 0; i < POINTS; i++) {
      age[i * 2] = age[i * 2 + 1] = i / (POINTS - 1);
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
    }
    geometry.setAttribute('aAge', new THREE.BufferAttribute(age, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    const index: number[] = [];
    for (let i = 0; i < POINTS - 1; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geometry.setIndex(index);
    const mesh = new THREE.Mesh(geometry, wakeMaterial.clone());
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);

    // The patch of water round her hull: a grid in her own frame, laid on the sea each frame.
    const { nx, ny } = PATCH;
    const hullGeo = new THREE.BufferGeometry();
    hullGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((nx + 1) * (ny + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const local = new Float32Array((nx + 1) * (ny + 1) * 2);
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        local[(j * (nx + 1) + i) * 2] = PATCH.aft + ((PATCH.fore - PATCH.aft) * i) / nx;
        local[(j * (nx + 1) + i) * 2 + 1] = -PATCH.across + (2 * PATCH.across * j) / ny;
      }
    hullGeo.setAttribute('aLocal', new THREE.BufferAttribute(local, 2));
    const hullIdx: number[] = [];
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        hullIdx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
      }
    hullGeo.setIndex(hullIdx);
    const hull = new THREE.Mesh(hullGeo, hullMaterial.clone());
    hull.frustumCulled = false;
    hull.renderOrder = 1;
    scene.add(hull);
    return { mesh, hull, trail: [] };
  };

  return {
    update(ships, dt, t, light, heightAt) {
      const seen = new Set<string>();
      for (const s of ships) {
        seen.add(s.id);
        let w = wakes.get(s.id);
        if (!w) {
          w = make();
          wakes.set(s.id, w);
        }
        const r = (s.headingDeg * Math.PI) / 180;
        const fx = Math.sin(r);
        const fz = -Math.cos(r);
        const halfLen = s.length / 2;
        const halfBeam = s.length * BEAM_SHARE;

        // The wake starts a little aft of her bow, where the bow wave leaves her side. A new point every SPACING
        // she sails (filled in between frames, so a turn stays a curve, not a corner); a jump (a new place on
        // the map) starts afresh; points past their life are gone.
        const start = new THREE.Vector2(s.x + fx * s.length * 0.3, s.z + fz * s.length * 0.3);
        const head = w.trail[0];
        if (!head || head.at.distanceTo(start) > 3) w.trail = [{ at: start.clone(), born: t }];
        else {
          const gap = head.at.distanceTo(start);
          const steps = Math.min(8, Math.floor(gap / SPACING));
          const from = head.at.clone();
          for (let k = 1; k <= steps; k++) w.trail.unshift({ at: from.clone().lerp(start, (k * SPACING) / gap), born: t });
          w.trail[0]!.at.copy(start);
          w.trail[0]!.born = t;
        }
        w.trail = w.trail.filter((p, i) => i === 0 || t - p.born < LIFE).slice(0, POINTS);
        const mat = w.mesh.material as THREE.ShaderMaterial;
        mat.uniforms.uTime!.value = t;
        mat.uniforms.uLight!.value = light;
        mat.uniforms.uPace!.value = s.pace;
        // The ribbon: each trail point spread to both sides across the way she went, wider the further astern
        // (by distance along it), laid on the sea there; past the trail's end the ribbon folds to nothing.
        const pos = w.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        const age = w.mesh.geometry.getAttribute('aAge') as THREE.BufferAttribute;
        let astern = 0;
        for (let i = 0; i < POINTS; i++) {
          const point = w.trail[Math.min(i, w.trail.length - 1)]!;
          const p = point.at;
          const q = (w.trail[Math.min(i + 1, w.trail.length - 1)] ?? point).at;
          if (i > 0 && i < w.trail.length) astern += p.distanceTo(w.trail[i - 1]!.at);
          let dx = p.x - q.x;
          let dz = p.y - q.y;
          if (dx === 0 && dz === 0) {
            dx = fx;
            dz = fz;
          }
          const len = Math.hypot(dx, dz);
          const nx = -dz / len;
          const nz = dx / len;
          // From just outside her side, opening astern with her pace (the spread set for the brig, 2.6 tiles
          // long as drawn, and wider for a bigger ship).
          const half = halfBeam * 1.2 + (HALF_WIDTH + SPREAD * (0.6 + 0.6 * s.pace) * astern) * Math.max(1, s.length / 2.6);
          const a = i < w.trail.length ? Math.min(1, (t - point.born) / LIFE) : 1;
          for (const [k, sign] of [
            [0, -1],
            [1, 1],
          ] as const) {
            const x = p.x + sign * nx * half;
            const z = p.y + sign * nz * half;
            pos.setXYZ(i * 2 + k, x, heightAt(x, z) + LIFT, z);
            age.setX(i * 2 + k, a);
          }
        }
        pos.needsUpdate = true;
        age.needsUpdate = true;

        // The water at her hull, laid on the sea round her.
        const hm = w.hull.material as THREE.ShaderMaterial;
        hm.uniforms.uTime!.value = t;
        hm.uniforms.uLight!.value = light;
        hm.uniforms.uPace!.value = s.pace;
        hm.uniforms.uLength!.value = s.length;
        hm.uniforms.uSpeed!.value = s.speed;
        const hp = w.hull.geometry.getAttribute('position') as THREE.BufferAttribute;
        const local = w.hull.geometry.getAttribute('aLocal') as THREE.BufferAttribute;
        for (let i = 0; i < hp.count; i++) {
          const along = local.getX(i) * halfLen;
          const across = local.getY(i) * halfBeam;
          // Starboard is her right: (-fz, fx).
          const x = s.x + fx * along - fz * across;
          const z = s.z + fz * along + fx * across;
          hp.setXYZ(i, x, heightAt(x, z) + LIFT, z);
        }
        hp.needsUpdate = true;
      }
      for (const [id, w] of wakes) {
        if (seen.has(id)) continue;
        for (const m of [w.mesh, w.hull]) {
          scene.remove(m);
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
        wakes.delete(id);
      }
    },
  };
}
