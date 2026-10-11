// Shore surf: a ribbon laid along the waterline (from wet sand up the beach to ~45 m offshore) that draws what the
// open-ocean module does not: lighter shallow water over sand, lines of broken surf rolling in, a lacy swash sheet
// running up the beach and the mirror sheen of wet sand. Driven by its own clock (frozen under reduced motion).
import type * as THREE_NS from 'three';
import { GLSL_NOISE } from '../../systems/noise';
import { heightAt, shoreV, wx, wz } from './geo';
import { HAZE_GLSL, type HazeUniforms } from './haze';

type THREE = typeof THREE_NS;

export interface Surf {
  mesh: THREE_NS.Mesh;
  uniforms: Record<string, THREE_NS.IUniform>;
  update(time: number): void;
  dispose(): void;
}

export function createSurf(THREE: THREE, haze: HazeUniforms, mobile: boolean): Surf {
  const us: number[] = [];
  const step = mobile ? 3 : 2;
  for (let u = -700; u <= 1400; u += u < -260 || u > 520 ? step * 3 : step) us.push(u);
  const os: number[] = [];
  for (let o = -9; o <= 46; o += o < 6 ? 0.75 : 2) os.push(o);
  const nu = us.length;
  const no = os.length;
  const pos = new Float32Array(nu * no * 3);
  const uvo = new Float32Array(nu * no * 2);
  for (let i = 0; i < nu; i++) {
    const u = us[i];
    const sv = shoreV(u);
    for (let j = 0; j < no; j++) {
      const o = os[j];
      const v = sv + o;
      const ground = heightAt(u, v);
      // the water part floats above the calm swell crests so the ocean never pokes through it (also right at the
      // waterline: there the crests used to cover the foam lace, leaving a hard ocean/sand terminator line)
      const lift = 0.3 * Math.min(1, Math.max(0, (o + 1.5) / 3.5)) + 0.17 * Math.min(1, Math.max(0, o / 8));
      const y = Math.max(lift, ground + 0.035);
      const k = i * no + j;
      pos[k * 3] = wx(u, v);
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = wz(u, v);
      uvo[k * 2] = u;
      uvo[k * 2 + 1] = o;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < nu - 1; i++)
    for (let j = 0; j < no - 1; j++) {
      const a = i * no + j;
      const b = (i + 1) * no + j;
      index.push(a, b, b + 1, a, b + 1, a + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCoast', new THREE.BufferAttribute(uvo, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();

  const uniforms: Record<string, THREE_NS.IUniform> = {
    ...haze,
    uTime: { value: 0 },
    uShallow: { value: new THREE.Color('#6d9e92') },
    uFoam: { value: new THREE.Color('#fff1dc') },
    uWetSky: { value: new THREE.Color('#f2b98d') },
    uSunGlow: { value: new THREE.Color('#ffcf8f') },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    // the sheet hugs the beach a few cm above the terrain: bias it forward so the coarser terrain grid never cuts
    // straight polygon edges through it
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    vertexShader: /* glsl */ `
      attribute vec2 aCoast;
      varying vec2 vC;
      varying vec3 vW;
      void main(){
        vC = aCoast;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_NOISE}
      ${HAZE_GLSL}
      uniform float uTime;
      uniform vec3 uShallow, uFoam, uWetSky, uSunGlow;
      varying vec2 vC;
      varying vec3 vW;
      void main(){
        float u = vC.x, o = vC.y;
        // breakup along the shore and across it
        float n1 = fbm(vec2(u * 0.11, o * 0.25) + vec2(uTime * 0.05, 0.0), 4);
        float n2 = vnoise(vec2(u * 0.6, o * 0.9 - uTime * 0.3));
        // three sets of rollers walking in; each set slows and widens as it breaks. Lines break in sections along
        // the shore (never one ruler-straight stroke) and only show once they stand up near the bar.
        float foam = 0.0;
        for (int k = 0; k < 3; k++){
          float fk = float(k);
          float ph = fract(uTime * 0.075 + fk / 3.0 + (vnoise(vec2(u * 0.012, fk * 7.0)) - 0.5) * 0.12);
          float lineO = mix(34.0, -1.0, pow(ph, 0.8)) + (vnoise(vec2(u * 0.05, fk * 3.1)) - 0.5) * 3.0;
          float width = mix(1.1, 3.4, smoothstep(26.0, 6.0, lineO));
          float band = exp(-pow((o - lineO) / width, 2.0));
          float section = smoothstep(0.28, 0.62, vnoise(vec2(u * 0.045 + fk * 13.0, ph * 2.0)));
          // trailing lace behind each breaking line (soft leading edge, no hard step)
          float trail = smoothstep(lineO + 12.0, lineO + 1.0, o) * smoothstep(lineO - 0.5, lineO + 1.5, o) * smoothstep(24.0, 8.0, lineO);
          float lace = smoothstep(0.52, 0.75, n1 + n2 * 0.35);
          foam += (band * (0.5 + 0.4 * n2) * section * smoothstep(30.0, 16.0, lineO) + trail * lace * 0.45) * 0.85;
        }
        // swash: a thin, broken sheet sliding a few metres up the beach and draining back. Its leading edge wanders
        // with noise and is laced, so it never reads as a straight rim across the sand.
        float runN = (vnoise(vec2(u * 0.13, uTime * 0.05)) - 0.5) * 1.8;
        float run = -2.6 * (0.5 + 0.5 * sin(uTime * 0.47 + u * 0.02)) - 0.4 + runN;
        float swash = smoothstep(run - 0.9, run + 0.9, o) * smoothstep(1.5, -0.5, o);
        float swEdge = exp(-pow((o - run - 0.25) / 0.7, 2.0)) * smoothstep(0.35, 0.7, n2 + 0.3 * n1);
        // the swash rim is the beach's soft foam edge: a lace line, brighter than the sheet behind it
        foam += swEdge * 0.6 + swash * smoothstep(0.5, 0.75, n1) * 0.3;
        // a standing lace of foam right at the waterline, so sand never meets water on a hard terminator line
        foam += exp(-pow((o - 0.4) / 1.3, 2.0)) * (0.32 + 0.3 * smoothstep(0.3, 0.7, n1 + 0.25 * n2));
        foam = clamp(foam, 0.0, 0.85);

        // shallow water over sand: lighter teal toward the beach
        float shallow = smoothstep(42.0, 4.0, o) * smoothstep(-1.0, 1.0, o);
        vec3 col = uShallow;
        float a = shallow * 0.24;
        // wet sand above the waterline: dark with a sky sheen; the inland edge wanders and feathers into dry sand
        float wetIn = -4.0 - 2.2 * fbm(vec2(u * 0.05, 3.7), 3);
        float wet = smoothstep(0.6, -0.8, o) * smoothstep(wetIn - 2.5, wetIn + 0.5, o);
        vec3 V = normalize(cameraPosition - vW);
        float sheen = pow(1.0 - max(V.y, 0.0), 4.0);
        vec3 wetCol = mix(vec3(0.16, 0.12, 0.09), uWetSky * 1.1 + uSunGlow * 0.25, 0.25 + sheen * 0.5);
        col = mix(col, wetCol, wet);
        a = max(a, wet * 0.62);
        // foam lit by the low sun behind it: warm, bright but not paper-white
        vec3 foamCol = uFoam * (0.92 + 0.3 * n2);
        col = mix(col, foamCol, foam);
        a = max(a, foam * 0.9);
        // fade the ribbon into the open sea and into the dry beach (no border is ever visible)
        a *= smoothstep(46.0, 28.0, o) * smoothstep(-9.0, -6.5, o);

        vec3 hzV = vW - cameraPosition;
        float hzD = length(hzV);
        col = mix(col, oceanHaze(hzV / hzD), hazeAmount(hzD));
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'coast-surf';
  mesh.renderOrder = 1;
  return {
    mesh,
    uniforms,
    update(time) {
      uniforms.uTime.value = time;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
