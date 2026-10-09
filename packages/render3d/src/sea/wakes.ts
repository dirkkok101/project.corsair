import * as THREE from 'three';

// Ships' wakes, bow waves and hull foam. They are drawn as part of the water, not laid on it: each frame every
// ship's wake is stamped into a small world-space render target round the camera's target, and the ocean's own
// shader reads it, combing the wake into streaks and lighting it with the sea. So the foam always sits on the
// surface (the swell can never bury it), and it moves exactly as the water does.
//
// A wake is redrawn every frame from where the ship has been, not accumulated, so it can't build up into a
// permanent line: each point of her trail ages out within WAKE_LIFE seconds, and drifts downwind meanwhile
// like everything else on the sea.

export interface WakeShip {
  id: string;
  x: number;
  z: number;
  headingDeg: number;
  /** Tiles a second. */
  speed: number;
  /** Her speed as a share of a brisk pace (0..1): how white the water is round her. */
  pace: number;
  /** Her drawn length, tiles. */
  length: number;
}

/** Seconds a point of wake lasts: a few ship lengths behind her at an ordinary pace. */
export const WAKE_LIFE = 4.5;
/** Half the V's opening (a real ship's wake opens at about 19° either side; the reference's reads a little narrower). */
const V_SLOPE = Math.tan((17 * Math.PI) / 180);
/** Her half-beam at the waterline, as a share of her length: the wake's width at her stern. */
const HALF_BEAM = 0.12;
/** How many half-beams the wake widens by for each of her lengths behind her (the ocean's shader needs it). */
export const WAKE_WIDENING = V_SLOPE / HALF_BEAM;
/**
 * The strip runs this much wider than the wake it carries, so the wake fades out inside it: the strip's own
 * edge is a hard line in the target, which would show as a staircase.
 */
export const WAKE_MARGIN = 1.45;
/** Columns across a wake's strip: enough that its widening quads don't kink the streaks combed along them. */
const COLUMNS = 6;
/** Trail points, kept about this far apart as a share of her length. */
const SPACING = 0.12;
/** A jump this far between frames (a new fight, a teleport) starts a fresh wake rather than drawing one across the sea. */
const JUMP = 3;
const MAX_POINTS = 96;
const MAX_SHIPS = 48;
const RESOLUTION = 512;

interface TrailPoint {
  x: number;
  z: number;
  born: number;
}

interface Trail {
  points: TrailPoint[];
  ship: WakeShip;
  seen: number;
}

const STAMP_VERT = /* glsl */ `
attribute vec4 wake;
uniform vec3 uArea;
varying vec4 vWake;
void main() {
  vWake = wake;
  gl_Position = vec4((position.xz - uArea.xy) / uArea.z * 2.0 - 1.0, 0.0, 1.0);
}
`;

// The wake behind her: R its whiteness, G how near her track (1 on it, 0 at the strip's edges, as the cleared
// target is, so filtering never draws a seam round a strip), B the distance behind her in her own lengths, so the ocean can comb it into streaks that run with her track and fan out as it widens.
const TRAIL_FRAG = /* glsl */ `
varying vec4 vWake;
void main() {
  gl_FragColor = vec4(vWake.x, vWake.y, vWake.z, 0.0);
}
`;

// The white water at her hull: the bow wave thrown out either side of the stem, and foam along her sides.
// In the alpha channel, so it lies over the wake's own channels (the target is drawn with MAX blending).
const HULL_FRAG = /* glsl */ `
varying vec4 vWake;
void main() {
  // Along her (bow +), across (starboard +), in her lengths; and her pace.
  float a = vWake.x, b = vWake.y, pace = vWake.z;
  float e = length(vec2(a / 0.46, b / 0.115));
  // Foam hugging the hull, whitest forward and fading aft.
  float hull = smoothstep(0.85, 1.0, e) * (1.0 - smoothstep(1.0, 1.3, e)) * smoothstep(-0.6, 0.25, a);
  // The bow wave: two arms from the stem, sweeping aft and outward, softening as they spread.
  float behind = 0.47 - a;
  float arm = abs(b) - 0.07 - behind * 0.32;
  float bow = exp(-arm * arm / (0.0012 + behind * 0.004)) * step(0.0, behind) * (1.0 - smoothstep(0.15, 0.8, behind));
  // And a little white heaped at the stem itself.
  bow += exp(-((a - 0.47) * (a - 0.47) + b * b) / 0.0015) * 0.7;
  gl_FragColor = vec4(0.0, 0.0, 0.0, clamp((hull * 0.8 + bow * 0.85) * pace, 0.0, 1.0));
}
`;

export interface Wakes {
  /** The stamped wakes; read with `area` (x, z of the corner, side length in tiles). */
  texture: THREE.Texture;
  area: THREE.Vector3;
  /** Each frame: where the ships are; `drift` is the surface drift (tiles a second) the wakes move with. */
  update(ships: WakeShip[], dt: number, drift: THREE.Vector2): void;
  /** Stamps the wakes round `center`, over `side` tiles, into the texture. */
  render(renderer: THREE.WebGLRenderer, centerX: number, centerZ: number, side: number): void;
}

export function createWakes(): Wakes {
  const target = new THREE.WebGLRenderTarget(RESOLUTION, RESOLUTION, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
  });
  const area = new THREE.Vector3(0, 0, 64);
  const uniforms = { uArea: { value: area } };
  const material = (frag: string) =>
    new THREE.ShaderMaterial({
      vertexShader: STAMP_VERT,
      fragmentShader: frag,
      uniforms,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
    });

  // The trails: a strip of quads per ship, built afresh each frame.
  const trailVerts = MAX_SHIPS * MAX_POINTS * (COLUMNS + 1);
  const trailPos = new Float32Array(trailVerts * 3);
  const trailWake = new Float32Array(trailVerts * 4);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeo.setAttribute('wake', new THREE.BufferAttribute(trailWake, 4).setUsage(THREE.DynamicDrawUsage));
  const trailIndex = new Uint32Array(MAX_SHIPS * (MAX_POINTS - 1) * COLUMNS * 6);
  trailGeo.setIndex(new THREE.BufferAttribute(trailIndex, 1).setUsage(THREE.DynamicDrawUsage));
  const trailMesh = new THREE.Mesh(trailGeo, material(TRAIL_FRAG));

  // The hulls: a quad round each ship, in her own frame.
  const hullPos = new Float32Array(MAX_SHIPS * 4 * 3);
  const hullWake = new Float32Array(MAX_SHIPS * 4 * 4);
  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.BufferAttribute(hullPos, 3).setUsage(THREE.DynamicDrawUsage));
  hullGeo.setAttribute('wake', new THREE.BufferAttribute(hullWake, 4).setUsage(THREE.DynamicDrawUsage));
  const hullIndex = new Uint32Array(MAX_SHIPS * 6);
  for (let i = 0; i < MAX_SHIPS; i++) hullIndex.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  hullGeo.setIndex(new THREE.BufferAttribute(hullIndex, 1));
  const hullMesh = new THREE.Mesh(hullGeo, material(HULL_FRAG));

  for (const m of [trailMesh, hullMesh]) m.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(trailMesh, hullMesh);
  const camera = new THREE.Camera();
  const clear = new THREE.Color(0, 0, 0);
  const keep = new THREE.Color();

  const trails = new Map<string, Trail>();
  let clock = 0;

  /** Lays the frame's geometry from the trails. */
  const build = () => {
    let v = 0;
    let idx = 0;
    let hulls = 0;
    for (const trail of trails.values()) {
      const s = trail.ship;
      if (v + (MAX_POINTS + 1) * (COLUMNS + 1) > trailVerts || hulls >= MAX_SHIPS) break;
      const r = (s.headingDeg * Math.PI) / 180;
      const fx = Math.sin(r);
      const fz = -Math.cos(r);
      const live = trail.seen === clock;
      const pace = THREE.MathUtils.clamp(s.pace, 0, 1);
      const halfBeam = s.length * HALF_BEAM;
      // From her stern (while she's here) back along where she has been.
      const path: TrailPoint[] = live ? [{ x: s.x - fx * s.length * 0.42, z: s.z - fz * s.length * 0.42, born: clock }, ...trail.points] : trail.points;
      let along = 0;
      const first = v;
      for (let i = 0; i < path.length; i++) {
        const p = path[i]!;
        if (i > 0) along += Math.hypot(p.x - path[i - 1]!.x, p.z - path[i - 1]!.z);
        // Across her track here, from the neighbours either side.
        const a = path[Math.max(0, i - 1)]!;
        const b = path[Math.min(path.length - 1, i + 1)]!;
        let tx = a.x - b.x;
        let tz = a.z - b.z;
        const tl = Math.hypot(tx, tz);
        if (tl < 1e-5) {
          tx = fx;
          tz = fz;
        } else {
          tx /= tl;
          tz /= tl;
        }
        const half = (halfBeam + along * V_SLOPE) * WAKE_MARGIN;
        const age = (clock - p.born) / WAKE_LIFE;
        // Fades with age (gone at WAKE_LIFE), and eases in over the first stretch behind her stern.
        const white = pace * Math.pow(Math.max(0, 1 - age), 1.6) * THREE.MathUtils.smoothstep(along, 0, s.length * 0.25 + 0.01);
        for (let c = 0; c <= COLUMNS; c++) {
          const side = (c / COLUMNS) * 2 - 1;
          trailPos.set([p.x - tz * half * side, 0, p.z + tx * half * side], v * 3);
          trailWake.set([white, 1 - Math.abs(side), along / s.length, 0], v * 4);
          v++;
        }
      }
      const row = COLUMNS + 1;
      for (let i = 0; i + 1 < path.length; i++) {
        for (let c = 0; c < COLUMNS; c++) {
          const q = first + i * row + c;
          trailIndex.set([q, q + 1, q + row + 1, q, q + row + 1, q + row], idx);
          idx += 6;
        }
      }
      if (!live) continue;
      // Her hull's quad, from 0.65 of her length astern to 0.8 ahead, 0.35 either side, in her lengths.
      const corners: [number, number][] = [[-0.65, -0.35], [0.8, -0.35], [0.8, 0.35], [-0.65, 0.35]];
      corners.forEach(([al, ac], k) => {
        const along2 = al * s.length;
        const across = ac * s.length;
        // Starboard is to her right: (-fz, fx) in x, z.
        hullPos.set([s.x + fx * along2 - fz * across, 0, s.z + fz * along2 + fx * across], (hulls * 4 + k) * 3);
        hullWake.set([al, ac, pace, 0], (hulls * 4 + k) * 4);
      });
      hulls++;
    }
    trailGeo.setDrawRange(0, idx);
    hullGeo.setDrawRange(0, hulls * 6);
    for (const g of [trailGeo, hullGeo]) {
      g.attributes.position!.needsUpdate = true;
      g.attributes.wake!.needsUpdate = true;
    }
    trailGeo.index!.needsUpdate = true;
  };

  return {
    texture: target.texture,
    area,
    update(ships, dt, drift) {
      clock += dt;
      for (const s of ships) {
        let trail = trails.get(s.id);
        const last = trail?.points[0];
        if (!trail || (last && Math.hypot(last.x - s.x, last.z - s.z) > JUMP + s.length)) {
          trail = { points: [], ship: s, seen: clock };
          trails.set(s.id, trail);
        }
        trail.ship = s;
        trail.seen = clock;
        // A point where her stern is, each time she has moved on a little.
        const r = (s.headingDeg * Math.PI) / 180;
        const sx = s.x - Math.sin(r) * s.length * 0.42;
        const sz = s.z + Math.cos(r) * s.length * 0.42;
        const head = trail.points[0];
        if (!head || Math.hypot(head.x - sx, head.z - sz) > s.length * SPACING) {
          trail.points.unshift({ x: sx, z: sz, born: clock });
          if (trail.points.length > MAX_POINTS) trail.points.length = MAX_POINTS;
        }
      }
      for (const [id, trail] of trails) {
        // The water carries the wake downwind; the old end ages out.
        for (const p of trail.points) {
          p.x += drift.x * dt;
          p.z += drift.y * dt;
        }
        while (trail.points.length && clock - trail.points.at(-1)!.born > WAKE_LIFE) trail.points.pop();
        if (!trail.points.length && trail.seen !== clock) trails.delete(id);
      }
    },
    render(renderer, centerX, centerZ, side) {
      // The area snaps to its own texels, so the stamped wakes don't crawl as the camera follows a ship.
      const texel = side / RESOLUTION;
      area.set(Math.round((centerX - side / 2) / texel) * texel, Math.round((centerZ - side / 2) / texel) * texel, side);
      build();
      const previous = renderer.getRenderTarget();
      renderer.getClearColor(keep);
      const alpha = renderer.getClearAlpha();
      renderer.setRenderTarget(target);
      renderer.setClearColor(clear, 0);
      renderer.clear(true, false, false);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      renderer.setClearColor(keep, alpha);
    },
  };
}
