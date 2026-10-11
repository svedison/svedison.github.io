// Thin high cloud streaks low over the sea, lit from behind by the setting sun (golden rims near the sun,
// lavender-grey away from it). A camera-following dome section drawn right after the sky, before the world.
// Its alpha also feeds the ray mask, so clouds partly interrupt the sun shafts (3d-sky-rays).
import type * as THREE_NS from 'three';
import { GLSL_NOISE } from '../../systems/noise';
import type { Sky } from '../../systems/sky';

type THREE = typeof THREE_NS;

export function createClouds(THREE: THREE, sky: Sky) {
  const uniforms: Record<string, THREE_NS.IUniform> = {
    uSunDir: sky.uniforms.uSunDir,
    uSunCol: sky.uniforms.uSunColor,
    uHorizon: sky.uniforms.uHorizon,
    uZenith: sky.uniforms.uZenith,
    uTime: { value: 0 },
    uCover: { value: 1 },
  };
  const geo = new THREE.SphereGeometry(850, 48, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    // depth-tested against the far-pinned dome depth: the deck sits behind everything, so it can never wash over a
    // palm crown or the bluffs that stand above the horizon (it used to draw over them as a pale ghost band)
    depthTest: true,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * (modelMatrix * vec4(position, 1.0));
        gl_Position.z = gl_Position.w * 0.99998;
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uSunDir, uSunCol, uHorizon, uZenith;
      uniform float uTime, uCover;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        if (d.y < 0.002) discard;
        // project onto a high cloud deck; streaks stretched along the wind
        vec2 p = d.xz / (d.y + 0.045);
        float ca = 0.83, sa = 0.56;
        p = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
        p *= vec2(0.16, 0.9);
        p.x += uTime * 0.004;
        float n = fbm(p * 1.3 + vec2(3.1, 7.7), 5);
        float n2 = fbm(p * 4.1 + n * 1.7, 3);
        float dens = smoothstep(0.5, 0.76, n * 0.8 + n2 * 0.32) * uCover;
        // keep them to a band low over the sea, dissolving into the horizon haze
        float el = d.y;
        dens *= smoothstep(0.012, 0.05, el) * (1.0 - smoothstep(0.2, 0.38, el));
        float cs = max(dot(d, uSunDir), 0.0);
        vec3 shade = mix(vec3(0.62, 0.5, 0.56), mix(uHorizon, uZenith, 0.35) * 0.95, 0.4);
        vec3 lit = uSunCol * (1.1 + 2.6 * pow(cs, 24.0));
        vec3 col = mix(shade, lit, 0.25 + 0.75 * pow(cs, 4.0));
        // thin edges glow (silver lining) toward the sun
        col += uSunCol * pow(cs, 40.0) * (1.0 - dens) * 2.5;
        col = mix(col, uHorizon, exp(-el * 22.0) * 0.6);
        float a = dens * 0.78;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'coast-clouds';
  mesh.frustumCulled = false;
  mesh.renderOrder = -999;
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.position.copy(camera.position);
    mesh.updateMatrixWorld();
  };
  return {
    mesh,
    update(time: number) {
      uniforms.uTime.value = time;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
