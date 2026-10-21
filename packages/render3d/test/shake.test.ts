import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createShake, drawShaken } from '../src/shake';

/** The camera's greatest turn over the next `s` seconds, at 60 frames a second. */
const peak = (shake: ReturnType<typeof createShake>, s = 0.3) => {
  let max = 0;
  for (let i = 0; i < s * 60; i++) {
    const r = shake.update(1 / 60);
    max = Math.max(max, Math.abs(r.yaw), Math.abs(r.pitch), Math.abs(r.roll));
  }
  return max;
};

describe('the battle camera shake', () => {
  it('a light knock barely stirs it; a heavy blow punches far harder than its share', () => {
    const light = createShake();
    light.add(0.2);
    const heavy = createShake();
    heavy.add(0.8);
    // Trauma squared: four times the trauma, about sixteen times the turn.
    expect(peak(heavy)).toBeGreaterThan(peak(light) * 8);
  });

  it('dies away on its own, and adds up to no more than full', () => {
    const shake = createShake();
    shake.add(0.7);
    shake.add(0.7);
    expect(shake.trauma).toBe(1);
    peak(shake, 1);
    expect(shake.trauma).toBe(0);
    expect(shake.update(1 / 60)).toEqual({ yaw: 0, pitch: 0, roll: 0 });
  });

  it('a fresh view (no time passed) neither ages it nor turns it twice as hard', () => {
    const shake = createShake();
    shake.add(0.5);
    shake.update(0);
    expect(shake.trauma).toBe(0.5);
  });

  it('the player can turn it off', () => {
    const shake = createShake();
    shake.setScale(0);
    shake.add(1);
    expect(peak(shake)).toBe(0);
  });

  it('shakes only the frame drawn: afterwards projecting and picking see the camera still', () => {
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 4000);
    camera.position.set(0, 30, 30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const onScreen = () => new THREE.Vector3(5, 0, -3).project(camera);
    const still = onScreen();
    let shaken: THREE.Vector3 | undefined;
    drawShaken(camera, { yaw: 0.016, pitch: 0.02, roll: 0.012 }, () => {
      // As the renderer does when it draws: the matrices rebuilt from the turned camera.
      camera.updateMatrixWorld();
      shaken = onScreen();
    });
    expect(shaken!.distanceTo(still)).toBeGreaterThan(0.01);
    expect(onScreen().distanceTo(still)).toBeLessThan(1e-9);
  });
});
