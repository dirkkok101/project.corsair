import * as THREE from 'three';
import { treeKit } from './terrain';

/** A hoard's landmark on the coast (treasure.json landmarks), drawn where it stands; a dug pit once found. */
export interface LandmarkSpot {
  id: string;
  x: number;
  y: number;
  /** The landmark as the map names it ("a lone palm", "a wrecked hull", ...). */
  kind: string;
  found?: boolean;
}

/**
 * The treasure maps' landmarks (slice 4 of docs/design/famous-pirates-and-treasure.md): a model for each hoard whose
 * map the captain holds, a little larger than the island's own trees and rocks so a captain who has read the map
 * knows the coast when she sees it. World units are tiles; `heightAt` is the ground's.
 */
export function createLandmarks(heightAt: (x: number, y: number) => number) {
  const kit = treeKit();
  const object = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#4f3b2a', roughness: 0.92, side: THREE.DoubleSide });
  const thatch = new THREE.MeshStandardMaterial({ color: '#8f7a4c', roughness: 1 });
  const dirt = new THREE.MeshStandardMaterial({ color: '#5a4430', roughness: 1 });
  const stone = kit.rockMaterial;
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const palm = (s: number, lean: number) => {
    const g = new THREE.Group();
    g.add(mesh(kit.palmTrunk, kit.barkMaterial), mesh(kit.palmCrown, kit.frondMaterial));
    g.scale.setScalar(s);
    g.rotation.z = lean;
    return g;
  };

  /** The model for a landmark, by the words the map uses. */
  const model = (kind: string): THREE.Object3D => {
    const g = new THREE.Group();
    if (kind.includes('three palms')) {
      for (const i of [-1, 0, 1]) {
        const p = palm(1.5 - Math.abs(i) * 0.1, 0.08 * i);
        p.position.x = i * 0.9;
        g.add(p);
      }
    } else if (kind.includes('palm')) {
      g.add(palm(1.9, 0.12));
    } else if (kind.includes('rock')) {
      // A great rock split down the middle, the halves leaning apart.
      for (const side of [-1, 1]) {
        const half = mesh(new THREE.DodecahedronGeometry(0.8, 0), stone);
        half.scale.set(0.55, 1.4, 1);
        half.position.set(side * 0.5, 0.75, 0);
        half.rotation.z = -side * 0.22;
        g.add(half);
      }
    } else if (kind.includes('hull')) {
      // A hull broken open above the tideline: the keel and the lower planking, her ribs standing up bare above it,
      // heeled over on her side. (A cylinder's x = r sin(theta): its x < 0 side, theta about 1.5 pi, becomes the
      // bottom once the axis is turned to lie along x.)
      const hull = mesh(new THREE.CylinderGeometry(0.42, 0.3, 1.8, 14, 1, true, Math.PI * 1.2, Math.PI * 0.6), wood);
      hull.rotation.z = Math.PI / 2;
      hull.position.y = 0.42;
      g.add(hull);
      const keel = mesh(new THREE.BoxGeometry(2, 0.08, 0.08), wood);
      keel.position.y = 0.02;
      g.add(keel);
      for (let i = 0; i < 6; i++) {
        // A rib: the lower arc of a hoop, open at the top, taller than the planking it held.
        const rib = mesh(new THREE.TorusGeometry(0.44, 0.03, 5, 12, Math.PI * 0.85), wood);
        rib.rotation.set(0, Math.PI / 2, Math.PI + Math.PI * 0.075);
        rib.position.set(-0.75 + i * 0.3, 0.44, 0);
        g.add(rib);
      }
      g.rotation.x = 0.45;
    } else if (kind.includes('hut')) {
      // Four low walls, one fallen in, and what is left of the thatch.
      for (const [x, z, ry, h] of [[0, -0.5, 0, 0.55], [0, 0.5, 0, 0.3], [-0.5, 0, Math.PI / 2, 0.5], [0.5, 0, Math.PI / 2, 0.45]] as const) {
        const wall = mesh(new THREE.BoxGeometry(1, h, 0.08), wood);
        wall.position.set(x, h / 2, z);
        wall.rotation.y = ry;
        g.add(wall);
      }
      const roof = mesh(new THREE.ConeGeometry(0.8, 0.55, 4, 1), thatch);
      roof.position.set(0.15, 0.45, -0.1);
      roof.rotation.set(0.35, Math.PI / 4, 0.2);
      g.add(roof);
    } else {
      // A cairn: stones piled shoulder high.
      let y = 0;
      for (const r of [0.42, 0.34, 0.27, 0.2, 0.14]) {
        const s = mesh(new THREE.DodecahedronGeometry(r, 0), stone);
        s.position.y = y + r * 0.8;
        s.rotation.set(r * 7, r * 11, r * 5);
        y += r * 1.5;
        g.add(s);
      }
    }
    return g;
  };

  /** Where a hoard was dug up: a pit and the spoil heaped beside it. */
  const pit = () => {
    const g = new THREE.Group();
    const hole = mesh(new THREE.CircleGeometry(0.32, 12), new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 1 }));
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(0.9, 0.02, 0.5);
    const spoil = mesh(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), dirt);
    spoil.scale.set(1, 0.5, 1);
    spoil.position.set(1.4, 0, 0.6);
    g.add(hole, spoil);
    return g;
  };

  const shown = new Map<string, { root: THREE.Group; key: string }>();
  return {
    object,
    /** The landmarks to show now; models are built once and kept until their spot goes. */
    set(spots: LandmarkSpot[]) {
      const want = new Set<string>();
      for (const s of spots) {
        want.add(s.id);
        const key = `${s.kind}|${s.x}|${s.y}|${Boolean(s.found)}`;
        if (shown.get(s.id)?.key === key) continue;
        const old = shown.get(s.id);
        if (old) object.remove(old.root);
        const root = new THREE.Group();
        root.add(model(s.kind));
        if (s.found) root.add(pit());
        root.position.set(s.x, Math.max(0.05, heightAt(s.x, s.y)) - 0.03, s.y);
        // Its own turn, from where it stands, so two maps' palms don't stand alike.
        root.rotation.y = ((s.x * 12.9898 + s.y * 78.233) % 6.283);
        object.add(root);
        shown.set(s.id, { root, key });
      }
      for (const [id, v] of shown) {
        if (want.has(id)) continue;
        object.remove(v.root);
        shown.delete(id);
      }
    },
  };
}
