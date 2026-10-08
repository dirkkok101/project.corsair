import * as THREE from 'three';

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

/** The hull's side: planking strakes, a painted upper band, a dark wale, gunports with gilt-edged lids. */
function hullTexture(plan: HullPlan): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  // v (canvas y) runs top (rail) to bottom (keel); u along the length.
  const bandTop = 0;
  const bandBottom = 256 * 0.34;
  g.fillStyle = plan.paint.hull;
  g.fillRect(0, 0, 1024, 256);
  g.fillStyle = plan.paint.band;
  g.fillRect(0, bandTop, 1024, bandBottom);
  g.fillStyle = plan.paint.wale;
  g.fillRect(0, bandBottom, 1024, 14);
  // Strakes: thin dark seams and a little grain, so the hull reads as planked close up.
  for (let y = 4; y < 256; y += 11) {
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(0, y, 1024, 1.5);
    for (let x = (y * 37) % 160; x < 1024; x += 160) g.fillRect(x, y - 10, 1.5, 10);
  }
  for (let i = 0; i < 600; i++) {
    g.fillStyle = `rgba(${i % 2 ? '255,255,255' : '0,0,0'},0.05)`;
    g.fillRect((i * 97) % 1024, (i * 53) % 256, 20 + (i % 30), 1);
  }
  // A gilt moulding along the rail.
  g.fillStyle = plan.paint.trim;
  g.fillRect(0, 0, 1024, 6);
  return finish(c, 4);
}

/** Gunport rows on the hull texture: drawn on a copy, since the hull's u runs over the whole length. */
function addPorts(texture: THREE.CanvasTexture, plan: HullPlan): void {
  const g = (texture.image as HTMLCanvasElement).getContext('2d')!;
  for (const row of plan.ports) {
    const v = 256 * (1 - row.at) * 0.62;
    for (let i = 0; i < row.count; i++) {
      const u = 1024 * (0.22 + (0.6 * (i + 0.5)) / row.count);
      g.fillStyle = plan.paint.trim;
      g.fillRect(u - 15, v - 13, 30, 26);
      g.fillStyle = '#1a0f12';
      g.fillRect(u - 12, v - 10, 24, 20);
    }
  }
  texture.needsUpdate = true;
}

/** The transom: windows of the stern gallery in a gilt frame. */
function sternTexture(plan: HullPlan): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = plan.paint.hull;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = plan.paint.band;
  g.fillRect(0, 0, 256, 120);
  g.fillStyle = plan.paint.trim;
  g.fillRect(20, 30, 216, 64);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = '#f4d488';
    g.fillRect(30 + i * 42, 38, 30, 48);
    g.fillStyle = '#5a7fa0';
    g.fillRect(34 + i * 42, 42, 22, 40);
  }
  g.fillStyle = plan.paint.trim;
  g.fillRect(0, 110, 256, 8);
  return finish(c, 1);
}

/** Deck planks, fore and aft. */
function deckTexture(plan: HullPlan): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = plan.paint.deck;
  g.fillRect(0, 0, 256, 256);
  // Weathered and oiled: a warm dark wash, since the deck faces the sun full on and would otherwise read as
  // a pale tan slab from above (Pirates!'s decks are a deep reddish brown), and each plank a shade apart.
  g.fillStyle = 'rgba(70, 32, 14, 0.4)';
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) {
    g.fillStyle = `rgba(40, 18, 8, ${((x * 37) % 5) * 0.03})`;
    g.fillRect(x, 0, 16, 256);
  }
  for (let x = 0; x < 256; x += 16) {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(x, 0, 1.5, 256);
    for (let y = (x * 13) % 90; y < 256; y += 90) g.fillRect(x, y, 16, 1.5);
  }
  return finish(c, 4);
}

/**
 * Sailcloth: off-white canvas with seams down each cloth, a bolt rope round the edge and two reef bands near
 * the head; a square sail can carry its nation's emblem (Pirates! paints the Spanish cross on Spanish canvas
 * and a skull on a pirate's).
 */
const CLOTH = new Map<string, THREE.CanvasTexture>();
function sailTexture(emblem: string): THREE.CanvasTexture {
  const known = CLOTH.get(emblem);
  if (known) return known;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6f2e6';
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 21) {
    g.fillStyle = 'rgba(120,100,70,0.16)';
    g.fillRect(x, 0, 2, 256);
  }
  // Reef bands with their points.
  for (const y of [46, 84]) {
    g.fillStyle = 'rgba(120,100,70,0.3)';
    g.fillRect(0, y, 256, 3);
    for (let x = 8; x < 256; x += 16) g.fillRect(x, y + 3, 2, 7);
  }
  g.strokeStyle = 'rgba(120,100,70,0.4)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 250);
  if (emblem === 'spain') {
    // The ragged red cross of Burgundy.
    g.strokeStyle = 'rgba(176,36,40,0.9)';
    g.lineWidth = 16;
    g.beginPath();
    g.moveTo(60, 70);
    g.lineTo(196, 216);
    g.moveTo(196, 70);
    g.lineTo(60, 216);
    g.stroke();
  } else if (emblem === 'pirate') {
    g.fillStyle = 'rgba(40,36,44,0.82)';
    g.beginPath();
    g.arc(128, 128, 30, 0, Math.PI * 2);
    g.fill();
    g.fillRect(108, 150, 40, 18);
    g.save();
    g.translate(128, 188);
    for (const a of [0.6, -0.6]) {
      g.rotate(a);
      g.fillRect(-56, -6, 112, 12);
      g.rotate(-a);
    }
    g.restore();
  }
  const t = finish(c, 1);
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
  const castle = plan.castle * THREE.MathUtils.smoothstep(plan.castleTo - t, -0.02, 0.04);
  const fore = plan.forecastle * THREE.MathUtils.smoothstep(t - plan.forecastleFrom, -0.02, 0.04);
  const h = plan.rail + plan.sheerStern * (1 - t) ** 3 + plan.sheerBow * t ** 4 + castle + fore;
  return { w: Math.max(w, 0.004), h };
}

const KEEL = -0.28;
const STATIONS = 96;
const SECTION = 20;

/** How far out the hull side stands at a height `s` up it (keel 0 .. rail 1), for a half-width `w`. */
function sideAt(w: number, s: number): number {
  const bilge = Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, s * 1.6)) ** 2));
  const tumble = 1 - 0.12 * Math.max(0, (s - 0.7) / 0.3) ** 2;
  return w * bilge * tumble;
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
    const x = sideAt(w, s) + out;
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
        pos.push(side * sideAt(w, s), y, z);
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

  const gilt = new THREE.MeshStandardMaterial({ color: plan.paint.trim, roughness: 0.4, metalness: 0.6 });
  const wale = new THREE.MeshStandardMaterial({ color: plan.paint.wale, roughness: 0.7 });
  // Raised wales: a heavy one below the painted band, a lighter one along the waterline; the rail capped in gilt.
  group.add(strake(plan, 0.64, 0.035, 0.012, wale), strake(plan, 0.42, 0.025, 0.008, wale), strake(plan, 1, 0.022, 0.006, gilt));
  // The bow: a beakhead platform under the bowsprit, a gilded figurehead leaning out, a cutwater below.
  const bow = stationOf(plan, 1);
  const beak = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.2), wale);
  beak.position.set(0, bow.h * 0.72, -plan.length / 2 - 0.08);
  const figure = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), gilt);
  figure.scale.set(0.8, 1.2, 2.2);
  figure.position.set(0, bow.h * 0.62, -plan.length / 2 - 0.13);
  figure.rotation.x = 0.5;
  const cutwater = new THREE.Mesh(new THREE.BoxGeometry(0.03, bow.h + 0.2, 0.12), wale);
  cutwater.position.set(0, (bow.h - 0.2) / 2, -plan.length / 2 - 0.02);
  group.add(beak, figure, cutwater);
  // The stern: quarter galleries on either side, three lanterns on the taffrail.
  const aft = stationOf(plan, 0.05);
  for (const side of [-1, 1]) {
    const gallery = new THREE.Mesh(new THREE.BoxGeometry(0.05, aft.h * 0.38, 0.22), stern);
    gallery.position.set(side * (aft.w + 0.02), aft.h * 0.72, plan.length / 2 - 0.16);
    group.add(gallery);
  }
  const lantern = new THREE.MeshStandardMaterial({ color: '#ffd77a', emissive: '#ffb84a', emissiveIntensity: 1.6, roughness: 0.3 });
  const s0top = stationOf(plan, 0);
  for (const [x, lift] of [[-s0top.w * 0.6, 0.1], [0, 0.16], [s0top.w * 0.6, 0.1]] as const) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), lantern);
    l.scale.y = 1.4;
    l.position.set(x, s0top.h + lift, plan.length / 2 + 0.01);
    group.add(l);
  }
  return group;
}

// --- spars, rigging, sails, flags --------------------------------------------------------------------

const SPAR = new THREE.MeshStandardMaterial({ color: '#4a2f22', roughness: 0.8 });
const BLACK = new THREE.MeshStandardMaterial({ color: '#1d1a19', roughness: 0.6, metalness: 0.3 });
const LINE = new THREE.LineBasicMaterial({ color: '#2a2220', transparent: true, opacity: 0.85 });
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
type SailUniforms = { uBelly: THREE.IUniform; uLuff: THREE.IUniform; uTime: THREE.IUniform; uTatter: THREE.IUniform };
/** The sails' own glow, shared by every sail and tinted by the renderer with the light: warm at dusk, blue by moonlight. */
export const SAIL_GLOW = new THREE.Color('#fffaf0');
function sailMaterial(cloth: THREE.Texture, shared?: SailUniforms): THREE.MeshStandardMaterial & { userData: { uniforms: SailUniforms } } {
  // A soft glow of their own, so sails stay bright white on the shadowed side too (Pirates!'s glowing canvas).
  const m = new THREE.MeshStandardMaterial({ map: cloth, roughness: 0.92, side: THREE.DoubleSide, emissive: '#fffaf0', emissiveIntensity: 0.38, emissiveMap: cloth }) as THREE.MeshStandardMaterial & {
    userData: { uniforms: SailUniforms };
  };
  const uniforms = shared ?? { uBelly: { value: 1 }, uLuff: { value: 0 }, uTime: { value: 0 }, uTatter: { value: 0 } };
  m.emissive = SAIL_GLOW;
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFree;\nattribute float aDepth;\nattribute float aAbeam;\nuniform float uBelly;\nuniform float uLuff;\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float wave = sin((position.x + position.z) * 9.0 + uTime * 11.0) * sin(position.y * 6.0 - uTime * 7.0);
vec3 belly = mix(vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), aAbeam);
transformed += belly * aFree * (aDepth * uBelly + wave * uLuff * 0.05);`,
      );
    // Shot through (uTatter 0 whole .. 1 in rags): round holes in more and more of the cloth, then the foot
    // torn away in ragged tongues, so a beaten ship's canvas shows it (Pirates! draws hers as rags).
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTatter;
float tatterHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <map_fragment>',
        `if (uTatter > 0.0) {
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
export function flagTexture(nation: string): THREE.CanvasTexture {
  const cached = FLAGS.get(nation);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 80;
  const g = c.getContext('2d')!;
  if (nation === 'spain') {
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
  FLAGS.set(nation, t);
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
}

/** The parts of a class shared by every ship of it (geometry and hull paint), built once. */
interface ClassKit {
  hull: THREE.Group;
}
const KITS = new Map<ShipPlan, ClassKit>();

function kitFor(plan: ShipPlan): ClassKit {
  const known = KITS.get(plan);
  if (known) return known;
  const sides = hullTexture(plan.hull);
  addPorts(sides, plan.hull);
  const hull = hullMesh(
    plan.hull,
    new THREE.MeshStandardMaterial({ map: sides, roughness: 0.75 }),
    new THREE.MeshStandardMaterial({ map: sternTexture(plan.hull), roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ map: deckTexture(plan.hull), roughness: 0.85 }),
  );
  const kit = { hull };
  KITS.set(plan, kit);
  return kit;
}

export function buildShip(plan: ShipPlan, nation: string): BuiltShip {
  const kit = kitFor(plan);
  const root = new THREE.Group();
  root.add(kit.hull.clone());
  // Square sails carry the nation's emblem (Spain's cross, a pirate's skull); fore-and-aft canvas is plain.
  const sailMat = sailMaterial(sailTexture(nation === 'spain' || nation === 'pirate' ? nation : 'plain'));
  const flatMat = sailMaterial(sailTexture('plain'), sailMat.userData.uniforms);
  const flagMat = flagMaterial(flagTexture(nation));
  const lines: number[] = [];
  const h = plan.hull;
  const railAt = (forward: number) => stationOf(h, 0.5 + forward / h.length);

  // Masts, each with its yards and square sails in a group that braces round the mast.
  const yards: { group: THREE.Group; sails: { mesh: THREE.Mesh; furl: THREE.Mesh; course: boolean }[] }[] = [];
  for (const m of plan.masts) {
    const z = -m.at;
    const mast = spar(0.04, 0.022, m.height);
    mast.position.set(0, 0.05, z);
    root.add(mast);
    const group = new THREE.Group();
    group.position.set(0, 0, z);
    root.add(group);
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
      // A fighting top under each upper yard.
      if (i === m.squares.length - 1 && m.squares.length > 1) {
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.03, 10), SPAR);
        top.position.set(0, sq.zt + 0.08, z);
        root.add(top);
      }
    });
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
      root.add(new THREE.Mesh(ladder, RATLINES));
      const chain = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.3), SPAR);
      chain.position.set(s * (rail.w + 0.025), rail.h - 0.05, z + 0.16);
      root.add(chain);
    }
  }
  // Stays: each masthead forward to the next mast's foot, the foremast's to the bowsprit's end.
  const masts = [...plan.masts].sort((a, b) => b.at - a.at);
  const [[bx0, by0], [bx1, by1]] = plan.bowsprit;
  masts.forEach((m, i) => {
    const ahead = masts[i - 1];
    if (ahead) lines.push(0, m.height * 0.95, -m.at, 0, ahead.height * 0.45, -ahead.at);
    else lines.push(0, m.height * 0.95, -m.at, 0, by1, -bx1);
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
    root.add(group);
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

  // Rigging lines, in one draw.
  const rig = new THREE.BufferGeometry();
  rig.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  root.add(new THREE.LineSegments(rig, LINE));

  // Cannon muzzles out of the lowest row of ports.
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
        root.add(m);
      }
    }
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
  root.add(pennant);

  return {
    root,
    setSails(setting, point, side, nowMs) {
      const p = POINTS[point] ?? POINTS.beam!;
      const t = nowMs / 1000;
      const u = sailMat.userData.uniforms;
      u.uTime.value = t;
      u.uBelly.value = point === 'irons' ? 0.1 : p.belly;
      u.uLuff.value = point === 'irons' ? 1 : 0;
      flagMat.userData.uniforms.uTime.value = t;
      // Yards braced round toward the wind's side; courses furled at half sail, everything at furled.
      for (const y of yards) {
        y.group.rotation.y = THREE.MathUtils.degToRad(setting === 'furled' ? 0 : side * p.brace);
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
    setTatters(share) {
      // Barely scratched canvas stays whole.
      sailMat.userData.uniforms.uTatter.value = THREE.MathUtils.clamp((share - 0.08) / 0.92, 0, 1);
    },
  };
}
