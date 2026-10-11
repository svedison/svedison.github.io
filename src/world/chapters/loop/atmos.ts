// The Loop: clouds (the crane rises through them; a cluster sits over Seattle), the rain that falls from it,
// and the three station marks (brushed rings that fill with colour when a light is placed).
import type * as THREE_NS from 'three';
import { GLSL_NOISE, makeRng } from '../../systems/noise';
import type { SharedUniforms } from './map';

type THREE = typeof THREE_NS;

// ---------------------------------------------------------------- clouds
export interface CloudPuff {
  x: number;
  y: number;
  z: number;
  s: number;
}

export interface Clouds {
  mesh: THREE_NS.Mesh;
  setCount(n: number): void;
  dispose(): void;
}

const CLOUD_VERT = /* glsl */ `
attribute vec4 aPuff;   // xyz centre, size
attribute float aSeed;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying vec3 vWorld;
void main(){
  vUv = position.xy;
  vSeed = aSeed;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 c = aPuff.xyz + vec3(sin(uTime * 0.03 + aSeed * 6.0) * 1.2, 0.0, 0.0);
  // flatten a little: clouds are wider than tall
  vec3 wp = c + (right * position.x * 1.25 + up * position.y * 0.8) * aPuff.w;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const CLOUD_FRAG = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uOpacity;
uniform vec3 uLight;
uniform vec3 uShade;
varying vec2 vUv;
varying float vSeed;
varying vec3 vWorld;
${GLSL_NOISE}
void main(){
  vec2 q = vUv;
  float n = fbm(q * 2.2 + vSeed * 31.0, 4);
  float d = length(q * vec2(1.0, 1.25)) + (n - 0.5) * 0.75;
  float a = smoothstep(1.0, 0.25, d);
  if (a < 0.01) discard;
  // paper-white tops, a cool grey wash underneath (ink-wash clouds, not photographic)
  float under = smoothstep(0.35, -0.6, q.y + (n - 0.5) * 0.5);
  vec3 col = mix(uLight, uShade, under * 0.6);
  float dist = length(vWorld - cameraPosition);
  // fade as the camera passes through so no billboard edge is ever seen
  a *= smoothstep(1.5, 9.0, dist);
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  col = mix(col, uFogColor, fog * 0.4);
  gl_FragColor = vec4(col, a * uOpacity);
  #include <colorspace_fragment>
}
`;

export function createClouds(THREE: THREE, shared: SharedUniforms, puffs: CloudPuff[], opacity = 0.92): Clouds {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const pf = new Float32Array(puffs.length * 4);
  const sd = new Float32Array(puffs.length);
  puffs.forEach((p, i) => {
    pf.set([p.x, p.y, p.z, p.s], i * 4);
    sd[i] = (i * 0.618034) % 1;
  });
  g.setAttribute('aPuff', new THREE.InstancedBufferAttribute(pf, 4));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd, 1));
  g.instanceCount = puffs.length;
  const mat = new THREE.ShaderMaterial({
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    uniforms: {
      uTime: shared.uTime,
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
      uOpacity: { value: opacity },
      uLight: { value: new THREE.Color('#f6f2ea') },
      uShade: { value: new THREE.Color('#aeb4b6') },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  const max = puffs.length;
  return {
    mesh,
    setCount(n) {
      g.instanceCount = Math.max(0, Math.min(max, n));
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}

/** Deterministic puff placement in a box (x, z centre; half extents; altitude range). */
export function scatterPuffs(
  seed: number,
  n: number,
  cx: number,
  cz: number,
  hx: number,
  hz: number,
  y0: number,
  y1: number,
  s0: number,
  s1: number,
): CloudPuff[] {
  const rng = makeRng(seed);
  const out: CloudPuff[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: cx + (rng() * 2 - 1) * hx,
      z: cz + (rng() * 2 - 1) * hz,
      y: y0 + rng() * (y1 - y0),
      s: s0 + rng() * (s1 - s0),
    });
  }
  return out;
}

// ---------------------------------------------------------------- rain streaks
export interface RainStreaks {
  mesh: THREE_NS.LineSegments;
  setDensity(d: number): void;
  dispose(): void;
}

const RAIN_VERT = /* glsl */ `
attribute vec4 aDrop; // x, z offset, phase, end (0 top / 1 bottom)
uniform float uTime;
uniform vec3 uOrigin;
uniform float uHeight;
uniform float uLen;
uniform float uRadius;
varying float vA;
varying vec3 vWorld;
void main(){
  float fall = fract(aDrop.z + uTime * 0.55);
  float y = uOrigin.y - fall * uHeight - aDrop.w * uLen;
  vec3 wp = vec3(uOrigin.x + aDrop.x * uRadius, y, uOrigin.z + aDrop.y * uRadius);
  // fade in under the cloud and out before the ground
  vA = smoothstep(0.0, 0.15, fall) * smoothstep(1.0, 0.75, fall);
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vA;
varying vec3 vWorld;
void main(){
  float dist = length(vWorld - cameraPosition);
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  gl_FragColor = vec4(uColor, vA * uOpacity * (1.0 - fog));
  #include <colorspace_fragment>
}
`;

export function createRainStreaks(
  THREE: THREE,
  shared: SharedUniforms,
  opts: { count: number; origin: THREE_NS.Vector3; height: number; radius: number; seed: number; length?: number },
): RainStreaks {
  const rng = makeRng(opts.seed);
  const n = opts.count;
  const a = new Float32Array(n * 2 * 4);
  const pos = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    // disc distribution, denser in the middle of the cloud
    const r = Math.sqrt(rng()) * (0.4 + 0.6 * rng());
    const th = rng() * Math.PI * 2;
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    const ph = rng();
    a.set([x, z, ph, 0, x, z, ph, 1], i * 8);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aDrop', new THREE.BufferAttribute(a, 4));
  const mat = new THREE.ShaderMaterial({
    vertexShader: RAIN_VERT,
    fragmentShader: RAIN_FRAG,
    uniforms: {
      uTime: shared.uTime,
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
      uOrigin: { value: opts.origin.clone() },
      uHeight: { value: opts.height },
      uLen: { value: opts.length ?? 0.9 },
      uRadius: { value: opts.radius },
      uColor: { value: new THREE.Color('#5d676d') },
      uOpacity: { value: 0.55 },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.LineSegments(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return {
    mesh,
    setDensity(d) {
      g.setDrawRange(0, Math.round(n * Math.max(0, Math.min(1, d))) * 2);
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------- station marks
export interface StationMarks {
  mesh: THREE_NS.Mesh;
  /** i: 0 love, 1 gratitude, 2 forgive. lit 0..1, ring 0..1 (expanding ring on placement), pulse 0..1, appear 0..1. */
  set(i: number, lit: number, ring: number, pulse: number, appear: number): void;
  dispose(): void;
}

const MARK_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aCol;
attribute float aIdx;
uniform float uSize;
uniform vec4 uState[3]; // lit, ring, pulse, appear
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vState;
varying float vIdx;
void main(){
  vUv = position.xy;
  vCol = aCol;
  int i = int(aIdx + 0.5);
  vState = i == 0 ? uState[0] : (i == 1 ? uState[1] : uState[2]);
  vIdx = aIdx;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  // size in world units, scaled by distance so marks keep a steady on-screen size
  vec4 vc = viewMatrix * vec4(aPos, 1.0);
  float s = uSize * -vc.z * 0.02 * (1.0 + vState.y * 1.6);
  vec3 wp = aPos + (right * position.x + up * position.y) * s;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const MARK_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uPaper;
uniform vec3 uGold;
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vState;
varying float vIdx;
${GLSL_NOISE}
void main(){
  float lit = vState.x;
  float ring = vState.y;
  float pulse = vState.z;
  // marks are drawn at (1 + ring * 1.6) scale while the placement ring expands; keep the mark itself steady
  float k = 1.0 + ring * 1.6;
  vec2 q = vUv * k;
  float r = length(q);
  float ang = atan(q.y, q.x);
  // brushed ring (ensō) with a small gap that closes when lit
  float wob = (vnoise(vec2(ang * 2.0 + vIdx * 7.0, vIdx)) - 0.5) * 0.06;
  float R = 0.42 + wob;
  float w = 0.075 + 0.035 * sin(ang * 1.0 + vIdx * 2.0);
  float aa = fwidth(r) * 1.2;
  float band = smoothstep(w + aa, w - aa, abs(r - R));
  float gapAng = mod(ang - (0.9 + vIdx * 1.7) + 6.2831853, 6.2831853);
  float gap = smoothstep(0.0, 0.18, gapAng) * smoothstep(0.62, 0.42, gapAng);
  band *= 1.0 - gap * (1.0 - lit);
  // fill: pale paper while waiting; the light's colour once placed
  float inside = smoothstep(R - w * 0.5 + aa, R - w * 0.5 - aa, r);
  vec3 fill = mix(uPaper, vCol * 1.08, lit);
  float fillA = inside * mix(0.85, 1.0, lit);
  // soft halo of the light around the mark
  float halo = exp(-pow(max(r - R, 0.0) / 0.32, 2.0)) * (1.0 - inside) * (0.55 * lit + 0.6 * pulse);
  // expanding placement ring
  float er = 0.42 + ring * 0.6 * k;
  float pr = smoothstep(0.03 + aa, 0.0, abs(r - er)) * (1.0 - ring) * step(0.001, ring);
  vec3 col = fill;
  float a = fillA;
  col = mix(col, vCol, (1.0 - a) * step(0.001, halo));
  a = max(a, halo);
  col = mix(col, uInk, band);
  a = max(a, band);
  col = mix(col, vCol, pr * (1.0 - band));
  a = max(a, pr * 0.8);
  a *= vState.w;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export function createStationMarks(
  THREE: THREE,
  stations: { pos: THREE_NS.Vector3; color: THREE_NS.ColorRepresentation }[],
  size: number,
): StationMarks {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const p = new Float32Array(stations.length * 3);
  const c = new Float32Array(stations.length * 3);
  const ix = new Float32Array(stations.length);
  const tmp = new THREE.Color();
  stations.forEach((s, i) => {
    p.set([s.pos.x, s.pos.y, s.pos.z], i * 3);
    tmp.set(s.color);
    c.set([tmp.r, tmp.g, tmp.b], i * 3);
    ix[i] = i;
  });
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(p, 3));
  g.setAttribute('aCol', new THREE.InstancedBufferAttribute(c, 3));
  g.setAttribute('aIdx', new THREE.InstancedBufferAttribute(ix, 1));
  g.instanceCount = stations.length;
  const state = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  const mat = new THREE.ShaderMaterial({
    vertexShader: MARK_VERT,
    fragmentShader: MARK_FRAG,
    uniforms: {
      uSize: { value: size },
      uState: { value: state },
      uInk: { value: new THREE.Color('#1c1b19') },
      uPaper: { value: new THREE.Color('#f3ede2') },
      uGold: { value: new THREE.Color('#F2A93B') },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return {
    mesh,
    set(i, lit, ring, pulse, appear) {
      state[i].set(lit, ring, pulse, appear);
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}
