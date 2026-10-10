import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// HD ships, built in code from each class's plan (rigs.ts) rather than exported from Blender, so the sails can
// be cloth: they belly to leeward with the wind, luff in irons, furl and reef, and later tear; masts are
// separate pieces that can fall. Art direction: Pirates! 2004 (golden-brown hulls, glowing white sails, big
// flags), docs/reference/pirates-3d-style.md.
//
// Model units match the old class models (the brig 2.4 long), so the renderer's scale is unchanged. The ship's
// frame: bow toward -z, up +y, starboard +x; the waterline at y 0.

/** A square sail on a yard: centre forward of the mast, head and foot heights, head and foot widths, belly. */
export interface SquareSail {
  name: string;
  zt: number;
  zb: number;
  wt: number;
  wb: number;
  billow: number;
}
/** A mast: where it stands (forward of the hull's middle), how tall, and its square sails top to bottom. */
export interface Mast {
  at: number;
  height: number;
  squares: SquareSail[];
}
/** A fore-and-aft sail on the centreline: its corners (forward position, height) and the point it swings round. */
export interface FlatSail {
  kind: 'jib' | 'spanker' | 'gaff' | 'lateen';
  /** Tack (forward lower), throat or head (forward upper), peak (aft upper), clew (aft lower). */
  corners: [number, number][];
  pivot: number;
  /** A gaff or lateen hangs from a spar, drawn along its head. */
  spar?: boolean;
  /** A boom along its foot. */
  boom?: boolean;
}
export interface HullPlan {
  length: number;
  /** Half the beam at its widest. */
  beam: number;
  /** Rail height amidships, and the rise toward stern and bow (the sheer). */
  rail: number;
  sheerStern: number;
  sheerBow: number;
  /** A raised stern castle: its height above the sheer, and how far forward it reaches (0 stern .. 1 bow). */
  castle: number;
  castleTo: number;
  /** A raised forecastle, from this far aft. */
  forecastle: number;
  forecastleFrom: number;
  /** 0 fine .. 1 bluff bows; the stern's width as a share of the beam (a fluyt's narrow pear stern is small). */
  fullness: number;
  sternWidth: number;
  /** Gun decks: rows of ports (height as a share of the rail) and how many a side. */
  ports: { at: number; count: number }[];
  paint: { hull: string; band: string; wale: string; deck: string; trim: string };
}
export interface ShipPlan {
  hull: HullPlan;
  masts: Mast[];
  flats: FlatSail[];
  /** Bowsprit from (forward, height) to (forward, height). */
  bowsprit: [[number, number], [number, number]];
}

/** Points of sail, as the sprites had them: yard brace (degrees), belly, fore-and-aft swing (degrees). */
const POINTS: Record<string, { brace: number; belly: number; swing: number }> = {
  run: { brace: 0, belly: 1.25, swing: 75 },
  broad: { brace: 20, belly: 1.2, swing: 50 },
  beam: { brace: 35, belly: 1.0, swing: 32 },
  close: { brace: 45, belly: 0.6, swing: 14 },
  irons: { brace: 45, belly: 0.05, swing: 4 },
};

// --- textures, drawn once per paint scheme --------------------------------------------------------------

/** A seeded generator, so every ship of a class is weathered the same. */
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** Surfaces drawn as canvases: its colour, and a height (grey) for its relief and a roughness (grey). */
interface Surface {
  colour: CanvasRenderingContext2D;
  height: CanvasRenderingContext2D;
  rough: CanvasRenderingContext2D;
}
function surface(w: number, h: number): Surface {
  const make = () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c.getContext('2d')!;
  };
  const colour = make();
  const height = make();
  const rough = make();
  height.fillStyle = 'rgb(128,128,128)';
  height.fillRect(0, 0, w, h);
  return { colour, height, rough };
}

/** A tangent-space normal map from a height canvas (`strength` steepens it), tiling along u. */
function normalMap(height: CanvasRenderingContext2D, strength: number): THREE.DataTexture {
  const { width: w, height: h } = height.canvas;
  const px = height.getImageData(0, 0, w, h).data;
  const at = (x: number, y: number) => px[(Math.min(h - 1, Math.max(0, y)) * w + ((x + w) % w)) * 4]! / 255;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      // Canvas y runs down the texture, its v up: the green (v) slope is flipped.
      out[i] = Math.round((0.5 - dx / len / 2) * 255);
      out[i + 1] = Math.round((0.5 + dy / len / 2) * 255);
      out[i + 2] = Math.round((0.5 + 0.5 / len) * 255);
      out[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.flipY = true;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** A grey canvas as a texture of plain values (not colour), for roughness. */
function valueMap(c: HTMLCanvasElement, anisotropy: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = anisotropy;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Where the waterline lies on the hull's texture, top (rail) 0 .. bottom (keel) 1: the hull meets the sea at y 0. */
const waterlineV = (plan: HullPlan) => plan.rail / (plan.rail - KEEL);

/**
 * The hull's side, weathered: planked in strakes of varied tone with a grain, a painted upper band, a dark wale,
 * grime streaked down from the ports and scuppers, a dark wet band and green weed at the waterline, a tarred
 * bottom below it. With a relief (plank seams, butt joints, the grain) and a roughness (dry wood matte, the wet
 * waterline glossy).
 */
function hullSurface(plan: HullPlan): Surface {
  const W = 2048;
  const H = 512;
  const sf = surface(W, H);
  const { colour: g, height: hg, rough: rg } = sf;
  const rand = seeded(plan.length * 1000 + plan.beam * 97);
  const band = H * 0.34;
  const water = H * (1 - waterlineV(plan));
  g.fillStyle = plan.paint.hull;
  g.fillRect(0, 0, W, H);
  g.fillStyle = plan.paint.band;
  g.fillRect(0, 0, W, band);
  g.fillStyle = plan.paint.wale;
  g.fillRect(0, band, W, 26);
  // Strakes: each plank a shade apart, butted end to end, with a fine grain; seams sunk in the relief.
  const strakeH = 22;
  rg.fillStyle = 'rgb(205,205,205)';
  rg.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += strakeH) {
    let x = -rand() * 300;
    while (x < W) {
      // Long planks (a butt joint every so often, staggered strake to strake, never a brick pattern).
      const len = 520 + rand() * 640;
      const tone = (rand() - 0.5) * 0.16;
      g.fillStyle = tone > 0 ? `rgba(255,235,200,${tone})` : `rgba(20,10,4,${-tone})`;
      g.fillRect(x, y, len, strakeH);
      // Grain: long faint streaks along the plank.
      for (let k = 0; k < 7; k++) {
        const gy = y + rand() * strakeH;
        g.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,240,210'},${0.03 + rand() * 0.05})`;
        g.fillRect(x + rand() * 20, gy, len * (0.4 + rand() * 0.6), 1);
        hg.fillStyle = `rgba(${rand() < 0.5 ? '100,100,100' : '150,150,150'},0.5)`;
        hg.fillRect(x + rand() * 20, gy, len * (0.4 + rand() * 0.6), 1);
      }
      // The butt joint.
      g.fillStyle = 'rgba(10,5,2,0.16)';
      g.fillRect(x, y, 2, strakeH);
      hg.fillStyle = 'rgb(100,100,100)';
      hg.fillRect(x, y, 2, strakeH);
      x += len;
    }
    // The seam between strakes: dark, sunk, a little caulking.
    g.fillStyle = 'rgba(10,5,2,0.45)';
    g.fillRect(0, y, W, 2);
    hg.fillStyle = 'rgb(55,55,55)';
    hg.fillRect(0, y, W, 2);
    // Each plank a little proud in its middle.
    const grad = hg.createLinearGradient(0, y + 2, 0, y + strakeH);
    grad.addColorStop(0, 'rgba(150,150,150,0.0)');
    grad.addColorStop(0.5, 'rgba(160,160,160,0.6)');
    grad.addColorStop(1, 'rgba(150,150,150,0.0)');
    hg.fillStyle = grad;
    hg.fillRect(0, y + 2, W, strakeH - 2);
  }
  // The wale stands out.
  hg.fillStyle = 'rgb(175,175,175)';
  hg.fillRect(0, band + 2, W, 22);
  // Grime: streaks running down from the rail and from each scupper, rain-washed.
  for (let i = 0; i < 260; i++) {
    const x = rand() * W;
    const top = rand() < 0.5 ? 0 : band + 26;
    const len = 40 + rand() * 160;
    const grad = g.createLinearGradient(0, top, 0, top + len);
    grad.addColorStop(0, `rgba(25,18,10,${0.12 + rand() * 0.18})`);
    grad.addColorStop(1, 'rgba(25,18,10,0)');
    g.fillStyle = grad;
    g.fillRect(x, top, 2 + rand() * 5, len);
  }
  // Paint long at sea: the band's colour dulled and darkened unevenly, as weathered paint is.
  for (let i = 0; i < 140; i++) {
    g.fillStyle = `rgba(${40 + rand() * 30},${30 + rand() * 20},${20 + rand() * 15},${0.08 + rand() * 0.12})`;
    g.fillRect(rand() * W, rand() * band, 60 + rand() * 260, 6 + rand() * 24);
  }
  g.fillStyle = 'rgba(55,40,28,0.22)';
  g.fillRect(0, 0, W, band);
  // Salt and sun bleaching on the upper works, in patches.
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(235,225,205,${0.03 + rand() * 0.05})`;
    g.beginPath();
    g.ellipse(rand() * W, rand() * band, 30 + rand() * 90, 6 + rand() * 18, 0, 0, Math.PI * 2);
    g.fill();
  }
  // The waterline: below, a tarred bottom; along it, green weed and a dark wet band where the sea washes up.
  g.fillStyle = 'rgba(18,14,12,0.78)';
  g.fillRect(0, water, W, H - water);
  const wet = g.createLinearGradient(0, water - 44, 0, water + 6);
  wet.addColorStop(0, 'rgba(10,8,6,0)');
  wet.addColorStop(1, 'rgba(10,8,6,0.55)');
  g.fillStyle = wet;
  g.fillRect(0, water - 44, W, 50);
  for (let i = 0; i < 420; i++) {
    g.fillStyle = `rgba(${40 + rand() * 30},${70 + rand() * 40},${30 + rand() * 20},${0.25 + rand() * 0.35})`;
    g.fillRect(rand() * W, water - 6 + rand() * 18, 3 + rand() * 14, 2 + rand() * 6);
  }
  // Wet near the sea, glossy (low roughness); the tarred bottom a little glossy too.
  const gloss = rg.createLinearGradient(0, water - 60, 0, water);
  gloss.addColorStop(0, 'rgba(110,110,110,0)');
  gloss.addColorStop(1, 'rgba(110,110,110,1)');
  rg.fillStyle = gloss;
  rg.fillRect(0, water - 60, W, 60);
  rg.fillStyle = 'rgb(130,130,130)';
  rg.fillRect(0, water, W, H - water);
  // The painted band a little smoother than the bare planks.
  rg.fillStyle = 'rgba(160,160,160,0.5)';
  rg.fillRect(0, 0, W, band);
  // A gilt moulding along the rail.
  g.fillStyle = plan.paint.trim;
  g.fillRect(0, 0, W, 10);
  hg.fillStyle = 'rgb(190,190,190)';
  hg.fillRect(0, 0, W, 10);
  return sf;
}

/** Gunport rows on the hull: lids in a frame, the dark port sunk into the side, grime running down below each. */
function addPorts(sf: Surface, plan: HullPlan): void {
  const { colour: g, height: hg } = sf;
  for (const row of plan.ports) {
    const v = 512 * (1 - row.at) * 0.62;
    for (let i = 0; i < row.count; i++) {
      const u = 2048 * (0.22 + (0.6 * (i + 0.5)) / row.count);
      const grime = g.createLinearGradient(0, v + 20, 0, v + 120);
      grime.addColorStop(0, 'rgba(30,18,10,0.35)');
      grime.addColorStop(1, 'rgba(30,18,10,0)');
      g.fillStyle = grime;
      g.fillRect(u - 14, v + 20, 28, 100);
      g.fillStyle = plan.paint.trim;
      g.fillRect(u - 30, v - 26, 60, 52);
      g.fillStyle = '#1a0f12';
      g.fillRect(u - 24, v - 20, 48, 40);
      hg.fillStyle = 'rgb(200,200,200)';
      hg.fillRect(u - 30, v - 26, 60, 52);
      hg.fillStyle = 'rgb(40,40,40)';
      hg.fillRect(u - 24, v - 20, 48, 40);
    }
  }
}

/**
 * The stern windows' lamplight, shared by every ship: dark by day, warm by night (the renderer sets it with the
 * light). The window panes are drawn into an emissive map, so only they glow.
 */
export const WINDOW_GLOW = new THREE.Color(0, 0, 0);

/** The stern gallery's window panes alone, white on black: the emissive map for their lamplight. */
function sternGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = i % 2 ? '#ffd890' : '#ffe6a8';
    g.fillRect(34 + i * 42, 42, 22, 40);
    // The leading of the panes stays dark against the lamplight.
    g.fillStyle = '#000';
    for (let k = 1; k < 4; k++) g.fillRect(34 + i * 42, 42 + k * 10, 22, 1);
    g.fillRect(44 + i * 42, 42, 1, 40);
  }
  return finish(c, 1);
}

/**
 * The transom: the stern gallery's windows in carved, gilded frames, weathered: the paint dulled and streaked,
 * the gilt worn to the wood in places, small leaded panes.
 */
function sternTexture(plan: HullPlan): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const rand = seeded(plan.length * 13 + 5);
  g.fillStyle = plan.paint.hull;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = plan.paint.band;
  g.fillRect(0, 0, 256, 120);
  g.fillStyle = 'rgba(55,40,28,0.3)';
  g.fillRect(0, 0, 256, 120);
  // The carved frame: gilt with worn, dark edges.
  g.fillStyle = plan.paint.trim;
  g.fillRect(20, 30, 216, 64);
  g.fillStyle = 'rgba(60,40,20,0.45)';
  g.fillRect(20, 30, 216, 4);
  g.fillRect(20, 90, 216, 4);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = 'rgba(60,40,20,0.5)';
    g.fillRect(28 + i * 42, 36, 34, 52);
    // Leaded panes: dark glass that catches a little sky.
    g.fillStyle = '#2a3a48';
    g.fillRect(34 + i * 42, 42, 22, 40);
    g.fillStyle = 'rgba(160,190,210,0.25)';
    g.fillRect(34 + i * 42, 42, 22, 12);
    g.fillStyle = 'rgba(20,15,10,0.8)';
    for (let k = 1; k < 4; k++) g.fillRect(34 + i * 42, 42 + k * 10, 22, 1);
    g.fillRect(44 + i * 42, 42, 1, 40);
  }
  g.fillStyle = plan.paint.trim;
  g.fillRect(0, 110, 256, 8);
  // Weather: grime streaked down, the gilt rubbed through to dark wood here and there.
  for (let i = 0; i < 60; i++) {
    const x = rand() * 256;
    const top = rand() * 120;
    const grad = g.createLinearGradient(0, top, 0, top + 60);
    grad.addColorStop(0, `rgba(25,18,10,${0.1 + rand() * 0.15})`);
    grad.addColorStop(1, 'rgba(25,18,10,0)');
    g.fillStyle = grad;
    g.fillRect(x, top, 2 + rand() * 3, 60);
  }
  for (let i = 0; i < 50; i++) {
    g.fillStyle = 'rgba(70,45,25,0.35)';
    g.fillRect(rand() * 256, 30 + rand() * 90, 2 + rand() * 8, 2 + rand() * 3);
  }
  return finish(c, 2);
}

/**
 * The deck, weathered: planks fore and aft (along v) paying with tarred seams, each a shade apart with a grain;
 * worn paler down the middle where the crew walk, stained, and darker toward the waterways at the sides. With a
 * relief (the seams sunk, the trenails) and a roughness (scrubbed boards matte, the tar a little glossy).
 */
function deckSurface(plan: HullPlan): Surface {
  const S = 512;
  const sf = surface(S, S);
  const { colour: g, height: hg, rough: rg } = sf;
  const rand = seeded(plan.length * 77 + 3);
  g.fillStyle = plan.paint.deck;
  g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(70, 40, 20, 0.45)';
  g.fillRect(0, 0, S, S);
  rg.fillStyle = 'rgb(225,225,225)';
  rg.fillRect(0, 0, S, S);
  const plank = 24;
  for (let x = 0; x < S; x += plank) {
    // Each plank's own shade, and its butt joints, staggered.
    const tone = (rand() - 0.5) * 0.14;
    g.fillStyle = tone > 0 ? `rgba(255,230,190,${tone})` : `rgba(25,12,4,${-tone})`;
    g.fillRect(x, 0, plank, S);
    for (let k = 0; k < 10; k++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,235,200'},${0.03 + rand() * 0.04})`;
      g.fillRect(x + rand() * plank, rand() * S, 1, 40 + rand() * 160);
    }
    for (let y = rand() * 200; y < S; y += 180 + rand() * 160) {
      g.fillStyle = 'rgba(20,10,4,0.3)';
      g.fillRect(x, y, plank, 2);
      hg.fillStyle = 'rgb(80,80,80)';
      hg.fillRect(x, y, plank, 2);
      // Trenails either side of the joint.
      for (const dy of [-6, 6]) {
        g.fillStyle = 'rgba(30,15,6,0.5)';
        g.fillRect(x + 6, y + dy, 3, 3);
        g.fillRect(x + plank - 9, y + dy, 3, 3);
      }
    }
    // The tarred seam.
    g.fillStyle = 'rgba(12,8,6,0.75)';
    g.fillRect(x, 0, 2, S);
    hg.fillStyle = 'rgb(50,50,50)';
    hg.fillRect(x, 0, 2, S);
    rg.fillStyle = 'rgb(120,120,120)';
    rg.fillRect(x, 0, 2, S);
  }
  // Worn paler down the middle, darker toward the sides.
  const wear = g.createLinearGradient(0, 0, S, 0);
  wear.addColorStop(0, 'rgba(20,10,4,0.35)');
  wear.addColorStop(0.3, 'rgba(255,240,215,0.06)');
  wear.addColorStop(0.5, 'rgba(255,240,215,0.12)');
  wear.addColorStop(0.7, 'rgba(255,240,215,0.06)');
  wear.addColorStop(1, 'rgba(20,10,4,0.35)');
  g.fillStyle = wear;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(30,18,8,${0.05 + rand() * 0.1})`;
    g.beginPath();
    g.ellipse(rand() * S, rand() * S, 8 + rand() * 40, 6 + rand() * 30, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return sf;
}

/** A castle bulkhead's face: planked in the band's colour, two doors in gilt-edged frames, small windows above. */
function bulkheadTexture(plan: HullPlan): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = plan.paint.band;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(55,40,28,0.35)';
  g.fillRect(0, 0, 256, 128);
  for (let x = 0; x < 256; x += 16) {
    g.fillStyle = 'rgba(20,10,4,0.3)';
    g.fillRect(x, 0, 1.5, 128);
  }
  for (const x of [54, 172]) {
    g.fillStyle = plan.paint.trim;
    g.fillRect(x - 3, 40, 36, 88);
    g.fillStyle = '#2a1a10';
    g.fillRect(x, 44, 30, 84);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(x + 4, 50, 2, 70);
  }
  for (const x of [20, 120, 220]) {
    g.fillStyle = plan.paint.trim;
    g.fillRect(x - 2, 10, 20, 18);
    g.fillStyle = '#2a3a48';
    g.fillRect(x, 12, 16, 14);
  }
  g.fillStyle = plan.paint.trim;
  g.fillRect(0, 0, 256, 5);
  return finish(c, 4);
}

/** A hatch grating: a lattice of bars over the dark hold, in a coaming. */
function gratingTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#120c08';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#6b4a30';
  for (let i = 0; i < 128; i += 16) {
    g.fillRect(i, 0, 6, 128);
    g.fillRect(0, i, 128, 6);
  }
  g.strokeStyle = '#4a3020';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 118, 118);
  return finish(c, 4);
}

/**
 * Sailcloth: off-white canvas with seams down each cloth, a bolt rope round the edge and two reef bands near
 * the head; a square sail can carry its nation's emblem (Pirates! paints the Spanish cross on Spanish canvas
 * and a skull on a pirate's).
 */
const CLOTH = new Map<string, { map: THREE.CanvasTexture; normal: THREE.DataTexture }>();
function sailTexture(emblem: string): { map: THREE.CanvasTexture; normal: THREE.DataTexture } {
  const known = CLOTH.get(emblem);
  if (known) return known;
  const S = 512;
  const sf = surface(S, S);
  const { colour: g, height: hg } = sf;
  const rand = seeded(emblem.length * 131 + 7);
  g.fillStyle = '#efe7d3';
  g.fillRect(0, 0, S, S);
  // The weave: a fine cross-hatch of warp and weft, barely there.
  for (let i = 0; i < S; i += 2) {
    g.fillStyle = `rgba(110,90,60,${0.025 + rand() * 0.03})`;
    g.fillRect(i, 0, 1, S);
    g.fillRect(0, i, S, 1);
    hg.fillStyle = 'rgba(115,115,115,0.35)';
    hg.fillRect(i, 0, 1, S);
    hg.fillRect(0, i, S, 1);
  }
  // Cloths of slightly different bolts, seamed: a doubled, raised stitch line between each.
  for (let x = 0; x < S; x += 42) {
    const tone = (rand() - 0.5) * 0.08;
    g.fillStyle = tone > 0 ? `rgba(255,250,235,${tone})` : `rgba(80,65,40,${-tone})`;
    g.fillRect(x, 0, 42, S);
    g.fillStyle = 'rgba(120,100,70,0.28)';
    g.fillRect(x, 0, 3, S);
    hg.fillStyle = 'rgb(175,175,175)';
    hg.fillRect(x, 0, 3, S);
  }
  // Soft creases where the cloth draws between yard and sheets: broad shallow troughs, slanting.
  for (let i = 0; i < 26; i++) {
    const y = rand() * S;
    const grad = hg.createLinearGradient(0, y - 18, 0, y + 18);
    grad.addColorStop(0, 'rgba(128,128,128,0)');
    grad.addColorStop(0.5, `rgba(${rand() < 0.5 ? '95,95,95' : '160,160,160'},0.5)`);
    grad.addColorStop(1, 'rgba(128,128,128,0)');
    hg.save();
    hg.translate(S / 2, y);
    hg.rotate((rand() - 0.5) * 0.5);
    hg.fillStyle = grad;
    hg.fillRect(-S, -18, S * 2, 36);
    hg.restore();
  }
  // Weathered: grey toward the foot, where the spray reaches, and a few stains.
  const foot = g.createLinearGradient(0, S * 0.5, 0, S);
  foot.addColorStop(0, 'rgba(90,80,60,0)');
  foot.addColorStop(1, 'rgba(90,80,60,0.22)');
  g.fillStyle = foot;
  g.fillRect(0, S * 0.5, S, S * 0.5);
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(110,90,60,${0.03 + rand() * 0.05})`;
    g.beginPath();
    g.ellipse(rand() * S, rand() * S, 10 + rand() * 40, 6 + rand() * 24, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // Reef bands with their points, and the bolt rope round the edge, both raised.
  for (const y of [92, 168]) {
    g.fillStyle = 'rgba(120,100,70,0.38)';
    g.fillRect(0, y, S, 6);
    hg.fillStyle = 'rgb(185,185,185)';
    hg.fillRect(0, y, S, 6);
    for (let x = 16; x < S; x += 32) {
      g.fillRect(x, y + 6, 3, 16);
      hg.fillRect(x, y + 6, 3, 16);
    }
  }
  g.strokeStyle = 'rgba(120,100,70,0.5)';
  g.lineWidth = 12;
  g.strokeRect(6, 6, S - 12, S - 12);
  hg.strokeStyle = 'rgb(200,200,200)';
  hg.lineWidth = 12;
  hg.strokeRect(6, 6, S - 12, S - 12);
  const k = S / 256;
  if (emblem === 'spain') {
    // The ragged red cross of Burgundy.
    g.strokeStyle = 'rgba(176,36,40,0.88)';
    g.lineWidth = 16 * k;
    g.beginPath();
    g.moveTo(60 * k, 70 * k);
    g.lineTo(196 * k, 216 * k);
    g.moveTo(196 * k, 70 * k);
    g.lineTo(60 * k, 216 * k);
    g.stroke();
  } else if (emblem === 'pirate') {
    g.fillStyle = 'rgba(40,36,44,0.82)';
    g.beginPath();
    g.arc(128 * k, 128 * k, 30 * k, 0, Math.PI * 2);
    g.fill();
    g.fillRect(108 * k, 150 * k, 40 * k, 18 * k);
    g.save();
    g.translate(128 * k, 188 * k);
    for (const a of [0.6, -0.6]) {
      g.rotate(a);
      g.fillRect(-56 * k, -6 * k, 112 * k, 12 * k);
      g.rotate(-a);
    }
    g.restore();
  }
  const t = { map: finish(g.canvas, 4), normal: normalMap(hg, 2.2) };
  CLOTH.set(emblem, t);
  return t;
}

function finish(c: HTMLCanvasElement, anisotropy: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// --- the hull ------------------------------------------------------------------------------------------

/** Half-width at a station (t 0 stern .. 1 bow) and the rail height there. */
function stationOf(plan: HullPlan, t: number): { w: number; h: number } {
  const midTo = 0.55 - plan.fullness * 0.15;
  let w: number;
  if (t < 0.3) w = plan.beam * (plan.sternWidth + (1 - plan.sternWidth) * Math.sin((Math.PI / 2) * (t / 0.3)) ** 0.8);
  else if (t < midTo) w = plan.beam;
  else w = plan.beam * Math.sqrt(Math.max(0, 1 - ((t - midTo) / (1 - midTo)) ** (1.6 + plan.fullness * 1.8)));
  // Each castle rises in a step at its bulkhead (a deck above the waist), not a ramp.
  const castle = plan.castle * THREE.MathUtils.smoothstep(plan.castleTo - t, -0.006, 0.006);
  const fore = plan.forecastle * THREE.MathUtils.smoothstep(t - plan.forecastleFrom, -0.006, 0.006);
  const h = plan.rail + plan.sheerStern * (1 - t) ** 3 + plan.sheerBow * t ** 4 + castle + fore;
  return { w: Math.max(w, 0.004), h };
}

const KEEL = -0.28;
const STATIONS = 96;
const SECTION = 20;

/** How far out the hull side stands at a height `s` up it (keel 0 .. rail 1), for a half-width `w`. */
function sideAt(w: number, s: number, t = 0.5, plan?: HullPlan): number {
  const bilge = Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, s * 1.6)) ** 2));
  // Tumblehome: the topsides lean in toward the rail, much more on a castled ship (a galleon, a ship of the line).
  const tumbles = plan && plan.castle > 0.2 ? 0.24 : 0.12;
  const tumble = 1 - tumbles * Math.max(0, (s - 0.62) / 0.38) ** 2;
  // Her lines: toward bow and stern the hull fines away below the water into a V (a sharp entry and a clean run),
  // while the topsides stay full and flare out over it.
  const end = Math.max(0, Math.abs(t - 0.5) * 2 - 0.3) / 0.7;
  const fine = 1 - 0.62 * end ** 1.4 * (1 - Math.min(1, s * 1.15)) ** 1.1;
  return w * bilge * tumble * fine;
}

/** A strip along both sides of the hull at height `s`: a wale (out from the side) or the rail's cap. */
function strake(plan: HullPlan, s: number, height: number, out: number, material: THREE.Material): THREE.Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const { w, h } = stationOf(plan, t);
    const z = plan.length / 2 - t * plan.length;
    const y = KEEL + (h - KEEL) * s;
    const x = sideAt(w, s, t, plan) + out;
    pos.push(x, y - height / 2, z, x, y + height / 2, z, -x, y - height / 2, z, -x, y + height / 2, z);
    if (i < STATIONS) {
      const a = i * 4;
      idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5, a + 2, a + 3, a + 6, a + 3, a + 7, a + 6);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}

function hullMesh(plan: HullPlan, sides: THREE.Material, stern: THREE.Material, deck: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  // Each station's section, starboard then port, keel to rail; the hull narrows and tumbles home at the top.
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const { w, h } = stationOf(plan, t);
    const z = plan.length / 2 - t * plan.length;
    for (const side of [1, -1]) {
      for (let j = 0; j <= SECTION; j++) {
        const s = j / SECTION;
        const y = KEEL + (h - KEEL) * s;
        pos.push(side * sideAt(w, s, t, plan), y, z);
        // u once along the length (so the painted ports meet the muzzles), v up the side (keel 0 .. rail 1).
        uv.push(t, (y - KEEL) / (h - KEEL));
      }
    }
  }
  const per = (SECTION + 1) * 2;
  for (let i = 0; i < STATIONS; i++) {
    for (let side = 0; side < 2; side++) {
      for (let j = 0; j < SECTION; j++) {
        const a = i * per + side * (SECTION + 1) + j;
        const b = a + per;
        if (side === 0) index.push(a, b, a + 1, a + 1, b, b + 1);
        else index.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const body = new THREE.Mesh(geometry, sides);
  body.castShadow = true;
  group.add(body);

  // The transom: a flat stern face with its gallery.
  const s0 = stationOf(plan, 0);
  const transom = new THREE.Mesh(new THREE.PlaneGeometry(s0.w * 2, s0.h - 0.02), stern);
  transom.position.set(0, (s0.h + 0.02) / 2, plan.length / 2);
  group.add(transom);

  // The deck, between the rails, a little below them; and a rim along the rails.
  const deckPos: number[] = [];
  const deckUv: number[] = [];
  const deckIdx: number[] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const { w, h } = stationOf(plan, t);
    const z = plan.length / 2 - t * plan.length;
    deckPos.push(-w * 0.88, h - 0.05, z, w * 0.88, h - 0.05, z);
    deckUv.push(0, t * 4, 1, t * 4);
    if (i < STATIONS) deckIdx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(deckPos, 3));
  deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(deckUv, 2));
  deckGeo.setIndex(deckIdx);
  deckGeo.computeVertexNormals();
  group.add(new THREE.Mesh(deckGeo, deck));
  // Each castle's bulkhead across the deck where it rises (painted, with doors in, and windows in a tall one), and
  // a balustrade of turned posts along its edge.
  const bulkheadMat = new THREE.MeshStandardMaterial({ map: bulkheadTexture(plan), roughness: 0.75 });
  const baluster = new THREE.CylinderGeometry(0.006, 0.008, 0.05, 6).translate(0, 0.025, 0);
  const railWood = new THREE.MeshStandardMaterial({ color: plan.paint.wale, roughness: 0.75 });
  for (const [rise, at, faces] of [
    [plan.castle, plan.castleTo, -1],
    [plan.forecastle, plan.forecastleFrom, 1],
  ] as const) {
    if (rise < 0.04) continue;
    const t = at;
    const z = plan.length / 2 - t * plan.length;
    // The waist's deck just off the step, and the castle's on it.
    const low = stationOf(plan, t + faces * -0.03).h - 0.05;
    const high = stationOf(plan, t - faces * -0.03).h - 0.05;
    const w = Math.min(stationOf(plan, t + 0.012).w, stationOf(plan, t - 0.012).w) * 0.88 * 2;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, high - low), bulkheadMat);
    wall.position.set(0, (low + high) / 2, z);
    // Facing the waist (forward for the stern castle, aft for the forecastle).
    wall.rotation.y = faces < 0 ? Math.PI : 0;
    group.add(wall);
    const n = Math.max(4, Math.round(w / 0.07));
    const posts = new THREE.InstancedMesh(baluster, railWood, n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m4.makeTranslation(-w / 2 + (w * (i + 0.5)) / n, high, z + faces * -0.004);
      posts.setMatrixAt(i, m4);
    }
    group.add(posts);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, 0.016), railWood);
    rail.position.set(0, high + 0.052, z);
    group.add(rail);
  }

  // Hatch gratings in their coamings, fore and aft of amidships.
  const grating = new THREE.MeshStandardMaterial({ map: gratingTexture(), roughness: 0.85 });
  const coaming = new THREE.MeshStandardMaterial({ color: plan.paint.wale, roughness: 0.8 });
  for (const t of [0.38, 0.62]) {
    const { w, h } = stationOf(plan, t);
    const z = plan.length / 2 - t * plan.length;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.03, plan.length * 0.08), [coaming, coaming, grating, coaming, coaming, coaming]);
    box.position.set(0, h - 0.035, z);
    group.add(box);
  }

  // Old gilt, worn and dulled by salt: a muted gold, more wood than mirror.
  const gilt = new THREE.MeshStandardMaterial({ color: new THREE.Color(plan.paint.trim).multiplyScalar(0.72), roughness: 0.62, metalness: 0.35 });
  const wale = new THREE.MeshStandardMaterial({ color: plan.paint.wale, roughness: 0.7 });
  // Raised wales: a heavy one below the painted band, a lighter one along the waterline; the rail capped in gilt.
  group.add(strake(plan, 0.64, 0.035, 0.012, wale), strake(plan, 0.42, 0.025, 0.008, wale), strake(plan, 1, 0.022, 0.006, gilt));
  // The bow: a beakhead platform under the bowsprit, a gilded figurehead leaning out, a cutwater below.
  const bow = stationOf(plan, 1);
  const beak = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.2), wale);
  beak.position.set(0, bow.h * 0.72, -plan.length / 2 - 0.08);
  // The figurehead: a carved figure (a lion or a crowned bust, as the yards carved them) leaning out from the
  // stem under the beakhead, on a scrolled bracket, its body tapering into the stem.
  const figure = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.034, 0.13, 10), gilt);
  torso.position.set(0, 0.05, 0);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), gilt);
  chest.scale.set(1, 0.9, 1.1);
  chest.position.set(0, 0.12, -0.006);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), gilt);
  head.position.set(0, 0.17, -0.012);
  // A crown of points (a mane for a lion, seen at this size).
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.03, 8, 1, true), gilt);
  crown.position.set(0, 0.197, -0.012);
  const scroll = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 14, Math.PI * 1.4), gilt);
  scroll.rotation.y = Math.PI / 2;
  scroll.position.set(0, -0.02, 0.01);
  figure.add(torso, chest, head, crown, scroll);
  figure.rotation.x = -0.75;
  figure.position.set(0, bow.h * 0.5, -plan.length / 2 - 0.1);
  // Trailboards: carved, gilt-edged boards running back from the figure along each side of the stem.
  for (const side of [-1, 1]) {
    const trail = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.035, 0.16), gilt);
    trail.position.set(side * 0.02, bow.h * 0.5, -plan.length / 2 - 0.02);
    trail.rotation.x = 0.35;
    group.add(trail);
  }
  const cutwater = new THREE.Mesh(new THREE.BoxGeometry(0.03, bow.h + 0.2, 0.12), wale);
  cutwater.position.set(0, (bow.h - 0.2) / 2, -plan.length / 2 - 0.02);
  group.add(beak, figure, cutwater);
  // Head rails: curved rails sweeping back and up from the figurehead to the bow on each side, two to a side.
  const stem = -plan.length / 2;
  const shoulder = stationOf(plan, 0.93);
  for (const side of [-1, 1]) {
    for (const [lift, out] of [
      [0, 1],
      [0.05, 0.85],
    ] as const) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, bow.h * 0.5 + lift, stem - 0.1),
        new THREE.Vector3(side * 0.035 * out, bow.h * 0.62 + lift, stem - 0.04),
        new THREE.Vector3(side * shoulder.w * 0.7 * out, bow.h * 0.78 + lift, stem + 0.12),
        new THREE.Vector3(side * shoulder.w * out, shoulder.h * 0.85 + lift * 0.5, stem + 0.24),
      ]);
      const railTube = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.007, 5), gilt);
      group.add(railTube);
    }
    // A cathead: a stout beam out over the bow, an anchor hung from it, stock up and flukes down.
    const cat = stationOf(plan, 0.9);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.022, 0.022), wale);
    head.position.set(side * (cat.w + 0.05), cat.h - 0.01, stem + 0.24);
    head.rotation.y = side * 0.4;
    group.add(head);
    const anchor = new THREE.Group();
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.13, 6), BLACK);
    shank.position.y = -0.065;
    const stock = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6), wale);
    stock.rotation.x = Math.PI / 2;
    const arms = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 5, 10, Math.PI), BLACK);
    arms.rotation.z = Math.PI;
    arms.position.y = -0.11;
    anchor.add(shank, stock, arms);
    anchor.position.set(side * (cat.w + 0.11), cat.h - 0.03, stem + 0.24 + 0.03);
    anchor.rotation.y = Math.PI / 2;
    group.add(anchor);
  }
  // Steps up her side amidships, from near the water to the rail, on both sides.
  const entry = stationOf(plan, 0.52);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const s = 0.38 + (k / 6) * 0.58;
      const y = KEEL + (entry.h - KEEL) * s;
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.05), wale);
      step.position.set(side * (sideAt(entry.w, s, 0.52, plan) + 0.012), y, plan.length / 2 - 0.52 * plan.length);
      group.add(step);
    }
  }
  // The stern: quarter galleries on either side, three lanterns on the taffrail.
  const aft = stationOf(plan, 0.05);
  for (const side of [-1, 1]) {
    // A rounded bay standing out from the quarter, its windows (the stern's panes) round it, a domed roof and a
    // drop below, each with a turned finial.
    const height = aft.h * 0.38;
    const bay = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, height, 14, 1, false, side > 0 ? 0 : Math.PI, Math.PI), stern);
    bay.scale.set(0.9, 1, 1.9);
    bay.position.set(side * (aft.w - 0.01), aft.h * 0.72, plan.length / 2 - 0.16);
    const roof = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 6, side > 0 ? 0 : Math.PI, Math.PI, 0, Math.PI / 2), gilt);
    roof.scale.set(0.9, 0.7, 1.9);
    roof.position.set(bay.position.x, aft.h * 0.72 + height / 2, bay.position.z);
    const drop = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.09, 14, 1, false, side > 0 ? 0 : Math.PI, Math.PI), gilt);
    drop.rotation.x = Math.PI;
    drop.scale.set(0.9, 1, 1.9);
    drop.position.set(bay.position.x, aft.h * 0.72 - height / 2 - 0.045, bay.position.z);
    group.add(bay, roof, drop);
  }

  // On deck: the ship's boat stowed keel-up amidships on chocks, the capstan, and the wheel aft.
  const boatWood = new THREE.MeshStandardMaterial({ color: '#5e3f2a', roughness: 0.8 });
  const mid = stationOf(plan, 0.5);
  const boatLen = plan.length * 0.2;
  const boat = new THREE.Group();
  // Her hull, upturned: a half-ellipsoid, fuller aft, with a keel along the top.
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), boatWood);
  shell.scale.set(mid.w * 0.3, 0.05, boatLen / 2);
  shell.castShadow = true;
  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.01, boatLen * 0.95), wale);
  keel.position.y = 0.05;
  boat.add(shell, keel);
  for (const dz of [-0.3, 0.3]) {
    const chock = new THREE.Mesh(new THREE.BoxGeometry(mid.w * 0.66, 0.02, 0.03), wale);
    chock.position.set(0, -0.005, dz * boatLen);
    boat.add(chock);
  }
  boat.position.set(0, mid.h - 0.05 + 0.02, plan.length / 2 - 0.47 * plan.length);
  group.add(boat);
  const capstan = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.07, 12), wale);
  drum.position.y = 0.035;
  const head2 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 12), boatWood);
  head2.position.y = 0.075;
  capstan.add(drum, head2);
  for (let k = 0; k < 4; k++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.008, 0.008), boatWood);
    bar.position.y = 0.075;
    bar.rotation.y = (k * Math.PI) / 4;
    capstan.add(bar);
  }
  const capAt = stationOf(plan, 0.3);
  capstan.position.set(0, capAt.h - 0.05, plan.length / 2 - 0.3 * plan.length);
  group.add(capstan);
  const wheelAt = stationOf(plan, 0.12);
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.006, 6, 18), boatWood);
  wheel.add(rim);
  for (let k = 0; k < 8; k++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.11, 4), boatWood);
    spoke.rotation.z = (k * Math.PI) / 8;
    wheel.add(spoke);
  }
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.02), wale);
  post.position.set(0, -0.045, 0.015);
  wheel.add(post);
  wheel.position.set(0, wheelAt.h - 0.05 + 0.075, plan.length / 2 - 0.12 * plan.length);
  group.add(wheel);
  const lantern = new THREE.MeshStandardMaterial({ color: '#ffd77a', emissive: '#ffb84a', emissiveIntensity: 1.6, roughness: 0.3 });
  const s0top = stationOf(plan, 0);
  for (const [x, lift] of [[-s0top.w * 0.6, 0.1], [0, 0.16], [s0top.w * 0.6, 0.1]] as const) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), lantern);
    l.scale.y = 1.4;
    l.position.set(x, s0top.h + lift, plan.length / 2 + 0.01);
    group.add(l);
  }
  // A great ship carries a great stern lantern on the taffrail, in a gilt cage on a bracket.
  if (plan.castle > 0.2) {
    const great = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.1, 8), lantern);
    glass.position.y = 0.05;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.05, 8), gilt);
    cap.position.y = 0.125;
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), gilt);
    finial.position.y = 0.16;
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.08), gilt);
    bracket.position.set(0, -0.005, -0.03);
    great.add(glass, cap, finial, bracket);
    great.position.set(0, s0top.h + 0.2, plan.length / 2 + 0.04);
    group.add(great);
  }
  return group;
}

// --- spars, rigging, sails, flags --------------------------------------------------------------------

const SPAR = new THREE.MeshStandardMaterial({ color: '#4a2f22', roughness: 0.8 });
const BLACK = new THREE.MeshStandardMaterial({ color: '#1d1a19', roughness: 0.6, metalness: 0.3 });
/**
 * A sailor, simply made but plainly a man (a brig ~ 30 m in 2.4 units, a man ~ 0.14): legs in breeches, a torso
 * in shirt or jacket, arms that swing as he works (each hung from its shoulder), a head and a hat. Each part is
 * one instanced draw for the whole crew, coloured per man.
 */
const SAILOR = (() => {
  const legs = mergeGeometries([
    new THREE.CylinderGeometry(0.008, 0.007, 0.06, 6).translate(-0.008, 0.03, 0),
    new THREE.CylinderGeometry(0.008, 0.007, 0.06, 6).translate(0.008, 0.03, 0),
  ])!;
  const torso = new THREE.CapsuleGeometry(0.016, 0.03, 3, 8).scale(1.1, 1, 0.75).translate(0, 0.078, 0);
  // An arm hangs from its shoulder (the geometry's origin), to be swung there.
  const arm = new THREE.CylinderGeometry(0.0058, 0.005, 0.05, 6).translate(0, -0.025, 0);
  const head = new THREE.SphereGeometry(0.0125, 10, 8).translate(0, 0.123, 0);
  const hat = new THREE.CylinderGeometry(0.0125, 0.014, 0.009, 10).translate(0, 0.134, 0);
  return { legs, torso, arm, head, hat };
})();
const SAILOR_CLOTH = new THREE.MeshStandardMaterial({ roughness: 0.9 });
/** Where the shoulders are on a standing man. */
const SHOULDER = { x: 0.022, y: 0.1 };

/**
 * What a crew wears, by nation (all period working dress, not uniforms: navies wouldn't issue those for decades):
 * each man drawn from these shirts or jackets, breeches, hats or caps, and how many go bare-armed.
 */
interface Dress {
  tops: string[];
  breeches: string[];
  hats: string[];
  bareArms: number;
}
const DRESS: Record<string, Dress> = {
  england: { tops: ['#2e3f63', '#3a4c72', '#e6e0cf', '#7d2f2a'], breeches: ['#e8e2d2', '#d8d2c2', '#5a5048'], hats: ['#1e1c1b', '#2e3f63', '#e6e0cf'], bareArms: 0.1 },
  spain: { tops: ['#3a2a22', '#8a2a24', '#c9a54a', '#e2d8c2'], breeches: ['#3a2a22', '#5a4a3a', '#2a2622'], hats: ['#8a2a24', '#2a2622', '#c9a54a'], bareArms: 0.15 },
  france: { tops: ['#2f4a7a', '#e9e6dc', '#e9e6dc', '#3a5a8a'], breeches: ['#e9e6dc', '#2f4a7a', '#8a8070'], hats: ['#b5302a', '#b5302a', '#2a2a2e'], bareArms: 0.15 },
  netherlands: { tops: ['#6a5640', '#7d7f80', '#d9773a', '#4a4a48'], breeches: ['#4a4038', '#6a5640', '#2e2a26'], hats: ['#2a2622', '#d9773a', '#5a4a3a'], bareArms: 0.1 },
  pirate: { tops: ['#8a2a24', '#2a2622', '#c9b48a', '#3c4f6e', '#6a7a3a', '#e6dccb'], breeches: ['#3a3430', '#5a4a3a', '#7d5a3a', '#2a2622'], hats: ['#a5302a', '#1e1c1b', '#c9b48a', '#2a4a6a'], bareArms: 0.5 },
  player: { tops: ['#e3dccb', '#d8cfb8', '#8a2f2a', '#3c4f6e', '#7d7f80', '#2e2a28'], breeches: ['#5a5048', '#3a3430', '#d8d2c2'], hats: ['#2e2a28', '#8a2f2a', '#c9b48a'], bareArms: 0.25 },
};
/** Skin, varied man to man. */
const SKINS = ['#c99a74', '#b4825e', '#9a6a48', '#7a5034', '#d8ac88'].map((c) => new THREE.Color(c));

/** Most men a ship shows on deck (the rest are below, aloft or at the guns), and seconds a fallen man lies. */
const MAX_SAILORS = 24;
const FALLEN_SECONDS = 2.5;
/** Shot holes: a splintered dark hole with torn planking round it, laid on the hull's side. */
const HOLE = (() => {
  if (typeof document === 'undefined') return new THREE.MeshBasicMaterial();
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  // Splinters: pale torn wood in jagged spikes round the hole.
  g.fillStyle = 'rgba(196,160,110,0.95)';
  g.beginPath();
  for (let k = 0; k <= 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    const r = k % 2 ? 14 + (k * 7) % 9 : 24 + (k * 5) % 7;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.fill();
  // Scorch round it, and the black hole itself.
  const burn = g.createRadialGradient(32, 32, 6, 32, 32, 22);
  burn.addColorStop(0, 'rgba(15,10,6,1)');
  burn.addColorStop(0.55, 'rgba(15,10,6,1)');
  burn.addColorStop(1, 'rgba(40,25,12,0)');
  g.fillStyle = burn;
  g.beginPath();
  g.arc(32, 32, 22, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.2, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4 });
})();
const HOLE_GEO = new THREE.PlaneGeometry(0.075, 0.075);
const MAX_HOLES = 40;
/** A gun on her weather deck: its wooden carriage, and the barrel on it. */
const CARRIAGE = new THREE.BoxGeometry(0.07, 0.035, 0.05);
const CARRIAGE_WOOD = new THREE.MeshStandardMaterial({ color: '#5a3a24', roughness: 0.85 });
const GUN_BARREL = new THREE.CylinderGeometry(0.012, 0.017, 0.11, 8);
/** A rigging block: a small rounded wooden shell (a sheave inside), where a rope is rove. */
const BLOCK = new THREE.SphereGeometry(0.011, 8, 6).scale(0.75, 1.25, 0.6);
/** A deadeye (the block a shroud's lanyard is rove through) and the iron chain plate under it. */
const DEADEYE = new THREE.CylinderGeometry(0.014, 0.014, 0.008, 10);
const CHAIN_PLATE = new THREE.BoxGeometry(0.006, 0.12, 0.006);
/** Tarred rope: dark, a little sheen. */
const ROPE = new THREE.MeshStandardMaterial({ color: '#2b2420', roughness: 0.7 });
/** A rope's thickness (model units): fine against the hull, but solid enough to catch the light close in. */
const ROPE_RADIUS = 0.0055;
const ROPE_UNIT = new THREE.CylinderGeometry(1, 1, 1, 5, 1).translate(0, 0.5, 0);

/** Ropes along line segments (pairs of points, flat x, y, z), as one instanced draw of thin cylinders. */
function ropes(lines: number[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(ROPE_UNIT, ROPE, lines.length / 6);
  layRopes(mesh, lines);
  mesh.castShadow = true;
  return mesh;
}

/** Lays (or re-lays, as the yards swing) a rope mesh's instances along line segments. */
function layRopes(mesh: THREE.InstancedMesh, lines: number[]): void {
  const n = lines.length / 6;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    a.fromArray(lines, i * 6);
    b.fromArray(lines, i * 6 + 3);
    const d = b.clone().sub(a);
    const len = d.length();
    q.setFromUnitVectors(up, d.divideScalar(len || 1));
    m.compose(a, q, new THREE.Vector3(ROPE_RADIUS, len, ROPE_RADIUS));
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
}
/** Ratlines: rope rungs across the shrouds, drawn as a see-through ladder. */
const RATLINES = (() => {
  if (typeof document === 'undefined') return new THREE.MeshBasicMaterial();
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(42,34,32,0.95)';
  for (let y = 4; y < 256; y += 14) g.fillRect(0, y, 64, 2);
  for (const x of [1, 31, 61]) g.fillRect(x, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: false });
})();

function spar(r0: number, r1: number, length: number): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r1, r0, length, 8, 1);
  g.translate(0, length / 2, 0);
  const m = new THREE.Mesh(g, SPAR);
  m.castShadow = true;
  return m;
}

/**
 * Sailcloth that bellies: each vertex carries how free it is to move (0 at the edges held by yard, mast or
 * sheet, 1 in the middle of the cloth), and the shader pushes it along the sail's own z by the ship's belly,
 * rippling it when the sail luffs.
 */
type SailUniforms = {
  uBelly: THREE.IUniform;
  uLuff: THREE.IUniform;
  uTime: THREE.IUniform;
  uTatter: THREE.IUniform;
  /** Shot holes: where balls went through her rigging (her own frame: y up, z along), and how big. */
  uHoles: THREE.IUniform<THREE.Vector4[]>;
  uHoleCount: THREE.IUniform<number>;
  /** From the world back to her own frame (her root's inverse). */
  uShipInverse: THREE.IUniform<THREE.Matrix4>;
};
/** The most shot holes a ship's canvas shows. */
const SAIL_HOLES = 32;
/** The sails' own glow, shared by every sail and tinted by the renderer with the light: warm at dusk, blue by moonlight. */
export const SAIL_GLOW = new THREE.Color('#fffaf0');
function sailMaterial(cloth: { map: THREE.Texture; normal: THREE.Texture }, shared?: SailUniforms): THREE.MeshStandardMaterial & { userData: { uniforms: SailUniforms } } {
  // Lit as cloth is: its weave, seams and creases in relief catch the sun; only a faint glow of its own, so the
  // shaded side reads as shade (light through the canvas keeps it from going grey).
  const m = new THREE.MeshStandardMaterial({
    map: cloth.map,
    normalMap: cloth.normal,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.95,
    side: THREE.DoubleSide,
    emissive: '#fffaf0',
    emissiveIntensity: 0.16,
    emissiveMap: cloth.map,
  }) as THREE.MeshStandardMaterial & {
    userData: { uniforms: SailUniforms };
  };
  const uniforms = shared ?? {
    uBelly: { value: 1 },
    uLuff: { value: 0 },
    uTime: { value: 0 },
    uTatter: { value: 0 },
    uHoles: { value: Array.from({ length: SAIL_HOLES }, () => new THREE.Vector4()) },
    uHoleCount: { value: 0 },
    uShipInverse: { value: new THREE.Matrix4() },
  };
  m.emissive = SAIL_GLOW;
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aFree;\nattribute float aDepth;\nattribute float aAbeam;\nuniform float uBelly;\nuniform float uLuff;\nuniform float uTime;\nuniform mat4 uShipInverse;\nvarying vec3 vShip;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float wave = sin((position.x + position.z) * 9.0 + uTime * 11.0) * sin(position.y * 6.0 - uTime * 7.0);
vec3 belly = mix(vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), aAbeam);
transformed += belly * aFree * (aDepth * uBelly + wave * uLuff * 0.05);
vShip = (uShipInverse * modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    // Shot through (uTatter 0 whole .. 1 in rags): round holes in more and more of the cloth, then the foot
    // torn away in ragged tongues, so a beaten ship's canvas shows it (Pirates! draws hers as rags).
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTatter;
uniform vec4 uHoles[${SAIL_HOLES}];
uniform int uHoleCount;
varying vec3 vShip;
float tatterHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <map_fragment>',
        `// A ball through her rigging went clean through every sail in its path (it flew across her): a hole where the
// cloth crosses its line, ragged at the edge.
for (int i = 0; i < ${SAIL_HOLES}; i++) {
  if (i >= uHoleCount) break;
  vec2 d = vShip.yz - uHoles[i].yz;
  float a = atan(d.y, d.x);
  float rag = 1.0 + 0.3 * sin(a * 7.0 + uHoles[i].x * 13.0) * sin(a * 3.0 + uHoles[i].x * 5.0);
  if (length(d) < uHoles[i].w * rag) discard;
}
if (uTatter > 0.0) {
  vec2 cells = vMapUv * vec2(7.0, 6.0);
  vec2 cell = floor(cells);
  vec2 spot = vec2(tatterHash(cell + 1.7), tatterHash(cell + 5.3)) * 0.6 + 0.2;
  float hit = step(tatterHash(cell + 9.1), uTatter * 0.7);
  float r = (0.12 + 0.22 * tatterHash(cell + 3.9)) * hit;
  if (length(fract(cells) - spot) < r) discard;
  float rag = smoothstep(0.45, 1.0, uTatter) * (0.35 + 0.4 * tatterHash(vec2(floor(vMapUv.x * 9.0), 2.0)));
  if (1.0 - vMapUv.y < rag) discard;
}
#include <map_fragment>`,
      );
  };
  return m;
}

/** A grid of cloth between four corners (in a plane of the ship), with how free each vertex is to belly. */
function cloth(corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3], depth: number, nx = 10, ny = 8, abeam = 0): THREE.BufferGeometry {
  const [tl, tr, br, bl] = corners;
  const pos: number[] = [];
  const uv: number[] = [];
  const free: number[] = [];
  const deep: number[] = [];
  const axis: number[] = [];
  const idx: number[] = [];
  const top = new THREE.Vector3();
  const bottom = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const s = i / nx;
      const q = j / ny;
      top.lerpVectors(tl, tr, s);
      bottom.lerpVectors(bl, br, s);
      p.lerpVectors(top, bottom, q);
      pos.push(p.x, p.y, p.z);
      uv.push(s, 1 - q);
      // Held at the head (yard) and less at the foot (sheets); free in the middle.
      free.push(Math.sin(Math.PI * s) * Math.sin(Math.PI * (0.15 + 0.85 * q)) ** 0.8);
      deep.push(depth);
      axis.push(abeam);
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFree', new THREE.Float32BufferAttribute(free, 1));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(deep, 1));
  g.setAttribute('aAbeam', new THREE.Float32BufferAttribute(axis, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flag that streams: its far edge waves, in a vertex shader. */
function flagMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial & { userData: { uniforms: { uTime: THREE.IUniform } } } {
  const m = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: 0.9 }) as THREE.MeshStandardMaterial & {
    userData: { uniforms: { uTime: THREE.IUniform } };
  };
  const uniforms = { uTime: { value: 0 } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat fly = uv.x;\ntransformed.z += sin(uv.x * 8.0 - uTime * 9.0) * 0.05 * fly + fly * fly * 0.04;\ntransformed.y += sin(uv.x * 5.0 - uTime * 6.0) * 0.015 * fly;');
  };
  return m;
}

/** Each nation's colours, drawn: Spain's Burgundy cross, England's red ensign, France's white, the Dutch tricolour, the pirates' black. */
const FLAGS = new Map<string, THREE.CanvasTexture>();
/** A famous pirate's own flag (pirates.json): a field, and a device in a colour. */
export interface FlagDesign {
  field: string;
  colour: string;
  device: 'skull' | 'swords' | 'hourglass' | 'heart' | 'spear' | 'bones';
}

/** A famous pirate's device on her flag, in a 128x80 canvas, centred a little forward of the hoist. */
function drawDevice(g: CanvasRenderingContext2D, design: FlagDesign) {
  g.fillStyle = design.colour;
  g.strokeStyle = design.colour;
  const bar = (x: number, y: number, len: number, angle: number, w = 6) => {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.fillRect(-len / 2, -w / 2, len, w);
    g.restore();
  };
  if (design.device === 'skull' || design.device === 'bones') {
    if (design.device === 'skull') {
      g.beginPath();
      g.arc(64, 30, 13, 0, Math.PI * 2);
      g.fill();
      g.fillRect(56, 38, 16, 9);
      g.fillStyle = design.field;
      g.beginPath();
      g.arc(59, 29, 3.5, 0, Math.PI * 2);
      g.arc(69, 29, 3.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = design.colour;
    }
    bar(64, design.device === 'skull' ? 60 : 40, 58, 0.55);
    bar(64, design.device === 'skull' ? 60 : 40, 58, -0.55);
  } else if (design.device === 'swords') {
    // Two cutlasses crossed, hilts down.
    for (const side of [-1, 1]) {
      g.save();
      g.translate(64, 40);
      g.rotate(side * 0.6);
      g.fillRect(-2.5, -30, 5, 50);
      g.fillRect(-9, 18, 18, 4);
      g.restore();
    }
  } else if (design.device === 'hourglass') {
    g.beginPath();
    g.moveTo(48, 14);
    g.lineTo(80, 14);
    g.lineTo(64, 40);
    g.lineTo(80, 66);
    g.lineTo(48, 66);
    g.lineTo(64, 40);
    g.closePath();
    g.fill();
  } else if (design.device === 'heart') {
    // A heart, bleeding.
    g.beginPath();
    g.moveTo(64, 58);
    g.bezierCurveTo(30, 36, 46, 12, 64, 28);
    g.bezierCurveTo(82, 12, 98, 36, 64, 58);
    g.fill();
    for (const x of [58, 66, 72]) g.fillRect(x, 58, 3, 8 + (x % 5) * 2);
  } else {
    // A spear, point up, and a dart beside it.
    g.fillRect(52, 18, 4, 52);
    g.beginPath();
    g.moveTo(54, 6);
    g.lineTo(46, 22);
    g.lineTo(62, 22);
    g.closePath();
    g.fill();
    bar(80, 44, 30, -0.9, 4);
  }
}

export function flagTexture(nation: string, design?: FlagDesign): THREE.CanvasTexture {
  const key = design ? `${design.field}|${design.colour}|${design.device}` : nation;
  const cached = FLAGS.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 80;
  const g = c.getContext('2d')!;
  if (design) {
    g.fillStyle = design.field;
    g.fillRect(0, 0, 128, 80);
    drawDevice(g, design);
  } else if (nation === 'spain') {
    g.fillStyle = '#f4eee0';
    g.fillRect(0, 0, 128, 80);
    g.strokeStyle = '#b3262c';
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(10, 8);
    g.lineTo(118, 72);
    g.moveTo(118, 8);
    g.lineTo(10, 72);
    g.stroke();
  } else if (nation === 'england' || nation === 'player') {
    g.fillStyle = '#b3262c';
    g.fillRect(0, 0, 128, 80);
    g.fillStyle = '#f4eee0';
    g.fillRect(0, 0, 52, 36);
    g.fillStyle = '#b3262c';
    g.fillRect(22, 0, 8, 36);
    g.fillRect(0, 14, 52, 8);
  } else if (nation === 'france') {
    g.fillStyle = '#f4f1e8';
    g.fillRect(0, 0, 128, 80);
    g.fillStyle = '#d8b24a';
    for (const [x, y] of [[40, 30], [80, 30], [60, 54]]) {
      g.beginPath();
      g.arc(x!, y!, 7, 0, Math.PI * 2);
      g.fill();
    }
  } else if (nation === 'netherlands') {
    for (const [i, col] of ['#d0532b', '#f4eee0', '#2c4f8f'].entries()) {
      g.fillStyle = col;
      g.fillRect(0, (i * 80) / 3, 128, 80 / 3 + 1);
    }
  } else {
    g.fillStyle = '#101012';
    g.fillRect(0, 0, 128, 80);
    g.fillStyle = '#efe9da';
    g.beginPath();
    g.arc(64, 32, 13, 0, Math.PI * 2);
    g.fill();
    g.fillRect(40, 50, 48, 7);
    g.save();
    g.translate(64, 54);
    g.rotate(0.6);
    g.fillRect(-26, -3, 52, 6);
    g.rotate(-1.2);
    g.fillRect(-26, -3, 52, 6);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  FLAGS.set(key, t);
  return t;
}

/** A nation's flag on its own (a fort's), streaming. */
export function makeFlag(nation: string): { mesh: THREE.Mesh; update(t: number): void } {
  const material = flagMaterial(flagTexture(nation));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.38, 10, 4).translate(0.31, 0, 0), material);
  return {
    mesh,
    update(t) {
      material.userData.uniforms.uTime.value = t;
    },
  };
}

// --- a ship ----------------------------------------------------------------------------------------------

export interface BuiltShip {
  root: THREE.Object3D;
  /** Sails for the setting and the wind: the point of sail, which side the wind is on (+1 starboard), luffing. */
  setSails(setting: 'full' | 'half' | 'furled', point: string, side: number, nowMs: number): void;
  /** How shot through her sails are: 0 whole .. 1 in rags. */
  setTatters(share: number): void;
  /**
   * Her crew on deck, as a share of a full complement (0..1): figures working the ship, as many as she has men
   * for. When it drops (grapeshot sweeping her deck), the men lost fall where they stood and are gone.
   */
  setCrew(share: number, nowMs: number): void;
  /**
   * A round shot through her side: a splintered hole at `along` her length (bow +0.5 .. stern -0.5), on her
   * starboard side (`side` +1) or port (-1), `up` her side (0 the waterline .. 1 the rail).
   */
  hole(along: number, side: number, up: number): void;
  /** Patches every shot hole in her side (a shipwright's repair). */
  clearHoles(): void;
  /** Her guns still mounted, as a share of her battery: the muzzles of guns knocked out are gone from their ports. */
  setGuns(share: number): void;
  /**
   * How far each broadside's guns are run out (0 just fired, recoiled inboard .. 1 loaded and run out), port and
   * starboard: the reload shows on her side.
   */
  setRunOut(port: number, starboard: number): void;
  /** A ball through her rigging at a point in her own frame (model units: y up from the water, z along, bow -z). */
  sailHole(y: number, z: number): void;
  /**
   * A mast (fore to aft) going by the board: `fallen` 0 standing .. 1 gone (over the side and under), toppling
   * toward `towardDeg` on her own bearings (0 her bow, 90 to starboard).
   */
  setMast(index: number, fallen: number, towardDeg: number): void;
  /**
   * Her shipwright's fit, as it shows (upgrades.json ids): a copper band at the waterline, bronze guns, swivels on
   * the rail, nettings over the waist, sweeps out of her sides. Rebuilt only when the list changes.
   */
  setFit(upgrades: string[]): void;
}

const BRONZE = new THREE.MeshStandardMaterial({ color: '#a8743a', roughness: 0.35, metalness: 0.75 });
const COPPER = new THREE.MeshStandardMaterial({ color: '#b5653a', roughness: 0.4, metalness: 0.6 });
const OAR = new THREE.MeshStandardMaterial({ color: '#8a6b47', roughness: 0.85 });
let netTexture: THREE.CanvasTexture | undefined;
/** Boarding nettings: a coarse dark mesh, see-through between the cords. */
function netMaterial(): THREE.MeshStandardMaterial {
  if (!netTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.strokeStyle = 'rgba(40, 32, 24, 0.95)';
    g.lineWidth = 3;
    for (let i = 0; i <= 64; i += 16) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 64);
      g.moveTo(0, i);
      g.lineTo(64, i);
      g.stroke();
    }
    netTexture = new THREE.CanvasTexture(c);
    netTexture.wrapS = netTexture.wrapT = THREE.RepeatWrapping;
    netTexture.repeat.set(12, 2);
  }
  return new THREE.MeshStandardMaterial({ map: netTexture, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 1 });
}

/** The parts of a class shared by every ship of it (geometry and hull paint), built once. */
interface ClassKit {
  hull: THREE.Group;
}
const KITS = new Map<ShipPlan, ClassKit>();

function kitFor(plan: ShipPlan): ClassKit {
  const known = KITS.get(plan);
  if (known) return known;
  const sides = hullSurface(plan.hull);
  addPorts(sides, plan.hull);
  const hull = hullMesh(
    plan.hull,
    new THREE.MeshStandardMaterial({
      map: finish(sides.colour.canvas, 8),
      normalMap: normalMap(sides.height, 3),
      normalScale: new THREE.Vector2(1, 1),
      roughnessMap: valueMap(sides.rough.canvas, 8),
      roughness: 1,
    }),
    new THREE.MeshStandardMaterial({ map: sternTexture(plan.hull), roughness: 0.7, emissive: WINDOW_GLOW, emissiveMap: sternGlowTexture() }),
    (() => {
      const deck = deckSurface(plan.hull);
      const map = finish(deck.colour.canvas, 8);
      const normal = normalMap(deck.height, 2.5);
      const rough = valueMap(deck.rough.canvas, 8);
      // Planks run the length in four repeats: the texture tiles both ways.
      for (const t of [map, normal, rough]) t.wrapT = THREE.RepeatWrapping;
      return new THREE.MeshStandardMaterial({ map, normalMap: normal, roughnessMap: rough, roughness: 1 });
    })(),
  );
  const kit = { hull };
  KITS.set(plan, kit);
  return kit;
}

export function buildShip(plan: ShipPlan, nation: string, flag?: FlagDesign): BuiltShip {
  const kit = kitFor(plan);
  const root = new THREE.Group();
  root.add(kit.hull.clone());
  // Square sails carry the nation's emblem (Spain's cross, a pirate's skull); fore-and-aft canvas is plain.
  const sailMat = sailMaterial(sailTexture(nation === 'spain' || nation === 'pirate' ? nation : 'plain'));
  const flatMat = sailMaterial(sailTexture('plain'), sailMat.userData.uniforms);
  const flagMat = flagMaterial(flagTexture(nation, flag));
  const h = plan.hull;
  const railAt = (forward: number) => stationOf(h, 0.5 + forward / h.length);

  // Masts, each with its yards and square sails in a group that braces round the mast. Everything a mast
  // carries (yards, sails, top, shrouds, its stay, the canvas set on it) hangs in one piece pivoting at its
  // foot on deck, so a mast shot through can go by the board whole, leaving a stump. Each piece is built in
  // the ship's own coordinates inside a frame that undoes the pivot's offset.
  const yards: { group: THREE.Group; sails: { mesh: THREE.Mesh; furl: THREE.Mesh; course: boolean }[] }[] = [];
  const braces: { mesh: THREE.InstancedMesh; arms: { arm: number; y: number }[]; z: number; to: { w: number; h: number; z: number } }[] = [];
  /** Lays each mast's braces for her yards braced round `angle` (radians). */
  const layBraces = (angle: number) => {
    for (const b of braces) {
      const lines: number[] = [];
      for (const { arm, y } of b.arms) {
        for (const s of [-1, 1]) {
          // The yard's arm as braced (turned about the mast), to the rail on that side, aft.
          const x = s * arm * Math.cos(angle);
          const dz = -s * arm * Math.sin(angle);
          lines.push(x, y, b.z + dz, s * b.to.w, b.to.h, b.to.z);
        }
      }
      layRopes(b.mesh, lines);
    }
  };
  const sticks: { stick: THREE.Group; stump: THREE.Mesh; foot: number }[] = [];
  const frames: THREE.Group[] = [];
  const mastLines: number[][] = [];
  for (const m of plan.masts) {
    const z = -m.at;
    const foot = railAt(m.at).h - 0.05;
    const stick = new THREE.Group();
    stick.position.set(0, foot, z);
    root.add(stick);
    const frame = new THREE.Group();
    frame.position.set(0, -foot, -z);
    stick.add(frame);
    frames.push(frame);
    const stump = spar(0.042, 0.034, foot + 0.18);
    stump.position.set(0, 0.05, z);
    stump.visible = false;
    root.add(stump);
    sticks.push({ stick, stump, foot });
    const lines: number[] = [];
    mastLines.push(lines);
    const mast = spar(0.04, 0.022, m.height);
    mast.position.set(0, 0.05, z);
    frame.add(mast);
    const group = new THREE.Group();
    group.position.set(0, 0, z);
    frame.add(group);
    const sails: (typeof yards)[number]['sails'] = [];
    m.squares.forEach((sq, i) => {
      // The yard, the sail hanging from it (bellying forward, -z), and its furled roll.
      const yard = spar(0.018, 0.012, sq.wt + 0.12);
      yard.rotation.z = Math.PI / 2;
      yard.position.set((sq.wt + 0.12) / 2, sq.zt, 0);
      group.add(yard);
      const geo = cloth(
        [new THREE.Vector3(-sq.wt / 2, sq.zt - 0.02, 0), new THREE.Vector3(sq.wt / 2, sq.zt - 0.02, 0), new THREE.Vector3(sq.wb / 2, sq.zb, 0), new THREE.Vector3(-sq.wb / 2, sq.zb, 0)],
        -sq.billow * 1.6,
      );
      const mesh = new THREE.Mesh(geo, sailMat);
      mesh.castShadow = true;
      group.add(mesh);
      const furl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, sq.wt * 0.95, 8), sailMat);
      furl.rotation.z = Math.PI / 2;
      furl.position.set(0, sq.zt - 0.05, 0.02);
      furl.visible = false;
      group.add(furl);
      sails.push({ mesh, furl, course: i === m.squares.length - 1 });
      // Running rigging on the yard (it braces round with it): lifts from the yard's arms up to the mast above,
      // a footrope sagging under it for the men to stand on, and the sheets from the sail's clews down toward
      // the deck (a course's to the rail, an upper sail's to the yard below).
      const arm = (sq.wt + 0.1) / 2;
      const above = Math.min(m.height, sq.zt + 0.35);
      const below = m.squares[i + 1];
      const clewTo = below ? below.zt + 0.02 : railAt(m.at).h + 0.02;
      const running = [
        -arm, sq.zt, 0, 0, above, 0,
        arm, sq.zt, 0, 0, above, 0,
        -arm, sq.zt - 0.03, 0.02, -arm * 0.5, sq.zt - 0.07, 0.02,
        -arm * 0.5, sq.zt - 0.07, 0.02, 0, sq.zt - 0.08, 0.02,
        0, sq.zt - 0.08, 0.02, arm * 0.5, sq.zt - 0.07, 0.02,
        arm * 0.5, sq.zt - 0.07, 0.02, arm, sq.zt - 0.03, 0.02,
        -sq.wb / 2, sq.zb, 0, -sq.wb * 0.42, clewTo, 0.12,
        sq.wb / 2, sq.zb, 0, sq.wb * 0.42, clewTo, 0.12,
      ];
      group.add(ropes(running));
      // Blocks where the running rigging is rove: at each yard arm (lift, brace, sheet) and at the slings.
      for (const [bx, by] of [
        [-arm, sq.zt],
        [arm, sq.zt],
        [-arm * 0.92, sq.zt - 0.035],
        [arm * 0.92, sq.zt - 0.035],
        [0, sq.zt + 0.04],
      ] as const) {
        const block = new THREE.Mesh(BLOCK, SPAR);
        block.position.set(bx, by, 0.015);
        group.add(block);
      }
      // A fighting top under each upper yard.
      if (i === m.squares.length - 1 && m.squares.length > 1) {
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.03, 10), SPAR);
        top.position.set(0, sq.zt + 0.08, z);
        frame.add(top);
      }
    });
    // Braces: from each yard's arms aft and down to the rail (behind this mast), the ropes that swing the yards
    // round; laid again whenever the yards are braced.
    const braceTo = railAt(m.at - 0.5);
    const yardArms = m.squares.map((sq) => ({ arm: (sq.wt + 0.1) / 2, y: sq.zt }));
    const braceMesh = new THREE.InstancedMesh(ROPE_UNIT, ROPE, yardArms.length * 2);
    braceMesh.castShadow = true;
    frame.add(braceMesh);
    braces.push({ mesh: braceMesh, arms: yardArms, z, to: { w: braceTo.w, h: braceTo.h, z: z + 0.5 } });
    yards.push({ group, sails });
    // Shrouds: from the masthead down to the chainwale either side, a little aft; ratlines across them, a
    // chainwale (a ledge outside the rail) where they come down.
    const rail = railAt(m.at - 0.12);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        lines.push(0, m.height * 0.92, z, s * (rail.w + 0.03), rail.h - 0.04, z + 0.08 + k * 0.08);
      }
      const ladder = new THREE.BufferGeometry();
      ladder.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, m.height * 0.92, z, 0, m.height * 0.92, z, s * (rail.w + 0.03), rail.h - 0.04, z + 0.08, s * (rail.w + 0.03), rail.h - 0.04, z + 0.24], 3),
      );
      ladder.setAttribute('uv', new THREE.Float32BufferAttribute([0.45, 1, 0.55, 1, 0, 0, 1, 0], 2));
      ladder.setIndex([0, 2, 3, 0, 3, 1]);
      frame.add(new THREE.Mesh(ladder, RATLINES));
      const chain = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.3), SPAR);
      chain.position.set(s * (rail.w + 0.025), rail.h - 0.05, z + 0.16);
      root.add(chain);
      // A deadeye at each shroud's foot on the chainwale, its chain plate running down the side to the wale.
      for (let k = 0; k < 3; k++) {
        const eye = new THREE.Mesh(DEADEYE, SPAR);
        eye.rotation.z = Math.PI / 2;
        eye.position.set(s * (rail.w + 0.03), rail.h - 0.035, z + 0.08 + k * 0.08);
        root.add(eye);
        const plate = new THREE.Mesh(CHAIN_PLATE, BLACK);
        plate.position.set(s * (rail.w + 0.03), rail.h - 0.1, z + 0.08 + k * 0.08);
        root.add(plate);
      }
    }
  }
  // Stays: each masthead forward to the next mast's foot, the foremast's to the bowsprit's end.
  const masts = [...plan.masts].sort((a, b) => b.at - a.at);
  const [[bx0, by0], [bx1, by1]] = plan.bowsprit;
  masts.forEach((m, i) => {
    const ahead = masts[i - 1];
    const own = mastLines[plan.masts.indexOf(m)]!;
    if (ahead) own.push(0, m.height * 0.95, -m.at, 0, ahead.height * 0.45, -ahead.at);
    else own.push(0, m.height * 0.95, -m.at, 0, by1, -bx1);
  });
  // The bowsprit.
  const sprit = spar(0.03, 0.016, Math.hypot(bx1 - bx0, by1 - by0));
  sprit.position.set(0, by0, -bx0);
  sprit.rotation.x = -Math.atan2(bx1 - bx0, by1 - by0);
  root.add(sprit);

  // Fore-and-aft sails: each in a group swinging round its pivot (a jib's clew, a spanker's boom).
  const flats: { group: THREE.Group; mesh: THREE.Mesh; kind: FlatSail['kind'] }[] = [];
  for (const f of plan.flats) {
    const group = new THREE.Group();
    group.position.set(0, 0, -f.pivot);
    // Set on the nearest mast (a jib on the foremast's stay, a spanker on the mizzen), and lost with it.
    const on = plan.masts.reduce((best, m, i) => (Math.abs(m.at - f.pivot) < Math.abs(plan.masts[best]!.at - f.pivot) ? i : best), 0);
    frames[on]!.add(group);
    const c = f.corners.map(([fwd, up]) => new THREE.Vector3(0, up, -(fwd - f.pivot)));
    const quad: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] =
      c.length === 3 ? [c[1]!, c[1]!.clone().add(new THREE.Vector3(0, -0.001, 0.001)), c[2]!, c[0]!] : [c[1]!, c[2]!, c[3]!, c[0]!];
    // A fore-and-aft sail lies in the centreline plane; its cloth is built in x-y then turned to face abeam.
    const geo = cloth(quad.map((v) => new THREE.Vector3(v.z, v.y, 0)) as typeof quad, 0.12, 8, 8, 1);
    geo.rotateY(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, flatMat);
    mesh.castShadow = true;
    group.add(mesh);
    const along = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const s = spar(r, r * 0.7, a.distanceTo(b));
      s.position.copy(a);
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      group.add(s);
    };
    // A gaff runs along a four-cornered sail's head (throat to peak); a lateen yard from the tack up to the peak.
    if (f.spar) along(c.length === 3 ? c[0]! : c[1]!, c.length === 3 ? c[1]! : c[2]!, 0.014);
    if (f.boom) along(c[0]!, c[3] ?? c[2]!, 0.018);
    flats.push({ group, mesh, kind: f.kind });
  }

  // Rigging: each mast's shrouds and stay, as rope, a draw a mast.
  mastLines.forEach((own, i) => frames[i]!.add(ropes(own)));

  // The crew: men standing about the deck, at the rails and by the masts, clear of the hatches and the boat.
  const spots: { x: number; y: number; z: number; turn: number }[] = [];
  {
    const rand = seeded(plan.hull.length * 311 + plan.masts.length);
    const clear = (t: number) =>
      plan.masts.every((m) => Math.abs(0.5 + m.at / h.length - t) > 0.035) && Math.abs(t - 0.47) > 0.12 && Math.abs(t - 0.38) > 0.05 && Math.abs(t - 0.62) > 0.05;
    for (let tries = 0; spots.length < MAX_SAILORS && tries < 400; tries++) {
      const t = 0.1 + rand() * 0.8;
      if (!clear(t)) continue;
      const st = stationOf(h, t);
      // Most at the rails, some amidships.
      const across = (rand() < 0.65 ? 0.55 + rand() * 0.25 : rand() * 0.4) * (rand() < 0.5 ? -1 : 1);
      spots.push({ x: across * st.w, y: st.h - 0.05, z: h.length / 2 - t * h.length, turn: rand() * Math.PI * 2 });
    }
  }
  // The gun crews stand at their guns (after the guns are placed below; spots filled in once they are).
  const gunnerSpots: { x: number; y: number; z: number; turn: number; side: number }[] = [];
  /** How far each broadside is from loaded (0 loaded .. 1 just fired): its gunners work while it isn't. */
  const reloading = { port: 0, starboard: 0 };
  // Each man's dress, from his nation's (a merchant crew dresses as the player's would).
  const dress = DRESS[nation] ?? DRESS.player!;
  const men = Array.from({ length: MAX_SAILORS + 32 }, (_, i) => {
    const rand = seeded(i * 101 + nation.length * 7 + 1);
    const pick = (list: string[]) => new THREE.Color(list[Math.floor(rand() * list.length)]!);
    const skin = SKINS[Math.floor(rand() * SKINS.length)]!;
    const top = pick(dress.tops);
    return {
      top,
      sleeve: rand() < dress.bareArms ? skin : top,
      breeches: pick(dress.breeches),
      hat: rand() < 0.15 ? skin : pick(dress.hats),
      skin,
      // What he is about: hauling on a line (arms up and working), or standing by (arms down, a little sway).
      hauling: rand() < 0.4,
      phase: rand() * Math.PI * 2,
    };
  });
  const parts = {
    legs: new THREE.InstancedMesh(SAILOR.legs, SAILOR_CLOTH, MAX_SAILORS + 32),
    torso: new THREE.InstancedMesh(SAILOR.torso, SAILOR_CLOTH, MAX_SAILORS + 32),
    left: new THREE.InstancedMesh(SAILOR.arm, SAILOR_CLOTH, MAX_SAILORS + 32),
    right: new THREE.InstancedMesh(SAILOR.arm, SAILOR_CLOTH, MAX_SAILORS + 32),
    head: new THREE.InstancedMesh(SAILOR.head, SAILOR_CLOTH, MAX_SAILORS + 32),
    hat: new THREE.InstancedMesh(SAILOR.hat, SAILOR_CLOTH, MAX_SAILORS + 32),
  };
  const all = Object.values(parts);
  for (const m of all) {
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    root.add(m);
  }
  let shownCrew = -1;
  const fallen = new Map<number, number>();
  const pose = new THREE.Matrix4();
  const limb = new THREE.Matrix4();
  const rot = new THREE.Quaternion();
  const at = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const tip = new THREE.Euler();
  const placeSailors = (count: number, nowMs: number) => {
    const t = nowMs / 1000;
    let n = 0;
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i]!;
      const man = men[i]!;
      const fell = fallen.get(i);
      if (i >= count && fell === undefined) continue;
      if (fell !== undefined && t - fell > FALLEN_SECONDS) continue;
      // Standing men shift their weight a little; a fallen man lies where he dropped.
      const down = fell === undefined ? 0 : Math.min(1, (t - fell) * 4);
      tip.set(-down * (Math.PI / 2) * 0.95, sp.turn + (fell === undefined ? Math.sin(t * 0.7 + i) * 0.25 : 0), 0, 'YXZ');
      rot.setFromEuler(tip);
      at.set(sp.x, sp.y, sp.z);
      pose.compose(at, rot, one);
      parts.legs.setMatrixAt(n, pose);
      parts.torso.setMatrixAt(n, pose);
      parts.head.setMatrixAt(n, pose);
      parts.hat.setMatrixAt(n, pose);
      // Arms: hauling men reach up and pull, hand over hand; the rest hang at their sides, swinging a little.
      const working = fell === undefined;
      for (const [side, mesh] of [
        [-1, parts.left],
        [1, parts.right],
      ] as const) {
        const pull = man.hauling && working ? 2.2 + Math.sin(t * 2.6 + man.phase + (side > 0 ? Math.PI : 0)) * 0.6 : 0.1 + Math.sin(t * 0.9 + man.phase + side) * 0.08;
        tip.set(-pull, 0, side * 0.12, 'XYZ');
        rot.setFromEuler(tip);
        limb.compose(at.set(side * SHOULDER.x, SHOULDER.y, 0), rot, one);
        mesh.setMatrixAt(n, limb.premultiply(pose));
        mesh.setColorAt(n, man.sleeve);
      }
      parts.legs.setColorAt(n, man.breeches);
      parts.torso.setColorAt(n, man.top);
      parts.head.setColorAt(n, man.skin);
      parts.hat.setColorAt(n, man.hat);
      n++;
    }
    // Gunners: two men a deck gun, the share of them her crew allows; ramming and hauling while their side
    // reloads, standing by when it is loaded.
    const manned = Math.min(32, Math.round(gunnerSpots.length * Math.min(1, count / Math.max(1, spots.length))));
    for (let g = 0; g < manned; g++) {
      const sp = gunnerSpots[g]!;
      const man = men[spots.length + g]!;
      const busy = (sp.side > 0 ? reloading.starboard : reloading.port) > 0.02;
      tip.set(busy ? 0.35 + Math.sin(t * 6 + man.phase) * 0.15 : 0, sp.turn, 0, 'YXZ');
      rot.setFromEuler(tip);
      at.set(sp.x, sp.y, sp.z);
      pose.compose(at, rot, one);
      parts.legs.setMatrixAt(n, pose);
      parts.torso.setMatrixAt(n, pose);
      parts.head.setMatrixAt(n, pose);
      parts.hat.setMatrixAt(n, pose);
      for (const [side, mesh] of [
        [-1, parts.left],
        [1, parts.right],
      ] as const) {
        const reach = busy ? 1.3 + Math.sin(t * 7 + man.phase + (side > 0 ? 1.4 : 0)) * 0.6 : 0.15;
        tip.set(-reach, 0, side * 0.12, 'XYZ');
        rot.setFromEuler(tip);
        limb.compose(at.set(side * SHOULDER.x, SHOULDER.y, 0), rot, one);
        mesh.setMatrixAt(n, limb.premultiply(pose));
        mesh.setColorAt(n, man.sleeve);
      }
      parts.legs.setColorAt(n, man.breeches);
      parts.torso.setColorAt(n, man.top);
      parts.head.setColorAt(n, man.skin);
      parts.hat.setColorAt(n, man.hat);
      n++;
    }
    for (const m of all) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  };

  // Cannon muzzles out of the lowest row of ports.
  const muzzles: THREE.Mesh[] = [];
  /** Guns worked from her weather deck: carriages behind the ports, each with two men at it. */
  const deckGuns: { carriage: THREE.Group; side: number; out: number; crew: { x: number; z: number; turn: number }[] }[] = [];
  // Which guns go first as they are knocked out: scattered along both sides, the same for every ship of a class.
  const losing: number[] = [];
  const holes: THREE.Mesh[] = [];
  const row = h.ports[0];
  if (row) {
    const muzzle = new THREE.CylinderGeometry(0.018, 0.022, 0.08, 8);
    muzzle.rotateZ(Math.PI / 2);
    for (let i = 0; i < row.count; i++) {
      const t = 0.22 + (0.6 * (i + 0.5)) / row.count;
      const st = stationOf(h, t);
      const y = KEEL + (st.h - KEEL) * (1 - (1 - row.at) * 0.62);
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(muzzle, BLACK);
        m.position.set(s * (st.w * 0.97 + 0.03), y, h.length / 2 - t * h.length);
        m.userData.out = m.position.x;
        m.userData.side = s;
        root.add(m);
        muzzles.push(m);
        // Where the ports open just under the rail (a brig's, a sloop's), her guns stand on the weather deck: a
        // carriage on trucks, and two men at it, one at the breech and one at the side tackle.
        const deckY = st.h - 0.05;
        if (deckY - y < 0.09) {
          const carriage = new THREE.Group();
          const bed = new THREE.Mesh(CARRIAGE, CARRIAGE_WOOD);
          bed.position.set(0, 0.018, 0);
          const barrel = new THREE.Mesh(GUN_BARREL, BLACK);
          barrel.rotation.z = Math.PI / 2;
          barrel.position.set(s * 0.03, 0.04, 0);
          carriage.add(bed, barrel);
          const inboard = s * (st.w * 0.62);
          carriage.position.set(inboard, deckY, h.length / 2 - t * h.length);
          root.add(carriage);
          deckGuns.push({
            carriage,
            side: s,
            out: inboard,
            crew: [
              { x: inboard - s * 0.11, z: h.length / 2 - t * h.length + 0.03, turn: s > 0 ? -Math.PI / 2 : Math.PI / 2 },
              { x: inboard - s * 0.05, z: h.length / 2 - t * h.length - 0.06, turn: s > 0 ? -Math.PI / 2 + 0.6 : Math.PI / 2 - 0.6 },
            ],
          });
        }
      }
    }
  }

  for (const g of deckGuns) for (const c of g.crew) gunnerSpots.push({ x: c.x, y: g.carriage.position.y, z: c.z, turn: c.turn, side: g.side });
  // Men standing about the deck keep clear of the guns and their crews.
  for (let i = spots.length - 1; i >= 0; i--) {
    const sp = spots[i]!;
    if (deckGuns.some((g) => Math.hypot(sp.x - g.out, sp.z - g.carriage.position.z) < 0.14) || gunnerSpots.some((c) => Math.hypot(sp.x - c.x, sp.z - c.z) < 0.06)) spots.splice(i, 1);
  }

  // Colours: an ensign at the stern, a long pennant at the main masthead.
  const stern = stationOf(h, 0.02);
  const staff = spar(0.01, 0.008, 0.45);
  staff.position.set(0, stern.h, h.length / 2 - 0.02);
  root.add(staff);
  const ensign = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26, 10, 4).translate(0.21, 0, 0), flagMat);
  ensign.rotation.y = -Math.PI / 2;
  ensign.position.set(0, stern.h + 0.32, h.length / 2 + 0.0);
  root.add(ensign);
  const main = plan.masts.reduce((a, b) => (b.height > a.height ? b : a));
  const pennant = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.08, 12, 1).translate(0.3, 0, 0), flagMat);
  pennant.rotation.y = -Math.PI / 2;
  pennant.position.set(0, main.height + 0.02, -main.at);
  frames[plan.masts.indexOf(main)]!.add(pennant);

  let lastBrace = Number.NaN;
  // Her fit, built when it changes.
  let fitKey = '';
  const fitGroup = new THREE.Group();
  root.add(fitGroup);
  const along = (t: number) => h.length / 2 - t * h.length;
  return {
    root,
    setFit(upgrades) {
      const key = [...upgrades].sort().join(',');
      if (key === fitKey) return;
      fitKey = key;
      fitGroup.clear();
      const has = (id: string) => upgrades.includes(id);
      for (const m of muzzles) m.material = has('bronze_cannon') ? BRONZE : BLACK;
      if (has('copper')) {
        // A band of copper showing at the waterline down both sides.
        for (const s of [-1, 1]) {
          const pts: number[] = [];
          const idx: number[] = [];
          const n = 24;
          for (let i = 0; i <= n; i++) {
            const t = 0.06 + (0.88 * i) / n;
            const w = stationOf(h, t).w * 1.005;
            pts.push(s * w, -0.01, along(t), s * w, 0.035, along(t));
            if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
          g.setIndex(idx);
          g.computeVertexNormals();
          const band = new THREE.Mesh(g, COPPER);
          band.material.side = THREE.DoubleSide;
          fitGroup.add(band);
        }
      }
      if (has('swivel_guns')) {
        const geo = new THREE.CylinderGeometry(0.01, 0.013, 0.07, 6);
        geo.rotateZ(Math.PI / 2);
        for (const t of [0.3, 0.5, 0.7])
          for (const s of [-1, 1]) {
            const st = stationOf(h, t);
            const gun = new THREE.Mesh(geo, has('bronze_cannon') ? BRONZE : BLACK);
            gun.position.set(s * (st.w + 0.02), st.h + 0.025, along(t));
            fitGroup.add(gun);
          }
      }
      if (has('nettings')) {
        const mat = netMaterial();
        for (const s of [-1, 1]) {
          const t0 = 0.32;
          const t1 = 0.68;
          const st = stationOf(h, (t0 + t1) / 2);
          const net = new THREE.Mesh(new THREE.PlaneGeometry((t1 - t0) * h.length, 0.14), mat);
          net.rotation.y = Math.PI / 2;
          net.position.set(s * st.w, st.h + 0.07, along((t0 + t1) / 2));
          fitGroup.add(net);
        }
      }
      if (has('sweeps')) {
        const geo = new THREE.CylinderGeometry(0.006, 0.006, 0.5, 5);
        for (let i = 0; i < 6; i++) {
          const t = 0.28 + (0.44 * i) / 5;
          const st = stationOf(h, t);
          for (const s of [-1, 1]) {
            const oar = new THREE.Mesh(geo, OAR);
            // Out of the side, down to the water.
            oar.rotation.z = s * (Math.PI / 2 - 0.35);
            oar.position.set(s * (st.w + 0.22), st.h * 0.6, along(t));
            fitGroup.add(oar);
          }
        }
      }
    },
    setSails(setting, point, side, nowMs) {
      const p = POINTS[point] ?? POINTS.beam!;
      const t = nowMs / 1000;
      const u = sailMat.userData.uniforms;
      root.updateMatrixWorld();
      u.uShipInverse.value.copy(root.matrixWorld).invert();
      u.uTime.value = t;
      u.uBelly.value = point === 'irons' ? 0.1 : p.belly;
      u.uLuff.value = point === 'irons' ? 1 : 0;
      flagMat.userData.uniforms.uTime.value = t;
      // Yards braced round toward the wind's side; courses furled at half sail, everything at furled.
      const braced = THREE.MathUtils.degToRad(setting === 'furled' ? 0 : side * p.brace);
      if (braced !== lastBrace) {
        lastBrace = braced;
        layBraces(braced);
      }
      for (const y of yards) {
        y.group.rotation.y = braced;
        for (const s of y.sails) {
          const set = setting === 'full' || (setting === 'half' && !s.course);
          s.mesh.visible = set;
          s.furl.visible = !set;
        }
      }
      // Fore-and-aft sails swing to leeward (away from the wind's side); furled, they're stowed out of sight.
      for (const f of flats) {
        f.mesh.visible = setting === 'full' || (setting === 'half' && f.kind !== 'spanker');
        const swing = f.kind === 'jib' ? p.swing * 0.35 : p.swing;
        f.group.rotation.y = THREE.MathUtils.degToRad(-side * swing);
        f.mesh.scale.x = -side || 1;
      }
      // The flags stream downwind: away from the wind's side.
      ensign.rotation.y = -Math.PI / 2 - side * 0.6;
      pennant.rotation.y = -Math.PI / 2 - side * 0.6;
    },
    setMast(index, fallen, towardDeg) {
      const m = sticks[index];
      if (!m) return;
      const k = THREE.MathUtils.clamp(fallen, 0, 1);
      m.stick.visible = k < 1;
      m.stump.visible = k > 0;
      // Falling like a tree: slow to start, then over past the horizontal into the sea, settling as it goes.
      const a = THREE.MathUtils.degToRad(towardDeg);
      const axis = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)).normalize();
      m.stick.quaternion.setFromAxisAngle(axis, k * k * 1.75);
      m.stick.position.y = m.foot - k * k * 0.25;
    },
    setRunOut(port, starboard) {
      reloading.port = 1 - THREE.MathUtils.clamp(port, 0, 1);
      reloading.starboard = 1 - THREE.MathUtils.clamp(starboard, 0, 1);
      // The deck guns recoil and run out with their muzzles.
      for (const g of deckGuns) {
        const share = THREE.MathUtils.clamp(g.side > 0 ? starboard : port, 0, 1);
        const ease = share * share * (3 - 2 * share);
        g.carriage.position.x = g.out - g.side * 0.07 * (1 - ease);
      }
      for (const m of muzzles) {
        const share = THREE.MathUtils.clamp(m.userData.side > 0 ? starboard : port, 0, 1);
        // Recoiled back inboard (her muzzle gone into the port), then hauled out again as she is loaded.
        const ease = share * share * (3 - 2 * share);
        m.position.x = m.userData.out - m.userData.side * 0.07 * (1 - ease);
      }
    },
    sailHole(y, z) {
      const u = sailMat.userData.uniforms;
      const n = u.uHoleCount.value;
      // The oldest hole is patched over to make room (a ship this shot through is in rags anyway).
      const slot = n < SAIL_HOLES ? n : Math.floor(Math.random() * SAIL_HOLES);
      u.uHoles.value[slot]!.set(Math.random() * 10, y, z, 0.035 + Math.random() * 0.02);
      u.uHoleCount.value = Math.min(SAIL_HOLES, n + 1);
    },
    clearHoles() {
      for (const h of holes) root.remove(h);
      holes.length = 0;
    },
    hole(along, side, up) {
      if (holes.length >= MAX_HOLES) return;
      const t = THREE.MathUtils.clamp(0.5 - along, 0.04, 0.96);
      const st = stationOf(h, t);
      // Up her side from the waterline (y 0) to the rail, where the hull's surface stands there.
      const y = THREE.MathUtils.lerp(0.03, st.h - 0.03, THREE.MathUtils.clamp(up, 0, 1));
      const s = (y - KEEL) / (st.h - KEEL);
      const hole = new THREE.Mesh(HOLE_GEO, HOLE);
      hole.position.set(side * (sideAt(st.w, s, t, h) + 0.003), y, h.length / 2 - t * h.length);
      hole.rotation.set(0, (side * Math.PI) / 2, Math.random() * Math.PI * 2, 'YXZ');
      hole.scale.setScalar(0.7 + Math.random() * 0.6);
      root.add(hole);
      holes.push(hole);
    },
    setGuns(share) {
      if (!losing.length) {
        const rand = seeded(muzzles.length * 17 + 5);
        const order = muzzles.map((_, i) => [rand(), i] as const).sort((a, b) => a[0] - b[0]);
        losing.push(...order.map(([, i]) => i));
      }
      const gone = muzzles.length - Math.round(THREE.MathUtils.clamp(share, 0, 1) * muzzles.length);
      muzzles.forEach((m, i) => (m.visible = !losing.slice(0, gone).includes(i)));
    },
    setCrew(share, nowMs) {
      const count = Math.round(THREE.MathUtils.clamp(share, 0, 1) * spots.length);
      // Men lost since last time fall where they stood.
      if (shownCrew > count) for (let i = count; i < shownCrew; i++) fallen.set(i, nowMs / 1000);
      // Men added (her crew made up) stand up again.
      for (let i = shownCrew; i < count; i++) fallen.delete(i);
      shownCrew = count;
      placeSailors(count, nowMs);
    },
    setTatters(share) {
      // Barely scratched canvas stays whole.
      sailMat.userData.uniforms.uTatter.value = THREE.MathUtils.clamp((share - 0.08) / 0.92, 0, 1);
    },
  };
}
