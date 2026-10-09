import * as THREE from 'three';

// The sky: a dome around the camera, deep overhead and pale at the horizon, its colours set by the time of day,
// with a soft sun glow. Under the weather's overcast it fills with a lid of drifting grey cloud, heavy and dark
// in a storm, and the sun fades behind it.

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uOvercast;
uniform float uTime;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  // A soft glow round the sun, and a small bright disc (kept below the bloom threshold, so it doesn't flood),
  // both lost behind the cloud.
  float toward = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(toward, 12.0) * 0.18 + pow(toward, 900.0) * 0.6) * (1.0 - uOvercast * 0.9);
  // The cloud deck: drifting cloud projected on a high ceiling, covering more of the sky the heavier the weather,
  // its undersides darker, lit a little toward the sun; it thins out down to the horizon's haze.
  if (uOvercast > 0.01 && d.y > 0.0) {
    vec2 at = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.005);
    float cover = fbm(at);
    float amount = smoothstep(1.0 - uOvercast * 0.95, 1.15 - uOvercast * 0.6, cover + uOvercast * 0.35);
    float base = fbm(at * 1.9 + 5.3);
    vec3 cloudCol = mix(uHorizon * 0.55, uHorizon * 1.15, base) * mix(1.0, 0.7, uOvercast);
    cloudCol += uSunColor * pow(toward, 6.0) * 0.12 * (1.0 - uOvercast);
    col = mix(col, cloudCol, amount * smoothstep(0.0, 0.18, d.y));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SkyDome {
  mesh: THREE.Mesh;
  /** Each frame: centre on the camera and paint the time of day. */
  update(camera: THREE.Vector3, zenith: THREE.Color, horizon: THREE.Color, sunDir: THREE.Vector3, sun: THREE.Color): void;
  /** The weather's overcast, 0 clear .. 1 storm, and the time (seconds) the cloud drifts by. */
  setOvercast(amount: number, t: number): void;
}

export function createSky(): SkyDome {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uOvercast: { value: 0 },
      uTime: { value: 0 },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  const u = material.uniforms as Record<string, THREE.IUniform>;
  return {
    mesh,
    update(camera, zenith, horizon, sunDir, sun) {
      mesh.position.copy(camera);
      (u.uZenith!.value as THREE.Color).copy(zenith);
      (u.uHorizon!.value as THREE.Color).copy(horizon);
      (u.uSunDir!.value as THREE.Vector3).copy(sunDir);
      (u.uSunColor!.value as THREE.Color).copy(sun);
    },
    setOvercast(amount, t) {
      u.uOvercast!.value = amount;
      u.uTime!.value = t;
    },
  };
}
