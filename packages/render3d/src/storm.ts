import * as THREE from 'three';

// Heavy weather (after Assassin's Creed IV: Black Flag): rain slanting down past the camera, lightning (a flash
// that lights the whole scene and a jagged bolt to the sea, with thunder after it, later the further off it
// struck), and spray thrown off ships' bows as they drive into a heavy sea. Drawing only: the weather itself is
// the game's (systems-weather); this reads how stormy it is where the camera is.

/** Rain drops kept round the camera; each is a streak. */
const DROPS = 5000;
/** Spray droplets alive at most. */
const SPRAY = 1500;
/** Seconds between strikes at the storm's height (shorter), and at its edge. */
const STRIKE_EVERY = [4, 14];
/** Seconds of thunder's delay per tile off (sound is slow; this is a game's shortened version). */
const THUNDER_PER_TILE = 0.012;

export interface SprayShip {
  /** Where her bow is (tiles), and its height. */
  x: number;
  y: number;
  z: number;
  headingDeg: number;
  /** Her drawn length (tiles), how hard she is going (0..1), and how fast her bow is dropping (radians a second). */
  length: number;
  pace: number;
  dip: number;
}

export interface StormFrame {
  camera: THREE.Vector3;
  target: THREE.Vector3;
  dt: number;
  t: number;
  /** How hard it rains (0..1), how often lightning strikes (0 none .. 1 the storm's heart), how rough the sea is (0..1). */
  rain: number;
  lightning: number;
  rough: number;
  /** Where the wind blows toward (degrees, clockwise from north), and how hard (0..~1.1). */
  windToDeg: number;
  windStrength: number;
  ships: SprayShip[];
  /** The drawing buffer's height in pixels, for spray's size. */
  viewHeight: number;
}

export interface Storm {
  object: THREE.Group;
  /** Each frame; returns how bright the lightning is now (0..1), for the scene's light. */
  update(f: StormFrame): number;
  /** Called at each strike, with the thunder's delay in seconds. */
  onLightning(cb: (delayS: number) => void): void;
}

const RAIN_VERT = /* glsl */ `
attribute vec3 aSeed;
attribute float aEnd;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uVelocity;
uniform float uTime;
uniform float uLength;
varying float vEnd;
void main() {
  // Each drop falls along the wind-slanted velocity, wrapping round the box that follows the camera, so the
  // rain never runs out and never shows where it began.
  vec3 p = mod(aSeed * uBox + uVelocity * uTime - uCenter, uBox) - uBox * 0.5 + uCenter;
  p -= normalize(uVelocity) * uLength * aEnd;
  vEnd = aEnd;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const RAIN_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uColour;
varying float vEnd;
void main() {
  // Brightest at the head, fading along the streak.
  gl_FragColor = vec4(uColour, uAlpha * (1.0 - vEnd * 0.8));
  #include <colorspace_fragment>
}
`;

const SPRAY_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
}
`;

const SPRAY_FRAG = /* glsl */ `
uniform vec3 uColour;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = (1.0 - smoothstep(0.15, 0.5, length(c))) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColour, a);
  #include <colorspace_fragment>
}
`;

export function createStorm(): Storm {
  const object = new THREE.Group();
  object.name = 'storm';

  // Rain: line segments, two vertices a drop sharing a seed.
  const seeds = new Float32Array(DROPS * 2 * 3);
  const ends = new Float32Array(DROPS * 2);
  for (let i = 0; i < DROPS; i++) {
    const s = [Math.random(), Math.random(), Math.random()];
    seeds.set(s, i * 6);
    seeds.set(s, i * 6 + 3);
    ends[i * 2 + 1] = 1;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 2 * 3), 3));
  rainGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  rainGeo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  const rainUniforms = {
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(40, 40, 40) },
    uVelocity: { value: new THREE.Vector3(0, -30, 0) },
    uTime: { value: 0 },
    uLength: { value: 1 },
    uAlpha: { value: 0 },
    uColour: { value: new THREE.Color('#c9d3d8') },
  };
  const rain = new THREE.LineSegments(
    rainGeo,
    new THREE.ShaderMaterial({ vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, uniforms: rainUniforms, transparent: true, depthWrite: false }),
  );
  rain.frustumCulled = false;
  rain.renderOrder = 4;
  object.add(rain);

  // Lightning's bolt: a jagged ribbon from the cloud down to the sea, with a few forks, glowing past the bloom,
  // inside a wider, fainter glow; both face the camera as it struck.
  const boltGeo = new THREE.BufferGeometry();
  const glowGeo = new THREE.BufferGeometry();
  // (Not fogged: it is the brightest thing in the storm, seen through the haze that hides the islands.)
  const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 7, 8), transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false });
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.3, 1.8), transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
  const bolt = new THREE.Group();
  bolt.add(new THREE.Mesh(glowGeo, glowMat), new THREE.Mesh(boltGeo, boltMat));
  for (const m of bolt.children) m.frustumCulled = false;
  bolt.visible = false;
  object.add(bolt);
  /** Ribbons along the segments, `width` wide across `across` (a horizontal direction facing the camera). */
  const ribbons = (pts: number[], widths: number[], across: THREE.Vector3, scale: number) => {
    const tri: number[] = [];
    for (let i = 0; i < pts.length; i += 6) {
      const w = (widths[i / 6]! * scale) / 2;
      const [ax, ay, az, bx, by, bz] = pts.slice(i, i + 6) as [number, number, number, number, number, number];
      const ox = across.x * w;
      const oz = across.z * w;
      tri.push(ax - ox, ay, az - oz, ax + ox, ay, az + oz, bx + ox, by, bz + oz, ax - ox, ay, az - oz, bx + ox, by, bz + oz, bx - ox, by, bz - oz);
    }
    return new THREE.Float32BufferAttribute(tri, 3);
  };
  const shapeBolt = (x: number, z: number, top: number, across: THREE.Vector3) => {
    const pts: number[] = [];
    const widths: number[] = [];
    const branch = (sx: number, sy: number, sz: number, to: number, jag: number, depth: number) => {
      let px = sx;
      let py = sy;
      let pz = sz;
      const steps = 14;
      for (let k = 1; k <= steps; k++) {
        const ny = sy + ((to - sy) * k) / steps;
        const nx = px + (Math.random() - 0.5) * jag;
        const nz = pz + (Math.random() - 0.5) * jag;
        pts.push(px, py, pz, nx, ny, nz);
        widths.push(depth === 2 ? 1 : depth === 1 ? 0.55 : 0.35);
        if (depth > 0 && Math.random() < 0.18) branch(nx, ny, nz, ny - (sy - to) * 0.25, jag * 0.7, depth - 1);
        px = nx;
        py = ny;
        pz = nz;
      }
    };
    branch(x, top, z, 0, top * 0.12, 2);
    boltGeo.setAttribute('position', ribbons(pts, widths, across, top * 0.012));
    glowGeo.setAttribute('position', ribbons(pts, widths, across, top * 0.07));
  };

  // Spray: soft white droplets thrown off the bow, falling back, blown downwind.
  const sprayPos = new Float32Array(SPRAY * 3);
  const spraySize = new Float32Array(SPRAY);
  const sprayAlpha = new Float32Array(SPRAY);
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3).setUsage(THREE.DynamicDrawUsage));
  sprayGeo.setAttribute('aSize', new THREE.BufferAttribute(spraySize, 1).setUsage(THREE.DynamicDrawUsage));
  sprayGeo.setAttribute('aAlpha', new THREE.BufferAttribute(sprayAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  const sprayUniforms = { uScale: { value: 500 }, uColour: { value: new THREE.Color('#eef4f5') } };
  const spray = new THREE.Points(
    sprayGeo,
    new THREE.ShaderMaterial({ vertexShader: SPRAY_VERT, fragmentShader: SPRAY_FRAG, uniforms: sprayUniforms, transparent: true, depthWrite: false }),
  );
  spray.frustumCulled = false;
  spray.renderOrder = 3;
  object.add(spray);
  interface Drop {
    p: THREE.Vector3;
    v: THREE.Vector3;
    born: number;
    life: number;
    size: number;
  }
  let drops: Drop[] = [];
  const owed = new Map<number, number>();

  const strikes: ((delayS: number) => void)[] = [];
  let nextStrike = 0;
  /** The flash's start, and the bolt's place. */
  let flashAt = -Infinity;

  return {
    object,
    onLightning(cb) {
      strikes.push(cb);
    },
    update(f) {
      const { camera, target, t, dt } = f;
      const view = camera.distanceTo(target);
      const to = THREE.MathUtils.degToRad(f.windToDeg);
      const wx = Math.sin(to);
      const wz = -Math.cos(to);

      // Rain, in a box between the camera and what it looks at, sized to the view.
      rain.visible = f.rain > 0.01;
      if (rain.visible) {
        const size = THREE.MathUtils.clamp(view * 0.9, 6, 160);
        rainUniforms.uCenter.value.copy(camera).lerp(target, 0.45);
        rainUniforms.uBox.value.set(size, size * 0.9, size);
        const fall = size * 0.95;
        const slant = 0.35 * Math.min(1, f.windStrength);
        rainUniforms.uVelocity.value.set(wx * fall * slant, -fall, wz * fall * slant);
        rainUniforms.uLength.value = size * 0.035;
        rainUniforms.uTime.value = t;
        rainUniforms.uAlpha.value = 0.38 * f.rain;
        rainGeo.setDrawRange(0, Math.round(DROPS * 2 * Math.min(1, 0.2 + f.rain)));
      }

      // Lightning: strikes at random, more often in the storm's heart; somewhere ahead of the camera, a fair way off.
      if (f.lightning > 0.01) {
        if (!nextStrike) nextStrike = t + 1 + Math.random() * 3;
        if (t >= nextStrike) {
          const ahead = new THREE.Vector3().subVectors(target, camera).setY(0).normalize();
          const side = new THREE.Vector3(-ahead.z, 0, ahead.x);
          // Off toward the horizon from where the camera looks, so a low view sees it come down to the sea and
          // a high one sees it cross the water below.
          const far = view * (1.5 + Math.random() * 2.5) + 25;
          const at = target.clone().addScaledVector(ahead, far).addScaledVector(side, (Math.random() - 0.5) * far * 0.9);
          shapeBolt(at.x, at.z, Math.min(45, far * 0.45), side);
          flashAt = t;
          const span = STRIKE_EVERY[1]! - (STRIKE_EVERY[1]! - STRIKE_EVERY[0]!) * f.lightning;
          nextStrike = t + span * (0.5 + Math.random());
          const delay = 0.3 + at.distanceTo(target) * THUNDER_PER_TILE;
          for (const cb of strikes) cb(Math.min(4, delay));
        }
      } else nextStrike = 0;
      // The flash: two quick pulses and a fading glow.
      const since = t - flashAt;
      const flash =
        since < 0 || since > 0.6 ? 0 : Math.max(Math.exp(-since * 30), since > 0.12 ? Math.exp(-(since - 0.12) * 9) * 0.8 : 0);
      bolt.visible = since >= 0 && since < 0.3 && (since < 0.08 || since > 0.12);
      boltMat.opacity = 1;
      glowMat.opacity = 0.35 * flash;

      // Spray: off each bow, more as her bow drops into a sea and the harder she goes; none in fair weather.
      for (const [i, s] of f.ships.entries()) {
        const slam = Math.max(0, s.dip) * 6 + 0.25;
        const rate = f.rough * s.pace * slam * 70;
        let due = (owed.get(i) ?? 0) + rate * dt;
        const r = THREE.MathUtils.degToRad(s.headingDeg);
        const fx = Math.sin(r);
        const fz = -Math.cos(r);
        for (; due >= 1 && drops.length < SPRAY; due--) {
          const side = Math.random() < 0.5 ? -1 : 1;
          const out = s.length * (0.25 + Math.random() * 0.45);
          drops.push({
            p: new THREE.Vector3(s.x + (Math.random() - 0.5) * s.length * 0.05, s.y, s.z),
            v: new THREE.Vector3(
              fx * out * 0.6 + -fz * side * out * 0.8,
              s.length * (0.35 + Math.random() * 0.55) * (0.6 + slam * 0.2),
              fz * out * 0.6 + fx * side * out * 0.8,
            ),
            born: t,
            life: 0.7 + Math.random() * 0.6,
            size: s.length * (0.018 + Math.random() * 0.03),
          });
        }
        owed.set(i, Math.min(due, 4));
      }
      drops = drops.filter((d) => t - d.born < d.life);
      let n = 0;
      for (const d of drops) {
        const g = d.size * 18;
        d.v.y -= g * dt;
        d.v.x += (wx * f.windStrength * 2 - d.v.x) * dt * 1.2;
        d.v.z += (wz * f.windStrength * 2 - d.v.z) * dt * 1.2;
        d.p.addScaledVector(d.v, dt);
        const age = (t - d.born) / d.life;
        sprayPos.set([d.p.x, d.p.y, d.p.z], n * 3);
        spraySize[n] = d.size * (1 + age * 1.5);
        sprayAlpha[n] = 0.85 * (1 - age) * Math.min(1, age * 8 + 0.2);
        n++;
      }
      sprayGeo.setDrawRange(0, n);
      for (const name of ['position', 'aSize', 'aAlpha']) sprayGeo.getAttribute(name).needsUpdate = true;
      sprayUniforms.uScale.value = f.viewHeight * 1.2;
      return flash;
    },
  };
}
