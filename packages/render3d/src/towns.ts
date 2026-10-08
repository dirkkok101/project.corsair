import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PlacedSettlement } from '@corsair/data';

// Towns (Pirates! 2004: white and pastel houses with red-tile roofs climbing from the shore, a church tower, a
// fort whose size shows the town's strength, the nation's flag over it): built from each settlement's size and
// nation, facing the sea. Each town is a few merged meshes with vertex colours; its flag streams.

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

/** A house: walls and a gabled roof (or a stepped-gable front, or a thatched shack), coloured, at the origin. */
function house(w: number, d: number, h: number, wall: THREE.Color, roof: THREE.Color, style: Style): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.BoxGeometry(w, h, d);
  body.translate(0, h / 2, 0);
  parts.push(paint(body, wall));
  // A windowed band: a darker strip on the long sides suggests windows and doors at this size.
  const band = new THREE.BoxGeometry(w * 0.82, h * 0.18, d + 0.01);
  band.translate(0, h * 0.55, 0);
  parts.push(paint(band, wall.clone().multiplyScalar(0.62)));
  const pitch = style.shacks ? 0.22 : 0.3;
  // The roof: a prism along the house's length (x), overhanging a little.
  const rw = w + 0.06;
  const rd = d / 2 + 0.05;
  const rh = d * pitch * 1.6;
  const roofGeo = new THREE.BufferGeometry();
  const v = [
    -rw / 2, 0, -rd, rw / 2, 0, -rd, rw / 2, rh, 0, -rw / 2, rh, 0,
    -rw / 2, 0, rd, -rw / 2, rh, 0, rw / 2, rh, 0, rw / 2, 0, rd,
    -rw / 2, 0, -rd, -rw / 2, rh, 0, -rw / 2, 0, rd,
    rw / 2, 0, -rd, rw / 2, 0, rd, rw / 2, rh, 0,
  ];
  roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  roofGeo.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6, 8, 10, 9, 11, 13, 12]);
  roofGeo.computeVertexNormals();
  roofGeo.translate(0, h, 0);
  parts.push(paint(roofGeo.toNonIndexed(), roof));
  if (style.stepped) {
    // A Dutch stepped gable on the street front.
    for (let i = 0; i < 3; i++) {
      const step = new THREE.BoxGeometry(w * (0.9 - i * 0.28), 0.08, 0.04);
      step.translate(0, h + 0.04 + i * 0.08, d / 2);
      parts.push(paint(step, wall));
    }
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

function paint(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** A church: a nave with a pitched roof and a bell tower with a pointed roof (or a dome, for the Spanish). */
function church(wall: THREE.Color, roof: THREE.Color, dome: boolean): THREE.BufferGeometry {
  const parts = [house(0.9, 0.42, 0.45, wall, roof, { walls: [], roofs: [] })];
  const tower = new THREE.BoxGeometry(0.26, 0.95, 0.26);
  tower.translate(-0.42, 0.475, 0);
  parts.push(paint(tower, wall));
  const top = dome ? new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2) : new THREE.ConeGeometry(0.2, 0.4, 4);
  if (!dome) top.rotateY(Math.PI / 4);
  top.translate(-0.42, dome ? 0.95 : 1.15, 0);
  parts.push(paint(top, dome ? new THREE.Color('#d9b24a') : roof));
  return mergeGeometries(parts)!;
}

/** A fort: four walls round a court with a bastion at each corner, cannons on the walls; `scale` by strength. */
function fort(scale: number, stone: THREE.Color, timber: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const side = 1.3 * scale;
  const h = timber ? 0.3 : 0.38;
  const t = 0.16;
  for (const [x, z, w, d] of [
    [0, -side / 2, side, t],
    [0, side / 2, side, t],
    [-side / 2, 0, t, side],
    [side / 2, 0, t, side],
  ] as const) {
    const wall = new THREE.BoxGeometry(w, h, d);
    wall.translate(x, h / 2, z);
    parts.push(paint(wall, stone));
  }
  if (!timber) {
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      // A bastion: a diamond of stone at the corner, a little higher than the walls.
      const b = new THREE.CylinderGeometry(0.3 * scale, 0.34 * scale, h + 0.06, 4);
      b.rotateY(Math.PI / 4);
      b.translate((x * side) / 2, (h + 0.06) / 2, (z * side) / 2);
      parts.push(paint(b, stone.clone().multiplyScalar(0.92)));
      // Cannons on the bastion, pointing out.
      for (const a of [-0.35, 0.35]) {
        const gun = new THREE.CylinderGeometry(0.025, 0.03, 0.22, 6);
        gun.rotateZ(Math.PI / 2);
        const dir = new THREE.Vector2(x, z).normalize().rotateAround(new THREE.Vector2(), a);
        gun.rotateY(-Math.atan2(dir.y, dir.x));
        gun.translate((x * side) / 2 + dir.x * 0.3 * scale, h + 0.1, (z * side) / 2 + dir.y * 0.3 * scale);
        parts.push(paint(gun, new THREE.Color('#1f1d1c')));
      }
    }
    // The keep in the court.
    const keep = new THREE.BoxGeometry(0.42 * scale, 0.5, 0.42 * scale);
    keep.translate(0, 0.25, 0);
    parts.push(paint(keep, stone.clone().multiplyScalar(1.05)));
  }
  return mergeGeometries(parts)!;
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
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  const flags: { update(t: number): void }[] = [];
  const pierMat = new THREE.MeshStandardMaterial({ color: '#7a5a3c', roughness: 0.9 });
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
    const parts: THREE.BufferGeometry[] = [];
    const place = (g: THREE.BufferGeometry, x: number, y: number, facing: number) => {
      const ground = Math.max(0.08, heightAt(x, y));
      g.rotateY(facing);
      g.translate(x, ground - 0.02, y);
      parts.push(g);
    };
    const facing = -Math.atan2(out.y, out.x);
    // Houses: rows up the slope behind the waterfront, the nearest the sea first, jittered.
    const count = (HOUSES[s.size] ?? 12) + (s.type === 'capital' ? 10 : 0);
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 8; tries++) {
      const row = Math.floor(tries / 9);
      const across = ((tries % 9) - 4) * 0.55 * SCALE + (rand() - 0.5) * 0.4;
      const back = 0.5 + row * 0.55 * SCALE + rand() * 0.25;
      const x = front.x - out.x * back + along.x * across;
      const y = front.y - out.y * back + along.y * across;
      const g = heightAt(x, y);
      if (g < 0.12 || g > 3.5) continue;
      const wall = new THREE.Color(style.walls[Math.floor(rand() * style.walls.length)]!);
      const roof = new THREE.Color(style.roofs[Math.floor(rand() * style.roofs.length)]!);
      const big = style.shacks ? 0.75 : 1;
      const k = big * SCALE;
      place(house((0.36 + rand() * 0.24) * k, (0.3 + rand() * 0.14) * k, (0.26 + rand() * 0.18) * k, wall, roof, style), x, y, facing + (rand() - 0.5) * 0.3);
      placed++;
    }
    if (s.size !== 'hamlet' && !style.shacks) {
      // The church up the slope, and the governor's house beside it.
      const cx = front.x - out.x * 2.4 + along.x * 1.0;
      const cy = front.y - out.y * 2.4 + along.y * 1.0;
      const ch = church(new THREE.Color(style.walls[0]!), new THREE.Color(style.roofs[0]!), s.nation === 'spain' || s.nation === 'france');
      ch.scale(SCALE, SCALE, SCALE);
      place(ch, cx, cy, facing + Math.PI / 2);
      place(house(0.8 * SCALE, 0.55 * SCALE, 0.52 * SCALE, new THREE.Color('#f8f4ea'), new THREE.Color(style.roofs[0]!), style), front.x - out.x * 2 - along.x * 1.5, front.y - out.y * 2 - along.y * 1.5, facing);
    }
    // A town on ground too small or steep for houses keeps its fort, pier and name.
    if (parts.length) {
      const mesh = new THREE.Mesh(mergeGeometries(parts)!, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      town.add(mesh);
    }

    // The fort on the waterfront to one side, sized by the town's strength; a palisade at a pirate haven.
    if (s.size !== 'hamlet') {
      const strength = (s.type === 'capital' ? 1.25 : s.size === 'city' ? 1.05 : 0.8) * 1.4;
      const g = fort(strength, new THREE.Color(style.shacks ? '#6e5236' : '#b8ad96'), Boolean(style.shacks));
      const fx = front.x + along.x * 3.4 - out.x * 0.6;
      const fy = front.y + along.y * 3.4 - out.y * 0.6;
      g.rotateY(facing);
      g.translate(fx, Math.max(0.08, heightAt(fx, fy)), fy);
      const fortMesh = new THREE.Mesh(g, material);
      fortMesh.castShadow = true;
      town.add(fortMesh);
      const f = flag(s.nation);
      f.mesh.position.set(fx, Math.max(0.08, heightAt(fx, fy)) + 1.0, fy);
      town.add(f.mesh);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 1.2, 6), pierMat);
      pole.position.set(fx, Math.max(0.08, heightAt(fx, fy)) + 0.6, fy);
      town.add(pole);
      flags.push(f);
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
