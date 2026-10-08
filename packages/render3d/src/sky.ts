import * as THREE from 'three';

// The sky (Pirates! 2004: a simple painted blue, deep overhead and pale at the horizon, not a physical sky,
// whose glare washed out a low camera looking toward the sun): a dome around the camera, its colours set by the
// time of day, with a soft sun glow.

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
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  // A soft glow round the sun, and a small bright disc (kept below the bloom threshold, so it doesn't flood).
  float toward = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(toward, 12.0) * 0.18 + pow(toward, 900.0) * 0.6);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SkyDome {
  mesh: THREE.Mesh;
  /** Each frame: centre on the camera and paint the time of day. */
  update(camera: THREE.Vector3, zenith: THREE.Color, horizon: THREE.Color, sunDir: THREE.Vector3, sun: THREE.Color): void;
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
  };
}
