import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Ship, Wind, WorldState } from '@corsair/core';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';
import { sailAnim } from '@corsair/render/sails';
import { normalizeDeg } from '@corsair/systems-navigation';
import { createOcean, seaHeight } from './ocean';
import type { SeaState } from './ocean';
import { loadShipModels, makeShip } from './ships';
import type { ShipModel } from './ships';
import { createGround } from './terrain';

// The 3D sea map (art direction: Sid Meier's Pirates! 2004, in HD): the world in map tiles, x east and z south,
// y up; the camera follows the player's ship and zooms from her deck to the whole region (the mouse wheel),
// overhead by default or from astern (C). Only drawing: the simulation, input and UI are the game's.

/** One model unit in tiles, so a ship stands as big as her 2D sprite (96 px over 3.7 units, 24 px a tile). */
const MODEL_SCALE = 96 / 3.7 / 24;
/** Camera distance from the ship, in tiles: from close aboard to the whole region. */
const ZOOM = { min: 6, max: 420, start: 22 };
/** Clouds show from this camera distance out, fully by the second (close in, they'd smear across the view). */
const CLOUDS_FROM = [70, 160];
/** Town names show within this many tiles of the camera's target. */
const NAMES_WITHIN = 160;
/** Far out, ships grow so they stay readable (as Pirates! draws them), up to this many times life. */
const FAR_SHIP_SCALE = 4;
const TOWN_COUNT: Record<string, number> = { hamlet: 4, town: 9, city: 16 };
const PENNANT: Record<string, string> = { spain: '#e8c170', england: '#a53030', france: '#ebede9', netherlands: '#de9e41', pirate: '#090a14' };

export interface SeaRenderer {
  canvas: HTMLCanvasElement;
  /** Draws the sea map for this state; `hour` is the time of day (0-24), `nowMs` the frame time. */
  render(state: WorldState, nowMs: number, hour: number): void;
  /** CSS size of the view; the canvas renders at the device's pixel ratio. */
  resize(width: number, height: number): void;
  /** Zoom by wheel steps (positive out). */
  zoom(steps: number): void;
  /** Overhead or from astern. */
  toggleChase(): void;
}

export async function createSeaRenderer(
  content: ContentPack,
  map: TileMap,
  options: {
    playerId: string;
    settlements: PlacedSettlement[];
    windAt: (state: WorldState, x: number, y: number) => Wind;
    /** Ship models by class id (ship.brig), as URLs of their glTF files. */
    models: Record<string, string>;
  },
): Promise<SeaRenderer> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'sea3d';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 4000);

  // Sky and light: a clear Caribbean sky, the sun (with a shadow near the player), a soft fill from the sky.
  const sky = new Sky();
  sky.scale.setScalar(3000);
  const su = sky.material.uniforms as Record<string, THREE.IUniform>;
  su.turbidity!.value = 2.2;
  su.rayleigh!.value = 1.1;
  su.mieCoefficient!.value = 0.004;
  su.mieDirectionalG!.value = 0.8;
  scene.add(sky);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -30;
  sc.right = sc.top = 30;
  sc.near = 1;
  sc.far = 400;
  scene.add(sun, sun.target);
  const fill = new THREE.HemisphereLight('#bfe3ff', '#2f6f6a', 0.9);
  scene.add(fill);

  const ground = createGround(map);
  for (const m of ground.meshes) scene.add(m);
  const ocean = createOcean(ground.depth, map.width, map.height);
  scene.add(ocean.mesh);

  // Towns: white walls and terracotta roofs on the shore, a fort for the bigger ones, their flag and name.
  const wall = new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.9 });
  const roof = new THREE.MeshStandardMaterial({ color: '#b5533c', roughness: 0.8 });
  const stone = new THREE.MeshStandardMaterial({ color: '#9a8f80', roughness: 1 });
  const houseGeo = new THREE.BoxGeometry(0.5, 0.35, 0.5);
  const roofGeo = new THREE.ConeGeometry(0.42, 0.3, 4);
  roofGeo.rotateY(Math.PI / 4);
  const names: { sprite: THREE.Sprite; x: number; y: number }[] = [];
  for (const s of options.settlements) {
    const town = new THREE.Group();
    const base = Math.max(0.2, ground.heightAt(s.x, s.y));
    town.position.set(s.x, base, s.y);
    const n = TOWN_COUNT[s.size] ?? 6;
    // Houses on a loose spiral, the same layout every visit (seeded by the town's place).
    for (let i = 0; i < n; i++) {
      const a = i * 2.4 + s.x;
      const r = 0.35 + 0.42 * Math.sqrt(i);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const lift = Math.max(0.2, ground.heightAt(s.x + x, s.y + z)) - base;
      const house = new THREE.Mesh(houseGeo, wall);
      house.position.set(x, lift + 0.17, z);
      house.castShadow = true;
      const top = new THREE.Mesh(roofGeo, roof);
      top.position.set(x, lift + 0.49, z);
      town.add(house, top);
    }
    if (s.size !== 'hamlet') {
      const fort = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.45, 1.4), stone);
      fort.position.set(1.5, 0.22, 1.2);
      fort.castShadow = true;
      town.add(fort);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6), stone);
    pole.position.set(0, 0.8, 0);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshBasicMaterial({ color: PENNANT[s.nation] ?? '#ffffff', side: THREE.DoubleSide }));
    flag.position.set(0.25, 1.45, 0);
    town.add(pole, flag);
    const name = label(s.name ?? s.id, PENNANT[s.nation] ?? '#ffffff');
    town.add(name);
    names.push({ sprite: name, x: s.x, y: s.y });
    scene.add(town);
  }

  // Clouds: soft white puffs drifting downwind (Pirates!: white clouds are wind, dark ones a storm).
  const puff = puffTexture();
  const cloudMat = new THREE.SpriteMaterial({ map: puff, transparent: true, depthWrite: false, opacity: 0.85, fog: false });
  const clouds: THREE.Sprite[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 520; i++) {
    const c = new THREE.Sprite(cloudMat);
    const s = 10 + rand() * 18;
    c.scale.set(s * 1.6, s, 1);
    c.position.set(rand() * map.width, 50 + rand() * 14, rand() * map.height);
    clouds.push(c);
    scene.add(c);
  }

  const models = await loadShipModels(options.models);
  const ships = new Map<string, ShipModel & { classId: string }>();
  const shipFor = (s: Ship) => {
    let m = ships.get(s.id);
    if (m && m.classId !== s.classId) {
      scene.remove(m.root);
      m = undefined;
    }
    if (!m) {
      const model = models.get(s.classId) ?? models.get('ship.brig')!;
      m = { ...makeShip(model), classId: s.classId };
      ships.set(s.id, m);
      scene.add(m.root);
    }
    return m;
  };

  let distance = ZOOM.start;
  let chase = false;
  const target = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const light = { sunDir, sun: new THREE.Color(), sky: new THREE.Color(), level: 1, fog: new THREE.Color(), fogDensity: 0.002 };
  const strengthOf = (w: Wind) => content.navigation.windStrength[w.strength] ?? 0.8;
  let lastMs = 0;

  const render = (state: WorldState, nowMs: number, hour: number) => {
    const t = nowMs / 1000;
    const dt = lastMs ? Math.min(0.1, (nowMs - lastMs) / 1000) : 0;
    lastMs = nowMs;
    const me = state.ships[options.playerId];
    if (!me) return;
    const wind = options.windAt(state, me.x, me.y);
    const sea: SeaState = { toDeg: normalizeDeg(wind.fromDeg + 180), strength: strengthOf(wind) };

    // Time of day: the sun's arc from 6 to 18, a low blue moon at night.
    const day = Math.sin(((hour - 6) / 12) * Math.PI);
    const elevation = Math.max(-0.15, day) * 70;
    const azimuth = ((hour - 6) / 12) * 180 + 90;
    sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - Math.max(elevation, 4)), THREE.MathUtils.degToRad(azimuth));
    su.sunPosition!.value.copy(sunDir);
    // Night is moonlit and readable, not black.
    const level = THREE.MathUtils.clamp(0.42 + day * 0.7, 0.42, 1);
    light.level = level;
    light.sun.set(day > 0.25 ? '#fff4d6' : day > 0 ? '#ffb070' : '#8aa4ff').multiplyScalar(day > 0 ? 1 : 0.3);
    light.sky.set(day > 0.2 ? '#9fd3f0' : day > 0 ? '#e8a87c' : '#2c4670');
    light.fog.copy(light.sky).lerp(new THREE.Color('#ffffff'), day > 0.2 ? 0.25 : 0);
    sun.intensity = day > 0 ? day * 2.6 : 0.5;
    sun.color.copy(light.sun);
    fill.intensity = 0.35 + level * 0.6;
    renderer.toneMappingExposure = 0.55 + level * 0.4;
    light.fogDensity = 0.0016 * (ZOOM.start / Math.max(ZOOM.start, distance)) ** 0.5;

    // Ships: each at her place, riding the swell, heeled by the wind on her beam, her sails for the wind.
    const farScale = THREE.MathUtils.clamp(distance / 90, 1, FAR_SHIP_SCALE);
    const seen = new Set<string>();
    for (const s of Object.values(state.ships)) {
      const m = shipFor(s);
      seen.add(s.id);
      const w = options.windAt(state, s.x, s.y);
      m.setSails(sailAnim(content, s, w, nowMs));
      const bob = seaHeight(sea, s.x, s.y, t);
      const fore = seaHeight(sea, s.x + Math.sin((s.headingDeg * Math.PI) / 180), s.y - Math.cos((s.headingDeg * Math.PI) / 180), t);
      let rel = normalizeDeg(w.fromDeg - s.headingDeg);
      if (rel > 180) rel -= 360;
      const press = s.sails === 'furled' ? 0 : (s.sails === 'full' ? 1 : 0.6) * strengthOf(w);
      const heel = Math.sin((rel * Math.PI) / 180) * press * 0.14 + Math.sin(t * 1.3 + s.x) * 0.02;
      m.root.position.set(s.x, bob, s.y);
      m.root.rotation.set(0, 0, 0);
      m.root.rotateY((-s.headingDeg * Math.PI) / 180);
      m.root.rotateX((fore - bob) * 0.8);
      m.root.rotateZ(-heel);
      m.root.scale.setScalar(MODEL_SCALE * farScale);
    }
    for (const [id, m] of ships) {
      if (seen.has(id)) continue;
      scene.remove(m.root);
      ships.delete(id);
    }

    // Clouds drift with the wind where the player is, and show only from afar.
    cloudMat.opacity = 0.85 * THREE.MathUtils.smoothstep(distance, CLOUDS_FROM[0]!, CLOUDS_FROM[1]!);
    for (const n of names) n.sprite.visible = Math.hypot(n.x - me.x, n.y - me.y) < NAMES_WITHIN * Math.max(1, distance / 120);
    const drift = strengthOf(wind) * 1.6 * dt;
    const to = ((wind.fromDeg + 180) * Math.PI) / 180;
    for (const c of clouds) {
      c.position.x = (c.position.x + Math.sin(to) * drift + map.width) % map.width;
      c.position.z = (c.position.z - Math.cos(to) * drift + map.height) % map.height;
    }

    // Camera: overhead (steeper the further out) or from astern, following the player.
    target.set(me.x, 0, me.y);
    const zt = Math.log(distance / ZOOM.min) / Math.log(ZOOM.max / ZOOM.min);
    const pitch = THREE.MathUtils.degToRad(chase ? 16 + zt * 30 : 30 + zt * 45);
    const yaw = chase ? (-me.headingDeg * Math.PI) / 180 : 0;
    const back = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(distance);
    back.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    camera.position.copy(target).add(back);
    camera.lookAt(target.x, 0.6, target.z);
    sun.position.copy(target).addScaledVector(sunDir, 200);
    sun.target.position.copy(target);
    ocean.update(target, sea, t, light);
    renderer.render(scene, camera);
  };

  return {
    canvas,
    render,
    resize(width, height) {
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    zoom(steps) {
      distance = THREE.MathUtils.clamp(distance * Math.pow(1.12, steps), ZOOM.min, ZOOM.max);
    },
    toggleChase() {
      chase = !chase;
    },
  };
}

/** A town's name over it, the same size on screen at every zoom. */
function label(text: string, colour: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = '600 44px Georgia, serif';
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + 40;
  c.height = 64;
  ctx.font = font;
  ctx.fillStyle = 'rgba(21, 29, 40, 0.72)';
  ctx.beginPath();
  ctx.roundRect(0, 6, c.width, 52, 10);
  ctx.fill();
  ctx.fillStyle = colour === '#090a14' ? '#d0d0d0' : colour;
  ctx.fillRect(10, 14, 6, 36);
  ctx.fillStyle = '#f4ead2';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 26, 33);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false, depthTest: false, fog: false }));
  sprite.scale.set((c.width / c.height) * 0.034, 0.034, 1);
  sprite.position.set(0, 2.4, 0);
  sprite.renderOrder = 10;
  return sprite;
}

/** A soft cloud puff, drawn once into a canvas. */
function puffTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  const blob = (x: number, y: number, r: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const [x, y, r] of [[80, 95, 55], [130, 75, 62], [180, 95, 50], [110, 110, 48], [160, 115, 44]] as const) blob(x, y, r);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
