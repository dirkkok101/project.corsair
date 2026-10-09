import * as THREE from 'three';

// The sea's baked textures. Every fine pattern on the water comes from a tiling, mipmapped texture rather than
// noise worked out per pixel, so the GPU filters it down with distance: far out it averages to an even colour
// instead of aliasing into stripes or shimmering.

/** Side of the detail texture, texels. */
const SIZE = 512;

/** A seeded generator, so the sea is the same every run. */
function random(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** Tiling value noise: `cells` lattice cells across the texture, smooth between them. */
function valueNoise(cells: number, rand: () => number) {
  const lattice = Float32Array.from({ length: cells * cells }, rand);
  return (u: number, v: number) => {
    const x = u * cells;
    const y = v * cells;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => lattice[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]!;
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function fbm(octaves: [cells: number, weight: number][], rand: () => number) {
  const layers = octaves.map(([cells, w]) => [valueNoise(cells, rand), w] as const);
  const total = octaves.reduce((n, [, w]) => n + w, 0);
  return (u: number, v: number) => layers.reduce((n, [f, w]) => n + f(u, v) * w, 0) / total;
}

/**
 * The detail texture, tiling, one texel a 1/SIZE of its repeat:
 * - R: the hammered surface, as shading (0.5 is flat): shallow dents in a loose cell pattern, lit from one side.
 * - G: whitecap flecks, small soft blobs (the shader stretches them along the wind).
 * - B: a broad soft noise, for the patches where flecks show and for the drifting cloud shadows.
 * - A: a medium noise, to break up the shallows, the surf and the foam.
 */
export function detailTexture(): THREE.DataTexture {
  const rand = random(20261009);
  // Dents: jittered cells, each a shallow bowl; neighbouring bowls meet in soft ridges.
  const cells = 24;
  const points = Array.from({ length: cells * cells }, () => [rand(), rand(), 0.75 + rand() * 0.5] as const);
  const dent = (u: number, v: number) => {
    const x = u * cells;
    const y = v * cells;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let best = 9;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i;
        const cy = iy + j;
        const p = points[(((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells)]!;
        const d = Math.hypot(cx + p[0] - x, cy + p[1] - y) * p[2];
        if (d < best) best = d;
      }
    }
    return best * best;
  };
  const fine = fbm([[64, 1], [128, 0.5]], rand);
  const broad = fbm([[4, 1], [8, 0.55], [16, 0.25]], rand);
  const medium = fbm([[16, 1], [32, 0.5], [64, 0.25]], rand);

  const height = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) height[y * SIZE + x] = dent(x / SIZE, y / SIZE) + (fine(x / SIZE, y / SIZE) - 0.5) * 0.12;
  }
  // Flecks: scattered soft blobs, a few hundred to the repeat, of varied size and brightness.
  const flecks = new Float32Array(SIZE * SIZE);
  for (let n = 0; n < 420; n++) {
    const cx = rand() * SIZE;
    const cy = rand() * SIZE;
    const r = 1.3 + rand() * 2;
    const peak = 0.45 + rand() * 0.55;
    for (let dy = -Math.ceil(r * 2); dy <= Math.ceil(r * 2); dy++) {
      for (let dx = -Math.ceil(r * 2); dx <= Math.ceil(r * 2); dx++) {
        const px = (((Math.round(cx) + dx) % SIZE) + SIZE) % SIZE;
        const py = (((Math.round(cy) + dy) % SIZE) + SIZE) % SIZE;
        const d = Math.hypot(Math.round(cx) + dx - cx, Math.round(cy) + dy - cy) / r;
        const i = py * SIZE + px;
        flecks[i] = Math.max(flecks[i]!, peak * Math.exp(-d * d * 2.2));
      }
    }
  }

  const data = new Uint8Array(SIZE * SIZE * 4);
  const h = (x: number, y: number) => height[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)]!;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      // Lit from up-left: the slope toward the light, scaled to fill the byte.
      const slope = (h(x - 1, y - 1) - h(x + 1, y + 1)) * 6;
      data[i * 4] = Math.round(255 * THREE.MathUtils.clamp(0.5 + slope, 0, 1));
      data[i * 4 + 1] = Math.round(255 * flecks[i]!);
      data[i * 4 + 2] = Math.round(255 * broad(x / SIZE, y / SIZE));
      data[i * 4 + 3] = Math.round(255 * medium(x / SIZE, y / SIZE));
    }
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The coast, from the game's sea-floor texture (one texel a tile: R the floor's height, 0 deep .. 1 at the
 * shoreline; G nearness to land), redone for the water's needs:
 * - R: the floor's height as it was (bilinear, it puts the shoreline where the ground meets the sea);
 * - G: a smoothed shallowness, for the turquoise apron's soft gradient;
 * - B, A: the direction toward the shore (as 0..1 for -1..1), for wave lines that roll in.
 */
export function coastTexture(depth: THREE.Texture, mapW: number, mapH: number): THREE.DataTexture {
  const source = (depth.image as { data: Uint8Array }).data;
  const w = mapW;
  const h = mapH;
  // RG source (two bytes a texel).
  const floor = new Float32Array(w * h);
  const halo = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    floor[i] = source[i * 2]! / 255;
    halo[i] = source[i * 2 + 1]! / 255;
  }
  const smooth = blur(blur(floor, w, h, 2), w, h, 2);
  // The shore lies up the slope of a wide blur of the floor (a sharper one points every which way in the deep).
  const wide = blur(blur(floor, w, h, 5), w, h, 5);
  const at = (a: Float32Array, x: number, y: number) => a[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = at(wide, x + 1, y) - at(wide, x - 1, y);
      const gy = at(wide, x, y + 1) - at(wide, x, y - 1);
      const len = Math.hypot(gx, gy) || 1;
      data[i * 4] = source[i * 2]!;
      data[i * 4 + 1] = Math.round(255 * Math.max(smooth[i]!, floor[i]! * 0.98) * (0.75 + 0.25 * Math.min(1, halo[i]! * 1.5)));
      data[i * 4 + 2] = Math.round(255 * (0.5 + (0.5 * gx) / len));
      data[i * 4 + 3] = Math.round(255 * (0.5 + (0.5 * gy) / len));
    }
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** A box blur of radius r, separable. */
function blur(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += a[y * w + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / (2 * r + 1);
      sum += a[y * w + Math.min(w - 1, x + r + 1)]! - a[y * w + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1);
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}
