import * as THREE from 'three';
import type { TileMap } from '@corsair/data';

// The land, raised from the map's tiles and elevation bands into soft green islands (Pirates! 2004: painterly,
// simple shapes), and the sea floor the water reads its colour from. The tile grid is blurred so coasts run
// smooth rather than in steps; heights are exaggerated far beyond life, like the ships, so islands read as
// islands from a ship's-eye camera.

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

export interface Ground {
  /** Smoothed ground height at a tile (negative under the sea). */
  heightAt(x: number, y: number): number;
  /** The sea floor for the water shader: 0 deep water .. 1 at the shoreline and above. */
  depth: THREE.DataTexture;
  /** The islands, in chunks so those out of view are culled. */
  meshes: THREE.Mesh[];
}

const CHUNK = 100;
const STEP = 2;

/** Ground colours (Technicolor, not realistic): sand, jungle, hill grass, rock. */
const SAND = new THREE.Color('#e9d39a');
const JUNGLE = new THREE.Color('#3f8f3a');
const GRASS = new THREE.Color('#7da343');
const ROCK = new THREE.Color('#8a7a66');

export function createGround(map: TileMap): Ground {
  const { width: w, height: h } = map;
  const raw = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) raw[i] = groundOf(map.tiles[i] ?? 3, map.elevation[i] ?? 0);
  const ground = blur(raw, w, h, 1, 3);
  const heightAt = (x: number, y: number) => {
    const tx = Math.min(w - 1, Math.max(0, Math.floor(x)));
    const ty = Math.min(h - 1, Math.max(0, Math.floor(y)));
    return ground[ty * w + tx]!;
  };

  // The sea floor, one texel a tile: -2.2 (deep) .. 0 (the shoreline) mapped to 0 .. 1.
  const floor = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) floor[i] = Math.round(255 * Math.min(1, Math.max(0, (ground[i]! + 2.2) / 2.2)));
  const depth = new THREE.DataTexture(floor, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  depth.magFilter = THREE.LinearFilter;
  depth.minFilter = THREE.LinearFilter;
  depth.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const meshes: THREE.Mesh[] = [];
  const colour = new THREE.Color();
  for (let cy = 0; cy < h; cy += CHUNK) {
    for (let cx = 0; cx < w; cx += CHUNK) {
      const x1 = Math.min(w, cx + CHUNK);
      const y1 = Math.min(h, cy + CHUNK);
      // Open sea: nothing above the floor to draw.
      let land = false;
      for (let y = cy; y < y1 && !land; y++) for (let x = cx; x < x1; x++) if (ground[y * w + x]! > -0.4) { land = true; break; }
      if (!land) continue;
      const nx = Math.floor((x1 - cx) / STEP) + 1;
      const ny = Math.floor((y1 - cy) / STEP) + 1;
      const pos = new Float32Array(nx * ny * 3);
      const col = new Float32Array(nx * ny * 3);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const x = cx + i * STEP;
          const y = cy + j * STEP;
          const g = heightAt(x, y);
          const k = (j * nx + i) * 3;
          pos[k] = x;
          pos[k + 1] = Math.max(g, -0.9);
          pos[k + 2] = y;
          // Sand at the waterline, jungle above it, hill grass higher, rock on the peaks.
          if (g < 0.35) colour.copy(SAND);
          else if (g < 1.6) colour.copy(SAND).lerp(JUNGLE, Math.min(1, (g - 0.35) / 0.35));
          else if (g < 3.2) colour.copy(JUNGLE).lerp(GRASS, (g - 1.6) / 1.6);
          else colour.copy(GRASS).lerp(ROCK, Math.min(1, (g - 3.2) / 2));
          col[k] = colour.r;
          col[k + 1] = colour.g;
          col[k + 2] = colour.b;
        }
      }
      const index: number[] = [];
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const a = j * nx + i;
          index.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geometry.setIndex(index);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      meshes.push(mesh);
    }
  }
  return { heightAt, depth, meshes };
}
