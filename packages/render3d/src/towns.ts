import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PlacedSettlement } from '@corsair/data';

// Towns (white and pastel houses with tiled roofs climbing from the shore, a church tower, a fort whose size shows
// the town's strength, the nation's flag over it, a wharf with boats): built from each settlement's size and
// nation, facing the sea. Walls of weathered plaster with shuttered windows and doors, tiled roofs, dressed-stone
// forts (textured, each building tinted by its vertex colours). Each town is a few merged meshes; its flag streams.

/** A nation's look: wall colours, roof colours, and whether its houses wear stepped gables (the Dutch). */
interface Style {
  walls: string[];
  roofs: string[];
  stepped?: boolean;
  shacks?: boolean;
}
// Bright, as Pirates! paints them: whitewash and warm stucco everywhere, the nations told apart by their roofs
// and a few accents (English brick, Dutch red brick and stepped gables, Spanish terracotta, French slate).
const STYLES: Record<string, Style> = {
  spain: { walls: ['#f6f2e8', '#f2e8d2', '#f8f4ec', '#efdcbc', '#f4ead6'], roofs: ['#c45a3c', '#d06a44', '#b8523a'] },
  england: { walls: ['#f2ead8', '#e9dcc0', '#d48f6c', '#f5efe2', '#e2c9a4'], roofs: ['#7d8794', '#c45a3c', '#8a8f96'] },
  france: { walls: ['#f4ead2', '#efdfbd', '#f7f0e0', '#ead6b0'], roofs: ['#76808e', '#c45a3c', '#848c98'] },
  netherlands: { walls: ['#c46a4c', '#d27a58', '#f2ead8', '#b9614a'], roofs: ['#6f7884', '#c45a3c', '#7c8590'], stepped: true },
  pirate: { walls: ['#a8845a', '#9b7a50', '#b8936a', '#8f6f48'], roofs: ['#c9ad6e', '#bca064', '#d4b97a'], shacks: true },
};
const HOUSES: Record<string, number> = { hamlet: 8, town: 22, city: 38 };
/** Houses are drawn this much larger than life's proportion to the ships, so a town reads from the sea. */
const SCALE = 1.7;
/** How far round a town its footprint reaches (kept clear of jungle), by size. */
export const TOWN_RADIUS: Record<string, number> = { hamlet: 2.6, town: 4.2, city: 5.6 };

/** A canvas drawn once into a texture (colour-correct, tiling, mipmapped). */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, rand: () => number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  let seed = w * 31 + h;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  draw(g, rand);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * A house front, light (each house's colour multiplies it): rough plaster stained by weather, stone quoins at the
 * corners, a door, and two shuttered windows above with a sill each.
 */
const FACADE = () =>
  canvasTexture(128, 128, (g, rand) => {
    g.fillStyle = '#fbfaf6';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? '120,110,95' : '255,255,250'},${0.04 + rand() * 0.06})`;
      g.fillRect(rand() * 128, rand() * 128, 4 + rand() * 14, 2 + rand() * 8);
    }
    // Rain stains from the eaves and the sills.
    for (let i = 0; i < 14; i++) {
      const grad = g.createLinearGradient(0, 0, 0, 60);
      grad.addColorStop(0, 'rgba(90,80,65,0.18)');
      grad.addColorStop(1, 'rgba(90,80,65,0)');
      g.fillStyle = grad;
      g.fillRect(rand() * 128, 0, 2 + rand() * 4, 60);
    }
    // The door, with its frame.
    g.fillStyle = '#7a6a58';
    g.fillRect(55, 88, 18, 40);
    g.fillStyle = '#4a3420';
    g.fillRect(57, 90, 14, 38);
    // Windows: dark glass behind open shutters, a sill below; small against the wall.
    for (const x of [26, 92]) {
      g.fillStyle = '#5a6a48';
      g.fillRect(x - 7, 30, 5, 20);
      g.fillRect(x + 14, 30, 5, 20);
      g.fillStyle = '#3a3e40';
      g.fillRect(x - 1, 30, 14, 20);
      g.fillStyle = 'rgba(200,215,225,0.3)';
      g.fillRect(x, 31, 5, 8);
      g.fillStyle = '#c4bcac';
      g.fillRect(x - 3, 50, 20, 3);
    }
  });
/**
 * Lamplight in the towns' windows, dark by day and warm from dusk (the renderer sets it with the light), and the
 * window panes alone (one of each house's two lit, the door dark), as the emissive map for it.
 */
export const TOWN_GLOW = new THREE.Color(0, 0, 0);
const FACADE_GLOW = () =>
  canvasTexture(128, 128, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#ffcf80';
    g.fillRect(26, 31, 12, 18);
  });
/** Roof tiles (grey, tinted by each roof's colour): rows of curved tiles, each a shade apart, mossy in places. */
const TILES = () =>
  canvasTexture(128, 128, (g, rand) => {
    g.fillStyle = '#d8d4cc';
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 10) {
      for (let x = (y / 10) % 2 ? -8 : 0; x < 128; x += 16) {
        const tone = 190 + rand() * 50;
        g.fillStyle = `rgb(${tone},${tone * 0.97},${tone * 0.94})`;
        g.beginPath();
        g.ellipse(x + 8, y + 6, 8, 6, 0, 0, Math.PI);
        g.fill();
        g.fillStyle = 'rgba(40,30,20,0.35)';
        g.fillRect(x, y + 9, 16, 1.5);
      }
    }
    for (let i = 0; i < 20; i++) {
      g.fillStyle = `rgba(80,90,50,${0.08 + rand() * 0.12})`;
      g.beginPath();
      g.ellipse(rand() * 128, rand() * 128, 6 + rand() * 12, 3 + rand() * 6, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
/** Dressed stone in courses (light, tinted by the fort's stone): blocks of varied tone, mortar between, weathered. */
const STONE = () =>
  canvasTexture(128, 128, (g, rand) => {
    g.fillStyle = '#c8c4bc';
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 14) {
      for (let x = (y / 14) % 2 ? -12 : 0; x < 128; x += 24) {
        const tone = 170 + rand() * 70;
        g.fillStyle = `rgb(${tone},${tone * 0.97},${tone * 0.92})`;
        g.fillRect(x + 1, y + 1, 22, 12);
      }
    }
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(60,60,50,${0.05 + rand() * 0.1})`;
      g.fillRect(rand() * 128, rand() * 128, 6 + rand() * 20, 4 + rand() * 30);
    }
  });

/** A building's parts, by material: plastered walls, tiled roofs, stone, timber. */
interface Parts {
  walls: THREE.BufferGeometry[];
  roofs: THREE.BufferGeometry[];
  stone: THREE.BufferGeometry[];
  wood: THREE.BufferGeometry[];
}
const parts = (): Parts => ({ walls: [], roofs: [], stone: [], wood: [] });

/** A pitched roof over a w x d plan (ridge along x), with tile texture coordinates, `h` up. */
function roofPrism(w: number, d: number, h: number, pitch: number): THREE.BufferGeometry {
  const rw = w + 0.06;
  const rd = d / 2 + 0.05;
  const rh = d * pitch * 1.6;
  const g = new THREE.BufferGeometry();
  const v = [
    -rw / 2, 0, -rd, rw / 2, 0, -rd, rw / 2, rh, 0, -rw / 2, rh, 0,
    -rw / 2, 0, rd, -rw / 2, rh, 0, rw / 2, rh, 0, rw / 2, 0, rd,
    -rw / 2, 0, -rd, -rw / 2, rh, 0, -rw / 2, 0, rd,
    rw / 2, 0, -rd, rw / 2, 0, rd, rw / 2, rh, 0,
  ];
  const slope = Math.hypot(rd, rh) * 4;
  const u = [0, 0, rw * 4, 0, rw * 4, slope, 0, slope, 0, 0, 0, slope, rw * 4, slope, rw * 4, 0, 0, 0, 0.5, 1, 1, 0, 0, 0, 1, 0, 0.5, 1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
  g.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6, 8, 10, 9, 11, 13, 12]);
  g.computeVertexNormals();
  return g.translate(0, h, 0);
}

/**
 * A house: plastered walls (a storey or two), a tiled roof (or thatch on a shack); a balcony on a Spanish or
 * French house, a chimney on an English or Dutch one, a stepped gable on a Dutch one. At the origin.
 */
function house(w: number, d: number, h: number, wall: THREE.Color, roof: THREE.Color, style: Style, nation: string, rand: () => number): Parts {
  const out = parts();
  out.walls.push(paint(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), wall));
  out.roofs.push(paint(roofPrism(w, d, h, style.shacks ? 0.22 : 0.3), roof));
  if (style.stepped) {
    for (let i = 0; i < 3; i++) out.walls.push(paint(new THREE.BoxGeometry(w * (0.9 - i * 0.28), 0.08, 0.04).translate(0, h + 0.04 + i * 0.08, d / 2), wall));
  }
  if ((nation === 'spain' || nation === 'france') && h > 0.55 && rand() < 0.6) {
    // A wooden balcony on the front, on brackets.
    out.wood.push(paint(new THREE.BoxGeometry(w * 0.6, 0.025, 0.09).translate(0, h * 0.62, d / 2 + 0.045), new THREE.Color('#6a4a30')));
    out.wood.push(paint(new THREE.BoxGeometry(w * 0.6, 0.05, 0.01).translate(0, h * 0.62 + 0.04, d / 2 + 0.09), new THREE.Color('#5a3a24')));
  }
  if ((nation === 'england' || nation === 'netherlands') && rand() < 0.7) {
    out.stone.push(paint(new THREE.BoxGeometry(0.07, 0.22, 0.07).translate(w * 0.32, h + d * 0.3, 0), new THREE.Color('#9a6a52')));
  }
  return out;
}

function paint(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Adds one building's parts to another's, moved by `m`. */
function addParts(into: Parts, from: Parts, m: THREE.Matrix4) {
  for (const k of ['walls', 'roofs', 'stone', 'wood'] as const) for (const g of from[k]) into[k].push(g.applyMatrix4(m));
}

/**
 * A church: a nave with a tiled roof, and a bell tower with open arches near its top under a spire (or a dome
 * and lantern, for the Spanish and French).
 */
function church(wall: THREE.Color, roof: THREE.Color, dome: boolean): Parts {
  const out = parts();
  out.walls.push(paint(new THREE.BoxGeometry(0.9, 0.45, 0.42).translate(0, 0.225, 0), wall));
  out.roofs.push(paint(roofPrism(0.9, 0.42, 0.45, 0.3), roof));
  // The tower, in two stages, the upper one open in arches (dark recesses) for the bells.
  out.walls.push(paint(new THREE.BoxGeometry(0.26, 0.75, 0.26).translate(-0.42, 0.375, 0), wall));
  out.walls.push(paint(new THREE.BoxGeometry(0.22, 0.2, 0.22).translate(-0.42, 0.85, 0), wall));
  for (const [x, z] of [[0, 0.112], [0, -0.112], [0.112, 0], [-0.112, 0]] as const) {
    out.wood.push(paint(new THREE.BoxGeometry(z ? 0.1 : 0.01, 0.13, z ? 0.01 : 0.1).translate(-0.42 + x, 0.85, z), new THREE.Color('#1a1614')));
  }
  const top = dome ? new THREE.SphereGeometry(0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2) : new THREE.ConeGeometry(0.17, 0.42, 4);
  if (!dome) top.rotateY(Math.PI / 4);
  top.translate(-0.42, dome ? 0.95 : 1.16, 0);
  out.roofs.push(paint(top, dome ? new THREE.Color('#c9a24a') : roof));
  return out;
}

/**
 * A fort: walls of dressed stone round a court, battlemented (merlons along the top), a bastion at each corner
 * with guns pointing out, a gate in the landward wall and a keep in the court; a pirate haven's is a timber
 * palisade. `scale` by the town's strength.
 */
function fort(scale: number, stone: THREE.Color, timber: boolean): Parts {
  const out = parts();
  const side = 1.3 * scale;
  const h = timber ? 0.3 : 0.38;
  const t = 0.16;
  const list = timber ? out.wood : out.stone;
  for (const [x, z, w, d] of [
    [0, -side / 2, side, t],
    [0, side / 2, side, t],
    [-side / 2, 0, t, side],
    [side / 2, 0, t, side],
  ] as const) {
    list.push(paint(new THREE.BoxGeometry(w, h, d).translate(x, h / 2, z), stone));
    // Merlons along the top (sharpened stakes on a palisade).
    const n = Math.round(Math.max(w, d) / 0.12);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n - 0.5;
      const mx = w > d ? x + f * w : x;
      const mz = w > d ? z : z + f * d;
      const m = timber ? new THREE.ConeGeometry(0.03, 0.08, 5).translate(mx, h + 0.04, mz) : new THREE.BoxGeometry(w > d ? 0.06 : t, 0.06, w > d ? t : 0.06).translate(mx, h + 0.03, mz);
      list.push(paint(m, stone));
    }
  }
  if (!timber) {
    // The gate: a dark arch in the landward (back) wall.
    out.wood.push(paint(new THREE.BoxGeometry(0.16, 0.22, 0.02).translate(0, 0.11, side / 2 + t / 2 + 0.005), new THREE.Color('#2a1e14')));
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const b = new THREE.CylinderGeometry(0.3 * scale, 0.36 * scale, h + 0.06, 4);
      b.rotateY(Math.PI / 4);
      b.translate((x * side) / 2, (h + 0.06) / 2, (z * side) / 2);
      out.stone.push(paint(b, stone.clone().multiplyScalar(0.94)));
      for (const a of [-0.35, 0.35]) {
        const gun = new THREE.CylinderGeometry(0.025, 0.03, 0.22, 6);
        gun.rotateZ(Math.PI / 2);
        const dir = new THREE.Vector2(x, z).normalize().rotateAround(new THREE.Vector2(), a);
        gun.rotateY(-Math.atan2(dir.y, dir.x));
        gun.translate((x * side) / 2 + dir.x * 0.3 * scale, h + 0.1, (z * side) / 2 + dir.y * 0.3 * scale);
        out.wood.push(paint(gun, new THREE.Color('#1f1d1c')));
      }
    }
    out.stone.push(paint(new THREE.BoxGeometry(0.42 * scale, 0.5, 0.42 * scale).translate(0, 0.25, 0), stone.clone().multiplyScalar(1.04)));
    out.roofs.push(paint(roofPrism(0.42 * scale, 0.42 * scale, 0.5, 0.25), new THREE.Color('#9a5a3c')));
  }
  return out;
}

export interface Towns {
  object: THREE.Group;
  /** Each frame: stream the flags. */
  update(t: number): void;
}

/**
 * The towns of the map. `heightAt` is the ground; `flag` makes a nation's streaming flag (shipyard.ts), and
 * `label` the town's name over it.
 */
export function createTowns(
  settlements: PlacedSettlement[],
  heightAt: (x: number, y: number) => number,
  flag: (nation: string) => { mesh: THREE.Mesh; update(t: number): void },
  label: (s: PlacedSettlement) => THREE.Object3D,
): Towns {
  const object = new THREE.Group();
  // One material each for walls, roofs, stone and timber, every building tinted by its vertex colours.
  const wallMat = new THREE.MeshStandardMaterial({ map: FACADE(), vertexColors: true, roughness: 0.92, emissiveMap: FACADE_GLOW() });
  // Shared, not copied: the renderer lights the windows by changing this one colour.
  wallMat.emissive = TOWN_GLOW;
  const roofMat = new THREE.MeshStandardMaterial({ map: TILES(), vertexColors: true, roughness: 0.85 });
  const stoneMat = new THREE.MeshStandardMaterial({ map: STONE(), vertexColors: true, roughness: 0.95 });
  const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const flags: { update(t: number): void }[] = [];
  const pierMat = new THREE.MeshStandardMaterial({ color: '#7a5a3c', roughness: 0.9 });
  const m4 = new THREE.Matrix4();
  for (const s of settlements) {
    const style = STYLES[s.nation] ?? STYLES.spain!;
    let seed = Math.floor(s.x * 7919 + s.y * 104729) % 2147483647 || 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    // Which way the sea lies: the lowest ground in a ring round the town.
    let seaward = 0;
    let lowest = Infinity;
    for (let a = 0; a < 360; a += 15) {
      const r = (a * Math.PI) / 180;
      const g = heightAt(s.x + Math.sin(r) * 2.5, s.y - Math.cos(r) * 2.5);
      if (g < lowest) {
        lowest = g;
        seaward = r;
      }
    }
    const out = new THREE.Vector2(Math.sin(seaward), -Math.cos(seaward));
    const along = new THREE.Vector2(-out.y, out.x);
    // The waterfront: walk seaward from the settlement to the shore.
    let shore = 0;
    while (shore < 3 && heightAt(s.x + out.x * shore, s.y + out.y * shore) > 0.05) shore += 0.1;
    const front = new THREE.Vector2(s.x + out.x * (shore - 0.15), s.y + out.y * (shore - 0.15));
    const town = new THREE.Group();
    const all = parts();
    const place = (b: Parts, x: number, y: number, facing: number, scale = 1) => {
      const ground = Math.max(0.08, heightAt(x, y));
      m4.makeRotationY(facing).premultiply(new THREE.Matrix4().makeTranslation(x, ground - 0.02, y)).multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
      addParts(all, b, m4);
    };
    const facing = -Math.atan2(out.y, out.x);
    // Houses: rows up the slope behind the waterfront, the nearest the sea first, jittered; some of two storeys.
    const count = (HOUSES[s.size] ?? 12) + (s.type === 'capital' ? 10 : 0);
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 8; tries++) {
      const row = Math.floor(tries / 9);
      const across = ((tries % 9) - 4) * 0.55 * SCALE + (rand() - 0.5) * 0.4;
      const back = 0.5 + row * 0.55 * SCALE + rand() * 0.25;
      const x = front.x - out.x * back + along.x * across;
      const y = front.y - out.y * back + along.y * across;
      const g = heightAt(x, y);
      if (g < 0.07 || g > 3.5) continue;
      // Clear of the fort's ground along the shore.
      if (s.size !== 'hamlet' && across > 2.3 && back < 3) continue;
      const wall = new THREE.Color(style.walls[Math.floor(rand() * style.walls.length)]!);
      const roof = new THREE.Color(style.roofs[Math.floor(rand() * style.roofs.length)]!);
      const big = style.shacks ? 0.75 : 1;
      const k = big * SCALE;
      const storeys = style.shacks ? 1 : rand() < 0.35 ? 2 : 1;
      place(house((0.36 + rand() * 0.24) * k, (0.3 + rand() * 0.14) * k, (0.24 + rand() * 0.12) * k * (storeys === 2 ? 1.6 : 1), wall, roof, style, s.nation, rand), x, y, facing + (rand() - 0.5) * 0.3);
      placed++;
    }
    // On a small island the rows run off the land: pack the rest onto whatever dry ground is near the landing.
    const taken: [number, number][] = [];
    for (let tries = 0; placed < count && tries < count * 20; tries++) {
      const a = rand() * Math.PI * 2;
      const r = 0.4 + Math.sqrt(rand()) * 2.2;
      const x = front.x - out.x * 0.8 + Math.cos(a) * r;
      const y = front.y - out.y * 0.8 + Math.sin(a) * r;
      const g = heightAt(x, y);
      if (g < 0.07 || g > 3.5 || taken.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 0.55)) continue;
      taken.push([x, y]);
      const k = (style.shacks ? 0.75 : 1) * SCALE;
      place(
        house((0.36 + rand() * 0.2) * k, (0.3 + rand() * 0.12) * k, (0.24 + rand() * 0.1) * k, new THREE.Color(style.walls[Math.floor(rand() * style.walls.length)]!), new THREE.Color(style.roofs[Math.floor(rand() * style.roofs.length)]!), style, s.nation, rand),
        x,
        y,
        facing + (rand() - 0.5) * 0.6,
      );
      placed++;
    }
    if (s.size !== 'hamlet' && !style.shacks) {
      // The church up the slope, and the governor's house beside it.
      const cx = front.x - out.x * 2.4 + along.x * 1.0;
      const cy = front.y - out.y * 2.4 + along.y * 1.0;
      place(church(new THREE.Color(style.walls[0]!), new THREE.Color(style.roofs[0]!), s.nation === 'spain' || s.nation === 'france'), cx, cy, facing + Math.PI / 2, SCALE);
      place(house(0.8 * SCALE, 0.55 * SCALE, 0.62 * SCALE, new THREE.Color('#f8f4ea'), new THREE.Color(style.roofs[0]!), style, s.nation, rand), front.x - out.x * 2 - along.x * 1.5, front.y - out.y * 2 - along.y * 1.5, facing);
    }

    // The fort on the waterfront to one side, sized by the town's strength; a palisade at a pirate haven.
    // On dry ground: along the shore to one side if there is room, else the other, nearer, or further back;
    // none at all on a spit of sand too small for one.
    const strength = (s.type === 'capital' ? 1.25 : s.size === 'city' ? 1.05 : 0.8) * 1.4;
    const fortAt = (() => {
      const half = 0.65 * strength;
      const dry = (x: number, y: number) =>
        [[0, 0], [half, half], [-half, half], [half, -half], [-half, -half]].every(([dx, dy]) => heightAt(x + dx!, y + dy!) > 0.06);
      for (const back of [0.5, 1.2, 2]) {
        for (const side of [4.4, -4.4, 3.2, -3.2, 2.2, -2.2]) {
          const x = front.x + along.x * side - out.x * back;
          const y = front.y + along.y * side - out.y * back;
          if (dry(x, y)) return { x, y };
        }
      }
      return undefined;
    })();
    if (s.size !== 'hamlet' && fortAt) {
      const fx = fortAt.x;
      const fy = fortAt.y;
      place(fort(strength, new THREE.Color(style.shacks ? '#8a6a46' : '#c4b8a0'), Boolean(style.shacks)), fx, fy, facing);
      const f = flag(s.nation);
      f.mesh.position.set(fx, Math.max(0.08, heightAt(fx, fy)) + 1.0, fy);
      town.add(f.mesh);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 1.2, 6), pierMat);
      pole.position.set(fx, Math.max(0.08, heightAt(fx, fy)) + 0.6, fy);
      town.add(pole);
      flags.push(f);
    }
    // A town on ground too small or steep for houses keeps its fort, pier and name.
    for (const [key, mat] of [
      ['walls', wallMat],
      ['roofs', roofMat],
      ['stone', stoneMat],
      ['wood', woodMat],
    ] as const) {
      if (!all[key].length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(all[key])!, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      town.add(mesh);
    }

    // The pier: planking out over the water on piles.
    const pierLength = s.size === 'hamlet' ? 1.2 : 2.2;
    const pier = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, pierLength), pierMat);
    deck.position.set(0, 0.16, -pierLength / 2);
    pier.add(deck);
    for (let z = 0.2; z < pierLength; z += 0.35) {
      for (const x of [-0.09, 0.09]) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 5), pierMat);
        pile.position.set(x, -0.02, -z);
        pier.add(pile);
      }
    }
    // At the pier's root a wider landing stage; crates and barrels on it; rowing boats moored alongside.
    const landing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.4), pierMat);
    landing.position.set(0, 0.16, -0.1);
    pier.add(landing);
    const crate = new THREE.MeshStandardMaterial({ color: '#8a6a44', roughness: 0.9 });
    const barrel = new THREE.MeshStandardMaterial({ color: '#6a4a2c', roughness: 0.85 });
    for (let k = 0; k < 6; k++) {
      const piece = k % 2 ? new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8), barrel) : new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), crate);
      piece.position.set(-0.35 + k * 0.12 + (rand() - 0.5) * 0.03, 0.22, -0.1 + (rand() - 0.5) * 0.15);
      piece.rotation.y = rand() * Math.PI;
      pier.add(piece);
    }
    const boatMat = new THREE.MeshStandardMaterial({ color: '#5e4430', roughness: 0.85 });
    for (const [x, z] of [
      [0.2, -pierLength * 0.45],
      [-0.2, -pierLength * 0.75],
    ] as const) {
      const boat = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), boatMat);
      boat.scale.set(0.06, 0.04, 0.16);
      boat.position.set(x, 0.04, z);
      pier.add(boat);
    }
    pier.position.set(front.x, 0, front.y);
    pier.rotation.y = -seaward;
    town.add(pier);

    const name = label(s);
    name.position.set(s.x, Math.max(0.2, heightAt(s.x, s.y)) + 2.6, s.y);
    town.add(name);
    object.add(town);
  }
  return {
    object,
    update(t) {
      for (const f of flags) f.update(t);
    },
  };
}
