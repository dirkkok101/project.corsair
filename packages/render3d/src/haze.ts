import * as THREE from 'three';

/**
 * How much haze at most (x, 0..1): zoomed out the map shows through it. The haze is measured by distance from the
 * camera (not depth, so it doesn't swing as the view turns), so it always lies toward the horizon, never as a ring.
 * A plain object, not a three vector, so every material shares it (see installHaze).
 */
export const HAZE_AROUND = { x: 1, y: 0, z: 0, w: 0 };

/** One haze for every built-in material (land, towns, ships, smoke): three's fog chunks, by distance from the camera, up to HAZE_AROUND.x. */
export function installHaze(): void {
  if (THREE.ShaderChunk.fog_pars_vertex.includes('hazeAround')) return;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  uniform vec4 hazeAround;
  varying float vFogDepth;
#endif
`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = length(mvPosition.xyz);
#endif
`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec4 hazeAround;
  varying float vFogDepth;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor * hazeAround.x );
#endif
`;
  // Every material's uniforms are cloned from these; a plain object (not a three vector) is shared, not copied,
  // so setting HAZE_AROUND reaches them all.
  for (const shader of Object.values(THREE.ShaderLib)) shader.uniforms.hazeAround = { value: HAZE_AROUND };
}
