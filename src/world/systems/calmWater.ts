// Calm analytic water (river / canal / lake). Deliberately NOT the ocean (3d-ultra-realistic-water says mirror-flat
// water wants a cheap analytic plane). Per pixel:
//   normal  = flat + a few slow analytic swell terms + fine value-noise ripples (faded by pixel footprint) + ring ripples
//   colour  = mix(body, skyReflection(reflect(view, n)), Schlick Fresnel) + sun glint + lantern glows (streaky because
//             the normal is rippled) — the sky gradient is evaluated with the same terms as sky.ts so they agree.
//   fog     = three's fog chunks (scene.fog works).
// ripple(x,z,strength): ring buffer of 8 expanding rings (world xz). rippleAtNdc() raycasts the pointer for you.
import type * as THREE_NS from 'three';
import { GLSL_NOISE } from './noise';
import type { SkyState } from './sky';

type THREE = typeof THREE_NS;

export interface CalmWaterOptions {
  /** Plane size (x, z). Default [400, 400]. */
  size?: [number, number];
  /** Water level (y). Default 0. */
  level?: number;
  /** Body (deep) colour. Default murky jade #2c4440. */
  color?: THREE_NS.ColorRepresentation;
  /** Sky colours used for reflection (keep in sync with createSky via setSky). */
  horizon?: THREE_NS.ColorRepresentation;
  zenith?: THREE_NS.ColorRepresentation;
  sunDir?: THREE_NS.Vector3;
  sunColor?: THREE_NS.ColorRepresentation;
  /** Ripple normal strength 0..1. Default 0.35. */
  roughness?: number;
  /** World-space scale of the fine ripples (bigger = larger ripples). Default 1. */
  rippleScale?: number;
  /** Flow direction (xz) and speed of the fine ripples. Default [0.25, 0.05]. */
  flow?: [number, number];
  /** Animate (false under reduced motion: still water, rings still work). Default true. */
  animate?: boolean;
}

export interface CalmWater {
  mesh: THREE_NS.Mesh;
  uniforms: Record<string, THREE_NS.IUniform>;
  /** Start an expanding ring at world (x, z). strength ~0.2..1.5. Up to 8 concurrent (oldest replaced). */
  ripple(x: number, z: number, strength?: number): void;
  /** Raycast NDC (-1..1) to the water plane and ripple there. Returns false if the ray misses. */
  rippleAtNdc(ndcX: number, ndcY: number, camera: THREE_NS.Camera, strength?: number): boolean;
  /** Up to 4 warm light reflections (lanterns) on the water: world position + colour + intensity. */
  setGlow(i: number, pos: THREE_NS.Vector3 | null, color?: THREE_NS.ColorRepresentation, intensity?: number): void;
  /** Sync reflection colours with the sky. */
  setSky(s: Pick<SkyState, 'horizon' | 'zenith' | 'sunDir' | 'sunColor'> & { sun?: number }): void;
  setColor(c: THREE_NS.ColorRepresentation): void;
  /** Rain dimples on the surface, 0 (none) .. 1 (downpour). Pair with createRainField density. */
  setRain(v: number): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

const MAX_RINGS = 8;
const MAX_GLOWS = 4;

export function createCalmWater(THREE: THREE, opts: CalmWaterOptions = {}): CalmWater {
  const [sx, sz] = opts.size ?? [400, 400];
  const level = opts.level ?? 0;
  const rings: THREE_NS.Vector4[] = [];
  for (let i = 0; i < MAX_RINGS; i++) rings.push(new THREE.Vector4(0, 0, -1000, 0));
  const glowPos: THREE_NS.Vector4[] = [];
  const glowCol: THREE_NS.Color[] = [];
  for (let i = 0; i < MAX_GLOWS; i++) {
    glowPos.push(new THREE.Vector4(0, 0, 0, 0));
    glowCol.push(new THREE.Color(0, 0, 0));
  }
  const uniforms: Record<string, THREE_NS.IUniform> = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uBody: { value: new THREE.Color(opts.color ?? '#2c4440') },
    uHorizon: { value: new THREE.Color(opts.horizon ?? '#d9c7b0') },
    uZenith: { value: new THREE.Color(opts.zenith ?? '#5d7a8c') },
    uSunDir: { value: (opts.sunDir ?? new THREE.Vector3(0.6, 0.12, -0.8)).clone().normalize() },
    uSunColor: { value: new THREE.Color(opts.sunColor ?? '#ffd2a0') },
    uSun: { value: 1 },
    uRough: { value: opts.roughness ?? 0.35 },
    uScale: { value: opts.rippleScale ?? 1 },
    uFlow: { value: new THREE.Vector2(...(opts.flow ?? [0.25, 0.05])) },
    uRain: { value: 0 },
    uRings: { value: rings },
    uGlowPos: { value: glowPos },
    uGlowCol: { value: glowCol },
  };

  const geo = new THREE.PlaneGeometry(sx, sz, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      ${GLSL_NOISE}
      uniform float uTime, uRough, uScale, uSun, uRain;
      uniform vec2 uFlow;
      uniform vec3 uBody, uHorizon, uZenith, uSunDir, uSunColor;
      uniform vec4 uRings[${MAX_RINGS}];
      uniform vec4 uGlowPos[${MAX_GLOWS}];
      uniform vec3 uGlowCol[${MAX_GLOWS}];
      varying vec3 vWorld;

      vec3 skyRefl(vec3 r){
        float y = clamp(r.y, 0.0, 1.0);
        float t = pow(y, 0.55);
        vec3 mid = mix(uHorizon, uZenith, 0.42) * 0.96;
        vec3 c = mix(mix(uHorizon, mid, smoothstep(0.0, 0.45, t)), uZenith, smoothstep(0.35, 1.0, t));
        float cs = max(dot(r, uSunDir), 0.0);
        c += uSunColor * (pow(cs, 8.0) * 0.25 + pow(cs, 90.0) * 0.5) * uSun;
        return c;
      }
      // height field of fine ripples, used via finite differences
      float hFine(vec2 p){
        vec2 q = p / uScale;
        return vnoise(q * 1.7 + uFlow * uTime) * 0.6 + vnoise(q * 3.9 - uFlow.yx * uTime * 1.3 + 7.1) * 0.4;
      }
      void main(){
        vec2 p = vWorld.xz;
        vec3 V = normalize(cameraPosition - vWorld);
        float dist = length(cameraPosition - vWorld);
        // pixel footprint: fade detail that would alias (DPR-agnostic: derived from derivatives)
        float fw = length(fwidth(p));
        float fineK = 1.0 - smoothstep(0.08 * uScale, 0.5 * uScale, fw);
        vec2 grad = vec2(0.0);
        // slow analytic swells
        grad += 0.030 * vec2(cos(p.x * 0.21 + uTime * 0.35), 0.0);
        grad += 0.022 * vec2(0.0, cos(p.y * 0.17 + p.x * 0.05 - uTime * 0.27));
        grad += 0.016 * vec2(cos((p.x + p.y) * 0.43 + uTime * 0.6)) * vec2(1.0, 1.0);
        // fine ripples (finite differences)
        float e = 0.06 * uScale;
        float h0 = hFine(p);
        vec2 gf = vec2(hFine(p + vec2(e, 0.0)) - h0, hFine(p + vec2(0.0, e)) - h0) / e;
        grad += gf * 0.09 * uScale * fineK;
        grad *= uRough * 2.0;
        // ring ripples: expanding damped wave packets
        for (int i = 0; i < ${MAX_RINGS}; i++) {
          vec4 R = uRings[i];
          float age = uTime - R.z;
          if (age < 0.0 || age > 4.0) continue;
          vec2 dp = p - R.xy;
          float r = length(dp) + 1e-4;
          float front = age * 1.1;
          float x = r - front;
          float env = exp(-x * x * 6.0) * exp(-age * 0.9) * R.w;
          float wave = cos(x * 18.0) ;
          grad += (dp / r) * wave * env * 0.35 * fineK;
        }
        // rain dimples: one short-lived ring per 0.55-unit cell (3x3 neighbourhood), density by uRain
        if (uRain > 0.001) {
          vec2 cellSz = vec2(0.55);
          vec2 cid = floor(p / cellSz);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 c = cid + vec2(float(i), float(j));
            vec2 h = hash22(c);
            if (h.x > uRain) continue;
            float per = 0.9 + h.y * 0.6;
            float ph = fract(uTime / per + h.x * 7.13);
            vec2 ctr = (c + 0.2 + 0.6 * hash22(c + 17.0 + floor(uTime / per + h.x * 7.13))) * cellSz;
            vec2 dp = p - ctr;
            float r = length(dp) + 1e-4;
            float x = r - ph * 0.42;
            float env = exp(-x * x * 900.0) * (1.0 - ph) * (1.0 - ph);
            grad += (dp / r) * cos(x * 60.0) * env * 0.5 * fineK;
          }
        }
        vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        float cosT = clamp(dot(N, V), 0.0, 1.0);
        float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        vec3 refl = skyRefl(R);
        // body: a touch of sky lighting so it is never dead black
        vec3 body = uBody * (0.55 + 0.45 * uHorizon);
        vec3 col = mix(body, refl, F);
        // sun glint
        float sg = pow(max(dot(R, uSunDir), 0.0), 600.0);
        col += uSunColor * sg * 3.0 * uSun * step(0.0, uSunDir.y);
        // lantern glows: specular toward each light, broken into a streak by the ripples
        for (int i = 0; i < ${MAX_GLOWS}; i++) {
          vec4 G = uGlowPos[i];
          if (G.w <= 0.0) continue;
          vec3 L = normalize(G.xyz - vWorld);
          float s = max(dot(R, L), 0.0);
          float d = length(G.xz - p);
          col += uGlowCol[i] * G.w * (pow(s, 300.0) * 2.2 + pow(s, 40.0) * 0.18) ;
          col += uGlowCol[i] * G.w * 0.12 * exp(-d * 5.0);    // small pool of light on the surface beneath
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'calm-water';
  mesh.position.y = level;

  let ringIdx = 0;
  let now = 0;
  const animate = opts.animate ?? true;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -level);
  const hit = new THREE.Vector3();

  const api: CalmWater = {
    mesh,
    uniforms,
    ripple(x, z, strength = 1) {
      rings[ringIdx].set(x, z, now, strength);
      ringIdx = (ringIdx + 1) % MAX_RINGS;
    },
    rippleAtNdc(nx, ny, camera, strength = 1) {
      ndc.set(nx, ny);
      ray.setFromCamera(ndc, camera);
      plane.constant = -mesh.position.y;
      if (!ray.ray.intersectPlane(plane, hit)) return false;
      api.ripple(hit.x, hit.z, strength);
      return true;
    },
    setGlow(i, pos, color, intensity = 1) {
      if (i < 0 || i >= MAX_GLOWS) return;
      if (!pos) {
        glowPos[i].w = 0;
        return;
      }
      glowPos[i].set(pos.x, pos.y, pos.z, intensity);
      if (color !== undefined) glowCol[i].set(color);
    },
    setSky(s) {
      (uniforms.uHorizon.value as THREE_NS.Color).copy(s.horizon);
      (uniforms.uZenith.value as THREE_NS.Color).copy(s.zenith);
      (uniforms.uSunDir.value as THREE_NS.Vector3).copy(s.sunDir).normalize();
      (uniforms.uSunColor.value as THREE_NS.Color).copy(s.sunColor);
      if (s.sun !== undefined) uniforms.uSun.value = s.sun;
    },
    setRain(v) {
      uniforms.uRain.value = Math.max(0, Math.min(1, v));
    },
    setColor(c) {
      (uniforms.uBody.value as THREE_NS.Color).set(c);
    },
    update(dt, _time) {
      // Own clock so rings stay coherent even if animation is frozen (reduced motion still shows touched rings).
      now += dt;
      uniforms.uTime.value = animate ? now : 0;
      if (!animate) {
        // rings still need a clock: shift ring start times back instead of advancing the global time
        for (let i = 0; i < MAX_RINGS; i++) rings[i].z -= dt;
        now -= dt;
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.removeFromParent();
    },
  };
  return api;
}
