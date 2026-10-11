// The Loop: the water cycle drawn as ONE brush stroke in 3D.
// A hand-built tube (radius varies like a loaded brush) with a luminous core that takes each station's colour
// when its light is placed, plus a wider soft "bleed" tube (watercolour halo on the paper).
import type * as THREE_NS from 'three';
import { GLSL_NOISE, valueNoise2 } from '../../systems/noise';
import { LOOP_KNOTS, SEGMENT_KNOTS, project } from './geo';
import type { SharedUniforms } from './map';

type THREE = typeof THREE_NS;

export interface LoopStroke {
  group: THREE_NS.Group;
  curve: THREE_NS.CatmullRomCurve3;
  /** Arc-length parameter (0..1) of each knot. */
  knotU: number[];
  uniforms: {
    uDraw: { value: number };
    uLit: { value: THREE_NS.Vector3 };
    uPulse: { value: number };
    uPulseAmt: { value: number };
    uSeg: { value: THREE_NS.Vector3 };
    uTip: { value: number };
    uFlow: { value: number };
    /** 0..1 presence: the stroke steps back (to a faint wash) while the DOM ring is the hero. */
    uFade: { value: number };
  };
  dispose(): void;
}

function buildTube(
  THREE: THREE,
  curve: THREE_NS.CatmullRomCurve3,
  segs: number,
  radial: number,
  radius: (u: number) => number,
): THREE_NS.BufferGeometry {
  const frames = curve.computeFrenetFrames(segs, true);
  const pos: number[] = [];
  const nor: number[] = [];
  const su: number[] = [];
  const sa: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u % 1, P);
    const N = frames.normals[i % segs];
    const B = frames.binormals[i % segs];
    const r = radius(u);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      n.set(0, 0, 0).addScaledVector(N, Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
      pos.push(P.x + n.x * r, P.y + n.y * r, P.z + n.z * r);
      nor.push(n.x, n.y, n.z);
      su.push(u);
      sa.push(j / radial);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(su, 1));
  g.setAttribute('aA', new THREE.Float32BufferAttribute(sa, 1));
  g.setIndex(idx);
  return g;
}

const COMMON = /* glsl */ `
uniform float uDraw;
uniform vec3 uLit;      // love (river), gratitude (sea), forgive (rain): 0..1
uniform float uPulse;   // position of the closing bloom along the loop
uniform float uPulseAmt;
uniform vec3 uSeg;      // u where sea starts, rain starts, river (love) starts again
uniform vec3 uGold;
uniform vec3 uTeal;
uniform vec3 uSilver;
uniform vec3 uInk;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uFade;
varying float vS;
varying vec3 vN;
varying vec3 vWorld;
float segLit(float s){
  return (s < uSeg.x || s >= uSeg.z) ? uLit.x : (s < uSeg.y ? uLit.y : uLit.z);
}
float isRain(float s){
  return (s >= uSeg.y && s < uSeg.z) ? 1.0 : 0.0;
}
vec3 segCol(float s){
  return (s < uSeg.x || s >= uSeg.z) ? uGold : (s < uSeg.y ? uTeal : uSilver);
}
float pulse(float s){
  float d = abs(s - uPulse);
  d = min(d, 1.0 - d);
  return exp(-d * d / 0.0016) * uPulseAmt;
}
`;

const VERT = /* glsl */ `
attribute float aS;
attribute float aA;
uniform float uGrow;
varying float vS;
varying float vA;
varying vec3 vN;
varying vec3 vWorld;
void main(){
  vS = aS;
  vA = aA;
  vN = normalize(mat3(modelMatrix) * normal);
  vec3 p = position + normal * uGrow;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CORE_FRAG = /* glsl */ `
${COMMON}
${GLSL_NOISE}
uniform float uTip;
uniform float uFlow;
uniform float uLen;
varying float vA;
void main(){
  if (vS > uDraw) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = clamp(dot(normalize(vN), V), 0.0, 1.0);
  float rim = 1.0 - facing;
  // Bristle streaks run along the stroke; the edges break up like a dry brush.
  float along = vS * uLen;
  float bristle = vnoise(vec2(vA * 26.0, along * 0.35)) * 0.6 + vnoise(vec2(vA * 61.0, along * 0.9)) * 0.4;
  float ragged = vnoise(vec2(along * 1.7, vA * 9.0));
  if (rim > 0.52 && bristle + ragged * 0.6 < 0.42 + (rim - 0.52) * 1.6) discard;
  float lit = segLit(vS);
  float pl = pulse(vS);
  vec3 core = mix(uInk, segCol(vS) * 1.1, clamp(lit + pl * 0.8, 0.0, 1.0));
  vec3 col = mix(core, uInk, pow(rim, 1.4) * mix(0.3, 0.9, lit));
  // ink is never flat black: lighter bristle streaks where the brush ran dry
  col = mix(col, uInk * 3.2, smoothstep(0.55, 0.85, bristle) * 0.6 * (1.0 - lit));
  // A thread of lantern light runs inside the ink and flows the way water does: river → sea → rain → river.
  float flow = 0.6 + 0.4 * sin(along * 0.9 - uTime * 1.4 * uFlow);
  float thread = smoothstep(0.93, 0.99, facing) * (1.0 - lit) * flow;
  col = mix(col, uGold, thread * 0.8);
  col = mix(col, uGold * 1.1, pl * 0.7);
  // the wet tip while the stroke is still being drawn
  float tip = smoothstep(0.025, 0.0, uDraw - vS) * uTip;
  col = mix(col, uGold * 1.1, tip * 0.85);
  // rain is cool blue-silver with a wet sheen running along it (never a flat grey)
  float sheen = pow(facing, 7.0) * (0.55 + 0.45 * sin(along * 1.3 - uTime * 0.9 * uFlow));
  col += vec3(0.78, 0.88, 1.0) * sheen * 0.42 * lit * isRain(vS);
  float dist = length(vWorld - cameraPosition);
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  col = mix(col, uFogColor, fog * 0.22 + max(0.0, fog - 0.4) * 1.2);
  gl_FragColor = vec4(col, uFade);
  #include <colorspace_fragment>
}
`;

const HALO_FRAG = /* glsl */ `
${COMMON}
void main(){
  if (vS > uDraw) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = clamp(abs(dot(normalize(vN), V)), 0.0, 1.0);
  float lit = segLit(vS);
  float pl = pulse(vS);
  float a = pow(facing, 2.2) * (0.3 * lit + 0.55 * pl);
  // a little breathing so a placed light feels alive, never flashing
  a *= 0.9 + 0.1 * sin(uTime * 1.3 + vS * 40.0);
  vec3 col = mix(segCol(vS), uGold, pl);
  float dist = length(vWorld - cameraPosition);
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  a *= (1.0 - fog) * uFade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export function createStroke(THREE: THREE, shared: SharedUniforms, opts: { hi: boolean; radius: number }): LoopStroke {
  const pts = LOOP_KNOTS.map((k) => {
    const [x, z] = project(k.lat, k.lon);
    return new THREE.Vector3(x, k.alt, z);
  });
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  curve.arcLengthDivisions = 2000;

  // Knot positions in arc-length u.
  const per = 64;
  const lengths = curve.getLengths(pts.length * per);
  const total = lengths[lengths.length - 1];
  const knotU = pts.map((_, i) => lengths[i * per] / total);

  const R = opts.radius;
  const radius = (u: number) => {
    // A loaded brush: swells and thins along the stroke, slightly heavier where it starts at Jiangyin.
    const n = valueNoise2(u * 18, 0.5, 7) * 0.6 + valueNoise2(u * 55, 3.5, 9) * 0.4;
    const start = Math.exp(-((u - 0.01) ** 2) / 0.0008) * 0.35;
    return R * (0.72 + 0.5 * n + start);
  };
  const segs = opts.hi ? 900 : 520;
  const coreGeo = buildTube(THREE, curve, segs, opts.hi ? 10 : 7, radius);
  const haloGeo = buildTube(THREE, curve, Math.round(segs / 2), 8, (u) => radius(u) * 3.2 + R * 0.5);

  const uniforms = {
    uDraw: { value: 0 },
    uLit: { value: new THREE.Vector3() },
    uPulse: { value: 0 },
    uPulseAmt: { value: 0 },
    uSeg: {
      value: new THREE.Vector3(knotU[SEGMENT_KNOTS.seaStart], knotU[SEGMENT_KNOTS.rainStart], knotU[SEGMENT_KNOTS.riverStart]),
    },
    uTip: { value: 1 },
    uFlow: { value: 1 },
    uFade: { value: 1 },
  };
  const base = {
    ...uniforms,
    uGold: { value: new THREE.Color('#F2A93B') },
    uTeal: { value: new THREE.Color('#3E8C8A') },
    uSilver: { value: new THREE.Color('#9DB8D2') },
    uInk: { value: new THREE.Color('#1c1b19') },
    uFogColor: shared.uFogColor,
    uFogDensity: shared.uFogDensity,
    uTime: shared.uTime,
  };
  const coreMat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: CORE_FRAG,
    uniforms: { ...base, uGrow: { value: 0 }, uLen: { value: total } },
    // transparent only so it can step back to a faint wash (uFade); it still writes depth, one tube, no self-overlap
    transparent: true,
    toneMapped: false,
  });
  const haloMat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: HALO_FRAG,
    uniforms: { ...base, uGrow: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  core.renderOrder = 2;
  halo.renderOrder = 3;
  core.frustumCulled = halo.frustumCulled = false;
  const group = new THREE.Group();
  group.add(core, halo);

  return {
    group,
    curve,
    knotU,
    uniforms,
    dispose() {
      coreGeo.dispose();
      haloGeo.dispose();
      coreMat.dispose();
      haloMat.dispose();
    },
  };
}
