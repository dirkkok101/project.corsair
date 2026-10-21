/**
 * The battle camera's shake: a broadside, a ball striking home, a mast going by the board. Events add "trauma" (0..1);
 * it fades at a steady rate, and the camera turns by trauma squared, so a light knock barely stirs it and a magazine
 * going up punches hard. The turn sways along summed sines at unrelated rates (a fresh random every frame only buzzes),
 * and it turns the camera rather than moving it, so it reads the same however far out the camera stands.
 */
import type * as THREE from 'three';

/** The camera's greatest turn (radians) at full trauma: yaw, pitch and roll. About 25 pixels on a 1080-pixel view. */
const MAX = { yaw: 0.016, pitch: 0.02, roll: 0.012 };
/** Trauma lost per second: a full shake is gone in under a second. */
const DECAY = 1.3;

export interface Shake {
  /** Adds trauma (0..1): it adds to what is still shaking, up to 1. */
  add(trauma: number): void;
  /** Ages it by `dt` seconds; the camera's turn now (radians). */
  update(dt: number): { yaw: number; pitch: number; roll: number };
  /** The player's setting: 1 the full shake, 0 none. */
  setScale(scale: number): void;
  reset(): void;
  readonly trauma: number;
}

/**
 * Draws one frame through the camera turned by `turn`, then sets it back: its rotation and its matrices too (drawing
 * rebuilds them from the turned rotation, and projecting and picking read the matrices), so nothing after the frame sees
 * the shake.
 */
export function drawShaken(camera: THREE.Camera, turn: { yaw: number; pitch: number; roll: number }, draw: () => void) {
  const still = camera.quaternion.clone();
  camera.rotateY(turn.yaw);
  camera.rotateX(turn.pitch);
  camera.rotateZ(turn.roll);
  draw();
  camera.quaternion.copy(still);
  camera.updateMatrixWorld();
}

export function createShake(): Shake {
  let trauma = 0;
  let t = 0;
  let scale = 1;
  return {
    add(amount) {
      trauma = Math.min(1, trauma + amount);
    },
    update(dt) {
      if (dt > 0) {
        trauma = Math.max(0, trauma - DECAY * dt);
        t += dt;
      }
      const k = trauma * trauma * scale;
      if (k === 0) return { yaw: 0, pitch: 0, roll: 0 };
      const sway = (a: number, b: number, seed: number) => 0.6 * Math.sin(t * a + seed) + 0.4 * Math.sin(t * b + seed * 2);
      return { yaw: MAX.yaw * k * sway(23, 37, 1), pitch: MAX.pitch * k * sway(29, 41, 2), roll: MAX.roll * k * sway(19, 31, 3) };
    },
    setScale(s) {
      scale = Math.max(0, Math.min(1, s));
    },
    reset() {
      trauma = 0;
    },
    get trauma() {
      return trauma;
    },
  };
}
