// Camera-facing additive halos for practical lights (lamp posts, the arcade sconce). One instanced draw.
// Halo size is in world units so it scales with distance like a real glow in wet air; fog applies.
import type * as THREE_NS from 'three';

type THREE = typeof THREE_NS;

export interface Glows {
  mesh: THREE_NS.Mesh;
  setIntensity(v: number): void;
  setAt(i: number, x: number, y: number, z: number, size: number, intensity: number): void;
  dispose(): void;
}

export function createGlows(THREE: THREE, items: { x: number; y: number; z: number; size: number; color: string }[]): Glows {
  const n = items.length;
  const pos = new Float32Array(n * 4);
  const col = new Float32Array(n * 4);
  const c = new THREE.Color();
  items.forEach((it, i) => {
    pos.set([it.x, it.y, it.z, it.size], i * 4);
    c.set(it.color);
    col.set([c.r, c.g, c.b, 1], i * 4);
  });
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const posAttr = new THREE.InstancedBufferAttribute(pos, 4);
  const colAttr = new THREE.InstancedBufferAttribute(col, 4);
  geo.setAttribute('aPos', posAttr);
  geo.setAttribute('aCol', colAttr);
  geo.instanceCount = n;
  const uniforms = { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uI: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec4 aPos; attribute vec4 aCol;
      varying vec2 vP; varying vec4 vC;
      void main(){
        vec4 mvPosition = modelViewMatrix * vec4(aPos.xyz, 1.0);
        mvPosition.xy += position.xy * aPos.w;
        vP = position.xy * 2.0; vC = aCol;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uI;
      varying vec2 vP; varying vec4 vC;
      void main(){
        float d = length(vP);
        float a = exp(-d * d * 14.0) * 0.9 + exp(-d * 4.0) * 0.22;
        a *= 1.0 - smoothstep(0.8, 1.0, d);
        gl_FragColor = vec4(vC.rgb * a * vC.a * uI, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // additive: fog fades the glow out instead of mixing toward the (bright) fog colour
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float ff = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            float ff = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          gl_FragColor.rgb *= 1.0 - ff * 0.85;
        #endif
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = 'glows';
  return {
    mesh,
    setIntensity(v) {
      uniforms.uI.value = v;
    },
    setAt(i, x, y, z, size, intensity) {
      pos[i * 4] = x;
      pos[i * 4 + 1] = y;
      pos[i * 4 + 2] = z;
      pos[i * 4 + 3] = size;
      col[i * 4 + 3] = intensity;
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    },
    dispose() {
      quad.dispose();
      geo.dispose();
      mat.dispose();
      mesh.removeFromParent();
    },
  };
}
