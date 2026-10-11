// Contact darkening for the Seattle quad: a soft, noise-broken occlusion pool where things meet the ground (cherry
// trunks, lamp posts, the bench), so nothing sits on the snow like a sticker. Strongest in winter, when the white
// ground shows it most. Lamp spots also carry a faint warm slush ring in winter (the snow melts where the light
// falls). One instanced draw; no per-frame allocation.
import type * as THREE_NS from 'three';
import { GLSL_NOISE } from '../../systems/noise';
import { LAND_Y } from './terrain';

type THREE = typeof THREE_NS;

export interface ContactSpot {
  x: number;
  z: number;
  /** radius x / z (m) */
  rx: number;
  rz: number;
  /** occlusion strength 0..1 */
  k: number;
  /** 1 = lamp: adds a warm slush ring under snow */
  lamp?: boolean;
}

export interface Contact {
  mesh: THREE_NS.InstancedMesh;
  /** amount 0..1 (season-driven), snow 0..1 */
  set(amount: number, snow: number): void;
  dispose(): void;
}

export function createContact(THREE: THREE, spots: ContactSpot[]): Contact {
  const geo = new THREE.CircleGeometry(1, 24);
  geo.rotateX(-Math.PI / 2);
  const aK = new Float32Array(spots.length * 2);
  spots.forEach((s, i) => {
    aK[i * 2] = s.k;
    aK[i * 2 + 1] = s.lamp ? 1 : 0;
  });
  geo.setAttribute('aK', new THREE.InstancedBufferAttribute(aK, 2));
  const u = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uAmt: { value: 0.4 },
    uSnow: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    fog: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec2 aK;
      varying vec2 vL; varying vec2 vK; varying vec2 vW;
      void main(){
        vL = position.xz;
        vK = aK;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = wp.xz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      ${GLSL_NOISE}
      uniform float uAmt, uSnow;
      varying vec2 vL; varying vec2 vK; varying vec2 vW;
      void main(){
        float r = length(vL) + (vnoise(vW * 2.3) - 0.5) * 0.28;
        // tight dark core at the contact, long soft falloff (ambient occlusion, not a cast shadow)
        float occ = pow(1.0 - smoothstep(0.0, 1.0, r), 2.2);
        float a = occ * vK.x * uAmt;
        vec3 col = vec3(0.05, 0.06, 0.065);
        // lamp slush: a broken warm-grey ring where the snow has gone soft under the light
        float slush = vK.y * uSnow * (1.0 - smoothstep(0.35, 1.0, r)) * smoothstep(0.35, 0.65, vnoise(vW * 3.1 + 7.0));
        col = mix(col, vec3(0.42, 0.37, 0.31), clamp(slush * 1.4, 0.0, 1.0));
        a = max(a, slush * 0.34);
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  spots.forEach((c, i) => {
    p.set(c.x, LAND_Y + 0.035, c.z);
    s.set(c.rx, 1, c.rz);
    m4.compose(p, q, s);
    mesh.setMatrixAt(i, m4);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.renderOrder = 2;
  mesh.name = 'contact-darkening';
  return {
    mesh,
    set(amount, snow) {
      u.uAmt.value = amount;
      u.uSnow.value = snow;
      mesh.visible = amount > 0.005 || snow > 0.005;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
