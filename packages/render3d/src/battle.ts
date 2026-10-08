import * as THREE from 'three';
import type { BattleViewShip, BattleViewState } from '@corsair/render/battle';

// The sea battle's own layer over the 3D world (Pirates! 2004's fights happen on the same sea as the map):
// balls in flight on their arcs, gunsmoke rolling downwind, splashes, splinters and torn canvas, a hurt ship
// smoking and burning, the wreck's barrels and men in the water, and the player's firing arcs. The ships
// themselves are placed by the sea renderer, like any other.

/** A ship as this layer needs her: where she is and how big, in tiles (the drawn size, not the sim's). */
export interface BattleHull {
  x: number;
  z: number;
  headingDeg: number;
  /** Drawn length and half-beam, and her rail and sails' heights above the water. */
  length: number;
  halfBeam: number;
  deck: number;
  sails: number;
}

export interface BattleFrame {
  /** Seconds, the renderer's clock (effects here outlive the sim's brief records of them). */
  t: number;
  dt: number;
  view: BattleViewState;
  hulls: { player: BattleHull; enemy?: BattleHull };
  /** The swell's height at a point, for things floating on it. */
  seaAt(x: number, z: number): number;
  /** Where the wind blows toward (degrees) and how hard, 0..1-ish. */
  windToDeg: number;
  windStrength: number;
  /** 0 night .. 1 day, so smoke and fire read right in the dark. */
  level: number;
  /** The drawing buffer's height in pixels, for particle sizes. */
  viewHeight: number;
}

type Kind = 'smoke' | 'hullSmoke' | 'flash' | 'fire' | 'spray' | 'spark' | 'splinter' | 'canvas';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  born: number;
  life: number;
  size: [number, number];
  spin: number;
  turn: number;
}

/** How each kind looks and moves: its colour, blend, starting opacity, gravity and drag. */
const KINDS: Record<Kind, { colour: string; glow?: boolean; alpha: number; gravity: number; drag: number; debris?: boolean }> = {
  // Gunsmoke: white, thick at first, thinning as it rolls downwind.
  smoke: { colour: '#eef0ee', alpha: 0.7, gravity: -0.25, drag: 1.6 },
  // A hurt hull's smoke: dark where it leaves her, climbing.
  hullSmoke: { colour: '#2c3133', alpha: 0.9, gravity: -0.6, drag: 0.6 },
  flash: { colour: '#ffb45a', glow: true, alpha: 1, gravity: 0, drag: 0 },
  fire: { colour: '#ff7418', glow: true, alpha: 1, gravity: -1.6, drag: 0.4 },
  spray: { colour: '#f4fbfb', alpha: 0.9, gravity: 9, drag: 0.3 },
  spark: { colour: '#fff1c4', glow: true, alpha: 1, gravity: 2, drag: 0.5 },
  splinter: { colour: '#a8743e', alpha: 1, gravity: 9, drag: 0.2, debris: true },
  canvas: { colour: '#ece2c8', alpha: 1, gravity: 0.9, drag: 1.8, debris: true },
};

const MAX_POINTS = 3000;
const MAX_DEBRIS = 400;
const MAX_BALLS = 400;
/** How high a ball climbs over its flight, per tile it travels: a flat arc, as a gun's is. */
const ARC_RISE = 0.06;
const BALL = '#15171c';
const GOLD = '#e8c170';
const PALE = '#ebede9';

export function createBattleFx() {
  const puff = dotTexture();
  const object = new THREE.Group();
  object.name = 'battle';

  // Smoke, flashes, spray and sparks: soft round points, each its own size, colour and opacity.
  const pointLayer = (glow: boolean) => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_POINTS * 3);
    const size = new Float32Array(MAX_POINTS);
    const col = new Float32Array(MAX_POINTS * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColour', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: puff }, uScale: { value: 500 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute vec4 aColour;
        uniform float uScale;
        varying vec4 vColour;
        void main() {
          vColour = aColour;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec4 vColour;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vColour.a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColour.rgb, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    points.renderOrder = glow ? 3 : 2;
    object.add(points);
    return { points, pos, size, col, material, geo };
  };
  const soft = pointLayer(false);
  const glow = pointLayer(true);

  // Splinters and scraps of canvas: little solid pieces tumbling.
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.04, 0.05), new THREE.MeshStandardMaterial({ roughness: 0.8 }), MAX_DEBRIS);
  debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debris.frustumCulled = false;
  object.add(debris);

  // Balls in flight: dark iron spheres (a touch larger than life, so they read from the camera).
  const balls = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshStandardMaterial({ color: BALL, roughness: 0.35, metalness: 0.6 }),
    MAX_BALLS,
  );
  balls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  balls.frustumCulled = false;
  object.add(balls);

  // The wreck: barrels afloat, and knots of men in the water clinging to a spar.
  const barrels = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.34, 12).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#7a5130', roughness: 0.8 }),
    64,
  );
  const spars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.07, 0.12), new THREE.MeshStandardMaterial({ color: '#5e4630', roughness: 0.9 }), 64);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: '#c99a72', roughness: 0.7 }), 512);
  for (const m of [barrels, spars, heads]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    object.add(m);
  }

  // The player's firing arcs on the water: gold when that broadside bears and is loaded, so she steers into one.
  const arcs = new THREE.Group();
  object.add(arcs);
  const arcSide = (mirror: number) => {
    const fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const edge = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
    fill.scale.x = edge.scale.x = mirror;
    fill.renderOrder = edge.renderOrder = 1;
    arcs.add(fill, edge);
    return { fill, edge };
  };
  const port = arcSide(-1);
  const starboard = arcSide(1);
  let arcShape = '';
  /** A sector off the starboard beam (local +x; port mirrors it), `deg` either side, `reach` tiles. */
  const shapeArcs = (deg: number, reach: number) => {
    const key = `${deg}:${reach}`;
    if (key === arcShape) return;
    arcShape = key;
    const n = 40;
    const fill: number[] = [];
    const edge: number[] = [0, 0, 0];
    for (let i = 0; i <= n; i++) {
      const a = THREE.MathUtils.degToRad(-deg + (2 * deg * i) / n);
      edge.push(Math.cos(a) * reach, 0, Math.sin(a) * reach);
      if (i < n) {
        const b = THREE.MathUtils.degToRad(-deg + (2 * deg * (i + 1)) / n);
        fill.push(0, 0, 0, Math.cos(b) * reach, 0, Math.sin(b) * reach, Math.cos(a) * reach, 0, Math.sin(a) * reach);
      }
    }
    edge.push(0, 0, 0);
    for (const side of [port, starboard]) {
      side.fill.geometry.dispose();
      side.fill.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(fill, 3));
      side.edge.geometry.dispose();
      side.edge.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
    }
  };
  const paintArc = (side: { fill: THREE.Mesh; edge: THREE.Line }, aim: string) => {
    const fill = side.fill.material as THREE.MeshBasicMaterial;
    const edge = side.edge.material as THREE.LineBasicMaterial;
    // Light on the water: a faint gold fill only when that broadside is ready, a gold edge when she bears but is
    // out of reach, otherwise just a faint edge (the sea and the ships stay the picture).
    const [fc, fa, ec, ea] = aim === 'ready' ? [GOLD, 0.14, GOLD, 0.85] : aim === 'out-of-range' ? [PALE, 0, GOLD, 0.5] : [PALE, 0, PALE, 0.14];
    fill.color.set(fc);
    fill.opacity = fa;
    edge.color.set(ec);
    edge.opacity = ea;
  };

  let particles: Particle[] = [];
  let seenAt = -Infinity;
  let smokeDue = { player: 0, enemy: 0 };
  let fireDue = { player: 0, enemy: 0 };
  const rand = Math.random;
  const spawn = (kind: Kind, t: number, x: number, y: number, z: number, v: [number, number, number], life: number, size: [number, number]) => {
    if (particles.length >= MAX_POINTS + MAX_DEBRIS) return;
    particles.push({ kind, x, y, z, vx: v[0], vy: v[1], vz: v[2], born: t, life, size, spin: rand() * Math.PI * 2, turn: (rand() - 0.5) * 14 });
  };

  /** The broadside that faces her foe fired: a bank of smoke rolling out from her side, a flash at each port. */
  const broadside = (t: number, ship: BattleHull, foe: BattleHull | undefined) => {
    const r = THREE.MathUtils.degToRad(ship.headingDeg);
    const fx = Math.sin(r);
    const fz = -Math.cos(r);
    // Starboard is her right: (-fz, fx). The side the foe lies on.
    const right: [number, number] = [-fz, fx];
    const toFoe = foe ? (foe.x - ship.x) * right[0] + (foe.z - ship.z) * right[1] : 1;
    const out = toFoe >= 0 ? 1 : -1;
    const guns = 7;
    for (let g = 0; g < guns; g++) {
      const along = (g / (guns - 1) - 0.5) * ship.length * 0.62;
      const x = ship.x + fx * along + right[0] * ship.halfBeam * out;
      const z = ship.z + fz * along + right[1] * ship.halfBeam * out;
      const y = ship.deck * 0.7;
      // A puff at each port (Pirates!: small white puffs, the ship never lost in them), pushed out and rolling
      // downwind.
      const push = 1.3 + rand() * 0.7;
      spawn('flash', t, x + right[0] * out * 0.15, y, z + right[1] * out * 0.15, [right[0] * out * 2, 0, right[1] * out * 2], 0.12, [0.45, 0.8]);
      spawn('smoke', t + rand() * 0.06, x, y + rand() * 0.1, z, [right[0] * out * push + (rand() - 0.5) * 0.3, 0.12 + rand() * 0.15, right[1] * out * push + (rand() - 0.5) * 0.3], 2.2 + rand(), [0.35, 1.5 + rand() * 0.5]);
    }
  };
  /** A ball strikes her hull: splinters fly from the hit and a little dark smoke. */
  const strike = (t: number, x: number, y: number, z: number) => {
    for (let k = 0; k < 14; k++) {
      const a = rand() * Math.PI * 2;
      const s = 1.5 + rand() * 3;
      spawn('splinter', t, x, y, z, [Math.cos(a) * s, 1.5 + rand() * 3.5, Math.sin(a) * s], 1.6, [1, 1]);
    }
    // Dark smoke trailing up from where she was struck.
    for (let k = 0; k < 4; k++) spawn('hullSmoke', t + k * 0.12, x, y, z, [(rand() - 0.5) * 0.3, 0.6 + rand() * 0.4, (rand() - 0.5) * 0.3], 2.6 + rand(), [0.35, 1.5]);
    spawn('flash', t, x, y, z, [0, 0, 0], 0.1, [0.5, 0.8]);
  };
  /** Shot through her canvas: scraps of sail fluttering down. */
  const tear = (t: number, x: number, y: number, z: number) => {
    for (let k = 0; k < 10; k++) {
      const a = rand() * Math.PI * 2;
      spawn('canvas', t, x, y, z, [Math.cos(a) * 1.6, 0.6 + rand(), Math.sin(a) * 1.6], 2.6 + rand(), [1, 1]);
    }
  };
  /** A ball into the sea: a white column thrown up and falling back. */
  const splash = (t: number, x: number, y: number, z: number, big = 1) => {
    for (let k = 0; k < 12; k++) {
      const a = rand() * Math.PI * 2;
      const s = rand() * 0.7 * big;
      spawn('spray', t, x, y, z, [Math.cos(a) * s, (2.6 + rand() * 2.2) * big, Math.sin(a) * s], 0.95, [0.35, 0.9 * big]);
    }
  };
  /** Grapeshot sweeping her deck: a scatter of little sparks. */
  const scatter = (t: number, x: number, y: number, z: number) => {
    for (let k = 0; k < 12; k++) {
      const a = rand() * Math.PI * 2;
      spawn('spark', t, x + Math.cos(a) * rand() * 0.6, y, z + Math.sin(a) * rand() * 0.6, [Math.cos(a) * 1.2, 0.8 + rand(), Math.sin(a) * 1.2], 0.3, [0.25, 0.15]);
    }
  };

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const colour = new THREE.Color();
  const tints = Object.fromEntries(Object.entries(KINDS).map(([k, d]) => [k, new THREE.Color(d.colour)])) as Record<Kind, THREE.Color>;

  return {
    object,
    /** A fresh fight: nothing left over from the last. */
    reset() {
      particles = [];
      seenAt = -Infinity;
      smokeDue = { player: 0, enemy: 0 };
      fireDue = { player: 0, enemy: 0 };
    },
    /** Something big went into the sea here (a ship going down). */
    splash(t: number, x: number, z: number) {
      splash(t, x, 0, z, 1.6);
    },
    update(f: BattleFrame) {
      const { t, dt, view, hulls } = f;
      const hullAt = (x: number, z: number) => {
        const near = (h?: BattleHull) => (h ? Math.hypot(h.x - x, h.z - z) : Infinity);
        return near(hulls.player) <= near(hulls.enemy) ? hulls.player : hulls.enemy!;
      };
      // What happened since the last frame (the sim keeps its effects only a moment; these play out longer).
      for (const fx of view.effects) {
        if (fx.at <= seenAt) continue;
        const h = hullAt(fx.x, fx.y);
        if (fx.kind === 'smoke') broadside(t, h, h === hulls.player ? hulls.enemy : hulls.player);
        else if (fx.kind === 'splash') splash(t, fx.x, f.seaAt(fx.x, fx.y), fx.y);
        else if (fx.kind === 'hit') strike(t, fx.x, h.deck * (0.5 + rand() * 0.5), fx.y);
        else if (fx.kind === 'sail') tear(t, fx.x, h.sails * (0.8 + rand() * 0.4), fx.y);
        else scatter(t, fx.x, h.deck + 0.1, fx.y);
      }
      seenAt = Math.max(seenAt, ...view.effects.map((fx) => fx.at));

      // A hurt hull smokes from her deck, and below a quarter of it she burns.
      const ships: ['player' | 'enemy', BattleViewShip, BattleHull | undefined][] = [
        ['player', view.ships.player, hulls.player],
        ['enemy', view.ships.enemy, view.wreck ? undefined : hulls.enemy],
      ];
      for (const [side, s, h] of ships) {
        if (!h || s.hull === undefined || !s.hullMax) continue;
        const share = s.hull / s.hullMax;
        if (share >= 0.5) continue;
        const r = THREE.MathUtils.degToRad(h.headingDeg);
        const along = () => (rand() - 0.5) * h.length * 0.6;
        smokeDue[side] += dt * (share < 0.25 ? 9 : 5);
        for (; smokeDue[side] >= 1; smokeDue[side]--) {
          const a = along();
          spawn('hullSmoke', t, h.x + Math.sin(r) * a, h.deck, h.z - Math.cos(r) * a, [0, 0.9 + rand() * 0.4, 0], 3.2 + rand(), [0.7, 3.2]);
        }
        if (share >= 0.25) continue;
        fireDue[side] += dt * 34;
        for (; fireDue[side] >= 1; fireDue[side]--) {
          const a = along();
          spawn('fire', t, h.x + Math.sin(r) * a + (rand() - 0.5) * 0.3, h.deck, h.z - Math.cos(r) * a + (rand() - 0.5) * 0.3, [0, 1 + rand(), 0], 0.6, [1.1, 0.35]);
        }
      }

      // Move everything on: smoke drifts downwind and slows, spray and splinters fall, canvas flutters down.
      const to = THREE.MathUtils.degToRad(f.windToDeg);
      const wx = Math.sin(to) * f.windStrength * 0.9;
      const wz = -Math.cos(to) * f.windStrength * 0.9;
      particles = particles.filter((pt) => t - pt.born < pt.life);
      for (const pt of particles) {
        if (t < pt.born) continue;
        const k = KINDS[pt.kind];
        const drag = Math.exp(-k.drag * dt);
        const blows = pt.kind === 'smoke' || pt.kind === 'hullSmoke' ? 1 : 0;
        pt.vx = (pt.vx - wx * blows) * drag + wx * blows;
        pt.vz = (pt.vz - wz * blows) * drag + wz * blows;
        pt.vy = pt.vy * drag - k.gravity * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.z += pt.vz * dt;
        if (k.debris || pt.kind === 'spray') {
          const sea = f.seaAt(pt.x, pt.z);
          // Debris floats once it lands; spray is gone into the sea.
          if (pt.y < sea) {
            if (pt.kind === 'spray') pt.life = 0;
            pt.y = sea;
            pt.vx *= 0.2;
            pt.vz *= 0.2;
            pt.vy = 0;
            pt.turn = 0;
          }
        }
        pt.spin += pt.turn * dt;
      }

      // Into the buffers.
      soft.material.uniforms.uScale!.value = glow.material.uniforms.uScale!.value = f.viewHeight * 1.2;
      let ns = 0;
      let ng = 0;
      let nd = 0;
      const shade = 0.45 + 0.55 * f.level;
      for (const pt of particles) {
        if (t < pt.born) continue;
        const k = KINDS[pt.kind];
        const age = (t - pt.born) / pt.life;
        if (k.debris) {
          if (nd >= MAX_DEBRIS) continue;
          e.set(pt.spin, pt.spin * 0.7, pt.spin * 1.3);
          q.setFromEuler(e);
          const fade = 1 - THREE.MathUtils.smoothstep(age, 0.8, 1);
          sc.set(pt.kind === 'canvas' ? 1.4 * fade : fade, fade, pt.kind === 'canvas' ? 4 * fade : fade);
          m.compose(p.set(pt.x, pt.y, pt.z), q, sc);
          debris.setMatrixAt(nd, m);
          debris.setColorAt(nd, tints[pt.kind]);
          nd++;
          continue;
        }
        const layer = k.glow ? glow : soft;
        const i = k.glow ? ng++ : ns++;
        if (i >= MAX_POINTS) continue;
        layer.pos.set([pt.x, pt.y, pt.z], i * 3);
        layer.size[i] = pt.size[0] + (pt.size[1] - pt.size[0]) * Math.sqrt(age);
        // Smoke thins as it spreads; flashes and fire burn out; spray falls away.
        // Smoke holds thick a while before it thins (a broadside hangs over the water, as in Pirates!).
        const fade = pt.kind === 'smoke' || pt.kind === 'hullSmoke' ? 1 - age * age : 1 - age;
        const a = k.alpha * (pt.kind === 'flash' ? 1 - age : fade * Math.min(1, age * 12 + 0.3));
        colour.copy(tints[pt.kind]);
        if (pt.kind === 'hullSmoke') colour.lerp(tints.smoke, Math.min(0.7, age * 0.8));
        if (!k.glow) colour.multiplyScalar(shade);
        layer.col.set([colour.r, colour.g, colour.b, a], i * 4);
      }
      for (const [layer, n] of [
        [soft, ns],
        [glow, ng],
      ] as const) {
        layer.geo.setDrawRange(0, Math.min(n, MAX_POINTS));
        for (const name of ['position', 'aSize', 'aColour']) layer.geo.getAttribute(name).needsUpdate = true;
      }
      debris.count = nd;
      debris.instanceMatrix.needsUpdate = true;
      if (debris.instanceColor) debris.instanceColor.needsUpdate = true;

      // Balls on their arcs: from her side to where they fall (a hit ends at her rail or her sails, a miss in the sea).
      // Each of the battle's shots is drawn as a few balls from guns along her side, landing a little apart, so a
      // broadside streams across as a loose spray of shot (as Pirates! draws it).
      let nb = 0;
      const shotHash = (s: { flight: number; tx: number; ty: number }, k: number) => {
        const v = Math.sin(s.flight * 91.7 + s.tx * 12.3 + s.ty * 7.1 + k * 17.31) * 43758.5453;
        return v - Math.floor(v);
      };
      const ball = (x: number, y: number, z: number, s: number) => {
        if (nb >= MAX_BALLS) return;
        m.compose(p.set(x, y, z), q.identity(), sc.setScalar(s));
        balls.setMatrixAt(nb++, m);
      };
      for (const s of view.shots) {
        const from = hullAt(s.x, s.y);
        const target = hullAt(s.tx, s.ty);
        const fr = THREE.MathUtils.degToRad(from.headingDeg);
        const tr = THREE.MathUtils.degToRad(target.headingDeg);
        const y0 = from.deck * 0.7;
        const y1 = s.hit ? (s.ammo === 'chain' ? target.sails : target.deck * (s.ammo === 'grape' ? 1.1 : 0.7)) : f.seaAt(s.tx, s.ty);
        const rise = Math.hypot(s.tx - s.x, s.ty - s.y) * ARC_RISE;
        for (let b = 0; b < (s.ammo === 'grape' ? 1 : 3); b++) {
          // Out of a port along her side, into her length (or the sea about her), each a moment apart.
          const along = (shotHash(s, b) - 0.5) * from.length * 0.6;
          const into = (shotHash(s, b + 5) - 0.5) * (s.hit ? target.length * 0.5 : 0.8);
          const k = THREE.MathUtils.clamp(1 - s.t / s.flight + (shotHash(s, b + 9) - 0.5) * 0.06, 0, 1);
          const sx = s.x + Math.sin(fr) * along;
          const sz = s.y - Math.cos(fr) * along;
          const ex = s.tx + Math.sin(tr) * into;
          const ez = s.ty - Math.cos(tr) * into;
          const x = sx + (ex - sx) * k;
          const z = sz + (ez - sz) * k;
          const y = y0 + (y1 - y0) * k + rise * 4 * k * (1 - k);
          if (s.ammo === 'chain') {
            // Two balls whirling on their chain.
            const spin = t * 18 + s.flight * 10;
            const dx = Math.cos(spin) * 0.16;
            const dz = Math.sin(spin) * 0.16;
            ball(x + dx, y, z + dz, 0.9);
            ball(x - dx, y, z - dz, 0.9);
          } else if (s.ammo === 'grape') {
            for (let j = 0; j < 6; j++) ball(x + Math.cos(j * 1.3 + s.flight) * 0.14, y + Math.sin(j * 2.1) * 0.08, z + Math.sin(j * 1.9 + s.flight) * 0.14, 0.6);
          } else ball(x, y, z, 1);
        }
      }
      balls.count = nb;
      balls.instanceMatrix.needsUpdate = true;

      // The wreck: barrels bobbing and turning slowly, men in the water round a spar.
      let nBarrel = 0;
      let nSpar = 0;
      let nHead = 0;
      for (const [i, b] of (view.wreck?.barrels ?? []).entries()) {
        if (nBarrel >= 64) break;
        e.set(Math.sin(t * 0.9 + i) * 0.25, i * 1.7 + t * 0.15, Math.cos(t * 0.7 + i) * 0.2);
        m.compose(p.set(b.x, f.seaAt(b.x, b.y) + 0.03, b.y), q.setFromEuler(e), sc.setScalar(1));
        barrels.setMatrixAt(nBarrel++, m);
      }
      for (const [i, g] of (view.wreck?.survivors ?? []).entries()) {
        if (nSpar >= 64) break;
        const sea = f.seaAt(g.x, g.y);
        const turn = i * 2.3;
        e.set(0, turn, Math.sin(t * 1.1 + i) * 0.08);
        m.compose(p.set(g.x, sea + 0.02, g.y), q.setFromEuler(e), sc.setScalar(1));
        spars.setMatrixAt(nSpar++, m);
        // A head for every few men, along both sides of the spar.
        const men = Math.min(8, Math.max(2, Math.ceil(g.men / 3)));
        for (let k = 0; k < men && nHead < 512; k++) {
          const along = ((k >> 1) / Math.max(1, (men >> 1) - 0.5) - 0.5) * 0.7;
          const off = (k % 2 ? 1 : -1) * 0.13;
          const hx = g.x + Math.cos(turn) * along + Math.sin(turn) * off;
          const hz = g.y - Math.sin(turn) * along + Math.cos(turn) * off;
          m.compose(p.set(hx, sea + 0.05 + Math.sin(t * 2.4 + k + i) * 0.015, hz), q.identity(), sc.setScalar(1));
          heads.setMatrixAt(nHead++, m);
        }
      }
      barrels.count = nBarrel;
      spars.count = nSpar;
      heads.count = nHead;
      for (const mesh of [barrels, spars, heads]) mesh.instanceMatrix.needsUpdate = true;

      // The player's arcs, round her on the water.
      arcs.visible = Boolean(view.arcs);
      if (view.arcs) {
        shapeArcs(view.arcs.arcDeg, view.arcs.rangeTiles);
        paintArc(port, view.arcs.port);
        paintArc(starboard, view.arcs.starboard);
        arcs.position.set(hulls.player.x, 0.12, hulls.player.z);
        arcs.rotation.set(0, -THREE.MathUtils.degToRad(hulls.player.headingDeg), 0);
      }
    },
  };
}

/** A soft round puff for the particles: a few overlapping blobs, so smoke reads as billows, not discs. */
function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  for (const [x, y, r] of [[64, 64, 52], [48, 56, 30], [80, 54, 30], [62, 80, 30]] as const) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}
