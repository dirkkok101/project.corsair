import * as THREE from 'three';

// Wakes (Pirates! 2004: a long thin white trail behind every ship): each ship leaves a ribbon of foam along
// the way she came, widening into a V and fading as it ages. It starts at her bow, so where it spreads wider
// than her hull it shows along her sides as a bow wave, then opens out astern. The trail is kept in world positions, so a
// ship turning leaves a curved wake.

/** Trail points a wake keeps, and how far apart (tiles) they are laid. */
const POINTS = 48;
const SPACING = 0.18;
/** Half-width at the stern, and how much it widens per tile astern (the wake's spread). */
const HALF_WIDTH = 0.14;
const SPREAD = 0.16;
/** A wake fades out over this many seconds once she stops laying it. */
const FADE_SECONDS = 6;

const VERT = /* glsl */ `
attribute float aAge;     // 0 at the stern .. 1 at the far end
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

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uLight;
uniform float uOpacity;
varying float vAge;
varying float vSide;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  // Two bright arms at the edges (the V), a softer churn down the middle, broken up, fading astern.
  float side = abs(vSide);
  float arms = smoothstep(0.55, 0.92, side) * (1.0 - smoothstep(0.92, 1.0, side));
  float churn = (1.0 - smoothstep(0.0, 0.45, side)) * (1.0 - smoothstep(0.0, 0.35, vAge)) * 0.8;
  float broken = 0.55 + 0.45 * noise(vWorld.xz * 6.0 + uTime * 0.4);
  float a = (arms + churn) * broken * (1.0 - smoothstep(0.25, 1.0, vAge)) * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.97, 0.99, 1.0) * max(uLight, 0.35), min(1.0, a * 1.05));
  #include <colorspace_fragment>
}
`;

interface Wake {
  mesh: THREE.Mesh;
  trail: THREE.Vector2[];
  /** Seconds since she last laid a point (a ship at rest lets her wake fade). */
  idle: number;
}

export interface Wakes {
  /** Each frame: lay each ship's wake from her stern (x, z, heading, speed in tiles/s, length in tiles). */
  update(ships: { id: string; x: number; z: number; headingDeg: number; speed: number; length: number }[], dt: number, t: number, light: number): void;
}

export function createWakes(scene: THREE.Scene): Wakes {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uTime: { value: 0 }, uLight: { value: 1 }, uOpacity: { value: 1 } },
    transparent: true,
    depthWrite: false,
  });
  const wakes = new Map<string, Wake>();

  const make = (): Wake => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POINTS * 2 * 3), 3));
    const age = new Float32Array(POINTS * 2);
    const side = new Float32Array(POINTS * 2);
    for (let i = 0; i < POINTS; i++) {
      age[i * 2] = age[i * 2 + 1] = i / (POINTS - 1);
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
    }
    geometry.setAttribute('aAge', new THREE.BufferAttribute(age, 1));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    const index: number[] = [];
    for (let i = 0; i < POINTS - 1; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geometry.setIndex(index);
    const mesh = new THREE.Mesh(geometry, material.clone());
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    return { mesh, trail: [], idle: 0 };
  };

  return {
    update(ships, dt, t, light) {
      const seen = new Set<string>();
      for (const s of ships) {
        seen.add(s.id);
        let w = wakes.get(s.id);
        if (!w) {
          w = make();
          wakes.set(s.id, w);
        }
        // The bow, where the wake starts.
        const r = (s.headingDeg * Math.PI) / 180;
        const fx = Math.sin(r);
        const fz = -Math.cos(r);
        const stern = new THREE.Vector2(s.x + fx * s.length * 0.42, s.z + fz * s.length * 0.42);
        const last = w.trail[0];
        if (!last || last.distanceTo(stern) > 3) w.trail = [stern.clone()];
        else if (last.distanceTo(stern) >= SPACING) {
          w.trail.unshift(stern.clone());
          if (w.trail.length > POINTS) w.trail.length = POINTS;
          w.idle = 0;
        } else w.trail[0]!.copy(stern);
        w.idle = s.speed > 0.05 ? 0 : w.idle + dt;
        const mat = w.mesh.material as THREE.ShaderMaterial;
        mat.uniforms.uTime!.value = t;
        mat.uniforms.uLight!.value = light;
        mat.uniforms.uOpacity!.value = Math.max(0, 1 - w.idle / FADE_SECONDS) * Math.min(1, w.trail.length / 6);
        // The ribbon: each trail point spread to both sides across the way she went, wider the further astern.
        const pos = w.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < POINTS; i++) {
          const p = w.trail[Math.min(i, w.trail.length - 1)] ?? stern;
          const q = w.trail[Math.min(i + 1, w.trail.length - 1)] ?? p;
          let dx = p.x - q.x;
          let dz = p.y - q.y;
          const len = Math.hypot(dx, dz) || 1;
          if (len === 1 && dx === 0 && dz === 0) {
            dx = fx;
            dz = fz;
          }
          const nx = -dz / (Math.hypot(dx, dz) || 1);
          const nz = dx / (Math.hypot(dx, dz) || 1);
          // Wider for a bigger ship (the spread is set for the brig, 2.6 tiles long as drawn).
          const half = (HALF_WIDTH + SPREAD * i * SPACING) * Math.max(1, s.length / 2.6);
          pos.setXYZ(i * 2, p.x - nx * half, 0.03, p.y - nz * half);
          pos.setXYZ(i * 2 + 1, p.x + nx * half, 0.03, p.y + nz * half);
        }
        pos.needsUpdate = true;
      }
      for (const [id, w] of wakes) {
        if (seen.has(id)) continue;
        scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        wakes.delete(id);
      }
    },
  };
}
