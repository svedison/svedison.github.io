// Aerial perspective that fogs everything into the SAME horizon colour the sky dome draws
// (3d-ultra-realistic-water: "fog into the same haze function the sky draws"). The GLSL mirrors the horizon row of
// systems/sky.ts (y = 0) and its sun halo, and its uniforms are the sky's own uniform objects, so the ocean, the
// bluffs, palms and surf all fade into one atmosphere with no line where land or water meets the sky.
import type * as THREE_NS from 'three';
import type { Sky } from '../../systems/sky';

export const HAZE_GLSL = /* glsl */ `
uniform vec3 uHzHorizon;
uniform vec3 uHzSunCol;
uniform float uHzSun;
uniform float uHzK;
uniform vec3 uSunDir;
vec3 oceanHaze(vec3 d){
  d = normalize(vec3(d.x, 0.0, d.z) + 1e-5);
  float sunAz = max(0.0, dot(normalize(d.xz), normalize(uSunDir.xz + 1e-5)));
  vec3 c = mix(uHzHorizon, mix(uHzHorizon, uHzSunCol, 0.35 * pow(sunAz, 3.0) * uHzSun) * 1.04, 0.55);
  float cs = max(dot(d, uSunDir), 0.0);
  c += uHzSunCol * (pow(cs, 8.0) * 0.32 + pow(cs, 90.0) * 0.55) * uHzSun * 0.85;
  return c;
}
float hazeAmount(float dist){
  float f = 1.0 - exp(-dist * uHzK);
  return pow(clamp(f, 0.0, 1.0), 1.6);
}
`;

export type HazeUniforms = Record<string, THREE_NS.IUniform>;

/** Uniform objects shared with the sky (same JS objects, so one update moves everything). */
export function hazeUniforms(sky: Sky, k: number): HazeUniforms {
  return {
    uHzHorizon: sky.uniforms.uHorizon,
    uHzSunCol: sky.uniforms.uSunColor,
    uHzSun: sky.uniforms.uSun,
    uSunDir: sky.uniforms.uSunDir,
    uHzK: { value: k },
  };
}

/**
 * Patch a built-in lit material (Standard / Lambert / Basic, instanced or not) so its fog is the sky haze.
 * `extraFrag` runs before the haze (e.g. back-lit translucency) with `vHzWorld` available.
 */
export function applyHaze(
  mat: THREE_NS.Material,
  uniforms: HazeUniforms,
  key: string,
  opts: { extraUniforms?: HazeUniforms; fragHead?: string; extraFrag?: string; hazeScale?: number } = {},
) {
  const hazeScale = (opts.hazeScale ?? 1).toFixed(3);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, opts.extraUniforms ?? {});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHzWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 hzp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            hzp = instanceMatrix * hzp;
          #endif
          vHzWorld = (modelMatrix * hzp).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHzWorld;\n' + HAZE_GLSL + (opts.fragHead ?? ''))
      .replace(
        '#include <fog_fragment>',
        `${opts.extraFrag ?? ''}
        {
          vec3 hzV = vHzWorld - cameraPosition;
          float hzD = length(hzV);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, oceanHaze(hzV / max(hzD, 1e-3)), hazeAmount(hzD) * ${hazeScale});
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'coast-haze-' + key;
}
