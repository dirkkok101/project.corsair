import * as THREE from 'three';
import { RIGS } from './rigs';
import { buildShip } from './shipyard';

/**
 * A ship class's card portrait, drawn from her 3D model (tools/art/render_ship_cards.ts): alone in side view facing
 * right, sails set full, no colours flying, on flat magenta for the UI importer to key out, as the painted cards
 * were briefed. Returns the canvas, drawn once.
 */
export function renderShipCard(classId: string, width: number, height: number): HTMLCanvasElement {
  const plan = RIGS[classId];
  if (!plan) throw new Error(`no rig for ${classId}`);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(1);
  renderer.setClearColor('#ff00ff');

  const scene = new THREE.Scene();
  // Lit softly from the upper left, as the painted cards are.
  scene.add(new THREE.HemisphereLight('#fff4e0', '#3a2a1c', 1.6));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
  sun.position.set(6, 10, 8);
  scene.add(sun);

  const built = buildShip(plan, 'england');
  built.setSails('full', 'beam', 1, 0);
  built.root.traverse((o) => {
    if (o.name === 'ensign' || o.name === 'pennant') o.visible = false;
  });
  scene.add(built.root);
  built.root.updateMatrixWorld(true);

  // Her bow is -z: a camera off her starboard side (+x) sees it to the right; a touch above her rail, fitted to her.
  const box = new THREE.Box3().setFromObject(built.root);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(20, width / height, 0.1, 200);
  const fit = Math.max(size.y, size.z / camera.aspect) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(centre.x + fit * 1.15, centre.y + fit * 0.12, centre.z);
  camera.lookAt(centre);
  renderer.render(scene, camera);
  return renderer.domElement;
}
