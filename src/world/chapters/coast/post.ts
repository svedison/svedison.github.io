// HDR pipeline for the coast:
//   scene -> HalfFloat target (linear HDR; alpha = 0 where the sky shows, 1 on anything opaque)
//   -> sun shafts (3d-sky-rays): half-res radial march toward the projected sun, sampling sky visibility × sky
//      brightness above a threshold, weights normalised so the sample count never changes exposure
//   -> small two-level bloom for the sun disc and glitter
//   -> composite: rays (attenuated on opaque foreground), bloom, warm grade, vignette, then ACES + sRGB once.
// Budget (SPEC §12.4): the HDR scene target is capped below the canvas DPR (1.5 desktop, 1.25 mobile) and upsampled
// by the composite. Tier: high = MSAA 2 + 40 ray samples at half res; medium = no MSAA + 24 samples at quarter res;
// low = no rays, no bloom. Mobile: rays at quarter res with 20 samples, no bloom.
// The composite also lays a soft paper wash behind the reading block (portrait: bottom; desktop: right-mid) so the
// dark ink copy keeps contrast over bright water.
import type * as THREE_NS from 'three';
import type { QualityTier } from '../../../bus';

type THREE = typeof THREE_NS;

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export interface CoastPost {
  /** Rays strength multiplier (0 = skip the pass). */
  rays: number;
  /** Sky luminance above which the sky feeds the shafts. */
  rayThreshold: number;
  /** Internal HDR resolution relative to the drawing buffer. */
  readonly internalScale: number;
  compile(renderer: THREE_NS.WebGLRenderer): void;
  render(renderer: THREE_NS.WebGLRenderer, scene: THREE_NS.Scene, camera: THREE_NS.PerspectiveCamera, sunDir: THREE_NS.Vector3, time: number): void;
  setTier(tier: QualityTier): void;
  uniforms: { exposure: THREE_NS.IUniform; rayTint: THREE_NS.IUniform; bloom: THREE_NS.IUniform; debug: THREE_NS.IUniform; plate: THREE_NS.IUniform };
  dispose(): void;
}

export interface CoastPostOptions {
  mobile: boolean;
}

export function createCoastPost(THREE: THREE, tier0: QualityTier, opts: CoastPostOptions = { mobile: false }): CoastPost {
  let tier = tier0;
  const mobile = opts.mobile;
  const msaa = (t: QualityTier) => (t === 'high' && !mobile ? 2 : 0);
  const raySamples = (t: QualityTier) => (mobile ? 20 : t === 'high' ? 40 : 24);
  const useBloom = () => tier !== 'low' && !mobile;
  const mkRT = (samples: number, depth: boolean) =>
    new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: depth,
      samples,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
  let rtScene = mkRT(msaa(tier), true);
  const rtRays = mkRT(0, false);
  const rtA = mkRT(0, false);
  const rtB = mkRT(0, false);
  const rtC = mkRT(0, false);
  const rtD = mkRT(0, false);

  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(quadGeo);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const rayU = {
    tScene: { value: null as THREE_NS.Texture | null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uThreshold: { value: 1.1 },
    uDensity: { value: 1.0 },
    uDecay: { value: 0.985 },
  };
  const raysMat = new THREE.ShaderMaterial({
    uniforms: rayU,
    vertexShader: VERT,
    defines: { SAMPLES: 40 },
    depthTest: false,
    depthWrite: false,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene;
      uniform vec2 uSun;
      uniform float uAspect, uThreshold, uDensity, uDecay;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 delta = (vUv - uSun) * uDensity / float(SAMPLES);
        vec2 uv = vUv - delta * hash(floor(gl_FragCoord.xy)); // stable jitter (no shimmer)
        float sum = 0.0, wsum = 0.0, w = 1.0;
        for (int i = 0; i < SAMPLES; i++){
          uv -= delta;
          if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0){
            vec4 s = texture2D(tScene, uv);
            float lum = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
            float e = min(max(lum - uThreshold, 0.0), 6.0);
            sum += e * (1.0 - clamp(s.a, 0.0, 1.0)) * w;
          }
          wsum += w;
          w *= uDecay;
        }
        float r = sum / max(wsum, 1e-4);
        vec2 dd = (vUv - uSun) * vec2(uAspect, 1.0);
        float fall = exp(-dot(dd, dd) * 2.2);
        gl_FragColor = vec4(vec3(r * fall), 1.0);
      }`,
  });

  const brightU = { tSrc: { value: null as THREE_NS.Texture | null }, uThreshold: { value: 2.4 } };
  const brightMat = new THREE.ShaderMaterial({
    uniforms: brightU,
    vertexShader: VERT,
    depthTest: false,
    depthWrite: false,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc; uniform float uThreshold; varying vec2 vUv;
      void main(){
        vec3 c = min(texture2D(tSrc, vUv).rgb, vec3(60.0));
        float l = max(max(c.r, c.g), c.b);
        float k = smoothstep(uThreshold - 0.8, uThreshold + 0.8, l);
        gl_FragColor = vec4(c * k, 1.0);
      }`,
  });
  const blurU = { tSrc: { value: null as THREE_NS.Texture | null }, uDir: { value: new THREE.Vector2() } };
  const blurMat = new THREE.ShaderMaterial({
    uniforms: blurU,
    vertexShader: VERT,
    depthTest: false,
    depthWrite: false,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tSrc, vUv).rgb * 0.2270;
        c += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.3162;
        c += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.0703;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const copyU = { tSrc: { value: null as THREE_NS.Texture | null } };
  const copyMat = new THREE.ShaderMaterial({
    uniforms: copyU,
    vertexShader: VERT,
    depthTest: false,
    depthWrite: false,
    fragmentShader: `uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }`,
  });

  const compU = {
    tScene: { value: null as THREE_NS.Texture | null },
    tRays: { value: null as THREE_NS.Texture | null },
    tBloomA: { value: null as THREE_NS.Texture | null },
    tBloomB: { value: null as THREE_NS.Texture | null },
    uRays: { value: 0 },
    uBloom: { value: 0.24 },
    uRayTint: { value: new THREE.Color(1.0, 0.74, 0.46) },
    uExposure: { value: 0.8 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uDebug: { value: 0 },
    uPlate: { value: new THREE.Vector4(0.72, 0.5, 0.34, 0.0) }, // centre xy, radius, strength
    // warm paper, matched to the coast mist (#eeb98f) lifted toward --paper: the wash reads as the evening sky
    // settling into the page, never as a grey-brown film over the land
    uPlateCol: { value: new THREE.Color(0.965, 0.89, 0.8) },
  };
  const compMat = new THREE.ShaderMaterial({
    uniforms: compU,
    vertexShader: VERT,
    depthTest: false,
    depthWrite: false,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene, tRays, tBloomA, tBloomB;
      uniform float uRays, uBloom, uExposure, uTime, uAspect, uDebug;
      uniform vec3 uRayTint, uPlateCol;
      uniform vec4 uPlate;
      varying vec2 vUv;
      void main(){
        vec4 s = texture2D(tScene, vUv);
        vec3 c = s.rgb;
        if (uRays > 0.0){
          float r = texture2D(tRays, vUv).r;
          c += uRayTint * r * uRays * 3.0 * mix(1.0, 0.04, clamp(s.a, 0.0, 1.0));
        }
        if (uBloom > 0.0){
          // dark opaque silhouettes (the palm through the sun, the boat's shadow side) take less veiling glare, so a
          // trunk standing in front of the glitter path stays a trunk instead of dissolving into a cream smear
          float sl = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
          float veil = mix(1.0, 0.12, clamp(s.a, 0.0, 1.0) * (1.0 - smoothstep(0.15, 1.4, sl)));
          c += (texture2D(tBloomA, vUv).rgb * 0.6 + texture2D(tBloomB, vUv).rgb * 0.55) * uBloom * veil;
        }
        c *= uExposure;
        // a little more colour before the filmic curve desaturates the highlights (golden hour, not beige)
        float l0 = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = max(mix(vec3(l0), c, 1.14), 0.0);
        if (uDebug > 0.5) c = vec3(texture2D(tRays, vUv).r * 4.0, s.a, 0.0);
        // warm highlights / slightly cool shadows, very gentle
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c *= mix(vec3(0.97, 0.99, 1.04), vec3(1.03, 1.0, 0.95), smoothstep(0.05, 0.8, l));
        // vignette
        vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
        c *= mix(1.0, 0.74, smoothstep(0.35, 1.05, length(q)));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // reading plate: a soft paper wash under the copy block (display space, so it is a true contrast floor)
        if (uPlate.w > 0.0){
          vec2 pq = (vUv - uPlate.xy) * vec2(uAspect, 1.0);
          float pk = 1.0 - smoothstep(uPlate.z * 0.35, uPlate.z, length(pq));
          // portrait: a band under the copy, feathered over ~17% of the screen height (eased, no visible top edge); full
          // paper by the eyebrow line, untouched above the convoy
          if (uAspect < 0.9) { pk = smoothstep(uPlate.y + 0.09, uPlate.y - 0.08, vUv.y); pk *= pk * (3.0 - 2.0 * pk); }
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uPlateCol, pk * uPlate.w);
        }
        // film grain in display space, static under a frozen clock
        float g = fract(sin(dot(vUv * 913.7 + fract(uTime * 0.37) * 37.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        gl_FragColor.rgb += g * 0.018;
      }`,
  });

  const size = new THREE.Vector2();
  let w = 0;
  let h = 0;
  const sunV = new THREE.Vector3();

  let scale = 1;
  function resize(W0: number, H0: number, pixelRatio: number) {
    // cap the internal HDR resolution below the canvas DPR (the composite upsamples)
    const cap = mobile ? 1.25 : 1.5;
    scale = Math.min(1, cap / Math.max(1, pixelRatio));
    const W = Math.max(1, Math.round(W0 * scale));
    const H = Math.max(1, Math.round(H0 * scale));
    w = W0;
    h = H0;
    rtScene.setSize(W, H);
    const rs = tier === 'high' && !mobile ? 0.5 : 0.25;
    rtRays.setSize(Math.max(1, Math.round(W * rs)), Math.max(1, Math.round(H * rs)));
    rtA.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    rtB.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    rtC.setSize(Math.max(1, W >> 3), Math.max(1, H >> 3));
    rtD.setSize(Math.max(1, W >> 3), Math.max(1, H >> 3));
  }

  function pass(renderer: THREE_NS.WebGLRenderer, mat: THREE_NS.Material, target: THREE_NS.WebGLRenderTarget | null) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  const api: CoastPost = {
    rays: 1,
    rayThreshold: 1.1,
    uniforms: { exposure: compU.uExposure, rayTint: compU.uRayTint, bloom: compU.uBloom, debug: compU.uDebug, plate: compU.uPlate },
    get internalScale() {
      return scale;
    },
    compile(renderer) {
      // warm every post program once (cheap, runs while the poster is still up)
      for (const m of [raysMat, brightMat, blurMat, copyMat, compMat]) {
        quad.material = m;
        renderer.compile(quadScene, quadCam);
      }
    },
    render(renderer, scene, camera, sunDir, time) {
      renderer.getDrawingBufferSize(size);
      if (size.x !== w || size.y !== h) resize(size.x, size.y, renderer.getPixelRatio());
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(rtScene);
      renderer.render(scene, camera);

      // project the sun; reject behind the camera, fade as it leaves the frame
      sunV.copy(sunDir).multiplyScalar(1000).add(camera.position).project(camera);
      let rays = tier === 'low' ? 0 : api.rays;
      const sx = sunV.x * 0.5 + 0.5;
      const sy = sunV.y * 0.5 + 0.5;
      if (sunV.z > 1 || sunV.z < -1) rays = 0;
      const off = Math.max(Math.max(-sx, sx - 1), Math.max(-sy, sy - 1));
      rays *= 1 - Math.min(1, Math.max(0, off / 0.25));
      compU.uRays.value = rays;
      compU.uAspect.value = w / Math.max(1, h);
      compU.uTime.value = time;
      compU.tScene.value = rtScene.texture;
      if (rays > 0.001) {
        rayU.tScene.value = rtScene.texture;
        rayU.uSun.value.set(sx, sy);
        rayU.uAspect.value = w / Math.max(1, h);
        rayU.uThreshold.value = api.rayThreshold;
        pass(renderer, raysMat, rtRays);
        compU.tRays.value = rtRays.texture;
      }
      if (useBloom()) {
        brightU.tSrc.value = rtScene.texture;
        pass(renderer, brightMat, rtA);
        blurU.tSrc.value = rtA.texture;
        blurU.uDir.value.set(1 / rtA.width, 0);
        pass(renderer, blurMat, rtB);
        blurU.tSrc.value = rtB.texture;
        blurU.uDir.value.set(0, 1 / rtA.height);
        pass(renderer, blurMat, rtA);
        copyU.tSrc.value = rtA.texture;
        pass(renderer, copyMat, rtC);
        blurU.tSrc.value = rtC.texture;
        blurU.uDir.value.set(1 / rtC.width, 0);
        pass(renderer, blurMat, rtD);
        blurU.tSrc.value = rtD.texture;
        blurU.uDir.value.set(0, 1 / rtC.height);
        pass(renderer, blurMat, rtC);
        compU.tBloomA.value = rtA.texture;
        compU.tBloomB.value = rtC.texture;
        compU.uBloom.value = api.uniforms.bloom.value;
      }
      const bloomSaved = compU.uBloom.value;
      if (!useBloom()) compU.uBloom.value = 0;
      pass(renderer, compMat, prevTarget);
      compU.uBloom.value = bloomSaved;
    },
    setTier(t) {
      if (t === tier) return;
      const msaaChange = msaa(t) !== msaa(tier);
      tier = t;
      raysMat.defines.SAMPLES = raySamples(t);
      raysMat.needsUpdate = true;
      if (msaaChange) {
        rtScene.dispose();
        rtScene = mkRT(msaa(t), true);
      }
      w = h = 0; // force resize
    },
    dispose() {
      [rtScene, rtRays, rtA, rtB, rtC, rtD].forEach((r) => r.dispose());
      [raysMat, brightMat, blurMat, copyMat, compMat].forEach((m) => m.dispose());
      quadGeo.dispose();
    },
  };
  raysMat.defines.SAMPLES = raySamples(tier);
  return api;
}
