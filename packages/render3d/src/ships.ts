import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Ships from the class models (tools/art/export_ships_glb.py): each model carries every sail state, its parts
// named `{state}_{part}`; a ship shows one state's canvas at a time, as the 2D renderer picks a sprite row.

const SETTINGS = ['full', 'half'];
const POINTS = ['run', 'broad_s', 'beam_s', 'close_s', 'broad_p', 'beam_p', 'close_p', 'irons_s0', 'irons_s1', 'irons_p0', 'irons_p1'];
/** Sail states, longest first so `full_irons_s0` is matched before anything shorter could be. */
const STATES = ['furled', ...SETTINGS.flatMap((s) => POINTS.map((p) => `${s}_${p}`))].sort((a, b) => b.length - a.length);

export interface ShipModel {
  root: THREE.Object3D;
  /** Show this sail state's canvas (`sail_full_beam_s` or `full_beam_s`), hiding every other state's. */
  setSails(anim: string): void;
}

export async function loadShipModels(urls: Record<string, string>): Promise<Map<string, THREE.Object3D>> {
  const loader = new GLTFLoader();
  const models = new Map<string, THREE.Object3D>();
  await Promise.all(
    Object.entries(urls).map(async ([classId, url]) => {
      const gltf = await loader.loadAsync(url);
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      models.set(classId, gltf.scene);
    }),
  );
  return models;
}

/** A ship of a class, her parts sorted by sail state. */
export function makeShip(model: THREE.Object3D): ShipModel {
  const root = new THREE.Group();
  const hull = model.clone(true);
  root.add(hull);
  const byState = new Map<string, THREE.Object3D[]>();
  hull.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    // The exporter names a mesh after its object, or its object's parent when the mesh is a primitive.
    const name = o.name || o.parent?.name || '';
    const state = STATES.find((s) => name.startsWith(`${s}_`));
    if (!state) return;
    const list = byState.get(state) ?? [];
    list.push(o);
    byState.set(state, list);
    o.visible = false;
  });
  let shown = '';
  return {
    root,
    setSails(anim) {
      const state = anim.replace(/^sail_/, '');
      if (state === shown) return;
      for (const o of byState.get(shown) ?? []) o.visible = false;
      for (const o of byState.get(state) ?? []) o.visible = true;
      shown = state;
    },
  };
}
