// HDR pipeline for the crossing (3d-ultra-realistic-water "Colour and pipeline"): the scene renders linear HDR into
// a HalfFloat target, a small dual-filter bloom catches lantern glow and glitter, and one composite applies the
// exposure, ACES, sRGB, vignette and grain. The composite also draws the bubble churn that hides the
// above/below-water seam (build-threejs-scroll-worlds: hide discontinuities inside dense atmosphere).
import type * as THREE_NS from 'three';
import type { QualityTier } from '../../../bus';

type THREE = typeof THREE_NS;

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const PREFILTER = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold, uKnee;
varying vec2 vUv;
void main(){
  vec2 o = uTexel * 0.5;
  vec3 c = (texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb
          + texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb) * 0.25;
  // one NaN/Inf texel (a degenerate normal somewhere) must never bloom into a white frame
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  c = min(c, vec3(40.0));
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  rq = rq * rq / (4.0 * uKnee + 1e-4);
  float w = max(rq, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(c * w, 1.0);
}`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  vec2 o = uTexel;
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv - o).rgb + texture2D(tSrc, vUv + o).rgb;
  s += texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb + texture2D(tSrc, vUv - vec2(o.x, -o.y)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

const UP = /* glsl */ `
uniform sampler2D tSrc, tAdd; uniform vec2 uTexel; uniform float uAddGain; varying vec2 vUv;
void main(){
  vec2 o = uTexel;
  vec3 s = texture2D(tSrc, vUv + vec2(-o.x * 2.0, 0.0)).rgb + texture2D(tSrc, vUv + vec2(o.x * 2.0, 0.0)).rgb
         + texture2D(tSrc, vUv + vec2(0.0, -o.y * 2.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, o.y * 2.0)).rgb;
  s += (texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb
      + texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb) * 2.0;
  gl_FragColor = vec4(s / 12.0 + texture2D(tAdd, vUv).rgb * uAddGain, 1.0);
}`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene, tBloom;
uniform float uExposure, uBloom, uChurn, uTime, uUnder, uGrain, uVignette, uAspect, uContrast;
uniform vec3 uChurnDeep, uChurnFoam, uLift;
uniform vec4 uCalm; uniform float uCalmK;
varying vec2 vUv;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + 1.0), u.x), u.y); }
// ACES fitted (Narkowicz) is too contrasty for paper; use the RRT/ODT fit three.js ships.
vec3 xRrtOdt(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 xAces(vec3 c){
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= 1.0 / 0.6; c = IN * c; c = xRrtOdt(c); c = OUT * c; return clamp(c, 0.0, 1.0);
}
vec3 xSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
// Rising bubbles: sparse jittered cells scrolled upward at per-column speeds. Most are soft, out-of-focus discs
// smeared along their climb (the lens is moving through them); a few near ones carry a small specular catch.
float bubbles(vec2 uv, float scale, float speed, float seed, float keepAbove){
  vec2 p = vec2(uv.x * uAspect, uv.y) * scale;
  float sp = speed * (0.55 + 0.9 * h12(vec2(floor(p.x), seed)));
  p.y -= uTime * sp;
  vec2 c = floor(p), f = fract(p);
  float keep = step(keepAbove, h12(c + seed * 3.1));
  vec2 o = h22(c + seed) * 0.5 + 0.25;
  float r = 0.05 + 0.26 * pow(h12(c * 1.7 + seed), 2.2);
  vec2 d = f - o;
  d.y *= 0.5 + 0.25 * h12(c + 9.0); // vertical smear along the climb
  float disc = smoothstep(r, r * 0.15, length(d));
  float catchL = smoothstep(r * 0.35, 0.0, length(d - vec2(-0.32, 0.18) * r)) * step(0.12, r);
  return keep * (disc * 0.42 + catchL * 0.6);
}
void main(){
  vec2 uv = vUv;
  // refraction wobble while churning
  float wob = uChurn * 0.012;
  uv += wob * vec2(sin(uv.y * 23.0 + uTime * 2.1) + 0.5 * sin(uv.y * 57.0 - uTime * 3.3), cos(uv.x * 19.0 - uTime * 1.7));
  vec3 hdr = texture2D(tScene, uv).rgb + texture2D(tBloom, uv).rgb * uBloom;
  if (any(isnan(hdr)) || any(isinf(hdr))) hdr = vec3(0.0);
  vec3 col = xAces(hdr * uExposure);
  col += uLift * (1.0 - col);
  // gentle S-curve (more at dawn, where the haze would otherwise flatten the frame)
  col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);
  // reading calm: highlights (sun glitter, god-ray core) are compressed behind the copy block so the type always sits
  // on a mid-dark ground. An ellipse around the block with a very wide smooth falloff (no separable rect: its
  // straight sides showed as a vertical edge across the dawn sky), so it reads as light falling off, never a box.
  if (uCalmK > 0.001){
    vec2 cc = (uCalm.xy + uCalm.zw) * 0.5;
    vec2 rr = (uCalm.zw - uCalm.xy) * 0.5 + vec2(0.2);
    float m = 1.0 - smoothstep(0.35, 1.0, length((vUv - cc) / rr));
    m *= m * (3.0 - 2.0 * m);
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    // (uCalmK may exceed 1 at dawn: the flat orange sky is mid-bright, not a highlight, and still needs the calm to
    // hold the copy at 4.5:1; capped so the ground never goes flat black)
    col *= 1.0 - m * min(uCalmK * smoothstep(0.06, 0.7, l) * 0.55, 0.74);
  }
  // churn: a wall of aerated water and foam the camera pushes through
  if (uChurn > 0.001){
    float n = vn(vec2(uv.x * uAspect, uv.y) * 5.0 + vec2(0.0, -uTime * 0.6)) * 0.6 + vn(vec2(uv.x * uAspect, uv.y) * 13.0 + vec2(uTime * 0.2, -uTime * 1.4)) * 0.4;
    vec3 mist = mix(uChurnDeep, uChurnFoam, smoothstep(0.35, 0.95, n) * 0.55 + (1.0 - vUv.y) * 0.08);
    float b = bubbles(uv, 5.0, 0.7, 1.0, 0.72) * 0.9 + bubbles(uv, 11.0, 1.2, 7.0, 0.78) * 0.7 + bubbles(uv, 26.0, 2.0, 13.0, 0.84) * 0.45;
    mist += uChurnFoam * b * 0.5 * smoothstep(0.25, 0.9, uChurn);
    col = mix(col, mist, smoothstep(0.0, 1.0, uChurn) * 0.97);
  }
  // vignette (stronger under water: the edges of the light)
  vec2 q = vUv - 0.5;
  float v = 1.0 - dot(q * vec2(uAspect * 0.72, 1.0), q * vec2(uAspect * 0.72, 1.0)) * (uVignette + uUnder * 0.5);
  col *= clamp(v, 0.0, 1.0);
  col = xSRGB(col);
  col += (h12(gl_FragCoord.xy + fract(uTime * 7.13) * 91.0) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}`;

export interface Post {
  /** The HDR target the scene renders into. */
  readonly scene: THREE_NS.WebGLRenderTarget;
  uniforms: Record<string, THREE_NS.IUniform>;
  /** Resize to the renderer's drawing buffer when it changes. Call each frame (cheap check). */
  sync(renderer: THREE_NS.WebGLRenderer): void;
  /** Bloom + composite to the canvas. */
  finish(renderer: THREE_NS.WebGLRenderer): void;
  setTier(t: QualityTier): void;
  dispose(): void;
}

export function createPost(THREE: THREE, tier: QualityTier): Post {
  const rtOpts = {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
  };
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: true, samples: tier === 'high' ? 4 : 0 });
  const LEVELS = 5;
  const down: THREE_NS.WebGLRenderTarget[] = [];
  const up: THREE_NS.WebGLRenderTarget[] = [];
  for (let i = 0; i < LEVELS; i++) {
    down.push(new THREE.WebGLRenderTarget(1, 1, rtOpts));
    up.push(new THREE.WebGLRenderTarget(1, 1, rtOpts));
  }
  let levels = tier === 'low' ? 3 : LEVELS;

  const mk = (frag: string, uniforms: Record<string, THREE_NS.IUniform>) =>
    new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const preMat = mk(PREFILTER, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.8 }, uKnee: { value: 0.7 } });
  const downMat = mk(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const upMat = mk(UP, { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() }, uAddGain: { value: 1 } });
  const uniforms: Record<string, THREE_NS.IUniform> = {
    tScene: { value: sceneRT.texture },
    tBloom: { value: null },
    uExposure: { value: 1 },
    uBloom: { value: 0.35 },
    uChurn: { value: 0 },
    uTime: { value: 0 },
    uUnder: { value: 0 },
    uGrain: { value: 0.018 },
    uVignette: { value: 0.55 },
    uAspect: { value: 1 },
    uChurnDeep: { value: new THREE.Color('#0c2a33') },
    uChurnFoam: { value: new THREE.Color('#9fc3c4') },
    uLift: { value: new THREE.Color(0, 0, 0) },
    uContrast: { value: 0.15 },
    uCalm: { value: new THREE.Vector4(0, 0, 0, 0) },
    uCalmK: { value: 0 },
  };
  const compMat = mk(COMPOSITE, uniforms);

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat);
  quad.frustumCulled = false;
  const fsScene = new THREE.Scene();
  fsScene.add(quad);
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2(-1, -1);
  const tmp = new THREE.Vector2();

  function pass(renderer: THREE_NS.WebGLRenderer, mat: THREE_NS.ShaderMaterial, target: THREE_NS.WebGLRenderTarget | null) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(fsScene, fsCam);
  }

  return {
    scene: sceneRT,
    uniforms,
    sync(renderer) {
      renderer.getDrawingBufferSize(tmp);
      if (tmp.x === size.x && tmp.y === size.y) return;
      size.copy(tmp);
      sceneRT.setSize(size.x, size.y);
      let w = Math.max(1, Math.round(size.x / 2));
      let h = Math.max(1, Math.round(size.y / 2));
      for (let i = 0; i < LEVELS; i++) {
        down[i].setSize(w, h);
        up[i].setSize(w, h);
        w = Math.max(1, Math.round(w / 2));
        h = Math.max(1, Math.round(h / 2));
      }
      uniforms.uAspect.value = size.x / Math.max(1, size.y);
    },
    finish(renderer) {
      const prevAuto = renderer.autoClear;
      renderer.autoClear = true;
      // bloom: prefilter at half res, dual-filter down/up chain
      preMat.uniforms.tSrc.value = sceneRT.texture;
      (preMat.uniforms.uTexel.value as THREE_NS.Vector2).set(1 / size.x, 1 / size.y);
      pass(renderer, preMat, down[0]);
      for (let i = 1; i < levels; i++) {
        downMat.uniforms.tSrc.value = down[i - 1].texture;
        (downMat.uniforms.uTexel.value as THREE_NS.Vector2).set(1 / down[i - 1].width, 1 / down[i - 1].height);
        pass(renderer, downMat, down[i]);
      }
      let src = down[levels - 1];
      for (let i = levels - 2; i >= 0; i--) {
        upMat.uniforms.tSrc.value = src.texture;
        upMat.uniforms.tAdd.value = down[i].texture;
        (upMat.uniforms.uTexel.value as THREE_NS.Vector2).set(1 / src.width, 1 / src.height);
        pass(renderer, upMat, up[i]);
        src = up[i];
      }
      uniforms.tBloom.value = src.texture;
      pass(renderer, compMat, null);
      renderer.autoClear = prevAuto;
    },
    setTier(t) {
      levels = t === 'low' ? 3 : LEVELS;
    },
    dispose() {
      sceneRT.dispose();
      down.forEach((r) => r.dispose());
      up.forEach((r) => r.dispose());
      preMat.dispose();
      downMat.dispose();
      upMat.dispose();
      compMat.dispose();
      quad.geometry.dispose();
    },
  };
}
