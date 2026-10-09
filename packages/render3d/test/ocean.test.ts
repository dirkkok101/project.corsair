import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createOcean } from '../src/sea/ocean';
import type { SeaLight } from '../src/sea/ocean';

const light: SeaLight = {
  sunDir: new THREE.Vector3(0, 1, 0),
  sun: new THREE.Color('#fff4d6'),
  sky: new THREE.Color('#9fd3f0'),
  level: 1,
  fog: new THREE.Color('#9fd3f0'),
  fogDensity: 0.001,
};

function ocean() {
  const depth = new THREE.DataTexture(new Uint8Array(16 * 16 * 2), 16, 16, THREE.RGFormat, THREE.UnsignedByteType);
  return createOcean(depth, 16, 16);
}

describe('the sea ships ride', () => {
  it('stays within the swell heights the wind allows', () => {
    const sea = ocean();
    const at = new THREE.Vector3();
    sea.update(at, { toDeg: 90, strength: 1 }, 0, light);
    let max = 0;
    for (let x = -40; x <= 40; x += 0.7) for (let z = -40; z <= 40; z += 0.7) max = Math.max(max, Math.abs(sea.heightAt(x, z)));
    expect(max).toBeGreaterThan(0.02);
    expect(max).toBeLessThanOrEqual(0.07 + 0.04 + 0.022 + 1e-9);
  });

  it('moves downwind, slowly', () => {
    const sea = ocean();
    const at = new THREE.Vector3();
    // Wind going east: a second on, the water looks most like it did a third of a tile to the west.
    sea.update(at, { toDeg: 90, strength: 0.8 }, 0, light);
    const before = (dx: number) => Array.from({ length: 80 }, (_, i) => sea.heightAt(i * 0.5 + dx, 3));
    const was = { west: before(-0.33), east: before(0.33), still: before(0) };
    for (let t = 1 / 60; t <= 1 + 1e-9; t += 1 / 60) sea.update(at, { toDeg: 90, strength: 0.8 }, t, light);
    const now = before(0);
    const off = (h: number[]) => h.reduce((n, v, i) => n + Math.abs(v - now[i]!), 0) / h.length;
    expect(off(was.west)).toBeLessThan(off(was.still));
    expect(off(was.still)).toBeLessThan(off(was.east));
  });

  it('turns with the wind without jolting the water under the camera', () => {
    const sea = ocean();
    const at = new THREE.Vector3(300, 0, 200);
    sea.update(at, { toDeg: 90, strength: 0.8 }, 0, light);
    let last = sea.heightAt(at.x, at.z);
    let jolt = 0;
    // The wind swings round a quarter; frame to frame, the water under the target barely changes.
    for (let i = 1; i <= 600; i++) {
      sea.update(at, { toDeg: 180, strength: 0.8 }, i / 60, light);
      const h = sea.heightAt(at.x, at.z);
      jolt = Math.max(jolt, Math.abs(h - last));
      last = h;
    }
    expect(jolt).toBeLessThan(0.004);
  });
});
