import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Ship, Wind, WorldState } from '@corsair/core';
import { shipStats } from '@corsair/data';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';
import type { BattleViewState } from './battleView';

export type { BattleViewPlace, BattleViewShip, BattleViewState } from './battleView';
import { sailAnim } from './sails';
import { normalizeDeg } from '@corsair/systems-navigation';
import { CLOUD_SPEED, createOcean } from './sea/ocean';
import type { SeaState, WakeShip } from './sea/ocean';
import { RIGS } from './rigs';
import { buildShip, flagTexture, makeFlag, SAIL_GLOW, WINDOW_GLOW } from './shipyard';
import type { BuiltShip, ShipPlan } from './shipyard';
import { createBattleFx, fallSide, MAST_FALL_SECONDS } from './battle';
import { createStorm } from './storm';
import type { SprayShip } from './storm';
import type { BattleHull } from './battle';
import { createLandmarks } from './landmarks';
import { createWildlife } from './wildlife';
import type { WildlifeKind, WildlifeSound } from './wildlife';
import { createTowns, TOWN_GLOW, TOWN_RADIUS } from './towns';
import { createGround } from './terrain';
import { createSky } from './sky';

// The 3D sea map (art direction: Sid Meier's Pirates! 2004, in HD): the world in map tiles, x east and z south,
// y up; the camera follows the player's ship and zooms from her deck to the whole region (the mouse wheel),
// overhead by default or from astern (C). Only drawing: the simulation, input and UI are the game's.

/**
 * Ships are drawn larger than the map's own proportion (Pirates! 2004 draws a ship nearly the size of a small
 * island): this many times her 2D sprite's size. Drawing only; the world and its distances are unchanged.
 */
const SHIP_SCALE = 1.6;
/** One model unit in tiles: a ship as big as her 2D sprite (96 px over 3.7 units, 24 px a tile), times SHIP_SCALE. */
const MODEL_SCALE = (96 / 3.7 / 24) * SHIP_SCALE;
/** Camera distance from the ship, in tiles: from close aboard to the whole region. */
const ZOOM = { min: 9, max: 420, start: 32 };
/** Clouds show from this camera distance out, fully by the second (close in, they'd smear across the view). */
const CLOUDS_FROM = [70, 160];
/** Town names show within this many tiles of the camera's target. */
const NAMES_WITHIN = 160;
/** Far out, ships grow so they stay readable (as Pirates! draws them), up to this many times life. */
const FAR_SHIP_SCALE = 4;
/** A ship's length in tiles at model scale (the brig's hull, 2.4 model units). */
const SHIP_LENGTH = 2.4 * MODEL_SCALE;
/** How fast a ship eases into the swell's pitch and roll (per second): slow, so she rocks rather than bounces. */
const RIDE_EASE = 1.1;
/** A fast ship's speed in speed points, for how hard a ship heels in a turn. */
const FAST_SHIP = 7;
/** The speed in speed points at which the water round a ship is at its whitest (an ordinary good pace). */
const BRISK = 4.5;
/** The battle camera's distance in tiles: no nearer or further than this, whatever the zoom. */
const BATTLE_VIEW = { min: 6, max: 90 };
/**
 * In battle ships are drawn at their true size (the map's 1.6x enlargement would make them dwarf the fight:
 * broadsides from barely a ship's length apart), so they trade shots across a few lengths of sea, as in Pirates!.
 */
const BATTLE_MODEL_SCALE = MODEL_SCALE / SHIP_SCALE;
/**
 * A ship heels outward as she turns (Pirates! 2004: her masts lean well over in a hard turn and come upright as
 * she steadies): this many radians at full speed in a turn this fast (degrees a second) or faster, easing in
 * over about half a second.
 */
const TURN_HEEL = 0.28;
const TURN_FULL_DEG = 30;
const TURN_EASE = 2.5;
/** A sunk ship takes this long to go under. */
const SINK_SECONDS = 6;

/**
 * The sky keeps its own slow day, not the game clock's (a game day passes in under half a minute): a long
 * bright day, golden sunrise and sunset, a short moonlit night (docs/reference/pirates-3d-style.md). Each
 * phase: real seconds at sea, and the hours it shows.
 */
const SKY_PHASES: [number, number, number][] = [
  [120, 5, 8],
  [840, 8, 16.5],
  [120, 16.5, 19.5],
  [120, 19.5, 29],
];
const SKY_CYCLE = SKY_PHASES.reduce((n, [s]) => n + s, 0);
/** The sky starts mid-morning. */
const SKY_START = 300;

function skyHour(seconds: number): number {
  let s = seconds % SKY_CYCLE;
  for (const [length, from, to] of SKY_PHASES) {
    if (s < length) return (from + ((to - from) * s) / length) % 24;
    s -= length;
  }
  return 12;
}

const DAY_SUN = new THREE.Color('#fff4d6');
const GOLD_SUN = new THREE.Color('#ffa860');
const MOON = new THREE.Color('#8aa4ff');
const DAY_SKY = new THREE.Color('#9fd3f0');
const GOLD_SKY = new THREE.Color('#f2a679');
const NIGHT_SKY = new THREE.Color('#2c4670');
const DAY_ZENITH = new THREE.Color('#2f7fcf');
const GOLD_ZENITH = new THREE.Color('#5568a8');
const NIGHT_ZENITH = new THREE.Color('#0d1a33');
// Overcast and storm (Black Flag: a lid of grey cloud, flat grey-green light, the horizon closing in).
const STORM_HORIZON = new THREE.Color('#6f7a80');
const STORM_ZENITH = new THREE.Color('#3b434b');
const STORM_SUN = new THREE.Color('#c9d0d4');
/**
 * How overcast the weather makes it, 0 clear .. 1 a storm: by the wind's strength where the camera is, and
 * deepest inside a storm (and closing in as one nears, from half again its radius).
 */
const GLOOM_BY_WIND: Record<string, number> = { calm: 0, light: 0, fresh: 0.12, strong: 0.4, gale: 0.7 };
/** How fast the sky clouds over or clears, per second: a squall rolls in over some seconds, not in a frame. */
const GLOOM_EASE = 0.35;
const PENNANT: Record<string, string> = { spain: '#e8c170', england: '#a53030', france: '#ebede9', netherlands: '#de9e41', pirate: '#090a14' };

export interface SeaRenderer {
  canvas: HTMLCanvasElement;
  /** Called at each lightning strike, with the thunder's delay (seconds, longer the further off it struck). */
  onLightning(cb: (delayS: number) => void): void;
  /** Draws the sea map for this state; `nowMs` is the frame time (the sky keeps its own slow day). */
  render(state: WorldState, nowMs: number): void;
  /** Draws the sea battle (on the same sea: its positions are world tiles); `enemyNation` flies her colours. */
  renderBattle(view: BattleViewState, nowMs: number, enemyNation?: string, enemyFamous?: string): void;
  /** CSS size of the view; the canvas renders at the device's pixel ratio. */
  resize(width: number, height: number): void;
  /** Zoom by wheel steps (positive out); one zoom for the sea and its battles. */
  zoom(steps: number): void;
  /** Overhead or from astern. */
  toggleChase(): void;
  /** Which way is up the screen (degrees clockwise from north): 0 overhead, her heading from astern. */
  viewDeg(): number;
  /** Sets the sky to an hour of its day (for reviewing sunrise, sunset and night). */
  setSkyHour(hour: number): void;
  /**
   * The point on the sea under a spot on the canvas (CSS pixels from its top left), in the tiles the last frame drew
   * (world tiles at sea and in battle alike); undefined above the horizon.
   */
  pick(px: number, py: number): { x: number; y: number } | undefined;
  /** Where a point on the sea (tiles) lies on the canvas, in CSS pixels; undefined behind the camera. */
  project(x: number, y: number): { px: number; py: number } | undefined;
  /** The stretch of sea in view, in tiles (the corners picked; the horizon clamps a view from astern). */
  viewBox(): { x: number; y: number; w: number; h: number };
  /** Debug: start a sea-life event now, by the player's ship, and count the animals out. */
  wildlife: { spawn(kind: WildlifeKind): void; readonly count: number };
  /** Two other ships firing on each other at (x, y) tiles: a bank of gun smoke there, drifting and thinning. */
  seaFight(x: number, y: number): void;
  /** The plotted route to the destination (waypoints after the ship, tiles), drawn on the sea until cleared. */
  guide(points: [number, number][] | undefined): void;
  /** For review: a row of these classes under sail, abeam of the player, drawn only (not in the world). */
  showcase(classIds: string[], state: WorldState): void;
}

export async function createSeaRenderer(
  content: ContentPack,
  map: TileMap,
  options: {
    playerId: string;
    settlements: PlacedSettlement[];
    windAt: (state: WorldState, x: number, y: number) => Wind;
    /** A town's line under its name ("Prosperous English Capital"), from the game's state. */
    townLine?: (s: PlacedSettlement, state: WorldState) => string;
    /**
     * For review, what to draw on the sea (`?sea=`): "plain" alone is the bare water; add layers by name to
     * bring them back (flecks, shadows, ripples, surf, swell, clouds, wakes). Unset, everything.
     */
    sea?: string[];
    /** Sea life's sounds (dolphins, gulls, a whale blowing); omit for silence. */
    sound?: WildlifeSound;
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
  scene.background = new THREE.Color();
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 4000);
  // Mouse picks: a ray from the camera onto the sea's mean level.
  const pickRay = new THREE.Raycaster();
  const SEA_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  // The finished image: soft bloom on sun, sails and foam (Pirates!'s glow), anti-aliased, tone-mapped last.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1920, 1080), 0.22, 0.45, 0.94);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass());

  // Sky and light: a clear Caribbean sky, the sun (with a shadow near the player), a soft fill from the sky.
  const sky = createSky();
  scene.add(sky.mesh);
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

  const ground = createGround(map, options.settlements.map((s) => ({ x: s.x, y: s.y, r: TOWN_RADIUS[s.size] ?? 3.5 })));
  scene.add(ground.object);
  const shown = (layer: string) => !options.sea?.includes('plain') || options.sea.includes(layer);
  const ocean = createOcean(ground.depth, map.width, map.height, shown);
  scene.add(ocean.mesh);

  // Towns: houses in the nation's style up from the shore, a church, a fort with its flag, a pier; the name over it.
  const names: { sprite: THREE.Sprite; x: number; y: number; s: PlacedSettlement; banner: Banner; inRange: boolean; shown: number }[] = [];
  const towns = createTowns(options.settlements, ground.heightAt, makeFlag, (s) => {
    const banner = createBanner(s.name ?? s.id, s.nation);
    names.push({ sprite: banner.sprite, x: s.x, y: s.y, s, banner, inRange: false, shown: 0 });
    return banner.sprite;
  });
  let bannersAt = -Infinity;
  scene.add(towns.object);
  // The treasure maps' landmarks on their coasts (and a dug pit once a hoard is found).
  const landmarks = createLandmarks(ground.heightAt);
  scene.add(landmarks.object);

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

  const worldShips = new THREE.Group();
  scene.add(worldShips);
  // The course to the destination: a gold line on the water from her bow along the route, over the waves.
  // A fat line (pixels wide at any zoom, which plain WebGL lines can't be), drawn over the waves.
  const guideMaterial = new LineMaterial({ color: '#e8c170', linewidth: 3, dashed: true, dashSize: 0.8, gapSize: 0.5, transparent: true, opacity: 0.9, depthTest: false });
  const guideLine = new Line2(new LineGeometry(), guideMaterial);
  guideLine.renderOrder = 10;
  guideLine.frustumCulled = false;
  scene.add(guideLine);
  let guidePoints: [number, number][] | undefined;
  /** A famous pirate's own flag (pirates.json), by her id. */
  const famousFlag = (id?: string) => (id ? content.pirates.captains.find((c) => c.id === id)?.flag : undefined);
  // Gun smoke where other ships fight within sight: puffs that swell, rise and thin over SMOKE_SECONDS.
  const SMOKE_SECONDS = 5;
  const smokeLayer = new THREE.Group();
  scene.add(smokeLayer);
  // Sea life about her: dolphins, flying fish, a whale, gulls near land.
  const wildlife = createWildlife(ground.heightAt, options.sound ?? (() => {}));
  scene.add(wildlife.object);
  const smokes: { sprite: THREE.Sprite; at: number; size: number; drift: number }[] = [];
  let smokeClock = 0;
  const ships = new Map<string, { root: THREE.Object3D; setSails(anim: string): void; setCrew(share: number): void; built: BuiltShip; holes: number; classId: string }>();
  const shipFor = (s: Ship) => {
    let m = ships.get(s.id);
    if (m && m.classId !== s.classId) {
      worldShips.remove(m.root);
      m = undefined;
    }
    if (!m) {
      // Built in code from her class's plan (cloth sails, her nation's colours).
      // A famous pirate flies her own flag.
      const built = buildShip(RIGS[s.classId] ?? RIGS['ship.brig']!, s.ai?.nation ?? 'player', famousFlag(s.ai?.famous));
      m = {
        root: built.root,
        setSails: (anim: string) => built.setSails(...sailsOf(anim), lastMs),
        setCrew: (share: number) => built.setCrew(share, lastMs),
        built,
        holes: 0,
        classId: s.classId,
      };
      ships.set(s.id, m);
      worldShips.add(m.root);
    }
    return m;
  };

  let distance = ZOOM.start;
  let chase = false;
  /** The heading the camera from astern looks along (the player's, at sea or in battle). */
  let viewHeading = 0;
  const target = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const zenith = new THREE.Color();
  const light = {
    sunDir,
    sun: new THREE.Color(),
    power: 2,
    sky: new THREE.Color(),
    zenith,
    ambient: new THREE.Color(),
    level: 1,
    overcast: 0,
    fog: new THREE.Color(),
    fogDensity: 0.002,
  };
  const strengthOf = (w: Wind) => content.navigation.windStrength[w.strength] ?? 0.8;
  let lastMs = 0;
  let skySeconds = SKY_START;
  /** The weather's overcast, eased toward `gloomWant`. */
  let gloom = 0;
  let gloomWant = 0;
  let gloomSeen = false;
  // Each ship's ride: her height on the swell and her pitch and roll, eased toward the sea's each frame.
  const rides = new Map<string, { bob: number; pitch: number; roll: number; lean: number; heading: number }>();

  /** The frame's clock and the hour's light: sun, sky, sea and sails blend smoothly by the sun's height. */
  const beginFrame = (nowMs: number, view: number) => {
    const dt = lastMs ? Math.min(0.1, (nowMs - lastMs) / 1000) : 0;
    lastMs = nowMs;
    skySeconds += dt;
    const hour = skyHour(skySeconds);
    // The weather's overcast, easing in and out (the first frame takes it as it is).
    gloom = gloomSeen ? gloom + (gloomWant - gloom) * (1 - Math.exp(-dt * GLOOM_EASE)) : gloomWant;
    gloomSeen = true;
    const g = THREE.MathUtils.smoothstep(gloom, 0, 1);
    light.overcast = g;
    // The sun's arc from 6 to 18; golden low, moonlit blue at night.
    const e = Math.sin(((hour - 6) / 12) * Math.PI);
    const dayness = THREE.MathUtils.smoothstep(e, 0.05, 0.4);
    const night = 1 - THREE.MathUtils.smoothstep(e, -0.14, 0.02);
    const elevation = Math.max(4, e * 70);
    const azimuth = ((hour - 6) / 12) * 180 + 90;
    sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
    // Bright through the golden hours (a Technicolor sunset, not a dim one); a readable moonlit night.
    const level = THREE.MathUtils.lerp(0.55, 1, THREE.MathUtils.smoothstep(e, -0.12, 0.08));
    light.level = level;
    light.sun.copy(GOLD_SUN).lerp(DAY_SUN, dayness).lerp(MOON.clone().multiplyScalar(0.6), night);
    light.sky.copy(GOLD_SKY).lerp(DAY_SKY, dayness).lerp(NIGHT_SKY, night);
    // The dome: deep blue overhead, the horizon in the hour's colour.
    zenith.copy(GOLD_ZENITH).lerp(DAY_ZENITH, dayness).lerp(NIGHT_ZENITH, night);
    // Overcast: the sky greys toward a lid of cloud (darker by night), the sun turns pale and weak behind it.
    const dim = THREE.MathUtils.lerp(0.35, 1, level);
    light.sky.lerp(STORM_HORIZON.clone().multiplyScalar(dim), g * 0.9);
    zenith.lerp(STORM_ZENITH.clone().multiplyScalar(dim), g * 0.9);
    light.sun.lerp(STORM_SUN.clone().multiplyScalar(dim), g * 0.8);
    light.fog.copy(light.sky).lerp(new THREE.Color('#ffffff'), 0.08 * dayness * (1 - g));
    (scene.background as THREE.Color).copy(light.sky);
    sun.intensity = THREE.MathUtils.lerp(0.9, 2.6, THREE.MathUtils.smoothstep(e, -0.05, 0.12)) * (1 - 0.72 * g);
    sun.color.copy(light.sun);
    // Sails catch the light: a touch of the sky's colour in their glow (lavender and gold at dusk, blue at night).
    SAIL_GLOW.set('#fffaf0').lerp(light.sky, 0.18 + 0.3 * (1 - dayness)).lerp(light.sun, 0.12);
    // Lamps lit in the stern windows as the day goes: dark by day, warm at dusk and by night.
    TOWN_GLOW.set('#ffb35c').multiplyScalar(1.4 * (1 - THREE.MathUtils.smoothstep(e, -0.05, 0.25)));
    WINDOW_GLOW.set('#ffb35c').multiplyScalar(1.6 * (1 - THREE.MathUtils.smoothstep(e, -0.05, 0.25)) + 0.15 * g);
    fill.intensity = (0.55 + level * 0.5) * (1 - 0.25 * g);
    fill.color.copy(light.sky).lerp(new THREE.Color('#ffffff'), 0.4);
    // The water is lit as the scene is: the sun's power, and the sky's light over it.
    light.power = sun.intensity;
    light.ambient.copy(fill.color).multiplyScalar(fill.intensity);
    renderer.toneMappingExposure = (0.7 + level * 0.3) * (1 - 0.12 * g);
    // The horizon closes in under the cloud, and the clouds themselves darken.
    light.fogDensity = 0.0016 * (ZOOM.start / Math.max(ZOOM.start, view)) ** 0.5 * (1 + 2.2 * g);
    cloudMat.color.setScalar(1 - 0.55 * g);
    sky.setOvercast(g, nowMs / 1000);
    return dt;
  };

  /**
   * A ship at her place, riding the swell under her whole hull (so she rides it rather than every ripple),
   * heeled by the wind on her beam. Returns her drawn length.
   */
  const placeShip = (
    id: string,
    root: THREE.Object3D,
    s: { x: number; y: number; headingDeg: number; sails: string },
    w: Wind,
    dt: number,
    scale: number,
    /** Her speed as a share of a fast ship's (0..1): she heels in a turn only as hard as she is going. */
    pace: number,
    model = MODEL_SCALE,
  ) => {
    const len = SHIP_LENGTH * scale;
    const r = (s.headingDeg * Math.PI) / 180;
    const fx = Math.sin(r);
    const fz = -Math.cos(r);
    const at = (along: number, abeam: number) => ocean.heightAt(s.x + fx * along - fz * abeam, s.y + fz * along + fx * abeam);
    const bow = at(len * 0.4, 0);
    const stern = at(-len * 0.4, 0);
    const port = at(0, -len * 0.12);
    const starboard = at(0, len * 0.12);
    let rel = normalizeDeg(w.fromDeg - s.headingDeg);
    if (rel > 180) rel -= 360;
    const press = s.sails === 'furled' ? 0 : (s.sails === 'full' ? 1 : 0.6) * strengthOf(w);
    const heel = Math.sin((rel * Math.PI) / 180) * press * 0.12;
    const ride = rides.get(id) ?? { bob: 0, pitch: 0, roll: 0, lean: 0, heading: s.headingDeg };
    const ease = 1 - Math.exp(-dt * RIDE_EASE);
    ride.bob += ((bow + stern + port + starboard) / 4 - ride.bob) * ease;
    ride.pitch += (Math.atan2(bow - stern, len * 0.8) - ride.pitch) * ease;
    ride.roll += (Math.atan2(starboard - port, len * 0.24) * 0.5 + heel - ride.roll) * ease;
    // Turning to starboard (heading rising) she leans out to port, and the other way round; positive roll is
    // to port, as for the wind on her starboard side.
    const turned = ((s.headingDeg - ride.heading + 540) % 360) - 180;
    ride.heading = s.headingDeg;
    const rate = dt > 0 ? turned / dt : 0;
    // Even a ship at a modest pace leans well over in a hard turn (the square root keeps it readable).
    const lean = THREE.MathUtils.clamp(rate / TURN_FULL_DEG, -1, 1) * Math.sqrt(THREE.MathUtils.clamp(pace, 0, 1)) * TURN_HEEL;
    ride.lean += (lean - ride.lean) * (1 - Math.exp(-dt * TURN_EASE));
    rides.set(id, ride);
    root.position.set(s.x, ride.bob, s.y);
    root.rotation.set(0, 0, 0);
    root.rotateY(-r);
    root.rotateX(ride.pitch);
    // A positive turn about her fore-and-aft axis lays her masts over to port (her local -x).
    root.rotateZ(ride.roll + ride.lean);
    root.scale.setScalar(model * scale);
    return len;
  };

  const bannerAt = new THREE.Vector3();
  const viewSize = new THREE.Vector2();
  /**
   * Town banners never overlap (they are drawn the same size at every zoom, so from afar neighbours would pile
   * up): the most important are placed first (capitals, then cities and towns, nearer ones first), and one that
   * would cover a banner already placed fades out until there is room for it again.
   */
  const declutterBanners = (dt: number) => {
    camera.updateMatrixWorld();
    renderer.getSize(viewSize);
    const unit = (camera.projectionMatrix.elements[5]! * viewSize.y) / 2;
    const rank = (s: PlacedSettlement) => (s.type === 'capital' ? 4 : s.size === 'city' ? 3 : s.size === 'hamlet' ? 1 : 2);
    const placed: [number, number, number, number][] = [];
    const order = names
      .filter((n) => n.inRange)
      .sort((a, b) => rank(b.s) - rank(a.s) || Math.hypot(a.x - target.x, a.y - target.z) - Math.hypot(b.x - target.x, b.y - target.z));
    const keep = new Set<(typeof names)[number]>();
    for (const n of order) {
      n.sprite.getWorldPosition(bannerAt).project(camera);
      if (bannerAt.z > 1) continue;
      // Its box on screen, in pixels, with a little room around it.
      const cx = ((bannerAt.x + 1) / 2) * viewSize.x;
      const cy = ((1 - bannerAt.y) / 2) * viewSize.y;
      const hw = (n.sprite.scale.x * unit) / 2 + 4;
      const hh = (n.sprite.scale.y * unit) / 2 + 3;
      if (placed.some(([x, y, w, h]) => Math.abs(cx - x) < hw + w && Math.abs(cy - y) < hh + h)) continue;
      placed.push([cx, cy, hw, hh]);
      keep.add(n);
    }
    const step = Math.min(1, dt * 5);
    for (const n of names) {
      // Fades rather than pops; a fresh view (no time passed yet) shows the outcome at once.
      const want = keep.has(n) ? 1 : 0;
      n.shown = dt ? n.shown + (want - n.shown) * step : want;
      if (Math.abs(want - n.shown) < 0.01) n.shown = want;
      n.sprite.visible = n.shown > 0;
      (n.sprite.material as THREE.SpriteMaterial).opacity = n.shown;
    }
  };

  /** Clouds drifting downwind (shown only from afar), the camera, and the frame drawn. */
  const finishFrame = (view: number, pitch: number, yaw: number, wind: Wind, sea: SeaState, t: number, dt: number) => {
    cloudMat.opacity = shown('clouds') ? 0.85 * THREE.MathUtils.smoothstep(view, CLOUDS_FROM[0]!, CLOUDS_FROM[1]!) : 0;
    const drift = strengthOf(wind) * CLOUD_SPEED * dt;
    const to = ((wind.fromDeg + 180) * Math.PI) / 180;
    for (const c of clouds) {
      c.position.x = (c.position.x + Math.sin(to) * drift + map.width) % map.width;
      c.position.z = (c.position.z - Math.cos(to) * drift + map.height) % map.height;
    }
    const back = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(view);
    back.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    camera.position.copy(target).add(back);
    camera.lookAt(target.x, 0.6, target.z);
    declutterBanners(dt);
    // Heavy weather: rain round the camera, lightning, spray off the bows; a strike lights the whole scene.
    const flash = storm.update({
      camera: camera.position,
      target,
      dt,
      t,
      rain: THREE.MathUtils.smoothstep(gloom, 0.4, 0.85),
      lightning: THREE.MathUtils.smoothstep(stormShare, 0.5, 1),
      // Spray only in a real blow (a strong wind or worse): a fresh breeze's bow wave is foam, not spray.
      rough: THREE.MathUtils.smoothstep(sea.strength, 0.9, 1.1),
      windToDeg: sea.toDeg,
      windStrength: sea.strength,
      ships: sprayShips,
      viewHeight: renderer.domElement.height,
    });
    if (flash > 0) {
      const white = new THREE.Color(0.85, 0.9, 1);
      light.sky.lerp(white, flash * 0.7);
      zenith.lerp(white, flash * 0.5);
      fill.intensity += flash * 3;
      light.ambient.add(white.clone().multiplyScalar(flash * 2.5));
      renderer.toneMappingExposure *= 1 + flash * 0.5;
      (scene.background as THREE.Color).copy(light.sky);
    }
    sprayShips = [];
    sun.position.copy(target).addScaledVector(sunDir, 200);
    sun.target.position.copy(target);
    ground.update(camera.position, target);
    ocean.update(target, sea, t, light);
    sky.update(camera.position, zenith, light.sky, sunDir, light.sun);
    towns.update(t);
    composer.render(dt);
  };

  // Heavy weather's rain, lightning and spray (storm.ts); the bows throwing spray this frame.
  const storm = createStorm();
  scene.add(storm.object);
  let sprayShips: SprayShip[] = [];
  /** Each ship's pitch last frame, for how fast her bow is dropping into a sea. */
  const lastPitch = new Map<string, number>();
  /** A ship's bow, for spray: where it is, and how fast it is dropping. */
  const bowOf = (id: string, root: THREE.Object3D, headingDeg: number, length: number, pace: number, dt: number): SprayShip => {
    const r = (headingDeg * Math.PI) / 180;
    const ride = rides.get(id);
    const pitch = ride?.pitch ?? 0;
    const dip = dt > 0 ? -(pitch - (lastPitch.get(id) ?? pitch)) / dt : 0;
    lastPitch.set(id, pitch);
    return {
      x: root.position.x + Math.sin(r) * length * 0.46,
      y: root.position.y + length * 0.06,
      z: root.position.z - Math.cos(r) * length * 0.46,
      headingDeg,
      length,
      pace,
      dip,
    };
  };

  // The sea battle: its two ships, built like any other, and its layer of shot, smoke and wreckage.
  const fx = createBattleFx();
  fx.object.visible = false;
  scene.add(fx.object);
  const fighters = new Map<'player' | 'enemy', { built: BuiltShip; classId: string; plan: ShipPlan }>();
  let inBattle = false;
  let battleView = BATTLE_VIEW.min;
  let sinkingFrom: number | undefined;
  /** Masts going by the board, by ship and mast: when it began, and the way it falls on her bearings. */
  const falls = new Map<string, { from: number; towardDeg: number }>();
  let fallsSeen = -Infinity;
  /** Each side's longest reload seen since it last fired, for how far its guns are run out. */
  const reloadSpan = new Map<string, number>();
  /** Back to the sea map: the fight's ships and its wreckage go; the world's ships return. */
  const leaveBattle = () => {
    inBattle = false;
    for (const [side, f] of fighters) {
      scene.remove(f.built.root);
      rides.delete(`battle.${side}`);
    }
    fighters.clear();
    fx.object.visible = false;
    fx.reset();
    worldShips.visible = true;
  };

  /** The overcast at a point: the wind's strength there, deepest within a storm. */
  const gloomAt = (state: WorldState, x: number, y: number) => {
    const byWind = GLOOM_BY_WIND[options.windAt(state, x, y).strength] ?? 0;
    let byStorm = 0;
    for (const s of state.weather?.storms ?? []) {
      const d = Math.hypot(s.x - x, s.y - y);
      byStorm = Math.max(byStorm, 1 - THREE.MathUtils.smoothstep(d, s.radius * 0.7, s.radius * 1.5));
    }
    battleStorm = byStorm;
    stormShare = byStorm;
    return Math.max(byWind, byStorm);
  };
  /** The storm's share of the overcast where the player last was (a fight joined there keeps it). */
  let battleStorm = 0;
  /** How deep in a storm the camera is now (lightning strikes only in storms). */
  let stormShare = 0;

  const render = (state: WorldState, nowMs: number) => {
    if (inBattle) leaveBattle();
    const me = state.ships[options.playerId];
    if (!me) return;
    gloomWant = gloomAt(state, me.x, me.y);
    const dt = beginFrame(nowMs, distance);
    wildlife.update(me, dt, skyHour(skySeconds));
    // The smoke of distant fights: swelling, rising downwind, thinning to nothing.
    smokeClock += dt;
    const downwind = (options.windAt(state, me.x, me.y).fromDeg + 180) * (Math.PI / 180);
    for (let i = smokes.length - 1; i >= 0; i--) {
      const p = smokes[i]!;
      const age = (smokeClock - p.at) / SMOKE_SECONDS;
      if (age >= 1) {
        smokeLayer.remove(p.sprite);
        p.sprite.material.dispose();
        smokes.splice(i, 1);
        continue;
      }
      const k = Math.max(0, age);
      p.sprite.scale.setScalar(p.size * (1 + k * 3));
      p.sprite.position.x += Math.sin(downwind) * dt * (0.5 + p.drift * 0.3);
      p.sprite.position.z -= Math.cos(downwind) * dt * (0.5 + p.drift * 0.3);
      p.sprite.position.y = 0.4 + k * 2.5;
      p.sprite.material.opacity = 0.55 * (1 - k) * Math.min(1, (smokeClock - p.at) * 6 + 0.2);
    }
    // The course she is sailing (the autopilot's route to its mark, or the ship she is intercepting), else the
    // route plotted to the destination picked on the chart.
    const plan = me.assist;
    const them = plan?.mode === 'intercept' && plan.targetId ? state.ships[plan.targetId] : undefined;
    const ahead: [number, number][] | undefined =
      plan?.mode === 'course' && plan.x !== undefined && plan.y !== undefined ? [...(plan.route ?? []), [plan.x, plan.y]] : them ? [[them.x, them.y]] : guidePoints;
    guideLine.visible = Boolean(ahead?.length);
    if (ahead?.length) {
      // A fresh geometry each frame: LineGeometry's buffers are sized by the first points it is given.
      guideLine.geometry.dispose();
      guideLine.geometry = new LineGeometry().setPositions([[me.x, me.y] as [number, number], ...ahead].flatMap(([x, y]) => [x, 0.3, y]));
      guideLine.computeLineDistances();
    }
    landmarks.set(
      content.pirates.captains.flatMap((c) => {
        const hoard = state.famous?.[c.id]?.hoard;
        return hoard && state.captain?.mapPieces?.[c.id] ? [{ id: c.id, x: hoard.x, y: hoard.y, kind: hoard.landmark, found: hoard.found }] : [];
      }),
    );
    const t = nowMs / 1000;
    const wind = options.windAt(state, me.x, me.y);
    const sea: SeaState = { toDeg: normalizeDeg(wind.fromDeg + 180), strength: strengthOf(wind) };

    // Ships: each at her place, her sails for the wind; far out they grow so they stay readable.
    const farScale = THREE.MathUtils.clamp(distance / 140, 1, FAR_SHIP_SCALE);
    const seen = new Set<string>();
    for (const s of Object.values(state.ships)) {
      const m = shipFor(s);
      seen.add(s.id);
      const w = options.windAt(state, s.x, s.y);
      m.setSails(sailAnim(content, s, w, nowMs));
      // Her men on deck, as many as she has hands for (a full complement shows a full deck).
      const maxCrew = content.ships[s.classId]?.maxCrew ?? 100;
      m.setCrew((s.crew ?? maxCrew * 0.7) / maxCrew);
      // Her damage, as a fight left it: canvas in rags by her sails' state, her side holed by her hull's, empty
      // ports for guns lost. Holes are placed the same way each time (her id's own rolls), patched when repaired.
      m.built.setTatters(1 - (s.sailCondition ?? 100) / 100);
      // Her shipwright's fit, as it shows.
      m.built.setFit(s.upgrades ?? []);
      const stats = shipStats(content, s);
      const holes = Math.round(Math.max(0, 1 - (s.hull ?? stats.hullMax) / stats.hullMax) * 24);
      if (holes < m.holes) {
        m.built.clearHoles();
        m.holes = 0;
      }
      for (; m.holes < holes; m.holes++) {
        const r = (k: number) => {
          const v = Math.sin((m.holes + 1) * 12.9898 + k * 78.233 + s.id.length * 3.1) * 43758.5453;
          return v - Math.floor(v);
        };
        m.built.hole(r(1) - 0.5, r(2) < 0.5 ? -1 : 1, 0.25 + r(3) * 0.6);
      }
      const battery = content.ships[s.classId]?.guns;
      if (battery) m.built.setGuns((s.guns ?? battery) / battery);
      const pace = s.speed / content.navigation.tilesPerSecondPerSpeedPoint / FAST_SHIP;
      const len = placeShip(s.id, m.root, s, w, dt, farScale, pace);
      if (Math.hypot(s.x - me.x, s.y - me.y) < 30 + distance * 0.6) sprayShips.push(bowOf(s.id, m.root, s.headingDeg, len, Math.min(1, pace * 1.4), dt));
    }
    for (const [id, m] of ships) {
      if (seen.has(id)) continue;
      worldShips.remove(m.root);
      ships.delete(id);
      rides.delete(id);
    }
    // Wakes behind the ships near the camera (far out they'd be finer than a pixel).
    ocean.ships(
      Object.values(state.ships)
        .filter((s) => Math.hypot(s.x - me.x, s.y - me.y) < 60 + distance)
        .map((s) => ({
          id: s.id,
          x: s.x,
          z: s.y,
          headingDeg: s.headingDeg,
          speed: s.speed,
          pace: Math.min(1, s.speed / content.navigation.tilesPerSecondPerSpeedPoint / BRISK),
          length: SHIP_LENGTH * farScale,
        })),
    );

    for (const n of names) n.inRange = Math.hypot(n.x - me.x, n.y - me.y) < NAMES_WITHIN * Math.max(1, distance / 120);
    // Each town's line, from the game's state, freshened every couple of seconds (redrawn only when it changes).
    if (options.townLine && nowMs - bannersAt > 2000) {
      bannersAt = nowMs;
      for (const n of names) if (n.inRange) n.banner.setLine(options.townLine(n.s, state));
    }

    // Camera: overhead (steeper the further out) or from astern, following the player.
    target.set(me.x, 0, me.y);
    const zt = Math.log(distance / ZOOM.min) / Math.log(ZOOM.max / ZOOM.min);
    const pitch = THREE.MathUtils.degToRad(chase ? 16 + zt * 30 : 30 + zt * 45);
    viewHeading = me.headingDeg;
    finishFrame(distance, pitch, chase ? (-me.headingDeg * Math.PI) / 180 : 0, wind, sea, t, dt);
  };

  /** The sea battle, on the same sea as the map (its positions are world tiles). */
  const renderBattle = (view: BattleViewState, nowMs: number, enemyNation?: string, enemyFamous?: string) => {
    if (!inBattle) {
      // A fresh fight: the world's ships give way to the two fighting, the camera starts framing them.
      inBattle = true;
      worldShips.visible = false;
      fx.object.visible = true;
      fx.reset();
      sinkingFrom = undefined;
      falls.clear();
      fallsSeen = -Infinity;
      reloadSpan.clear();
      battleView = 0;
    }
    const wind = view.wind;
    const sea: SeaState = { toDeg: normalizeDeg(wind.fromDeg + 180), strength: strengthOf(wind) };
    const { player, enemy } = view.ships;
    const apart = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    // Frame both ships (Pirates! keeps both in view, the camera high and oblique), closer as they close.
    // The sea's own zoom (the wheel sets the same one in battle), so ships look as big as at sea (they are drawn
    // at true size here, the map's ships 1.6x); pulled back only as far as keeps both ships on screen.
    const want = THREE.MathUtils.clamp(Math.max(distance / SHIP_SCALE, apart * 0.8 + 4), BATTLE_VIEW.min, BATTLE_VIEW.max);
    // The fight keeps the weather it began in: its wind's strength, and any storm it was joined in.
    gloomWant = Math.max(GLOOM_BY_WIND[view.wind.strength] ?? 0, battleStorm);
    stormShare = battleStorm;
    const dt = beginFrame(nowMs, battleView || want);
    const t = nowMs / 1000;
    battleView = battleView ? battleView + (want - battleView) * (1 - Math.exp(-dt * 1.5)) : want;

    const hulls: Partial<Record<'player' | 'enemy', BattleHull>> = {};
    const wakeShips: WakeShip[] = [];
    for (const [side, s] of [['player', player], ['enemy', enemy]] as const) {
      let f = fighters.get(side);
      if (f && f.classId !== s.classId) {
        scene.remove(f.built.root);
        f = undefined;
      }
      if (!f) {
        const plan = RIGS[s.classId] ?? RIGS['ship.brig']!;
        f = { built: buildShip(plan, side === 'player' ? 'player' : (enemyNation ?? 'pirate'), side === 'enemy' ? famousFlag(enemyFamous) : undefined), classId: s.classId, plan };
        fighters.set(side, f);
        scene.add(f.built.root);
      }
      // Sails shot through show it: holes, then rags (her canvas set as she set it).
      f.built.setTatters(1 - (s.sailCondition ?? 100) / 100);
      f.built.setFit(s.upgrades ?? []);
      // Her men on deck: grapeshot sweeping her deck cuts them down, and they fall where they stood.
      const maxCrew = content.ships[s.classId]?.maxCrew ?? 100;
      f.built.setCrew(view.wreck && side === 'enemy' ? 0 : (s.crew ?? maxCrew * 0.7) / maxCrew, nowMs);
      // Masts shot away: each comes down over her side when it goes, and stays down.
      for (const e of view.effects) {
        if (e.ship !== side || e.at <= fallsSeen) continue;
        if (e.kind === 'mast' && e.mast !== undefined) {
          falls.set(`${side}:${e.mast}`, { from: t, towardDeg: fallSide(s.headingDeg, e.towardDeg ?? s.headingDeg + 90) });
        } else if (e.place?.part === 'rigging' && e.place.up !== undefined) {
          // Through her rigging: a hole in the canvas where the ball crossed it (in her own frame).
          const sz = content.ships[s.classId]?.size;
          const along = e.place.along * (sz ? sz.length : f.plan.hull.length * BATTLE_MODEL_SCALE);
          f.built.sailHole(e.place.up / BATTLE_MODEL_SCALE, -along / BATTLE_MODEL_SCALE);
        } else if (e.kind === 'hit' && e.place?.part === 'hull') {
          // Round shot through her side: a hole on the side facing the ship that fired.
          const foe = side === 'player' ? enemy : player;
          const r = (s.headingDeg * Math.PI) / 180;
          const starboard = (foe.x - s.x) * Math.cos(r) + (foe.y - s.y) * Math.sin(r);
          f.built.hole(e.place.along, starboard >= 0 ? 1 : -1, 0.25 + Math.random() * 0.6);
        }
      }
      // Guns recoil when a broadside fires and run out again as she reloads: each side's share of its reload done
      // (its full time is the longest seen since that side last fired).
      if (s.reload) {
        const runOut = (b: 'port' | 'starboard') => {
          const key = `${side}:${b}`;
          const left = s.reload![b];
          const full = Math.max(left, reloadSpan.get(key) ?? 0);
          reloadSpan.set(key, left > 0 ? full : 0);
          return full > 0 ? 1 - left / full : 1;
        };
        f.built.setRunOut(runOut('port'), runOut('starboard'));
      }
      // Guns knocked out show as empty ports.
      const battery = content.ships[s.classId]?.guns;
      if (battery && s.guns !== undefined) f.built.setGuns(s.guns / battery);
      (s.masts ?? []).forEach((m, i) => {
        const fall = falls.get(`${side}:${i}`);
        if (fall) f!.built.setMast(i, (t - fall.from) / MAST_FALL_SECONDS, fall.towardDeg);
        else f!.built.setMast(i, m > 0 ? 0 : 1, 90);
      });
      f.built.setSails(...sailsOf(sailAnim(content, s, wind, nowMs)), nowMs);
      const pace = (s.speed ?? 0) / content.combat.battle.tilesPerSecondPerSpeedPoint / FAST_SHIP;
      const length = placeShip(`battle.${side}`, f.built.root, s, wind, dt, 1 / SHIP_SCALE, pace, BATTLE_MODEL_SCALE);
      if (!(side === 'enemy' && view.wreck)) sprayShips.push(bowOf(`battle.${side}`, f.built.root, s.headingDeg, length, Math.min(1, pace * 1.4), dt));
      // Going down: she settles by the stern, rolls and is gone under the sea.
      if (side === 'enemy' && view.wreck) {
        if (sinkingFrom === undefined) {
          sinkingFrom = t;
          fx.splash(t, s.x, s.y);
          ocean.splash(s.x, s.y, 1.8);
        }
        const k = Math.min(1, (t - sinkingFrom) / SINK_SECONDS);
        const root = f.built.root;
        root.rotateX(-0.35 * k);
        root.rotateZ(0.45 * k * k);
        root.position.y -= k * k * (f.plan.masts.reduce((h, m) => Math.max(h, m.height), 1) + 0.6) * BATTLE_MODEL_SCALE;
        root.visible = k < 1;
      } else f.built.root.visible = true;
      const tallest = f.plan.masts.reduce((h, m) => Math.max(h, m.height), 1);
      hulls[side] = {
        x: s.x,
        z: s.y,
        headingDeg: s.headingDeg,
        length: f.plan.hull.length * BATTLE_MODEL_SCALE,
        halfBeam: f.plan.hull.beam * BATTLE_MODEL_SCALE,
        deck: f.plan.hull.rail * BATTLE_MODEL_SCALE,
        sails: tallest * 0.6 * BATTLE_MODEL_SCALE,
        masts: f.plan.masts.map((m) => ({ along: m.at / f!.plan.hull.length, height: m.height * BATTLE_MODEL_SCALE })),
      };
      if (!(side === 'enemy' && view.wreck)) wakeShips.push({ id: `battle.${side}`, x: s.x, z: s.y, headingDeg: s.headingDeg, speed: s.speed ?? 0, pace: Math.min(1, (pace * FAST_SHIP) / BRISK), length });
    }
    ocean.ships(wakeShips);
    // Shot into the sea, a mast over the side: rings run out across the water.
    for (const e of view.effects) {
      if (e.at <= fallsSeen) continue;
      if (e.kind === 'splash') ocean.splash(e.x, e.y, 0.35);
      else if (e.kind === 'mast') ocean.splash(e.x, e.y, 1.1);
    }
    fallsSeen = Math.max(fallsSeen, ...view.effects.map((e) => e.at));
    for (const n of names) n.inRange = false;

    fx.update({
      t,
      dt,
      view,
      hulls: { player: hulls.player!, enemy: hulls.enemy },
      seaAt: (x, z) => ocean.heightAt(x, z),
      windToDeg: sea.toDeg,
      windStrength: sea.strength,
      level: light.level,
      viewHeight: renderer.domElement.height,
    });

    // The camera: on the pair (a little toward the player), high and oblique; from astern of her on C.
    target.set(player.x + (enemy.x - player.x) * 0.45, 0, player.y + (enemy.y - player.y) * 0.45);
    if (chase) target.set(player.x, 0, player.y);
    // The sea's camera angle for this zoom.
    const zt = Math.log(Math.max(ZOOM.min, battleView * SHIP_SCALE) / ZOOM.min) / Math.log(ZOOM.max / ZOOM.min);
    const pitch = THREE.MathUtils.degToRad(chase ? 16 + zt * 30 : 30 + zt * 45);
    viewHeading = player.headingDeg;
    finishFrame(chase ? Math.min(battleView, 30) : battleView, pitch, chase ? (-player.headingDeg * Math.PI) / 180 : 0, wind, sea, t, dt);
  };

  return {
    canvas,
    onLightning: (cb) => storm.onLightning(cb),
    render,
    renderBattle,
    resize(width, height) {
      renderer.setSize(width, height);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      guideMaterial.resolution.set(width, height);
    },
    zoom(steps) {
      distance = THREE.MathUtils.clamp(distance * Math.pow(1.12, steps), ZOOM.min, ZOOM.max);
    },
    pick(px, py) {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return undefined;
      pickRay.setFromCamera(new THREE.Vector2((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1), camera);
      const hit = pickRay.ray.intersectPlane(SEA_PLANE, new THREE.Vector3());
      return hit ? { x: hit.x, y: hit.z } : undefined;
    },
    project(x, y) {
      const r = canvas.getBoundingClientRect();
      const v = new THREE.Vector3(x, 0, y).project(camera);
      if (v.z > 1) return undefined;
      return { px: ((v.x + 1) / 2) * r.width, py: ((1 - v.y) / 2) * r.height };
    },
    viewBox() {
      const r = canvas.getBoundingClientRect();
      const reach = Math.max(distance * 3, 20);
      const corners = [
        [0, 0],
        [r.width, 0],
        [0, r.height],
        [r.width, r.height],
      ].map(([px, py]) => {
        pickRay.setFromCamera(new THREE.Vector2((px! / Math.max(1, r.width)) * 2 - 1, -(py! / Math.max(1, r.height)) * 2 + 1), camera);
        const hit = pickRay.ray.intersectPlane(SEA_PLANE, new THREE.Vector3());
        // Above the horizon: as far as the camera sees along that line, clamped.
        const d = hit ? Math.min(hit.distanceTo(pickRay.ray.origin), reach) : reach;
        const p = pickRay.ray.at(d, new THREE.Vector3());
        return [p.x, p.z] as const;
      });
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    },
    viewDeg: () => (chase ? viewHeading : 0),
    wildlife: {
      spawn: (kind) => wildlife.spawn(kind),
      get count() {
        return wildlife.count;
      },
    },
    seaFight(x, y) {
      for (let k = 0; k < 6; k++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: '#b8b5ad', transparent: true, depthWrite: false, opacity: 0.55 }));
        const a = (k / 6) * Math.PI * 2 + Math.random();
        sprite.position.set(x + Math.cos(a) * 0.6, 0.4, y + Math.sin(a) * 0.6);
        smokeLayer.add(sprite);
        smokes.push({ sprite, at: smokeClock + k * 0.08, size: 1.2 + Math.random() * 0.8, drift: Math.random() });
      }
    },
    guide(points) {
      guidePoints = points;
    },
    toggleChase() {
      chase = !chase;
    },
    showcase(classIds, state) {
      const me = state.ships[options.playerId];
      if (!me) return;
      classIds.forEach((id, i) => {
        const plan = RIGS[id];
        if (!plan) return;
        const built = buildShip(plan, i % 2 ? 'spain' : 'england');
        built.setSails('full', 'beam', 1, 0);
        built.root.position.set(me.x - 9 + (i % 4) * 6, 0, me.y + 5 + Math.floor(i / 4) * 5);
        built.root.rotation.y = -Math.PI / 2;
        built.root.scale.setScalar(MODEL_SCALE);
        scene.add(built.root);
      });
    },
    setSkyHour(hour) {
      // The first moment in the sky's cycle that shows this hour.
      let at = 0;
      for (const [length, from, to] of SKY_PHASES) {
        const h = hour < from ? hour + 24 : hour;
        if (h >= from && h <= to) {
          skySeconds = at + ((h - from) / (to - from)) * length;
          return;
        }
        at += length;
      }
    },
  };
}

interface Banner {
  sprite: THREE.Sprite;
  /** Sets the line under the name (redrawn only when it changes). */
  setLine(line: string): void;
}

/**
 * A town's banner over it, the same size on screen at every zoom (Pirates! 2004 shows the nation's colours, the
 * name and a line on the town's state): the nation's flag, the name in a serif, and the line beneath.
 */
function createBanner(name: string, nation: string): Banner {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const nameFont = '600 46px Georgia, serif';
  const lineFont = 'italic 26px Georgia, serif';
  const flag = flagTexture(nation).image as HTMLCanvasElement;
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false, depthTest: false, fog: false }));
  sprite.renderOrder = 10;
  let shown: string | undefined;
  const draw = (line: string) => {
    ctx.font = nameFont;
    const nameW = ctx.measureText(name).width;
    ctx.font = lineFont;
    const lineW = line ? ctx.measureText(line).width : 0;
    const flagW = 74;
    c.width = Math.ceil(Math.max(nameW, lineW) + flagW + 44);
    c.height = line ? 104 : 72;
    ctx.fillStyle = 'rgba(16, 24, 36, 0.66)';
    ctx.beginPath();
    ctx.roundRect(0, 4, c.width, c.height - 8, 12);
    ctx.fill();
    // The nation's flag, with a thin gilt frame.
    ctx.fillStyle = '#e6bf6a';
    ctx.fillRect(12, 14, flagW - 8 + 4, 42 + 4);
    ctx.drawImage(flag, 14, 16, flagW - 8, 42);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f7eedb';
    ctx.font = nameFont;
    ctx.fillText(name, flagW + 22, 38);
    if (line) {
      ctx.fillStyle = '#e6c98a';
      ctx.font = lineFont;
      ctx.fillText(line, flagW + 24, 78);
    }
    texture.needsUpdate = true;
    const h = line ? 0.05 : 0.036;
    sprite.scale.set((c.width / c.height) * h, h, 1);
  };
  draw('');
  return {
    sprite,
    setLine(line) {
      if (line === shown) return;
      shown = line;
      draw(line);
    },
  };
}

/** A sprite animation name (`sail_full_beam_s`) as the builder's setting, point of sail, and wind side (+1 starboard). */
function sailsOf(anim: string): ['full' | 'half' | 'furled', string, number] {
  const [, setting, point, tack] = anim.split('_') as [string, 'full' | 'half' | 'furled', string?, string?];
  if (setting === 'furled') return ['furled', 'run', 0];
  return [setting, point ?? 'run', tack?.startsWith('s') ? 1 : tack?.startsWith('p') ? -1 : 0];
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
