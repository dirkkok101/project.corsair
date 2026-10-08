import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TileMap } from '@corsair/data';

// The land (art direction: Pirates! 2004, docs/reference/pirates-3d-style.md): lush rounded green islands with
// soft beaches, patches of bare tan rock on the heights, palms along the shore and jungle inland. Heights come
// from the map's tiles and elevation bands, blurred so coasts run smooth, then given generated detail inland
// (rolling hills, ridged peaks) that never moves the coastline. Heights are exaggerated far beyond life, like
// the ships, so islands read as islands from a ship's-eye camera.
//
// Drawn in chunks with levels of detail: a quarter-tile mesh near the camera down to two tiles far out, built
// lazily a few a frame. Each chunk hangs a skirt below its edges so neighbours at different detail don't show
// cracks. Vegetation is instanced per chunk and shown only near the camera.

/** Height of a tile's ground in tiles, before smoothing: by terrain, then by elevation band (0-7). */
function groundOf(tile: number, band: number): number {
  switch (tile) {
    case 0:
      return -2.2; // deep
    case 1:
      return -0.7; // shallows
    case 2:
      return 0.25; // beach
    case 3:
      return 0.7 + 0.45 * band; // jungle
    case 4:
      return 1.4 + 0.6 * band; // hills
    default:
      return 2.4 + 0.8 * band; // mountain
  }
}

/** Box blur, rows then columns, `passes` times (three passes come close to a Gaussian). */
function blur(src: Float32Array, w: number, h: number, r: number, passes: number): Float32Array {
  let a: Float32Array = src;
  let b: Float32Array = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[y * w + Math.min(w - 1, Math.max(0, x))]!;
      for (let x = 0; x < w; x++) {
        b[y * w + x] = sum / (2 * r + 1);
        sum += a[y * w + Math.min(w - 1, x + r + 1)]! - a[y * w + Math.max(0, x - r)]!;
      }
    }
    [a, b] = [b, a];
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += a[Math.min(h - 1, Math.max(0, y)) * w + x]!;
      for (let y = 0; y < h; y++) {
        b[y * w + x] = sum / (2 * r + 1);
        sum += a[Math.min(h - 1, y + r + 1) * w + x]! - a[Math.max(0, y - r) * w + x]!;
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

/** Smooth value noise (deterministic), and a few octaves of it. */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * f, y * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

export interface Ground {
  /** Ground height at a point (negative under the sea), with the generated detail. */
  heightAt(x: number, y: number): number;
  /** The sea floor for the water shader: 0 deep water .. 1 at the shoreline and above. */
  depth: THREE.DataTexture;
  /** The islands and their vegetation; `update` fills it in around the camera. */
  object: THREE.Group;
  /** Each frame: build or swap chunks for their distance from the camera. */
  update(camera: THREE.Vector3, target: THREE.Vector3): void;
}

const CHUNK = 50;
/** Mesh spacing in tiles by level of detail, and the distance (tiles, from the camera) each holds out to. */
const LODS: { step: number; within: number }[] = [
  { step: 0.25, within: 45 },
  { step: 0.5, within: 110 },
  { step: 1, within: 260 },
  { step: 2, within: Infinity },
];
/** Chunks built per frame at most, so sailing into new country never stalls a frame. */
const BUILDS_PER_FRAME = 3;
/** Vegetation shows in chunks this near the camera's target (tiles). */
const TREES_WITHIN = 90;

/** Ground kept clear of trees (a town's footprint): centre and radius in tiles. */
export interface Clearing {
  x: number;
  y: number;
  r: number;
}

export function createGround(map: TileMap, clearings: Clearing[] = []): Ground {
  const { width: w, height: h } = map;
  const raw = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) raw[i] = groundOf(map.tiles[i] ?? 3, map.elevation[i] ?? 0);
  const base = blur(raw, w, h, 1, 3);
  const baseAt = (x: number, y: number) => {
    // Bilinear between tile centres, so a fine mesh is smooth rather than terraced.
    const fx = Math.min(w - 1.001, Math.max(0, x - 0.5));
    const fy = Math.min(h - 1.001, Math.max(0, y - 0.5));
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const a = base[iy * w + ix]!;
    const b = base[iy * w + ix + 1]!;
    const c = base[(iy + 1) * w + ix]!;
    const d = base[(iy + 1) * w + ix + 1]!;
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  const heightAt = (x: number, y: number) => {
    const g = baseAt(x, y);
    if (g <= 0.05) return g;
    // Inland only (none at the waterline, so the coast stays where the map has it): rolling hills everywhere,
    // sharp ridges on the heights.
    const inland = THREE.MathUtils.smoothstep(g, 0.05, 1.2);
    const rolling = (fbm(x * 0.35, y * 0.35, 4) - 0.5) * 0.9;
    const ridge = (1 - Math.abs(fbm(x * 0.18 + 17, y * 0.18 + 5, 4) * 2 - 1)) * THREE.MathUtils.smoothstep(g, 1.8, 4) * 2.2;
    return g + inland * (rolling + ridge);
  };

  // The sea floor, one texel a tile: -2.2 (deep) .. 0 (the shoreline) mapped to 0 .. 1.
  const floor = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) floor[i] = Math.round(255 * Math.min(1, Math.max(0, (base[i]! + 2.2) / 2.2)));
  const depth = new THREE.DataTexture(floor, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  depth.magFilter = THREE.LinearFilter;
  depth.minFilter = THREE.LinearFilter;
  depth.needsUpdate = true;

  const material = groundMaterial();
  const object = new THREE.Group();
  const trees = treeKit();

  // The chunks that have land in them, and what each is showing.
  interface Chunk {
    cx: number;
    cy: number;
    centre: THREE.Vector3;
    lod: number;
    meshes: (THREE.Mesh | undefined)[];
    plants?: THREE.Group;
  }
  const chunks: Chunk[] = [];
  for (let cy = 0; cy < h; cy += CHUNK) {
    for (let cx = 0; cx < w; cx += CHUNK) {
      let land = false;
      let top = 0;
      for (let y = cy; y < Math.min(h, cy + CHUNK); y++) {
        for (let x = cx; x < Math.min(w, cx + CHUNK); x++) {
          const g = base[y * w + x]!;
          if (g > -0.4) land = true;
          top = Math.max(top, g);
        }
      }
      if (land) chunks.push({ cx, cy, centre: new THREE.Vector3(cx + CHUNK / 2, top / 2, cy + CHUNK / 2), lod: -1, meshes: [] });
    }
  }

  const build = (c: Chunk, lod: number): THREE.Mesh => {
    const step = LODS[lod]!.step;
    const x1 = Math.min(w, c.cx + CHUNK);
    const y1 = Math.min(h, c.cy + CHUNK);
    const nx = Math.round((x1 - c.cx) / step) + 1;
    const ny = Math.round((y1 - c.cy) / step) + 1;
    // The grid, then a skirt: each edge vertex again, dropped below, so a coarser neighbour's seam is hidden.
    const edge = 2 * (nx + ny) - 4;
    const pos = new Float32Array((nx * ny + edge) * 3);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = c.cx + i * step;
        const y = c.cy + j * step;
        const k = (j * nx + i) * 3;
        pos[k] = x;
        pos[k + 1] = Math.max(heightAt(x, y), -1.2);
        pos[k + 2] = y;
      }
    }
    const index: number[] = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        index.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    }
    // The border, walked round, and its skirt.
    const ring: number[] = [];
    for (let i = 0; i < nx; i++) ring.push(i);
    for (let j = 1; j < ny; j++) ring.push(j * nx + nx - 1);
    for (let i = nx - 2; i >= 0; i--) ring.push((ny - 1) * nx + i);
    for (let j = ny - 2; j > 0; j--) ring.push(j * nx);
    ring.forEach((v, r) => {
      const k = (nx * ny + r) * 3;
      pos[k] = pos[v * 3]!;
      pos[k + 1] = pos[v * 3 + 1]! - 0.6;
      pos[k + 2] = pos[v * 3 + 2]!;
    });
    for (let r = 0; r < ring.length; r++) {
      const a = ring[r]!;
      const b = ring[(r + 1) % ring.length]!;
      const sa = nx * ny + r;
      const sb = nx * ny + ((r + 1) % ring.length);
      index.push(a, sa, b, b, sa, sb);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = lod <= 1;
    return mesh;
  };

  /** Palms on the beaches and low shore, jungle canopy inland: placed by a seeded grid, so always the same. */
  const plant = (c: Chunk): THREE.Group => {
    // The clearings that reach into this chunk.
    const near = clearings.filter((k) => k.x + k.r > c.cx && k.x - k.r < c.cx + CHUNK && k.y + k.r > c.cy && k.y - k.r < c.cy + CHUNK);
    const palms: THREE.Matrix4[] = [];
    const canopy: THREE.Matrix4[] = [];
    const tint: THREE.Color[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let y = c.cy; y < Math.min(h, c.cy + CHUNK); y += 0.5) {
      for (let x = c.cx; x < Math.min(w, c.cx + CHUNK); x += 0.5) {
        const r = hash2(Math.round(x * 2), Math.round(y * 2));
        const px = x + hash2(Math.round(x * 2) + 7, Math.round(y * 2)) * 0.5;
        const py = y + hash2(Math.round(x * 2), Math.round(y * 2) + 7) * 0.5;
        const g = heightAt(px, py);
        if (g < 0.12 || near.some((k) => Math.hypot(px - k.x, py - k.y) < k.r)) continue;
        const tile = map.tiles[Math.floor(py) * w + Math.floor(px)] ?? 3;
        const s = 0.75 + hash2(Math.round(px * 9), Math.round(py * 9)) * 0.5;
        q.setFromAxisAngle(up, r * Math.PI * 2);
        if (g < 0.75 && r < 0.22) {
          // A palm, leaning a little.
          const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(r * 40), 0, Math.sin(r * 40)), 0.18 * r * 4);
          palms.push(new THREE.Matrix4().compose(new THREE.Vector3(px, g - 0.02, py), lean.multiply(q), new THREE.Vector3(s, s, s)));
        } else if (g >= 0.55 && tile >= 3 && r < (tile === 5 ? 0.12 : 0.55)) {
          // A clump of canopy, darker and denser in the jungle, sparser on the heights.
          canopy.push(m.compose(new THREE.Vector3(px, g + 0.05, py), q, new THREE.Vector3(s, s * (0.8 + r * 0.6), s)).clone());
          const v = hash2(Math.round(px * 5), Math.round(py * 5));
          tint.push(new THREE.Color().setHSL(0.27 + v * 0.07, 0.55 + v * 0.15, 0.22 + v * 0.12 + Math.min(0.12, g * 0.02)));
        }
      }
    }
    const group = new THREE.Group();
    if (palms.length) {
      const inst = new THREE.InstancedMesh(trees.palm, trees.palmMaterial, palms.length);
      palms.forEach((p, i) => inst.setMatrixAt(i, p));
      inst.castShadow = true;
      group.add(inst);
    }
    if (canopy.length) {
      const inst = new THREE.InstancedMesh(trees.canopy, trees.canopyMaterial, canopy.length);
      canopy.forEach((p, i) => {
        inst.setMatrixAt(i, p);
        inst.setColorAt(i, tint[i]!);
      });
      inst.castShadow = true;
      group.add(inst);
    }
    return group;
  };

  return {
    heightAt,
    depth,
    object,
    update(camera, target) {
      let builds = 0;
      for (const c of chunks) {
        const d = camera.distanceTo(c.centre) - CHUNK * 0.7;
        const want = LODS.findIndex((l) => d < l.within);
        if (want !== c.lod) {
          // Build the new level first (if the budget allows), then swap, so nothing ever disappears.
          let mesh = c.meshes[want];
          if (!mesh) {
            if (builds >= BUILDS_PER_FRAME && c.lod >= 0) continue;
            mesh = build(c, want);
            c.meshes[want] = mesh;
            builds++;
          }
          if (c.lod >= 0) object.remove(c.meshes[c.lod]!);
          object.add(mesh);
          c.lod = want;
          // Coarse levels far away are cheap to keep; the finest are dropped once left behind.
          for (let l = 0; l < 2; l++) {
            if (l === want || !c.meshes[l] || d < LODS[l]!.within * 1.6) continue;
            c.meshes[l]!.geometry.dispose();
            c.meshes[l] = undefined;
          }
        }
        const near = Math.hypot(c.centre.x - target.x, c.centre.z - target.z) - CHUNK * 0.7 < TREES_WITHIN;
        if (near && !c.plants && builds < BUILDS_PER_FRAME + 1) {
          c.plants = plant(c);
          builds++;
        }
        if (c.plants) {
          if (near && !c.plants.parent) object.add(c.plants);
          if (!near && c.plants.parent) object.remove(c.plants);
        }
      }
    },
  };
}

/**
 * The ground's paint, by height and slope, in Pirates!'s Technicolor: white-gold beaches, bright jungle greens
 * varying patch by patch, lighter grass on the hills, tan rock on steep and high ground. Standard lighting
 * and shadows; only the colour is worked out per pixel.
 */
function groundMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGround;\nvarying vec3 vGroundNormal;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGroundNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vGround;
varying vec3 vGroundNormal;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
}
float gFbm(vec2 p) { return gNoise(p) * 0.5 + gNoise(p * 2.1) * 0.25 + gNoise(p * 4.3) * 0.125 + gNoise(p * 8.7) * 0.0625; }`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `float gh = vGround.y;
float slope = 1.0 - clamp(vGroundNormal.y, 0.0, 1.0);
float var = gFbm(vGround.xz * 0.6);
float fine = gFbm(vGround.xz * 5.0);
vec3 sand = mix(vec3(0.93, 0.86, 0.66), vec3(0.98, 0.94, 0.8), fine);
vec3 jungle = mix(vec3(0.16, 0.42, 0.12), vec3(0.3, 0.58, 0.16), var) * (0.85 + 0.3 * fine);
vec3 grass = mix(vec3(0.42, 0.6, 0.2), vec3(0.58, 0.7, 0.28), var) * (0.9 + 0.2 * fine);
vec3 rock = mix(vec3(0.62, 0.52, 0.38), vec3(0.78, 0.68, 0.52), fine);
// Beach at the waterline (wider where the ground is flat), jungle above, grass on the heights.
float beach = 1.0 - smoothstep(0.18, 0.42 + 0.15 * var, gh + slope * 0.6);
vec3 col = mix(mix(jungle, grass, smoothstep(1.6, 3.4, gh + var * 0.8)), sand, beach);
// Tan rock where it's steep or high, broken up.
float rocky = smoothstep(0.42, 0.7, slope + var * 0.25) + smoothstep(4.0, 6.0, gh + var);
col = mix(col, rock, clamp(rocky, 0.0, 1.0) * (1.0 - beach));
// Wet sand just above the waterline, a shade darker.
col *= mix(0.82, 1.0, smoothstep(0.02, 0.12, gh));
vec4 diffuseColor = vec4( col, opacity );`,
      );
  };
  return material;
}

/** The trees: a palm (curved trunk, a crown of drooping fronds) and a rounded clump of jungle canopy. */
function treeKit() {
  const trunkParts: THREE.BufferGeometry[] = [];
  // The trunk, in a few segments leaning progressively.
  const segments = 5;
  for (let i = 0; i < segments; i++) {
    const g = new THREE.CylinderGeometry(0.022 - i * 0.002, 0.026 - i * 0.002, 0.16, 6, 1);
    g.translate(i * 0.012, 0.08 + i * 0.155, 0);
    trunkParts.push(g);
  }
  // Position only, like the fronds, so the two merge (merging needs the same attributes on every part).
  for (const g of trunkParts) {
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
  }
  const trunk = mergeGeometries(trunkParts)!;
  const frondParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    // A frond: a long narrow leaf, arched up then drooping.
    const leaf = new THREE.BufferGeometry();
    const pts: number[] = [];
    const steps = 5;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const along = t * 0.42;
      const lift = Math.sin(t * Math.PI * 0.7) * 0.1 - t * t * 0.18;
      const half = Math.sin(t * Math.PI) * 0.05;
      pts.push(along, lift, -half, along, lift, half);
    }
    const idx: number[] = [];
    for (let s = 0; s < steps; s++) idx.push(s * 2, s * 2 + 1, s * 2 + 2, s * 2 + 1, s * 2 + 3, s * 2 + 2);
    leaf.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    leaf.setIndex(idx);
    leaf.rotateY((i / 8) * Math.PI * 2 + i * 0.3);
    leaf.translate(segments * 0.012, segments * 0.155 + 0.02, 0);
    frondParts.push(leaf);
  }
  const fronds = mergeGeometries(frondParts)!;
  const colour = (g: THREE.BufferGeometry, c: string) => {
    const col = new THREE.Color(c);
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [col.r, col.g, col.b]), 3));
    return g;
  };
  const palm = mergeGeometries([colour(trunk.toNonIndexed(), '#8a6a45'), colour(fronds.toNonIndexed(), '#3f8f2c')])!;
  palm.computeVertexNormals();
  palm.scale(2.2, 2.2, 2.2);
  const canopy = new THREE.IcosahedronGeometry(0.32, 1);
  // Flattened and lumpy, so a stand of them reads as a jungle canopy rather than balls.
  const p = canopy.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const bump = 1 + (hash2(Math.round(x * 50), Math.round(z * 50 + y * 30)) - 0.5) * 0.35;
    p.setXYZ(i, x * bump, Math.max(-0.1, y * 0.7 * bump) + 0.18, z * bump);
  }
  canopy.computeVertexNormals();
  return {
    palm,
    palmMaterial: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    canopy,
    canopyMaterial: new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: false }),
  };
}
