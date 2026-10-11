// Ch.2 The Crossing (Pacific, 2019). SPEC §3, §7.
// Night open ocean (vendored ocean.mjs, calm spectrum), stars and a low moon over the western sea (home), Jay's
// paper boat sailing east with two companion lanterns (parents) riding the same swell, the grandparents' light
// a faint gold point on the western horizon. Mid-chapter the camera dives under the surface for "the first year"
// (god rays, brush marks resolving into letters), then resurfaces at dawn facing the sunrise.
//
// The boat stays at the world origin and the sea moves past it (waves.offZ), so the wake, buoyancy and floating
// origin never drift. Camera, sky and every beat weight are pure functions of chapter progress (see timeline.ts).
import type * as THREE_NS from 'three';
import type { WorldModuleFactory, WorldModule, FrameInfo, Hotspot, Environment } from '../types';
import type { QualityTier } from '../../bus';
import { bus } from '../../bus';
import {
  createWaves,
  bakeOceanDetail,
  createOcean,
  createOceanGeometry,
  createWake,
  createPlanarReflection,
} from '../vendor/ocean.mjs';
import { createSky, skyPresets, makeSkyState, lerpSkyState } from '../systems/sky';
import { createPaperBoat } from '../systems/paperBoat';
import { createLantern, type Lantern } from '../systems/lantern';
import { acquireWashi, releaseWashi } from '../systems/washi';
import { smoothstep } from '../systems/noise';
import { KEEPSAKES, type KeepsakeId } from '../../content/keepsakes';
import { MOON_POEM } from '../../content/story';
import {
  KEYS_DESKTOP,
  KEYS_MOBILE,
  sampleCamera,
  dawnWeight,
  sunriseWeight,
  churn,
  underWeight,
  glyphVisible,
  glyphResolve,
  underLightSwing,
  RISE_T,
  type CamKey,
  type CamSample,
} from './crossing/timeline';
import { createPost } from './crossing/post';
import { createUnderwater } from './crossing/underwater';

type T3 = typeof THREE_NS;

// ---- loose typings for the vendored JS module (it is untyped .mjs)
interface Waves {
  offX: number;
  offZ: number;
  update(dt: number): void;
  height(x: number, z: number): number;
  setSeaState(s: number): void;
}
interface Ocean {
  mesh: THREE_NS.Mesh;
  uniforms: Record<string, THREE_NS.IUniform>;
  setReflection(r: { texture: THREE_NS.Texture; matrix: THREE_NS.Matrix4 }): void;
  update(o: { time: number; camera: THREE_NS.Camera }): void;
  dispose(): void;
}
interface Wake {
  rt: THREE_NS.WebGLRenderTarget;
  reset(x: number, z: number, fx: number, fz: number): void;
  update(x: number, z: number, fx: number, fz: number, step: number): void;
  dispose(): void;
}
interface Reflection {
  texture: THREE_NS.Texture;
  matrix: THREE_NS.Matrix4;
  setSize(w: number, h: number): void;
  render(scene: THREE_NS.Scene, camera: THREE_NS.Camera): void;
  dispose(): void;
}

/** Boat scale: the 1-unit paper boat becomes 6 m, still a speck against a 12 km sea from the crane height. */
const S = 6;
const keep = (id: KeepsakeId) => KEEPSAKES.find((k) => k.id === id);
/** The moon hotspot's name: from content when it carries one (the DOM mirror reads the same field). */
const MOON_LABEL = MOON_POEM.label;
/**
 * Per-channel gain applied once to the vendored Kelvin wake field (r = arm foam, g = centre wash, b = slick, a = wave
 * height). At night the wash and slick turn the moon path into a grey plume behind the boat (milky water + killed
 * glitter); keep the Kelvin arms as faint lace foam and only a trace of wash.
 */
const WAKE_GAIN: [number, number, number, number] = [0.7, 0.16, 0.3, 0.85];
/** Metres of sea that pass under the boat over the chapter, plus a slow cruise so the wake never lies. */
const TRAVEL = 640;
const CRUISE = 1.1;

// Sky haze for the ocean's aerial perspective: the same horizon function the sky dome draws (no disk, no stars).
const HAZE_GLSL = /* glsl */ `
uniform vec3 uSkyHorizon, uSkyZenith, uSkyGround, uSkySunColor, uSkySunDir;
uniform float uSkySun, uSkyHaze;
uniform vec3 uSunDir;
vec3 oceanHaze(vec3 d){
  float y = d.y;
  float t = pow(clamp(y, 0.0, 1.0), 0.55);
  vec3 mid = mix(uSkyHorizon, uSkyZenith, 0.42) * 0.96;
  vec3 c = y > 0.0 ? mix(mix(uSkyHorizon, mid, smoothstep(0.0, 0.45, t)), uSkyZenith, smoothstep(0.35, 1.0, t)) : uSkyHorizon;
  c = mix(c, uSkyGround, smoothstep(0.0, -0.18, y));
  float sunAz = max(0.0, dot(normalize(vec2(d.x, d.z) + 1e-5), normalize(vec2(uSkySunDir.x, uSkySunDir.z) + 1e-5)));
  float band = exp(-abs(y) / max(0.02, uSkyHaze * 0.35));
  c = mix(c, mix(uSkyHorizon, uSkySunColor, 0.35 * pow(sunAz, 3.0) * uSkySun) * 1.04, band * 0.55);
  float cs = max(dot(d, uSkySunDir), 0.0);
  c += uSkySunColor * pow(cs, 8.0) * 0.2 * uSkySun;
  return c;
}`;

/** Horizontal direction from the wide camera to the boat, turned `deg` toward screen-right, raised `elev` deg. */
function dirFromKey(THREE: T3, k: CamKey, deg: number, elev: number, out: THREE_NS.Vector3) {
  const fx = k.q[0] - k.p[0];
  const fz = k.q[2] - k.p[2];
  const fl = Math.hypot(fx, fz);
  // screen-right = forward x up = (-fz, 0, fx)
  const rx = -fz / fl;
  const rz = fx / fl;
  const bx = -k.p[0];
  const bz = -k.p[2];
  const bl = Math.hypot(bx, bz);
  const a = THREE.MathUtils.degToRad(deg);
  const hx = (bx / bl) * Math.cos(a) + rx * Math.sin(a);
  const hz = (bz / bl) * Math.cos(a) + rz * Math.sin(a);
  const hl = Math.hypot(hx, hz);
  return out.set(hx / hl, Math.tan(THREE.MathUtils.degToRad(elev)), hz / hl).normalize();
}

/** Direction of light seen from under a flat surface (Snell, n = 1.33). */
function refractUp(d: THREE_NS.Vector3, out: THREE_NS.Vector3) {
  const elev = Math.asin(Math.max(-1, Math.min(1, d.y)));
  const thetaI = Math.PI / 2 - Math.max(elev, 0.01);
  const thetaT = Math.asin(Math.sin(thetaI) / 1.33);
  const e = Math.PI / 2 - thetaT;
  const h = Math.hypot(d.x, d.z) || 1;
  return out.set((d.x / h) * Math.cos(e), Math.sin(e), (d.z / h) * Math.cos(e));
}

const create: WorldModuleFactory = async (ctx) => {
  const { THREE, renderer } = ctx;
  const rm = ctx.reducedMotion;
  let tier: QualityTier = ctx.tier;
  const scene = new THREE.Scene();

  // ------------------------------------------------------------------ sky
  const P = skyPresets(THREE);
  const night = makeSkyState(THREE, {
    horizon: '#1d2f45',
    zenith: '#03070f',
    ground: '#081422',
    sunColor: '#6f83a8',
    sun: 0.32,
    stars: 1,
    moon: 1,
    haze: 0.2,
  });
  const dawn = makeSkyState(THREE, {
    horizon: '#df9a74',
    zenith: '#141f3d',
    ground: '#2a3242',
    sunColor: '#ffa868',
    sun: 0.42,
    stars: 0.22,
    moon: 0,
    haze: 0.11,
  });
  const dawnLate = makeSkyState(THREE, {
    horizon: '#f0a675',
    zenith: '#203a6a',
    ground: '#34405a',
    sunColor: '#ffb070',
    sun: 0.42,
    stars: 0,
    moon: 0,
    haze: 0.1,
  });
  const skyNow = makeSkyState(THREE);
  const sky = createSky(THREE, { ...night, radius: 900, twinkle: !rm });
  sky.mesh.layers.enable(2);
  scene.add(sky.mesh);

  // sky cube for the ocean's Fresnel reflection (rendered from the sky only, on layer 2)
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(1, 2000, cubeRT);
  cubeCam.children.forEach((c) => c.layers.set(2));
  let cubeDirty = true;
  let cubeW = -1;

  // ------------------------------------------------------------------ ocean
  const waves = createWaves({ direction: 0.55 }) as unknown as Waves;
  waves.setSeaState(0.5); // calmer than the default spectrum: a long, quiet swell
  const detail = bakeOceanDetail(THREE, renderer) as THREE_NS.Texture;
  const wake = createWake(THREE, renderer, { shipLength: 7 }) as unknown as Wake;
  const glitterDir = new THREE.Vector3(0, 0.1, 1).normalize();
  const hazeUniforms: Record<string, THREE_NS.IUniform> = {
    uSkyHorizon: sky.uniforms.uHorizon,
    uSkyZenith: sky.uniforms.uZenith,
    uSkyGround: sky.uniforms.uGround,
    uSkySunColor: sky.uniforms.uSunColor,
    uSkySunDir: sky.uniforms.uSunDir,
    uSkySun: sky.uniforms.uSun,
    uSkyHaze: sky.uniforms.uHaze,
    uSunDir: { value: glitterDir },
  };
  const oceanGeo = createOceanGeometry(THREE, { rings: tier === 'low' ? 160 : 210, segments: ctx.isMobile || tier !== 'high' ? 256 : 400 }) as THREE_NS.BufferGeometry;
  const ocean = (createOcean as unknown as (T: T3, o: Record<string, unknown>) => Ocean)(THREE, {
    waves,
    detailTexture: detail,
    skyCube: cubeRT.texture,
    hazeGLSL: HAZE_GLSL,
    hazeUniforms,
    wake,
    geometry: oceanGeo,
    sunColor: new THREE.Vector3(0.5, 0.58, 0.72),
    ambient: new THREE.Vector3(0.03, 0.04, 0.06),
    deepColor: new THREE.Vector3(0.002, 0.009, 0.017),
    scatterColor: new THREE.Vector3(0.01, 0.06, 0.07),
    fogDensity: 2.2e-4,
  });
  scene.add(ocean.mesh);
  // the boat is fixed and the sea flows: a straight trail laid once is the exact wake
  wake.reset(0, 0, 0, -1);
  wake.update(0, 0, 0, -1, 0);
  {
    // multiply the field in place: dst * gain (CustomBlending, src factor zero, dst factor src colour/alpha)
    const gainMat = new THREE.ShaderMaterial({
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `void main(){ gl_FragColor = vec4(${WAKE_GAIN.map((v) => v.toFixed(3)).join(', ')}); }`,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.SrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
    });
    const gainQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), gainMat);
    gainQuad.frustumCulled = false;
    const gainScene = new THREE.Scene();
    gainScene.add(gainQuad);
    const gainCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(wake.rt);
    renderer.render(gainScene, gainCam);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    gainQuad.geometry.dispose();
    gainMat.dispose();
  }
  const reflection = createPlanarReflection(THREE, renderer, { layer: 1, resolutionScale: 0.5 }) as unknown as Reflection;
  const applyReflection = () => {
    if (tier === 'low') {
      ocean.uniforms.uRefl.value = null;
    } else ocean.setReflection(reflection);
  };
  applyReflection();

  // ------------------------------------------------------------------ light
  const hemi = new THREE.HemisphereLight('#4a6488', '#05080d', 0.6);
  const key = new THREE.DirectionalLight('#9fb2d6', 0.8);
  scene.add(hemi, key, key.target);
  hemi.layers.enable(1);
  key.layers.enable(1);

  // ------------------------------------------------------------------ the fleet
  const fleet = new THREE.Group();
  scene.add(fleet);
  const boatFloat = new THREE.Group();
  fleet.add(boatFloat);
  const boat = createPaperBoat(THREE, { tint: '#f7f1e3', light: true, lightDistance: 16, lightIntensity: 2.2, lantern: 1.35, flicker: !rm });
  boat.group.scale.setScalar(S);
  boat.group.rotation.y = Math.PI / 2; // bow (+x) to the east (-z)
  boatFloat.add(boat.group);

  const washi = acquireWashi(THREE);
  const raftGeo = new THREE.BoxGeometry(1, 0.05, 1);
  const raftMat = new THREE.MeshStandardMaterial({ color: '#d9ccb0', map: washi.albedo, roughness: 0.92 });
  // two companion lanterns (parents), port and starboard, a little aft of the bow
  const LANT_POS: [number, number][] = [
    [3.3, 2.0],
    [-3.0, 3.6],
  ];
  const companions: { float: THREE_NS.Group; lantern: Lantern; x: number; z: number; seed: number }[] = LANT_POS.map(([x, z], i) => {
    const float = new THREE.Group();
    const lantern = createLantern(THREE, { size: 0.15, flicker: !rm, seed: 11 + i * 7, intensity: 1.1 });
    lantern.group.scale.setScalar(S);
    lantern.group.position.y = 0.15 * 0.5 * S + 0.12;
    const raft = new THREE.Mesh(raftGeo, raftMat);
    raft.scale.set(1.15, 1, 1.15);
    raft.position.y = 0.04;
    raft.rotation.y = 0.3 + i;
    float.add(raft, lantern.group);
    fleet.add(float);
    return { float, lantern, x, z, seed: i * 1.7 + 0.4 };
  });

  // "tied together": two thin threads from the boat's stern quarters to the lantern rafts
  const THREAD_PTS = 10;
  const threadPos = new Float32Array(2 * THREAD_PTS * 3);
  const threadGeo = new THREE.BufferGeometry();
  threadGeo.setAttribute('position', new THREE.BufferAttribute(threadPos, 3));
  const threadIdx: number[] = [];
  for (let k = 0; k < 2; k++) for (let i = 0; i < THREAD_PTS - 1; i++) threadIdx.push(k * THREAD_PTS + i, k * THREAD_PTS + i + 1);
  threadGeo.setIndex(threadIdx);
  const threadMat = new THREE.LineBasicMaterial({ color: '#b9a57c', transparent: true, opacity: 0.55 });
  const threads = new THREE.LineSegments(threadGeo, threadMat);
  threads.frustumCulled = false;
  fleet.add(threads);

  // everything that stands in the water reflects (planar layer 1), lights included
  fleet.traverse((o) => o.layers.enable(1));

  // lantern light on the water: broken gold streaks toward the camera (the ocean shader has no point lights)
  const poolUniforms: Record<string, THREE_NS.IUniform> = {
    uL: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uCam: { value: new THREE.Vector3() },
    uCol: { value: new THREE.Vector3(2.6, 1.25, 0.38) },
    uDetail: { value: detail },
    uOff: { value: new THREE.Vector2() },
    uK: { value: 1 },
    uRing: { value: 0 },
  };
  const poolGeo = new THREE.PlaneGeometry(70, 70, 1, 1);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.ShaderMaterial({
    uniforms: poolUniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */ `
      uniform vec4 uL[3]; uniform vec3 uCam, uCol; uniform sampler2D uDetail; uniform vec2 uOff; uniform float uK, uRing;
      varying vec3 vW;
      void main(){
        float r1 = texture2D(uDetail, vW.xz / 5.0 + uOff).a;
        float r2 = texture2D(uDetail, vec2(vW.z, -vW.x) / 2.2 - uOff * 1.7).a;
        float br = smoothstep(0.42, 0.78, r1 * 0.6 + r2 * 0.5);
        vec3 sum = vec3(0.0);
        float graze = clamp(uCam.y / 40.0, 0.0, 1.0);
        for (int i = 0; i < 3; i++){
          vec2 d = vW.xz - uL[i].xz;
          vec2 tc = normalize(uCam.xz - uL[i].xz);
          float along = dot(d, tc);
          float across = dot(d, vec2(-tc.y, tc.x));
          float len = mix(5.0, 3.0, graze);
          float wid = 0.08 + max(along, 0.0) * 0.025;
          float streak = exp(-across * across / wid) * exp(-max(along, 0.0) / len) * smoothstep(-2.2, 1.0, along);
          float pool = exp(-dot(d, d) / 3.5);
          sum += uL[i].w * (streak * (0.03 + 0.75 * br) + pool * 0.06);
        }
        // hover: a broken gold ring on the water around the three of them ("these, together")
        float rr = length(vW.xz - vec2(0.0, 1.6));
        float ring = exp(-pow(rr - 7.5, 2.0) / 0.35) * (0.35 + 0.65 * br) + exp(-pow(rr - 7.5, 2.0) / 6.0) * 0.08;
        sum += vec3(ring * uRing * 0.55);
        gl_FragColor = vec4(uCol * sum * uK, 1.0);
      }`,
  });
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.renderOrder = -5;
  pool.frustumCulled = false;
  scene.add(pool);

  // the grandparents' light: a faint gold point on the western horizon (screen-space sized, never culled)
  const gpUniforms: Record<string, THREE_NS.IUniform> = {
    uPos: { value: new THREE.Vector3() },
    uRes: { value: new THREE.Vector2(1, 1) },
    uI: { value: 1 },
    uPx: { value: 1 },
  };
  const gpGeo = new THREE.PlaneGeometry(2, 2);
  const gpMat = new THREE.ShaderMaterial({
    uniforms: gpUniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform vec3 uPos; uniform vec2 uRes; uniform float uPx; varying vec2 vP;
      void main(){
        vec4 c = projectionMatrix * viewMatrix * vec4(uPos, 1.0);
        if (c.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vP = vec2(0.0); return; }
        vec2 half_ = vec2(14.0, 30.0) * uPx;
        vP = position.xy * half_;
        vec2 off = vec2(position.x * half_.x, position.y * half_.y - half_.y * 0.55) / uRes * 2.0;
        gl_Position = vec4(c.xy / c.w + off, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uI, uPx; varying vec2 vP;
      void main(){
        vec2 p = vP / uPx - vec2(0.0, 16.5);
        float core = exp(-dot(p, p) / 2.2);
        float glow = exp(-dot(p, p) / 30.0) * 0.18;
        // its reflection: a short broken streak on the water below
        float below = step(p.y, -1.5);
        float streak = below * exp(-p.x * p.x / 1.2) * exp((p.y + 1.5) / 9.0) * (0.55 + 0.45 * sin(p.y * 2.1)) * 0.22;
        vec3 col = vec3(3.2, 1.7, 0.55) * (core + glow + streak) * uI;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const gp = new THREE.Mesh(gpGeo, gpMat);
  gp.frustumCulled = false;
  gp.renderOrder = 10;
  scene.add(gp);

  // the dawn sun, drawn over the sky's flat disc: limb-darkened (bright cream core, deeper orange rim), reddened as it
  // sits lower, with a soft bloom and a wide flat flare along the horizon haze band, so it carries the same weight as
  // the moon did. A camera-facing quad inside the sky dome; the sea in front still occludes it (depth test on).
  const sunUniforms: Record<string, THREE_NS.IUniform> = {
    uDir: { value: new THREE.Vector3(0, 0.05, -1) },
    uCol: sky.uniforms.uSunColor,
    uK: { value: 0 },
    uLow: { value: 1 },
  };
  const SUN_DEG = 12; // half-size of the quad in degrees (the halo); the disc itself is ~1.75 deg in radius
  const sunGeo = new THREE.PlaneGeometry(2, 2);
  const sunMat = new THREE.ShaderMaterial({
    uniforms: sunUniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */ `
      uniform vec3 uDir; varying vec2 vP; varying vec3 vRay;
      void main(){
        float D = 850.0;
        float hs = D * tan(radians(${SUN_DEG.toFixed(1)}));
        vec4 mv = viewMatrix * vec4(cameraPosition + normalize(uDir) * D, 1.0);
        mv.xy += position.xy * hs;
        vRay = transpose(mat3(viewMatrix)) * mv.xyz;
        vP = position.xy * ${SUN_DEG.toFixed(1)};
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform float uK, uLow; varying vec2 vP; varying vec3 vRay;
      void main(){
        float r = length(vP) / 1.75;
        float disc = 1.0 - smoothstep(0.96, 1.04, r);
        float mu = sqrt(max(0.0, 1.0 - min(r, 1.0) * min(r, 1.0)));
        // limb darkening (I = 1 - u(1 - mu)), the rim warmer than the core
        float limb = 0.55 + 0.45 * pow(mu, 0.6);
        vec3 core = mix(vec3(1.0, 0.93, 0.8), vec3(1.0, 0.78, 0.55), uLow * 0.6);
        vec3 rim = mix(uCol, vec3(1.0, 0.45, 0.18), 0.45 + 0.3 * uLow);
        vec3 dc = mix(rim, core, smoothstep(0.0, 0.9, mu)) * limb * 3.0;
        // bloom: a tight glow, a wide soft one, and a flat flare along the horizon band
        float d2 = dot(vP, vP);
        float glow = exp(-d2 / 9.0) * 0.55 + exp(-d2 / 45.0) * 0.16;
        float band = exp(-abs(vP.y + 0.6) / (0.55 + 0.4 * (1.0 - uLow))) * exp(-abs(vP.x) / 7.0) * 0.32;
        float edge = 1.0 - smoothstep(0.8, 1.0, max(abs(vP.x), abs(vP.y)) / ${SUN_DEG.toFixed(1)});
        vec3 add = uCol * (glow + band) * edge * (1.0 - disc);
        // only above the horizon: below it the quad would paint over sea farther than its own distance
        float sky = smoothstep(-0.001, 0.006, normalize(vRay).y);
        gl_FragColor = vec4((dc * disc + add) * uK * sky, disc * uK * sky);
      }`,
  });
  const sunDisc = new THREE.Mesh(sunGeo, sunMat);
  sunDisc.frustumCulled = false;
  sunDisc.renderOrder = 2;
  sunDisc.visible = false;
  scene.add(sunDisc);

  // ------------------------------------------------------------------ under the surface
  const under = createUnderwater(
    THREE,
    ctx.camera,
    { boat: boatFloat, lanterns: companions.map((c) => c.lantern.group), skip: boat.lantern.group },
    { isMobile: ctx.isMobile, shafts: tier !== 'low' },
  );
  // Sea glass path (t, x, y, z), authored per device so the glint stays in a quiet part of the frame: right of the
  // underwater line on desktop, centre-low in the thumb zone on phones. The current carries it a little as the
  // camera turns (positions solved against the camera keys; smoothstep between anchors, pure in t).
  const GLASS_DESKTOP: number[][] = [
    [0.52, 0.48, -7.23, -9.3],
    [0.57, -0.71, -10.54, -10.1],
    [0.61, -2.74, -10.78, -1.84],
    [0.65, -0.59, -10.36, 3.82],
    [0.69, 0.13, -8.1, 8.75],
  ];
  const GLASS_MOBILE: number[][] = [
    [0.52, 2.01, -9.16, -11.02],
    [0.56, 1.37, -12.85, -13.09],
    [0.595, -0.8, -13.03, -7.45],
    [0.625, -2.05, -13.27, -2],
    [0.655, -1.2, -12.34, 3.57],
    [0.69, -1.35, -10.05, 11.13],
  ];
  const glassAt = (t: number, mobile: boolean, out: THREE_NS.Vector3) => {
    const a = mobile ? GLASS_MOBILE : GLASS_DESKTOP;
    let i = 0;
    while (i < a.length - 2 && t > a[i + 1][0]) i++;
    const k0 = a[i];
    const k1 = a[i + 1];
    const u = smoothstep(k0[0], k1[0], t);
    return out.set(k0[1] + (k1[1] - k0[1]) * u, k0[2] + (k1[2] - k0[2]) * u, k0[3] + (k1[3] - k0[3]) * u);
  };

  // ------------------------------------------------------------------ post
  const post = createPost(THREE, tier);

  // ------------------------------------------------------------------ directions (authored per device)
  const moonDir = new THREE.Vector3();
  const sunEarly = new THREE.Vector3();
  const sunLate = new THREE.Vector3();
  const gpDir = new THREE.Vector3();
  const moonUnder = new THREE.Vector3();
  const sunUnder = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  let keys: CamKey[] = KEYS_DESKTOP;
  let keysMobile: boolean | null = null;
  function authorDirections(mobile: boolean) {
    keys = mobile ? KEYS_MOBILE : KEYS_DESKTOP;
    const wide = keys[3];
    const end = keys[keys.length - 1];
    // phones: the disc sits in the clear band between the copy block and the horizon (the wide keys put the
    // horizon just under centre), 7 deg right so its road runs beside the fleet; inside the road the lanterns
    // dissolve into glitter
    // desktop: 10 deg right of the fleet so the moon road runs beside the boats, not through them
    dirFromKey(THREE, wide, mobile ? 7 : 10, mobile ? 2.8 : 5, moonDir);
    dirFromKey(THREE, wide, mobile ? -0.8 : -1.2, 0.06, gpDir);
    // the sun rises a few degrees left of the fleet so its glitter column runs beside the boat, not over it
    // (inside the column the paper boat dissolves into glare and only the lantern blobs read)
    // (desktop: -5 keeps the column between the copy block and the fleet, off the body text)
    // phones: the sun stays sitting on the horizon, below the copy block's scrim (higher, the scrim greys the disc)
    dirFromKey(THREE, end, mobile ? -7 : -5, mobile ? 0.6 : 1.4, sunEarly);
    dirFromKey(THREE, end, mobile ? -7 : -5, mobile ? 1.9 : 4.5, sunLate);
    night.sunDir.copy(moonDir);
    night.moonDir.copy(moonDir);
    dawn.sunDir.copy(sunEarly);
    dawnLate.sunDir.copy(sunLate);
    dawn.moonDir.copy(moonDir);
    dawnLate.moonDir.copy(moonDir);
    refractUp(moonDir, moonUnder);
    refractUp(sunEarly, sunUnder);
    // the copy block in uv (x0, y0, x1, y1; y up; extended past the screen edge it hugs): the post pass calms
    // highlights in a soft ellipse around it
    (post.uniforms.uCalm.value as THREE_NS.Vector4).set(...((mobile ? [-0.45, 0.6, 1.45, 1.1] : [-0.12, 0.38, 0.36, 0.92]) as [number, number, number, number]));
    // reading zones the glyphs keep clear of (NDC rects: copy block, underwater line)
    if (mobile) {
      (under.glyphs.uniforms.uAvoidA.value as THREE_NS.Vector4).set(-1.2, 0.18, 1.2, 1.2);
      (under.glyphs.uniforms.uAvoidB.value as THREE_NS.Vector4).set(-1.2, -0.52, 1.2, -0.3);
    } else {
      (under.glyphs.uniforms.uAvoidA.value as THREE_NS.Vector4).set(-1.2, -0.25, -0.38, 0.85);
      (under.glyphs.uniforms.uAvoidB.value as THREE_NS.Vector4).set(-0.25, -0.62, 0.22, -0.18);
    }
    cubeDirty = true;
  }

  // ------------------------------------------------------------------ interaction state
  let lanternHover = 0;
  let lanternFlare = 0;
  let moonHover = 0;
  let moonPulse = 0;
  /** The moon has been looked at once: its idle "you can touch this" breath stops for good. */
  let moonSeen = false;
  let moonBreath = 0;
  let glassHover = 0;
  let glassFlare = 0;
  let glassGone = 0;
  let glassCollected = false;
  const offs: (() => void)[] = [];
  offs.push(
    bus.on('keepsake:collected', ({ id }) => {
      if (id === 'three-lanterns') lanternFlare = 1;
      if (id === 'sea-glass') {
        glassFlare = 1;
        glassCollected = true;
      }
    }),
    // hover parity with the DOM mirrors: focusing a keepsake button warms the 3D object
    bus.on('keepsake:focus', ({ id, on }) => {
      if (id === 'three-lanterns') lanternHover = on ? 1 : 0;
      if (id === 'sea-glass') glassHover = on ? 1 : 0;
    }),
    // committed game state (boot + reset): the glass is back after a reset and stays gone after a reload
    // the moon's DOM mirror (and the 3D hotspot itself) both land here: the disc brightens and the glitter swells
    bus.on('moon:click', () => {
      moonPulse = 1;
      moonSeen = true;
    }),
    bus.on('keepsakes:sync', ({ ids }) => {
      glassCollected = ids.includes('sea-glass');
      glassGone = glassCollected ? 1 : 0;
      glassFlare = 0;
    }),
  );

  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const proxyGeoBox = new THREE.BoxGeometry(1, 1, 1);
  const proxyGeoSphere = new THREE.SphereGeometry(1, 12, 8);
  const proxies = new THREE.Group();
  scene.add(proxies);
  const moonProxy = new THREE.Mesh(proxyGeoSphere, proxyMat);
  const fleetProxy = new THREE.Mesh(proxyGeoBox, proxyMat);
  fleetProxy.scale.set(10, 4.5, 8);
  const glassProxy = new THREE.Mesh(proxyGeoSphere, proxyMat);
  glassProxy.scale.setScalar(0.6);
  proxies.add(moonProxy, fleetProxy, glassProxy);

  const inCrossing = (f: FrameInfo) => f.chapter === 'crossing';
  // Hotspot windows follow the frame on screen: the scroll position normally, but under reduced motion the engine
  // shows authored stills, so the windows follow the still's t (a pickup is live exactly when it is drawn).
  const tv = (f: FrameInfo) => (rm ? f.t : f.tExact);
  const moonOn = (f: FrameInfo) => inCrossing(f) && tv(f) > 0.06 && tv(f) < 0.43;
  const hotspots: Hotspot[] = [
    {
      id: 'moon',
      proxy: moonProxy,
      label: MOON_LABEL,
      enabled: (f) => moonOn(f),
      onHover: (h) => (moonHover = h ? 1 : 0),
      onActivate: () => bus.emit('moon:click', {}),
    },
    {
      id: 'three-lanterns',
      proxy: fleetProxy,
      label: keep('three-lanterns')?.title ?? 'three-lanterns',
      enabled: (f) => inCrossing(f) && ((tv(f) > 0.04 && tv(f) < 0.43) || (tv(f) > 0.76 && tv(f) < 0.97)),
      onHover: (h) => (lanternHover = h ? 1 : 0),
      onActivate: () => bus.emit('keepsake:activate', { id: 'three-lanterns' }),
    },
    {
      id: 'sea-glass',
      proxy: glassProxy,
      label: keep('sea-glass')?.hint ?? 'sea-glass',
      enabled: (f) => inCrossing(f) && tv(f) > 0.52 && tv(f) < 0.69 && !glassCollected,
      onHover: (h) => (glassHover = h ? 1 : 0),
      onActivate: () => bus.emit('keepsake:activate', { id: 'sea-glass' }),
    },
  ];

  // ------------------------------------------------------------------ per-frame state
  let clock = 0;
  let lastT = 0;
  let below = false;
  const cam: CamSample = { p: [0, 0, 0], q: [0, 0, 0], fov: 40 };
  const par = { x: 0, y: 0 };
  const bob = { y: 0, pitch: 0, roll: 0 };
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  const target = new THREE.Vector3();
  const lanternWorld = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const glitterCol = new THREE.Vector3();
  const moonGlitter = new THREE.Vector3(0.14, 0.17, 0.23);
  const sunGlitter = new THREE.Vector3(2.0, 1.0, 0.46);
  const keyNight = new THREE.Color('#8ea3cc');
  const keyDawn = new THREE.Color('#ffc493');
  const sunThrough = new THREE.Color('#ffe2c2');
  const hemiSkyNight = new THREE.Color('#3b5375');
  const hemiSkyDawn = new THREE.Color('#b4b8c8');
  const hemiGroundNight = new THREE.Color('#04070c');
  const hemiGroundDawn = new THREE.Color('#2b3240');
  const underDeepNight = new THREE.Vector3(0.0008, 0.006, 0.013);
  const underDeepDawn = new THREE.Vector3(0.003, 0.016, 0.026);
  const underUpNight = new THREE.Vector3(0.004, 0.024, 0.04);
  const underUpDawn = new THREE.Vector3(0.012, 0.06, 0.08);
  const shaftNight = new THREE.Vector3(0.12, 0.3, 0.38);
  const shaftDawn = new THREE.Vector3(0.3, 0.42, 0.42);
  const bufSize = new THREE.Vector2(-1, -1);
  let ringHover = 0;
  let warming = false;
  let lastSkyKey = -1;
  const bufTmp = new THREE.Vector2();

  // The underwater line ("The first year was hard...") belongs to the dive. The world publishes where the lens is on
  // <html data-dive="under|above"> while it owns the crossing; CSS hides the stage aside on "above". With no WebGL, no
  // JS, or before the module loads, the attribute is absent and the line keeps its static scroll reveal.
  let diveState: string | null = null;
  function setDive(next: 'under' | 'above' | 'dawn' | null) {
    if (next === diveState) return;
    diveState = next;
    const root = document.documentElement;
    if (next) root.dataset.dive = next;
    else delete root.dataset.dive;
  }

  // 'keepsake:inrange': the mirror row says which pickup the lens is looking at right now (the sea glass under water
  // opens its hint; hotspots.ts gives the mirror a lantern edge). Fires on change only.
  const range: Record<'sea-glass' | 'three-lanterns', boolean> = { 'sea-glass': false, 'three-lanterns': false };
  const ndcTmp = new THREE.Vector3();
  function emitRange(id: 'sea-glass' | 'three-lanterns', on: boolean) {
    if (range[id] === on) return;
    range[id] = on;
    bus.emit('keepsake:inrange', { id, on });
  }
  function onScreen(p: THREE_NS.Vector3, camera: THREE_NS.Camera) {
    ndcTmp.copy(p).project(camera);
    return ndcTmp.z < 1 && Math.abs(ndcTmp.x) < 0.95 && Math.abs(ndcTmp.y) < 0.95;
  }

  function flareAt(d: number) {
    if (lanternFlare <= 0) return 0;
    return Math.max(0, Math.sin(Math.min(1, Math.max(0, (1 - lanternFlare) * 1.6 - d)) * Math.PI)) * 1.4;
  }

  function lerpV(a: THREE_NS.Vector3, b: THREE_NS.Vector3, t: number, out: THREE_NS.Vector3) {
    return out.copy(a).lerp(b, t);
  }

  function boatTarget(dt: number) {
    const h0 = waves.height(0, 0);
    const hb = waves.height(0, -2.6);
    const hs = waves.height(0, 2.6);
    const hp = waves.height(0.9, 0);
    const hsb = waves.height(-0.9, 0);
    const k = dt > 0 ? 1 - Math.exp(-6 * dt) : 1;
    bob.y += (h0 - 0.05 - bob.y) * k;
    bob.pitch += (Math.atan2(hb - hs, 5.2) * 0.9 - bob.pitch) * k;
    bob.roll += (Math.atan2(hp - hsb, 1.8) * 0.4 - bob.roll) * k;
  }

  // ------------------------------------------------------------------ module
  const mod: WorldModule = {
    id: 'crossing',
    scene,

    update(f) {
      const dt = rm ? 0 : f.dt;
      clock += dt;
      const t = f.t;
      const mobile = ctx.isMobile || f.aspect < 0.8;
      if (mobile !== keysMobile) {
        keysMobile = mobile;
        authorDirections(mobile);
      }

      // sky: night -> dawn while under water, then the sun climbs
      const w = dawnWeight(t);
      const sr = sunriseWeight(t);
      lerpSkyState(night, dawn, w, skyNow);
      if (sr > 0) lerpSkyState(skyNow, dawnLate, sr, skyNow);
      // idle breath on the moon's glow while its hotspot is live and it has not been touched yet (a slow 5 s cycle,
      // the only hint that the sky is clickable); hover warms it at once, a click flares it
      const breathTarget = !rm && !moonSeen && moonOn(f) ? 0.5 - 0.5 * Math.cos(clock * 1.25) : 0;
      moonBreath += (breathTarget - moonBreath) * (dt > 0 ? Math.min(1, dt * 3) : 1);
      skyNow.moon = night.moon * 0.62 * (1 - w) * (1 + 0.3 * moonBreath * (1 - moonHover) + 0.35 * moonHover + 0.6 * moonPulse);
      skyNow.stars *= 0.7;
      sky.setState(skyNow);
      sky.update(dt, clock);
      // the 6-face sky cube only re-renders when the sky has visibly changed (1/32 steps), not every scroll frame
      const skyKey = Math.round(w * 32) + Math.round(sr * 32) * 64 + moonHover * 4096 + Math.round(moonPulse * 4) * 8192;
      lastSkyKey = skyKey;
      if (skyKey !== cubeW) cubeDirty = true;

      // the sea flows east-to-west past the boat
      waves.offX = 0;
      waves.offZ = -(TRAVEL * t + CRUISE * clock);
      waves.update(dt);

      // the dawn sun's own disc + bloom (over the sky's flat disc)
      sunDisc.visible = w > 0.01;
      (sunUniforms.uDir.value as THREE_NS.Vector3).copy(skyNow.sunDir);
      sunUniforms.uK.value = w * Math.min(1, skyNow.sun / 0.42);
      sunUniforms.uLow.value = 1 - sr;

      // glitter path: the moon at night, the sun at dawn
      lerpV(moonDir, sunEarly, w, glitterDir).lerp(sunLate, sr).normalize();
      lerpV(moonGlitter, sunGlitter, w, glitterCol);
      (ocean.uniforms.uSunColor.value as THREE_NS.Vector3).copy(glitterCol).multiplyScalar(1 + sr * 0.25);
      (ocean.uniforms.uAmbient.value as THREE_NS.Vector3).set(0.03 + 0.12 * w, 0.04 + 0.09 * w, 0.06 + 0.1 * w);
      (ocean.uniforms.uDeep.value as THREE_NS.Vector3).set(0.002 + 0.002 * w, 0.009 + 0.012 * w, 0.017 + 0.016 * w);
      (ocean.uniforms.uSSS.value as THREE_NS.Vector3).set(0.01 + 0.03 * w, 0.06 + 0.17 * w, 0.07 + 0.15 * w);

      // lights
      key.position.copy(glitterDir).multiplyScalar(100);
      key.color.copy(keyNight).lerp(keyDawn, w);
      key.intensity = 0.7 + 1.6 * w + 0.6 * sr;
      hemi.color.copy(hemiSkyNight).lerp(hemiSkyDawn, w);
      hemi.groundColor.copy(hemiGroundNight).lerp(hemiGroundDawn, w);
      // dawn: more sky fill so the washi reads as pale paper, not facetted card in a hard warm key
      hemi.intensity = 0.55 + 0.75 * w;

      // fleet buoyancy (same spectrum the ocean renders)
      boatTarget(dt);
      boatFloat.position.y = bob.y;
      boatFloat.rotation.set(bob.pitch, rm ? 0 : Math.sin(clock * 0.37) * 0.025, bob.roll);
      for (let i = 0; i < companions.length; i++) {
        const c = companions[i];
        const h = waves.height(c.x, c.z);
        const k = dt > 0 ? 1 - Math.exp(-5 * dt) : 1;
        c.float.position.x = c.x + (rm ? 0 : Math.sin(clock * 0.21 + c.seed) * 0.25);
        c.float.position.z = c.z + (rm ? 0 : Math.cos(clock * 0.17 + c.seed) * 0.2);
        c.float.position.y += (h - c.float.position.y) * k;
        const hx = waves.height(c.x + 0.6, c.z) - waves.height(c.x - 0.6, c.z);
        const hz = waves.height(c.x, c.z + 0.6) - waves.height(c.x, c.z - 0.6);
        c.float.rotation.set(Math.atan2(-hz, 1.2) * 0.8, c.seed, Math.atan2(hx, 1.2) * 0.8);
      }

      // lanterns: steady warm, a touch brighter at night, flare on hover / collect (staggered)
      if (dt > 0) {
        lanternFlare = Math.max(0, lanternFlare - dt * 0.7);
        moonPulse = Math.max(0, moonPulse - dt * 0.9);
        glassFlare = Math.max(0, glassFlare - dt * 0.8);
        if (glassCollected) glassGone = Math.min(1, glassGone + dt * 0.6);
      } else {
        lanternFlare = 0;
        moonPulse = 0;
        glassFlare = 0;
        if (glassCollected) glassGone = 1;
      }
      const base = 1.25 - 0.25 * w + 0.35 * lanternHover;
      boat.setLantern(base + 0.2 + flareAt(0));
      for (let i = 0; i < companions.length; i++) companions[i].lantern.setIntensity(base + flareAt(0.2 + i * 0.2));
      boat.update(dt, clock);
      for (let i = 0; i < companions.length; i++) companions[i].lantern.update(dt, clock);
      // hover feedback: the ring on the water answers within a frame or two
      ringHover += (lanternHover - ringHover) * (rm ? 1 : Math.min(1, f.dt * 14));
      poolUniforms.uRing.value = ringHover;
      // dawn: the low sun shines through the paper (back-lit sail), so the boat reads as a lit shape beside the glare
      // (a pale transmit colour: washi glows cream against the sun rather than going orange-brown like card)
      boat.setSun(glitterDir, sunThrough, 1.5 * w + 1.3 * sr);

      // threads between boat and lanterns (sagging slightly between the floats)
      fleet.updateMatrixWorld();
      for (let k = 0; k < 2; k++) {
        const c = companions[k];
        const sx = k === 0 ? 0.75 : -0.75;
        tmpV.set(sx, 0.55, 1.7).applyMatrix4(boatFloat.matrixWorld);
        const ex = c.float.position.x;
        const ey = c.float.position.y + 0.1;
        const ez = c.float.position.z;
        for (let i = 0; i < THREAD_PTS; i++) {
          const u = i / (THREAD_PTS - 1);
          const o = (k * THREAD_PTS + i) * 3;
          threadPos[o] = tmpV.x + (ex - tmpV.x) * u;
          threadPos[o + 1] = tmpV.y + (ey - tmpV.y) * u - Math.sin(u * Math.PI) * 0.35;
          threadPos[o + 2] = tmpV.z + (ez - tmpV.z) * u;
        }
      }
      (threadGeo.getAttribute('position') as THREE_NS.BufferAttribute).needsUpdate = true;

      // lantern light positions (world) for the water streaks and the underwater glows
      boat.lantern.group.getWorldPosition(lanternWorld[0]);
      companions[0].lantern.group.getWorldPosition(lanternWorld[1]);
      companions[1].lantern.group.getWorldPosition(lanternWorld[2]);
      const lv = poolUniforms.uL.value as THREE_NS.Vector4[];
      const uv = under.uniforms.uLant.value as THREE_NS.Vector4[];
      for (let i = 0; i < 3; i++) {
        const inten = (i === 0 ? base + 0.2 : base) * (1 - 0.55 * w);
        lv[i].set(lanternWorld[i].x, lanternWorld[i].y, lanternWorld[i].z, inten);
        uv[i].set(lanternWorld[i].x, lanternWorld[i].y, lanternWorld[i].z, inten * (1 + lanternFlare));
      }
      (poolUniforms.uOff.value as THREE_NS.Vector2).set((clock * 0.03) % 1, (-waves.offZ / 5) % 1);

      // grandparents' light: always on, a slow breath, dimmer as the dawn comes up
      gpUniforms.uI.value = (0.85 + 0.15 * Math.sin(clock * 0.6)) * (1 - 0.45 * w);

      // under water: light swings from the refracted moon (west) to the refracted sun (east)
      const sw = underLightSwing(t);
      const ud = under.uniforms;
      lerpV(moonUnder, sunUnder, sw, ud.uSunDirection.value as THREE_NS.Vector3).normalize();
      ud.uTime.value = clock;
      lerpV(underDeepNight, underDeepDawn, sw, ud.uDeep.value as THREE_NS.Vector3);
      lerpV(underUpNight, underUpDawn, sw, ud.uUp.value as THREE_NS.Vector3);
      lerpV(shaftNight, shaftDawn, sw, ud.uShaftColor.value as THREE_NS.Vector3);
      ud.uShaftGain.value = 2.0 + 1.6 * sw;
      (ud.uDiskCol.value as THREE_NS.Vector3).set(0.7 + 0.8 * sw, 0.85 + 0.45 * sw, 1.0 + 0.1 * sw);
      ud.uUnderGain.value = 0.3 + 0.25 * sw;
      const gv = glyphVisible(t);
      under.glyphs.uniforms.uOpacity.value = gv;
      under.glyphs.uniforms.uResolve.value = glyphResolve(t);
      under.glyphs.uniforms.uTime.value = clock;
      under.setGlint((1 + 1.2 * glassHover + 4 * glassFlare) * (1 - glassGone));
      under.seaGlass.visible = glassGone < 1;
      glassAt(t, mobile, under.seaGlass.position);
      under.seaGlass.position.y += Math.sin(clock * 0.5) * 0.08 - glassGone * 1.5;
      under.seaGlass.rotation.set(0.4 + clock * 0.07 + t * 3, clock * 0.11 + t * 5, 0.2);
      under.seaGlass.scale.setScalar(1 + glassHover * 0.25 - glassGone * 0.6);
      glassProxy.position.copy(under.seaGlass.position);

      // pointer parallax: small, damped, off under reduced motion
      const pk = dt > 0 ? 1 - Math.exp(-2.5 * dt) : 1;
      const px = !rm && f.pointer.active ? Math.max(-1, Math.min(1, f.pointer.x)) : 0;
      const py = !rm && f.pointer.active ? Math.max(-1, Math.min(1, f.pointer.y)) : 0;
      par.x += (px - par.x) * pk;
      par.y += (py - par.y) * pk;

      fleetProxy.position.set(0, bob.y + 1.6, 1.4);
      setDive(inCrossing(f) ? (underWeight(t) > 0.5 ? 'under' : t >= RISE_T ? 'dawn' : 'above') : null);
      lastT = t;
    },

    pose(f, camera) {
      sampleCamera(keys, f.t, cam);
      target.set(cam.q[0], cam.q[1], cam.q[2]);
      camera.position.set(cam.p[0], cam.p[1], cam.p[2]);
      camera.fov = cam.fov;
      camera.near = 0.1;
      camera.far = 20000;
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      if (!rm) {
        // parallax scales with distance to the subject, and fades out at the surface crossings
        camFwd.subVectors(target, camera.position);
        const dist = Math.min(40, camera.position.length());
        const seam = 1 - churn(f.t, cam.p[1]);
        camRight.crossVectors(camFwd, camera.up).normalize();
        camUp.crossVectors(camRight, camFwd).normalize();
        const k = dist * 0.018 * seam;
        camera.position.addScaledVector(camRight, par.x * k).addScaledVector(camUp, par.y * k * 0.6);
        camera.lookAt(target);
      }
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    },

    environment(f): Environment {
      if (f.t >= 0.5) return { mist: '#6b5a58', tone: 'light' };
      // the opener: the engine's seam veil covers the first 7% of the chapter, but the river -> crossing swap is
      // already hidden by t ~0.02. Thin the mist's own alpha so the night sea is clean by t = 0.04: the engine
      // multiplies this alpha into #veil's opacity (quantised so its per-colour caches stay small).
      const a = Math.round((1 - smoothstep(0.0, 0.04, f.t)) * 50) / 50;
      return { mist: a >= 1 ? '#0b1a2a' : `rgba(11, 26, 42, ${a})`, tone: 'light' };
    },

    hotspots() {
      return hotspots;
    },

    render(r, camera, f) {
      // while warming, every target stays at its tiny initial size: the programs compile, nothing costs fill-rate
      if (!warming) post.sync(r);
      r.getDrawingBufferSize(bufTmp);
      if (!warming && (bufTmp.x !== bufSize.x || bufTmp.y !== bufSize.y)) {
        bufSize.copy(bufTmp);
        reflection.setSize(bufSize.x, bufSize.y);
        under.setSize(bufSize.x, bufSize.y);
        gpUniforms.uRes.value.set(bufSize.x, bufSize.y);
        gpUniforms.uPx.value = r.getPixelRatio();
      }
      const t = f.t;
      // the waterline is the wave under the lens, not y = 0, so a crest never swallows an above-water frame
      const camRel = camera.position.y - waves.height(camera.position.x, camera.position.z) * smoothstep(3, 0.5, Math.abs(camera.position.y));
      below = camRel < 0;
      // the sea glass proxy is never smaller than a 52 px target
      const gd = camera.position.distanceTo(under.seaGlass.position);
      const pxWorld = (2 * gd * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, f.height);
      glassProxy.scale.setScalar(Math.max(0.35, 26 * pxWorld));
      emitRange('sea-glass', hotspots[2].enabled(f) && below && glassGone < 1 && onScreen(under.seaGlass.position, camera));
      emitRange('three-lanterns', hotspots[1].enabled(f) && onScreen(fleetProxy.position, camera));
      if (import.meta.env.DEV) {
        const ndc = (v: THREE_NS.Vector3) => (ndcTmp.copy(v).project(camera), [+ndcTmp.x.toFixed(3), +ndcTmp.y.toFixed(3)]);
        (window as unknown as { __crossingDbg?: unknown }).__crossingDbg = {
          t: +t.toFixed(3),
          tExact: +f.tExact.toFixed(3),
          cam: camera.position.toArray().map((v) => +v.toFixed(1)),
          moon: ndc(tmpV.copy(camera.position).addScaledVector(moonDir, 800)),
          boat: ndc(tmpV.set(0, 1, 0)),
          dive: diveState,
          range: { ...range },
        };
      }

      // hotspot proxies that live at infinity follow the camera
      moonProxy.position.copy(camera.position).addScaledVector(moonDir, 800);
      moonProxy.scale.setScalar(800 * Math.tan(THREE.MathUtils.degToRad(ctx.isMobile ? 4.5 : 3.4)));
      gpUniforms.uPos.value.copy(camera.position).addScaledVector(gpDir, 5000);
      proxies.updateMatrixWorld(true);

      const prevAuto = r.autoClear;
      r.autoClear = true;
      if (cubeDirty && !below) {
        const stars = sky.uniforms.uStars.value as number;
        sky.uniforms.uStars.value = stars * 0.35;
        cubeCam.position.set(0, 0, 0);
        cubeCam.update(r, scene);
        sky.uniforms.uStars.value = stars;
        cubeDirty = false;
        cubeW = lastSkyKey;
      }

      const c = churn(t, camRel);
      post.uniforms.uChurn.value = c;
      post.uniforms.uTime.value = clock;
      post.uniforms.uUnder.value = below ? 1 : 0;
      const w = dawnWeight(t);
      post.uniforms.uCalmK.value = keysMobile ? 0.45 + 0.85 * w : 0.3 + 1.05 * w;
      const sr = sunriseWeight(t);

      if (!below) {
        ocean.update({ time: clock, camera });
        poolUniforms.uCam.value.copy(camera.position);
        if (tier !== 'low') reflection.render(scene, camera);
        r.setRenderTarget(post.scene);
        r.clear();
        r.render(scene, camera);
        post.uniforms.uExposure.value = 1.4 - 0.62 * w - 0.06 * sr;
        post.uniforms.uBloom.value = 0.22 + 0.08 * (1 - w);
        post.uniforms.uVignette.value = 0.55;
        post.uniforms.uContrast.value = 0.12 + 0.4 * w;
      } else {
        scene.updateMatrixWorld();
        under.syncSilhouettes();
        // glyphs drift in a volume a few metres ahead of the lens
        camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
        tmpV.copy(camera.position).addScaledVector(camFwd, 6);
        under.glyphs.setCenter(tmpV);
        under.march(r);
        r.setRenderTarget(post.scene);
        r.clear();
        r.render(under.scene, camera);
        post.uniforms.uExposure.value = 1.6 + 0.4 * underLightSwing(t);
        post.uniforms.uBloom.value = 0.45;
        post.uniforms.uVignette.value = 0.7;
        post.uniforms.uContrast.value = 0.2;
      }
      r.autoClear = prevAuto;
      post.finish(r);
      return true;
    },

    enter() {
      cubeDirty = true;
    },

    leave() {
      emitRange('sea-glass', false);
      emitRange('three-lanterns', false);
      setDive(null);
    },

    setTier(next) {
      tier = next;
      applyReflection();
      under.setShafts(next !== 'low');
      post.setTier(next);
    },

    dispose() {
      setDive(null);
      offs.forEach((o) => o());
      sky.dispose();
      cubeRT.dispose();
      ocean.dispose();
      oceanGeo.dispose();
      detail.dispose();
      wake.dispose();
      reflection.dispose();
      boat.dispose();
      companions.forEach((c) => c.lantern.dispose());
      raftGeo.dispose();
      raftMat.dispose();
      releaseWashi();
      threadGeo.dispose();
      threadMat.dispose();
      poolGeo.dispose();
      poolMat.dispose();
      gpGeo.dispose();
      gpMat.dispose();
      sunGeo.dispose();
      sunMat.dispose();
      under.dispose();
      post.dispose();
      proxyMat.dispose();
      proxyGeoBox.dispose();
      proxyGeoSphere.dispose();
      void lastT;
    },
  };

  // Warm-up while the loader is still up: compile every program (sky, ocean, fleet, under-water, glyphs, post) for
  // the exact targets they will draw into, then run one real above-water and one under-water frame, with the
  // canvas write scissored to a single pixel, so landing deep in the chapter never shows a blank first frame.
  async function warm() {
    const cam = ctx.camera;
    const saveP = cam.position.clone();
    const saveQ = cam.quaternion.clone();
    const saveFov = cam.fov;
    const prevTarget = renderer.getRenderTarget();
    const wf: FrameInfo = {
      chapter: 'crossing',
      t: 0.2,
      tExact: 0.2,
      dt: 0,
      time: 0,
      aspect: cam.aspect,
      width: 2,
      height: 2,
      pointer: { x: 0, y: 0, active: false, speed: 0 },
    };
    warming = true;
    try {
      for (const t of [0.2, 0.6]) {
        wf.t = wf.tExact = t;
        mod.update(wf);
        mod.pose(wf, cam);
        renderer.setRenderTarget(post.scene);
        await renderer.compileAsync(t < 0.5 ? scene : under.scene, cam);
        renderer.setScissor(0, 0, 1, 1);
        renderer.setScissorTest(true);
        mod.render!(renderer, cam, wf);
        renderer.setScissorTest(false);
      }
    } catch {
      /* non-fatal: the first owned frame just compiles late */
    } finally {
      warming = false;
      setDive(null);
      renderer.setScissorTest(false);
      renderer.setRenderTarget(prevTarget);
      cam.position.copy(saveP);
      cam.quaternion.copy(saveQ);
      cam.fov = saveFov;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      cubeDirty = true;
    }
  }
  await warm();
  // built: the lens starts above water, so the underwater line stays hidden until the dive (CSS keys on this)
  setDive('above');
  return mod;
};

export default create;
