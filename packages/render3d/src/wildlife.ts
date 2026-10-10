import * as THREE from 'three';

// Sea life on the 3D sea: dolphins leaping at the bow in open water, flying fish skimming ahead of her, a whale
// surfacing to blow out in the deep, gulls wheeling where there is land near. Each is a rare, short event tied
// to where the ship is, for the eye and ear only: none of it touches the game's state. World units are tiles.

export type WildlifeSound = (id: string, opts: { gain: number; pan: number; rate?: number; lowpass?: number }) => void;
export type WildlifeKind = 'dolphins' | 'flyingFish' | 'whale' | 'gulls';

/** About how many seconds between each kind's chances (a chance fires only where it fits). */
const EVERY_S: Record<WildlifeKind, number> = { dolphins: 70, flyingFish: 35, whale: 200, gulls: 25 };
/** How long each lasts once it comes, in seconds. */
const LASTS_S: Record<WildlifeKind, number> = { dolphins: 22, flyingFish: 6, whale: 16, gulls: 40 };

interface Ship {
  x: number;
  y: number;
  headingDeg: number;
  speed: number;
}

interface Event {
  kind: WildlifeKind;
  root: THREE.Group;
  at: number;
  update(t: number, dt: number, ship: Ship): void;
}

export function createWildlife(heightAt: (x: number, y: number) => number, sound: WildlifeSound) {
  const object = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: '#7b8893', roughness: 0.4, metalness: 0.05 });
  const whaleSkin = new THREE.MeshStandardMaterial({ color: '#2f3840', roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: '#f1efe8', roughness: 0.8, side: THREE.DoubleSide });
  const silver = new THREE.MeshStandardMaterial({ color: '#c9d3d8', roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide });
  const spray = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false });
  const events: Event[] = [];
  const next: Record<WildlifeKind, number> = { dolphins: EVERY_S.dolphins / 2, flyingFish: EVERY_S.flyingFish / 2, whale: EVERY_S.whale / 2, gulls: 5 };
  let clock = 0;
  let last: Ship | undefined;

  const pan = (ship: Ship, x: number) => Math.max(-1, Math.min(1, (x - ship.x) / 20));
  /** Land within `r` tiles of a spot (a ring of samples): gulls want it, dolphins and whales don't. */
  const landWithin = (x: number, y: number, r: number) => {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      for (const d of [r / 3, (2 * r) / 3, r]) if (heightAt(x + Math.sin(a) * d, y - Math.cos(a) * d) > 0) return true;
    }
    return false;
  };
  /** Her heading as a unit vector (x east, y south), and abeam to starboard. */
  const axes = (ship: Ship) => {
    const h = (ship.headingDeg * Math.PI) / 180;
    return { fx: Math.sin(h), fy: -Math.cos(h), sx: Math.cos(h), sy: Math.sin(h) };
  };

  const dolphin = () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 8), grey);
    body.scale.set(0.16, 0.13, 0.62);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 6), grey);
    fin.position.set(0, 0.1, 0.02);
    fin.rotation.x = -0.4;
    const flukes = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.07), grey);
    flukes.position.z = 0.32;
    g.add(body, fin, flukes);
    // Drawn larger than life, as the ships are, so a pod reads at the sea's zoom.
    g.scale.setScalar(1.5);
    return g;
  };

  const spawners: Record<WildlifeKind, (ship: Ship) => Event | undefined> = {
    // A pod of three to five racing at her bow, each leaping clear every few seconds.
    dolphins(ship) {
      const root = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 3);
      const pod = Array.from({ length: n }, (_, i) => {
        const d = dolphin();
        root.add(d);
        return { d, side: i % 2 ? 1 : -1, abeam: 0.8 + Math.random() * 1.2, ahead: 1 + Math.random() * 2.5, phase: Math.random() * 3, period: 2.5 + Math.random() * 1.5 };
      });
      sound('dolphin', { gain: 0.35, pan: 0, lowpass: 4000 });
      return {
        kind: 'dolphins',
        root,
        at: clock,
        update(t, _dt, s) {
          const { fx, fy, sx, sy } = axes(s);
          const age = t - this.at;
          // They fall back astern as they tire of her.
          const lag = Math.max(0, age - LASTS_S.dolphins + 6) * 0.8;
          for (const p of pod) {
            const u = ((age + p.phase) % p.period) / p.period;
            // A leap in the last third of each cycle: up out of the water and back in, nose first.
            const leap = u > 0.66 ? (u - 0.66) / 0.34 : -1;
            const up = leap >= 0 ? -0.2 + 0.9 * Math.sin(Math.PI * leap) : -0.6;
            const along = p.ahead + Math.sin(age * 0.7 + p.phase) * 0.3 - lag;
            p.d.position.set(s.x + fx * along + sx * p.side * p.abeam, up, s.y + fy * along + sy * p.side * p.abeam);
            p.d.rotation.set(leap >= 0 ? -Math.cos(Math.PI * leap) * 0.7 : 0, Math.atan2(-fx, -fy), 0);
            if (leap >= 0 && leap < 0.05 && Math.random() < 0.3) sound('splash_big', { gain: 0.2, pan: pan(s, p.d.position.x), rate: 1.2 });
          }
        },
      };
    },
    // A shoal skimming out of her way ahead: silver flashes in low arcs.
    flyingFish(ship) {
      const root = new THREE.Group();
      const { fx, fy, sx, sy } = axes(ship);
      const fish = Array.from({ length: 6 + Math.floor(Math.random() * 6) }, () => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.16), silver);
        root.add(m);
        const side = Math.random() < 0.5 ? -1 : 1;
        return { m, x0: ship.x + fx * (3 + Math.random() * 3) + sx * side * Math.random(), y0: ship.y + fy * (3 + Math.random() * 3) + sy * side * Math.random(), dx: sx * side, dy: sy * side, delay: Math.random() * 2 };
      });
      sound('splash_small', { gain: 0.15, pan: 0, rate: 1.4 });
      return {
        kind: 'flyingFish',
        root,
        at: clock,
        update(t) {
          for (const f of fish) {
            const u = Math.max(0, Math.min(1, (t - this.at - f.delay) / 1.6));
            f.m.visible = u > 0 && u < 1;
            f.m.position.set(f.x0 + f.dx * u * 4, 0.1 + Math.sin(Math.PI * u) * 0.5, f.y0 + f.dy * u * 4);
            f.m.lookAt(f.x0 + f.dx * 10, 0.3, f.y0 + f.dy * 10);
          }
        },
      };
    },
    // A whale off her beam: the long back rises, she blows, and her flukes go up as she sounds.
    whale(ship) {
      const root = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 10), whaleSkin);
      body.scale.set(0.9, 0.6, 4);
      const flukes = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.45), whaleSkin);
      flukes.position.z = 2.1;
      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 10, 1, true), spray);
      plume.position.set(0, 1, -1.4);
      plume.rotation.x = Math.PI;
      root.add(body, flukes, plume);
      const { fx, fy, sx, sy } = axes(ship);
      const side = Math.random() < 0.5 ? -1 : 1;
      const d = 8 + Math.random() * 5;
      root.position.set(ship.x + sx * side * d + fx * 6, -1.2, ship.y + sy * side * d + fy * 6);
      root.rotation.y = Math.atan2(-fx, -fy);
      let blown = false;
      return {
        kind: 'whale',
        root,
        at: clock,
        update(t, dt) {
          const age = t - this.at;
          const L = LASTS_S.whale;
          // Up over 3 s, along the surface, then down over the last 4 s, flukes rising as she goes.
          const up = age < 3 ? age / 3 : age > L - 4 ? Math.max(0, (L - age) / 4) : 1;
          root.position.y = -1.2 + up * 1.05;
          root.translateZ(-dt * 0.4);
          flukes.rotation.x = age > L - 4 ? -Math.min(1.2, (age - (L - 4)) * 0.6) : 0;
          flukes.position.y = age > L - 4 ? Math.min(1.2, (age - (L - 4)) * 0.6) : 0;
          const blow = age - 4;
          plume.visible = blow > 0 && blow < 2.5;
          if (plume.visible) {
            plume.scale.setScalar(0.4 + blow * 0.5);
            (plume.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - blow / 2.5);
          }
          if (blow > 0 && !blown) {
            blown = true;
            sound('whale_blow', { gain: 0.25, pan: pan(ship, root.position.x), lowpass: 1500 });
          }
        },
      };
    },
    // Gulls wheeling over her, a few tiles up, while the land is near.
    gulls(ship) {
      const root = new THREE.Group();
      const flock = Array.from({ length: 3 + Math.floor(Math.random() * 4) }, (_, i) => {
        const g = new THREE.Group();
        const wings = [-1, 1].map((side) => {
          const w = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.015, 0.09), white);
          w.geometry.translate((side * 0.32) / 2, 0, 0);
          g.add(w);
          return { w, side };
        });
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), white);
        body.scale.z = 2.2;
        g.add(body);
        root.add(g);
        return { g, wings, r: 2 + Math.random() * 3, h: 2.2 + Math.random() * 1.6, speed: 0.4 + Math.random() * 0.3, phase: (i / 5) * Math.PI * 2 };
      });
      return {
        kind: 'gulls',
        root,
        at: clock,
        update(t, _dt, s) {
          for (const b of flock) {
            const a = b.phase + t * b.speed;
            b.g.position.set(s.x + Math.cos(a) * b.r, b.h + Math.sin(t * 0.8 + b.phase) * 0.2, s.y + Math.sin(a) * b.r);
            // Facing along the circle, wings beating, now and then a glide.
            b.g.rotation.set(0, -a, 0.25);
            const beat = Math.sin(t * 9 + b.phase) * (Math.sin(t * 0.5 + b.phase) > 0.3 ? 0.05 : 0.5);
            for (const w of b.wings) w.w.rotation.z = w.side * beat;
          }
          if (Math.random() < 0.004) sound('gull', { gain: 0.2, pan: (Math.random() - 0.5) * 1.2, rate: 0.9 + Math.random() * 0.3 });
        },
      };
    },
  };

  const start = (kind: WildlifeKind, ship: Ship) => {
    const e = spawners[kind](ship);
    if (!e) return;
    object.add(e.root);
    events.push(e);
  };

  return {
    object,
    /** Each frame at sea: chances of new events where they fit, and the ones under way move on. `hour` 0..24. */
    update(ship: Ship, dt: number, hour: number) {
      clock += dt;
      last = ship;
      const day = hour >= 6 && hour < 19;
      const open = !landWithin(ship.x, ship.y, 5);
      const fits: Record<WildlifeKind, boolean> = {
        dolphins: day && open && ship.speed > 0.2,
        flyingFish: day && open && ship.speed > 0.2,
        whale: day && !landWithin(ship.x, ship.y, 14),
        gulls: day && landWithin(ship.x, ship.y, 10),
      };
      for (const kind of Object.keys(EVERY_S) as WildlifeKind[]) {
        next[kind] -= dt;
        if (next[kind] > 0) continue;
        next[kind] = EVERY_S[kind] * (0.6 + Math.random() * 0.8);
        if (fits[kind] && !events.some((e) => e.kind === kind)) start(kind, ship);
      }
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]!;
        // Gulls go when the land falls astern; everything goes when its time is up.
        if (clock - e.at > LASTS_S[e.kind] || (e.kind === 'gulls' && !fits.gulls && clock - e.at > 8)) {
          object.remove(e.root);
          events.splice(i, 1);
          continue;
        }
        e.update(clock, dt, ship);
      }
    },
    /** Debug: start an event now, where she is; and how many animals are out. */
    spawn(kind: WildlifeKind) {
      if (last) start(kind, last);
    },
    get count() {
      return events.reduce((n, e) => n + e.root.children.length, 0);
    },
  };
}
