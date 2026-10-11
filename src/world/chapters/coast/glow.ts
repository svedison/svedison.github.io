// Lantern light that reads at a distance: one instanced draw holds
//   kind 0  soft camera-facing glow discs behind every lantern (so a 1 m lantern still carries 60 px of light), and
//   kind 1  flat rings on the water: a warm ripple where each friend's lantern is lit, plus the hover ring that
//           circles the convoy when the pointer (or focus) finds the hotspot.
// HDR additive colour; the alpha channel is left untouched so the ray pass's sky mask is not disturbed.
import type * as THREE_NS from 'three';

type THREE = typeof THREE_NS;

export interface Glow {
  mesh: THREE_NS.Mesh;
  /** Write instance i. kind 0 = billboard glow, 1 = flat ring (size = ring diameter). */
  set(i: number, kind: 0 | 1, x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number): void;
  hide(i: number): void;
  commit(): void;
  dispose(): void;
}

export function createGlow(THREE: THREE, count: number): Glow {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const iPos = new Float32Array(count * 4); // xyz + size
  const iCol = new Float32Array(count * 4); // rgb + alpha
  const iKind = new Float32Array(count);
  const aPos = new THREE.InstancedBufferAttribute(iPos, 4);
  const aCol = new THREE.InstancedBufferAttribute(iCol, 4);
  const aKind = new THREE.InstancedBufferAttribute(iKind, 1);
  aPos.setUsage(THREE.DynamicDrawUsage);
  aCol.setUsage(THREE.DynamicDrawUsage);
  aKind.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', aPos);
  geo.setAttribute('iCol', aCol);
  geo.setAttribute('iKind', aKind);
  geo.instanceCount = count;

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    vertexShader: /* glsl */ `
      attribute vec4 iPos;
      attribute vec4 iCol;
      attribute float iKind;
      varying vec2 vUv;
      varying vec4 vCol;
      varying float vKind;
      void main(){
        vUv = uv;
        vCol = iCol;
        vKind = iKind;
        if (iCol.a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        if (iKind < 0.5) {
          vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
          mv.xy += position.xy * iPos.w;
          // pull toward the camera a little so the disc is not cut by the lantern's own float
          mv.xyz += normalize(-mv.xyz) * 0.6;
          gl_Position = projectionMatrix * mv;
        } else {
          vec3 wp = iPos.xyz + vec3(position.x, 0.0, -position.y) * iPos.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec4 vCol;
      varying float vKind;
      void main(){
        float d = length(vUv * 2.0 - 1.0);
        float k;
        if (vKind < 0.5) {
          k = exp(-d * d * 7.0) * 0.8 + exp(-d * d * 40.0) * 0.6;
          k *= 1.0 - smoothstep(0.85, 1.0, d);
        } else {
          // ring peak well inside the quad, fully faded before its edge: at the grazing bluff-top view a ring cut at
          // the quad edge read as a hard pale wedge on the water
          float w = 0.07;
          k = exp(-pow((d - 0.78) / w, 2.0)) + 0.2 * exp(-pow((d - 0.64) / (w * 1.6), 2.0));
          k *= 1.0 - smoothstep(0.86, 0.98, d);
        }
        gl_FragColor = vec4(vCol.rgb * k * vCol.a, 0.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'coast-lantern-glow';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  return {
    mesh,
    set(i, kind, x, y, z, size, r, g, b, a) {
      iPos[i * 4] = x;
      iPos[i * 4 + 1] = y;
      iPos[i * 4 + 2] = z;
      iPos[i * 4 + 3] = size;
      iCol[i * 4] = r;
      iCol[i * 4 + 1] = g;
      iCol[i * 4 + 2] = b;
      iCol[i * 4 + 3] = a;
      iKind[i] = kind;
    },
    hide(i) {
      iCol[i * 4 + 3] = 0;
    },
    commit() {
      aPos.needsUpdate = true;
      aCol.needsUpdate = true;
      aKind.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      base.dispose();
      mat.dispose();
    },
  };
}
