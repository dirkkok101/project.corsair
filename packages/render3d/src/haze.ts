import * as THREE from 'three';

/**
 * Where the haze is measured from. At sea it is her lookouts' sight, so it rings her ship (x, z: world tiles;
 * radial 1): a thing hazes by how far it lies from her, across the water, wherever the camera stands, and what is
 * past her sight is all haze. In battle (radial 0) it is by depth from the camera, as three has it. `cap` is how
 * much haze at most: zoomed out the map shows through it (the fog of war as a ring round her).
 */
export const HAZE_AROUND = { x: 0, y: 1, z: 0, w: 0 };

/** One haze for every built-in material (land, towns, ships, smoke): three's fog chunks, measured as HAZE_AROUND says. */
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
  // Back from the view to the world: the view matrix is a turn and a shift, so its inverse turn is its transpose.
  vec3 hazeWorld = (mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix);
  vFogDepth = hazeAround.w > 0.5 ? length(hazeWorld.xz - hazeAround.xz) : -mvPosition.z;
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
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor * hazeAround.y );
#endif
`;
  // Every material's uniforms are cloned from these; a plain object (not a three vector) is shared, not copied,
  // so setting HAZE_AROUND reaches them all.
  for (const shader of Object.values(THREE.ShaderLib)) shader.uniforms.hazeAround = { value: HAZE_AROUND };
}
