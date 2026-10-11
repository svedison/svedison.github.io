// Linear HDR target (MSAA on high), then one last pass: exposure, a light unsharp, vignette, ACES, sRGB, dither.
// (3d-wood-lighting-scorecard "Last pass": unsharp 0.10, vignette 0.42 + 0.58 v, ACES, sRGB, dither 0.003.)
// Rendering into a target means three applies no tone mapping of its own, so shafts and dust add in linear
// light and are mapped exactly once.
import * as THREE from 'three';
import type { QualityTier } from '../../../bus';

export function createPost(renderer: THREE.WebGLRenderer, tier: QualityTier) {
  const make = (t: QualityTier, w = 2, h = 2) =>
    new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: t === 'high' ? 4 : 0,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
  let target = make(tier);
  const mat = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      tHDR: { value: target.texture },
      uTexel: { value: new THREE.Vector2(1 / 2, 1 / 2) },
      uExposure: { value: 1.08 },
      uSharp: { value: 0.1 },
      uAspect: { value: 1.6 },
      // the copy column: x from .x (full shade) to .y (none), strength .z. Pieces passing under the story copy
      // fall into the room's shadow instead of fighting the text (desktop only; 0 on phones)
      uShade: { value: new THREE.Vector3(0.1, 0.42, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tHDR; uniform vec2 uTexel; uniform float uExposure, uSharp, uAspect; uniform vec3 uShade;
      varying vec2 vUv;
      vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main(){
        vec3 c = texture2D(tHDR, vUv).rgb;
        vec3 b = (texture2D(tHDR, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tHDR, vUv - vec2(uTexel.x, 0.0)).rgb
                + texture2D(tHDR, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tHDR, vUv - vec2(0.0, uTexel.y)).rgb) * 0.25;
        c = max(c + (c - b) * uSharp, 0.0);
        vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
        float v = 1.0 - smoothstep(0.35, 1.25, length(q * vec2(0.82, 1.0)));
        c *= (0.42 + 0.58 * v) * uExposure;
        c = toSRGB(aces(c));
        /* in display space, so even a hot metal highlight under the copy goes quiet */
        c *= 1.0 - uShade.z * (1.0 - smoothstep(uShade.x, uShade.y, vUv.x));
        c += (h12(gl_FragCoord.xy + fract(c.r * 91.7)) - 0.5) * 0.003;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  let w = 2,
    h = 2;
  return {
    get target() {
      return target;
    },
    setSize(nw: number, nh: number) {
      if (nw === w && nh === h) return;
      w = nw;
      h = nh;
      target.setSize(w, h);
      mat.uniforms.uTexel.value.set(1 / w, 1 / h);
      mat.uniforms.uAspect.value = w / h;
    },
    setTier(t: QualityTier) {
      const s = t === 'high' ? 4 : 0;
      if (target.samples === s) return;
      target.dispose();
      target = make(t, w, h);
      mat.uniforms.tHDR.value = target.texture;
    },
    setShade(x0: number, x1: number, k: number) {
      mat.uniforms.uShade.value.set(x0, x1, k);
    },
    render(cam: THREE.Camera) {
      renderer.render(scene, cam);
    },
    dispose() {
      target.dispose();
      quad.geometry.dispose();
      mat.dispose();
    },
  };
}
