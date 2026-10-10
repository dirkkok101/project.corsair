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
  /** The sea floor for the water shader: red 0 deep water .. 1 at the shoreline and above; green, nearness to land. */
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

  // The sea floor, one texel a tile: red, the floor's height (-2.2 deep .. 0 at the shoreline, as 0 .. 1);
  // green, a wide soft halo of nearness to land, for the bright apron of shallows round every island.
  const land = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) land[i] = base[i]! > -0.4 ? 1 : 0;
  const halo = blur(land, w, h, 4, 3);
  const floor = new Uint8Array(w * h * 2);
  for (let i = 0; i < w * h; i++) {
    floor[i * 2] = Math.round(255 * Math.min(1, Math.max(0, (base[i]! + 2.2) / 2.2)));
    floor[i * 2 + 1] = Math.round(255 * Math.min(1, halo[i]! * 2.2));
  }
  const depth = new THREE.DataTexture(floor, w, h, THREE.RGFormat, THREE.UnsignedByteType);
  depth.magFilter = THREE.LinearFilter;
  depth.minFilter = THREE.LinearFilter;
  depth.needsUpdate = true;

  const material = groundMaterial();
  const object = new THREE.Group();
  const kit = treeKit();

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

  /**
   * Palms on the beaches and low shore, jungle trees inland with undergrowth round them, shrubs at the edge of
   * the sand, rocks along the waterline (more where the shore is steep): placed by a seeded grid, so always the
   * same.
   */
  const plant = (c: Chunk): THREE.Group => {
    // The clearings that reach into this chunk.
    const near = clearings.filter((k) => k.x + k.r > c.cx && k.x - k.r < c.cx + CHUNK && k.y + k.r > c.cy && k.y - k.r < c.cy + CHUNK);
    const palms: THREE.Matrix4[] = [];
    const trees: THREE.Matrix4[] = [];
    const tint: THREE.Color[] = [];
    const bushes: THREE.Matrix4[] = [];
    const bushTint: THREE.Color[] = [];
    const rocks: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let y = c.cy; y < Math.min(h, c.cy + CHUNK); y += 0.5) {
      for (let x = c.cx; x < Math.min(w, c.cx + CHUNK); x += 0.5) {
        const r = hash2(Math.round(x * 2), Math.round(y * 2));
        const px = x + hash2(Math.round(x * 2) + 7, Math.round(y * 2)) * 0.5;
        const py = y + hash2(Math.round(x * 2), Math.round(y * 2) + 7) * 0.5;
        const g = heightAt(px, py);
        const tile = map.tiles[Math.floor(py) * w + Math.floor(px)] ?? 3;
        const s = 0.75 + hash2(Math.round(px * 9), Math.round(py * 9)) * 0.5;
        q.setFromAxisAngle(up, r * Math.PI * 2);
        // Rocks along the waterline, more where the shore climbs steeply (a rocky coast), a few on the sand.
        if (g > -0.08 && g < 0.25) {
          const steep = Math.abs(heightAt(px + 0.4, py) - heightAt(px - 0.4, py)) + Math.abs(heightAt(px, py + 0.4) - heightAt(px, py - 0.4));
          if (r < 0.05 + Math.min(0.5, steep * 0.8)) {
            const k = 0.5 + hash2(Math.round(px * 13), Math.round(py * 13)) * 1.1;
            rocks.push(new THREE.Matrix4().compose(new THREE.Vector3(px, g - 0.03, py), q.clone(), new THREE.Vector3(k, k * (0.6 + r), k)));
          }
        }
        if (g < 0.12 || near.some((k) => Math.hypot(px - k.x, py - k.y) < k.r)) continue;
        if (g < 0.75 && r < 0.22) {
          // A palm, leaning a little, seaward-ish.
          const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(r * 40), 0, Math.sin(r * 40)), 0.18 * r * 4);
          palms.push(new THREE.Matrix4().compose(new THREE.Vector3(px, g - 0.02, py), lean.multiply(q.clone()), new THREE.Vector3(s, s, s)));
        } else if (g >= 0.55 && tile >= 3 && r < (tile === 5 ? 0.12 : 0.55)) {
          // A jungle tree, a shade of its own.
          trees.push(new THREE.Matrix4().compose(new THREE.Vector3(px, g, py), q.clone(), new THREE.Vector3(s, s * (0.85 + r * 0.5), s)));
          const v = hash2(Math.round(px * 5), Math.round(py * 5));
          tint.push(new THREE.Color().setHSL(0.18 + v * 0.1, 0.25, 0.82 + v * 0.16));
        }
        // Undergrowth: under the trees and along the top of the beach.
        const u = hash2(Math.round(px * 7) + 3, Math.round(py * 7) + 5);
        if (g >= 0.3 && tile >= 3 && u < (g < 0.8 ? 0.45 : 0.6)) {
          const k = 0.7 + u * 1.2;
          bushes.push(new THREE.Matrix4().compose(new THREE.Vector3(px + (u - 0.5) * 0.4, g - 0.01, py + (r - 0.5) * 0.4), q.clone(), new THREE.Vector3(k, k * (0.8 + r * 0.5), k)));
          bushTint.push(new THREE.Color().setHSL(0.17 + u * 0.12, 0.3, 0.75 + u * 0.2));
        }
      }
    }
    const group = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], tints?: THREE.Color[], shadow = true) => {
      if (!list.length) return;
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => {
        inst.setMatrixAt(i, p);
        if (tints) inst.setColorAt(i, tints[i]!);
      });
      inst.castShadow = shadow;
      group.add(inst);
    };
    add(kit.palmTrunk, kit.barkMaterial, palms);
    add(kit.palmCrown, kit.frondMaterial, palms);
    add(kit.treeTrunk, kit.barkMaterial, trees);
    add(kit.treeCrown, kit.leafMaterial, trees, tint);
    add(kit.bush, kit.leafMaterial, bushes, bushTint, false);
    add(kit.rock, kit.rockMaterial, rocks);
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
 * The ground, painted to sit with the realistic sea (after Black Flag): pale coral sand at the shore, darker and
 * glossy where the sea wets it, olive grass on open slopes, a deep green-brown jungle floor under the trees,
 * grey-brown limestone on steep ground and cliffs, all varied patch by patch. A relief worked out per pixel (two
 * scales of noise, ripples in the sand, strata in the rock) tilts the light, so the ground reads as ground, not
 * as paint; the wet sand is smoother than the dry. Standard lighting and shadows.
 */
function groundMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
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
float gFbm(vec2 p) { return gNoise(p) * 0.5 + gNoise(p * 2.1) * 0.25 + gNoise(p * 4.3) * 0.125 + gNoise(p * 8.7) * 0.0625; }
// The ground's small relief, by what it is: lumpy earth, rippled sand, layered rock.
float gRelief(vec2 p, float sandy, float rocky) {
  float earth = gFbm(p * 3.0) * 0.6 + gFbm(p * 11.0) * 0.4;
  float ripples = sin(p.x * 26.0 + gNoise(p * 2.0) * 6.0) * 0.5 + 0.5;
  float strata = abs(sin(p.y * 9.0 + gNoise(p * 1.5) * 4.0)) * 0.6 + gFbm(p * 7.0) * 0.4;
  return mix(mix(earth, ripples * 0.4, sandy), strata, rocky);
}
float gSandy;
float gRocky;
float gWet;`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `float gh = vGround.y;
float slope = 1.0 - clamp(vGroundNormal.y, 0.0, 1.0);
float var = gFbm(vGround.xz * 0.6);
float fine = gFbm(vGround.xz * 5.0);
float grain = gFbm(vGround.xz * 23.0);
// Natural colours: coral sand, olive grass, a dark jungle floor, grey-brown limestone.
vec3 sand = mix(vec3(0.86, 0.8, 0.66), vec3(0.93, 0.89, 0.78), fine) * (0.94 + 0.08 * grain);
vec3 jungle = mix(vec3(0.13, 0.22, 0.08), vec3(0.22, 0.32, 0.12), var) * (0.85 + 0.3 * fine);
vec3 grass = mix(vec3(0.36, 0.42, 0.18), vec3(0.5, 0.52, 0.26), var) * (0.88 + 0.24 * fine);
vec3 earth = vec3(0.42, 0.33, 0.22) * (0.85 + 0.3 * grain);
vec3 rock = mix(vec3(0.46, 0.42, 0.36), vec3(0.66, 0.6, 0.5), fine) * (0.85 + 0.3 * grain);
// Beach at the waterline (wider where the ground is flat), jungle above, grass on the heights.
float beach = 1.0 - smoothstep(0.18, 0.42 + 0.15 * var, gh + slope * 0.6);
vec3 col = mix(jungle, grass, smoothstep(1.6, 3.4, gh + var * 0.8));
// Bare earth where the green thins, between beach and jungle and in worn patches.
col = mix(col, earth, smoothstep(0.55, 0.85, fine) * 0.35 + (1.0 - smoothstep(0.35, 0.7, gh)) * 0.4 * (1.0 - beach));
col = mix(col, sand, beach);
// Rock where it's steep or high, broken up.
float rocky = clamp(smoothstep(0.4, 0.66, slope + var * 0.25) + smoothstep(4.0, 6.0, gh + var), 0.0, 1.0) * (1.0 - beach);
col = mix(col, rock, rocky);
// Wet sand just above the waterline: darker, a little browner.
float wet = 1.0 - smoothstep(0.02, 0.16, gh);
col = mix(col, col * vec3(0.66, 0.64, 0.6), wet);
gSandy = beach;
gRocky = rocky;
gWet = wet;
vec4 diffuseColor = vec4( col, opacity );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
// Wet sand is smooth enough to catch the sky; rock a little smoother than earth.
roughnessFactor = mix(mix(0.95, 0.82, gRocky), 0.45, gWet * gSandy);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // The relief, as a slope from neighbouring samples (in the world), tilting the surface normal.
  float e = 0.02;
  vec2 p = vGround.xz;
  float h0 = gRelief(p, gSandy, gRocky);
  float hx = gRelief(p + vec2(e, 0.0), gSandy, gRocky);
  float hz = gRelief(p + vec2(0.0, e), gSandy, gRocky);
  float strength = mix(mix(0.035, 0.012, gSandy), 0.06, gRocky);
  vec3 nw = normalize(vGroundNormal - vec3(hx - h0, 0.0, hz - h0) / e * strength);
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
}`,
      );
  };
  return material;
}

/** A canvas texture for foliage: drawn by `paint` on a transparent square, colour-correct, mipmapped. */
function foliageTexture(size: number, paint: (g: CanvasRenderingContext2D, rand: () => number) => void, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  paint(g, rand);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A leaf card: a quad of `w` x `h`, its foot at the origin, for leaf textures. */
function card(w: number, h: number): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
}

/**
 * The vegetation (after Black Flag's islands): palms with ringed trunks, coconuts and drooping fronds of leaflets
 * yellowing at the tips; jungle trees, a branching trunk under a crown of leaf clusters; shrubs and ferns for the
 * undergrowth; and grey shore rocks. Leaves are textured cards (alpha-cut), lit both sides; each part is its own
 * instanced draw.
 */
export function treeKit() {
  // A palm frond: a midrib with leaflets either side, greener at the base, yellowing and browner at the tip.
  const frondMap = foliageTexture(
    256,
    (g, rand) => {
      for (let i = 0; i < 46; i++) {
        const t = i / 46;
        const x = 8 + t * 240;
        const len = 46 * Math.sin(Math.PI * (0.15 + t * 0.85)) + 6;
        const col = `rgb(${Math.round(70 + t * 70 + rand() * 20)},${Math.round(110 + t * 20 + rand() * 20)},${Math.round(38 + rand() * 12)})`;
        g.strokeStyle = col;
        g.lineWidth = 4;
        for (const side of [-1, 1]) {
          g.beginPath();
          g.moveTo(x, 128);
          g.quadraticCurveTo(x + 10, 128 + side * len * 0.6, x + 18, 128 + side * len);
          g.stroke();
        }
      }
      g.strokeStyle = '#7a6a3a';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(0, 128);
      g.lineTo(256, 128);
      g.stroke();
    },
    11,
  );
  // A cluster of broad leaves, for jungle crowns and shrubs: many overlapping leaves in greens, lit from above.
  const leafMap = foliageTexture(
    256,
    (g, rand) => {
      for (let i = 0; i < 160; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * 108;
        const x = 128 + Math.cos(a) * r;
        const y = 128 + Math.sin(a) * r * 0.9;
        const light = 0.9 + (1 - y / 256) * 0.5 + rand() * 0.15;
        g.fillStyle = `rgb(${Math.round((58 + rand() * 34) * light)},${Math.round((104 + rand() * 40) * light)},${Math.round((34 + rand() * 20) * light)})`;
        g.save();
        g.translate(x, y);
        g.rotate(rand() * Math.PI * 2);
        g.beginPath();
        g.ellipse(0, 0, 13 + rand() * 7, 6 + rand() * 3, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    },
    23,
  );
  // Bark: a palm's ringed trunk, a jungle tree's darker furrowed one.
  const barkMap = foliageTexture(
    64,
    (g, rand) => {
      g.fillStyle = '#7a6448';
      g.fillRect(0, 0, 64, 64);
      for (let y = 0; y < 64; y += 5) {
        g.fillStyle = `rgba(40,30,20,${0.35 + rand() * 0.2})`;
        g.fillRect(0, y, 64, 1.5);
      }
    },
    5,
  );
  barkMap.wrapS = barkMap.wrapT = THREE.RepeatWrapping;
  const foliage = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 });

  // The palm: a slender, leaning, curving trunk, coconuts, and a crown of fronds arching out and drooping.
  const trunkParts: THREE.BufferGeometry[] = [];
  const segments = 6;
  for (let i = 0; i < segments; i++) {
    const g = new THREE.CylinderGeometry(0.02 - i * 0.0015, 0.024 - i * 0.0015, 0.14, 7, 1);
    g.translate(i * i * 0.0025, 0.07 + i * 0.135, 0);
    trunkParts.push(g);
  }
  const top = new THREE.Vector3(segments * segments * 0.0025, segments * 0.135, 0);
  for (let k = 0; k < 4; k++) {
    const nut = new THREE.SphereGeometry(0.014, 6, 5);
    nut.translate(top.x + Math.cos(k * 1.7) * 0.02, top.y - 0.02, Math.sin(k * 1.7) * 0.02);
    trunkParts.push(nut);
  }
  const palmTrunk = mergeGeometries(trunkParts.map((g) => g.toNonIndexed()))!;
  palmTrunk.scale(2.2, 2.2, 2.2);
  const frondParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) {
    // A frond: a strip along x, arching up then drooping, its leaflets in the texture.
    const steps = 6;
    const pts: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const lengthOf = 0.38 + (i % 3) * 0.05;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const along = t * lengthOf;
      const lift = Math.sin(t * Math.PI * 0.7) * 0.09 - t * t * 0.2;
      const half = 0.075;
      pts.push(along, lift, -half, along, lift, half);
      uv.push(t, 0, t, 1);
      if (k < steps) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    const leaf = new THREE.BufferGeometry();
    leaf.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    leaf.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    leaf.setIndex(idx);
    // Each frond twisted a little about its own length, then spread round the crown, some higher.
    leaf.rotateX((i % 2 ? 1 : -1) * 0.35);
    leaf.rotateZ(i < 5 ? 0.3 : 0);
    leaf.rotateY((i / 14) * Math.PI * 2 + i * 0.37);
    leaf.translate(top.x, top.y + 0.01, top.z);
    leaf.computeVertexNormals();
    frondParts.push(leaf.toNonIndexed());
  }
  const palmCrown = mergeGeometries(frondParts)!;
  palmCrown.scale(2.2, 2.2, 2.2);

  // A jungle tree: a trunk forking into three boughs, a crown of leaf clusters (crossed cards) on and round them.
  const treeTrunkParts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.022, 0.034, 0.32, 7).translate(0, 0.16, 0)];
  const crownParts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const bough = new THREE.CylinderGeometry(0.01, 0.016, 0.2, 5).translate(0, 0.1, 0);
    bough.rotateZ(0.6);
    bough.rotateY(a);
    bough.translate(0, 0.3, 0);
    treeTrunkParts.push(bough);
  }
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let k = 0; k < 16; k++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.04 + rnd() * 0.2;
    const y = 0.34 + rnd() * 0.22 - r * 0.3;
    const size = 0.3 + rnd() * 0.14;
    for (const turn of [0, Math.PI / 2]) {
      const c = card(size, size * 0.8);
      c.translate(0, -size * 0.3, 0);
      c.rotateX((rnd() - 0.5) * 0.8);
      c.rotateY(a + turn);
      c.translate(Math.cos(a) * r, y, Math.sin(a) * r);
      crownParts.push(c.toNonIndexed());
    }
  }
  // A flat-ish card across the top, so the crown reads from above as well as from the side.
  for (let k = 0; k < 5; k++) {
    const c = new THREE.PlaneGeometry(0.4, 0.4).rotateX(-Math.PI / 2 + (rnd() - 0.5) * 0.4);
    c.translate((rnd() - 0.5) * 0.18, 0.46 + rnd() * 0.08, (rnd() - 0.5) * 0.18);
    crownParts.push(c.toNonIndexed());
  }
  const treeTrunk = mergeGeometries(treeTrunkParts.map((g) => g.toNonIndexed()))!;
  const treeCrown = mergeGeometries(crownParts)!;

  // Undergrowth: a shrub or a fern, a few crossed leaf cards low to the ground.
  const bushParts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const c = card(0.26, 0.18);
    c.rotateY((k / 4) * Math.PI);
    bushParts.push(c.toNonIndexed());
  }
  const bush = mergeGeometries(bushParts)!;

  // A shore rock: a lumpy grey boulder.
  const rock = new THREE.IcosahedronGeometry(0.1, 1);
  {
    const p = rock.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const b = 0.75 + hash2(Math.round(p.getX(i) * 80), Math.round(p.getY(i) * 80 + p.getZ(i) * 50)) * 0.5;
      p.setXYZ(i, p.getX(i) * b * 1.2, p.getY(i) * b * 0.7, p.getZ(i) * b);
    }
    rock.computeVertexNormals();
  }

  return {
    palmTrunk,
    palmCrown,
    treeTrunk,
    treeCrown,
    bush,
    rock,
    barkMaterial: new THREE.MeshStandardMaterial({ map: barkMap, roughness: 0.9 }),
    frondMaterial: foliage(frondMap),
    leafMaterial: foliage(leafMap),
    rockMaterial: new THREE.MeshStandardMaterial({ color: '#6e6a62', roughness: 0.95 }),
  };
}
