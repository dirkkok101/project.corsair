import * as THREE from 'three';

// The sea is painted in screen colours: the colours measured off the reference footage, mixed as a painter
// mixes them. Its shader then carries each pixel back through the frame's pipeline to the linear colour it must
// output (the OutputPass applies Three's ACES filmic curve at the renderer's exposure, then sRGB encoding), so
// what was painted is what appears. Mixing in linear light instead would make a little white foam glare, since
// ACES needs a very bright input to reach near-white.

// Three's ACESFilmicToneMapping (r186), as row-major matrices.
const IN = new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777);
const OUT = new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602);

const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);

/** Linear scene colour -> the sRGB colour on screen, as the OutputPass draws it. */
export function toScreen(linear: THREE.Color, exposure: number, out = new THREE.Color()): THREE.Color {
  const v = new THREE.Vector3(linear.r, linear.g, linear.b).multiplyScalar(exposure / 0.6).applyMatrix3(IN);
  v.set(fit(v.x), fit(v.y), fit(v.z)).applyMatrix3(OUT);
  out.setRGB(THREE.MathUtils.clamp(v.x, 0, 1), THREE.MathUtils.clamp(v.y, 0, 1), THREE.MathUtils.clamp(v.z, 0, 1));
  return out.convertLinearToSRGB();
}

/** A colour's sRGB components as they read in a hex code, for a shader that paints in screen colours. */
export function screen(hex: string): THREE.Vector3 {
  const c = new THREE.Color(hex).convertLinearToSRGB();
  return new THREE.Vector3(c.r, c.g, c.b);
}

const glslMat = (m: THREE.Matrix3) => `mat3(${Array.from(m.elements, (e) => e.toFixed(7)).join(', ')})`;

/**
 * GLSL: `vec3 screenToScene(vec3 srgb)`, the linear colour that shows as `srgb` on screen at `uExposure`. The
 * inverse of the OutputPass: sRGB decode, the ACES output matrix, its RRT/ODT fit (the positive root of its
 * quadratic, per channel) and its input matrix, undone in turn. Channels are held below 0.95: the curve's inverse
 * runs off to infinity toward 1, and anything brighter would flare in the bloom.
 */
export const SCREEN_TO_SCENE = /* glsl */ `
uniform float uExposure;
vec3 screenToScene(vec3 srgb) {
  vec3 c = clamp(srgb, 0.0, 0.95);
  vec3 lin = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  vec3 y = max(${glslMat(OUT.clone().invert())} * lin, 0.0);
  vec3 a = 1.0 - 0.983729 * y;
  vec3 b = 0.0245786 - 0.432951 * y;
  vec3 k = -(0.000090537 + 0.238081 * y);
  vec3 v = (-b + sqrt(b * b - 4.0 * a * k)) / (2.0 * a);
  return max(${glslMat(IN.clone().invert())} * v, 0.0) * (0.6 / uExposure);
}
`;
