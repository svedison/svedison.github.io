// Koi under the canal surface: one instanced draw, flat fish lying just above the opaque water plane and blended
// toward it so they read as submerged. Tail wiggle is in the vertex shader; steering is a few lines of CPU per
// fish (12 fish, no allocation). gather(x, z) pulls them in under a resting pointer (the easter egg); fish too far
// away swim in from just outside the frame instead of crossing the whole river.
import type * as THREE_NS from 'three';
import { makeRng } from '../../systems/noise';

type THREE = typeof THREE_NS;

export interface Koi {
  mesh: THREE_NS.InstancedMesh;
  /** Pull the school under (x, z). */
  gather(x: number, z: number): void;
  release(): void;
  readonly gathering: boolean;
  update(dt: number, time: number, wiggle: boolean): void;
  dispose(): void;
}

const N = 12;
const HOME = { x0: 64, x1: 172, z0: -149.2, z1: -140.8 };

export function createKoi(THREE: THREE): Koi {
  const shape = new THREE.Shape();
  // head at +x, 0.56 m long
  shape.moveTo(0.28, 0);
  shape.bezierCurveTo(0.27, 0.05, 0.14, 0.075, 0.0, 0.07);
  shape.bezierCurveTo(-0.1, 0.06, -0.16, 0.03, -0.19, 0.018);
  shape.lineTo(-0.3, 0.075);
  shape.quadraticCurveTo(-0.27, 0, -0.3, -0.075);
  shape.lineTo(-0.19, -0.018);
  shape.bezierCurveTo(-0.16, -0.03, -0.1, -0.06, 0.0, -0.07);
  shape.bezierCurveTo(0.14, -0.075, 0.27, -0.05, 0.28, 0);
  const geo = new THREE.ShapeGeometry(shape, 6);
  geo.rotateX(-Math.PI / 2);
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aKoi', attr);

  const uTime = { value: 0 };
  const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.78, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uKoiTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aKoi;\nuniform float uKoiTime;\nvarying float vKA;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vKA = aKoi.z;
        float k = clamp((0.16 - transformed.x) / 0.46, 0.0, 1.0);
        transformed.z += sin(uKoiTime * 7.0 + aKoi.x - transformed.x * 9.0) * 0.07 * k * k * aKoi.y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vKA;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vKA;');
  };
  mat.customProgramCacheKey = () => 'jy-koi';

  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.name = 'koi';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const palette = ['#e0702f', '#eee6d6', '#d9a648', '#c9452f', '#f0ddc4', '#e58a3c'].map((c) => new THREE.Color(c));
  const rnd = makeRng(88);
  const fx = new Float32Array(N), fz = new Float32Array(N), hd = new Float32Array(N), sp = new Float32Array(N);
  const tx = new Float32Array(N), tz = new Float32Array(N), al = new Float32Array(N), sc = new Float32Array(N);
  const ph = new Float32Array(N);
  const tmpC = new THREE.Color();
  for (let i = 0; i < N; i++) {
    fx[i] = HOME.x0 + rnd() * (HOME.x1 - HOME.x0);
    fz[i] = HOME.z0 + rnd() * (HOME.z1 - HOME.z0);
    tx[i] = fx[i];
    tz[i] = fz[i];
    hd[i] = rnd() * Math.PI * 2;
    sp[i] = 0.3;
    al[i] = 1;
    sc[i] = 0.75 + rnd() * 0.5;
    ph[i] = rnd() * 100;
    tmpC.copy(palette[i % palette.length]).lerp(new THREE.Color('#5d6f66'), 0.18);
    mesh.setColorAt(i, tmpC);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let gx = 0, gz = 0, on = false;
  const inHome = (x: number, z: number) => x > HOME.x0 - 6 && x < HOME.x1 + 6 && z > HOME.z0 - 1 && z < HOME.z1 + 1;

  const pickWander = (i: number) => {
    // wander near where the fish is, inside the canal
    tx[i] = Math.min(HOME.x1, Math.max(HOME.x0, fx[i] + (rnd() - 0.5) * 18));
    tz[i] = HOME.z0 + rnd() * (HOME.z1 - HOME.z0);
  };

  return {
    mesh,
    get gathering() {
      return on;
    },
    gather(x, z) {
      gx = x;
      gz = z;
      if (!on) {
        on = true;
        for (let i = 0; i < N; i++) {
          const dx = fx[i] - x, dz = fz[i] - z;
          if (dx * dx + dz * dz > 22 * 22) {
            // enter from just beyond the pointer, already swimming toward it
            const a = rnd() * Math.PI * 2, r = 6 + rnd() * 4;
            fx[i] = x + Math.cos(a) * r;
            fz[i] = z + Math.sin(a) * r;
            hd[i] = a + Math.PI;
            al[i] = 0;
          }
        }
      }
    },
    release() {
      on = false;
    },
    update(dt, time, wiggle) {
      uTime.value = time;
      for (let i = 0; i < N; i++) {
        let goalX: number, goalZ: number, vmax: number;
        if (on) {
          const a = ph[i] + time * 0.35 * (i % 2 ? 1 : -1);
          const r = 0.35 + (i % 4) * 0.22;
          goalX = gx + Math.cos(a) * r;
          goalZ = gz + Math.sin(a) * r;
          vmax = 0.95;
        } else {
          if ((fx[i] - tx[i]) ** 2 + (fz[i] - tz[i]) ** 2 < 1) pickWander(i);
          goalX = tx[i];
          goalZ = tz[i];
          vmax = 0.42;
        }
        const dx = goalX - fx[i], dz = goalZ - fz[i];
        const dist = Math.hypot(dx, dz);
        const want = Math.atan2(dz, dx);
        let dh = want - hd[i];
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        const turn = 2.2 * dt;
        hd[i] += Math.max(-turn, Math.min(turn, dh));
        const vt = Math.min(vmax, 0.12 + dist * 0.6) * (0.55 + 0.45 * Math.cos(Math.min(Math.abs(dh), Math.PI / 2)));
        sp[i] += (vt - sp[i]) * Math.min(1, dt * 2);
        fx[i] += Math.cos(hd[i]) * sp[i] * dt;
        fz[i] += Math.sin(hd[i]) * sp[i] * dt;
        // visible in the canal or while gathering; fade out when strayed outside home without a reason
        const vis = on || inHome(fx[i], fz[i]) ? 1 : 0;
        al[i] += (vis - al[i]) * Math.min(1, dt * 1.2);
        if (!on && al[i] < 0.02 && !inHome(fx[i], fz[i])) {
          fx[i] = HOME.x0 + rnd() * (HOME.x1 - HOME.x0);
          fz[i] = HOME.z0 + rnd() * (HOME.z1 - HOME.z0);
          pickWander(i);
        }
        pos.set(fx[i], 0.014 + i * 0.0006, fz[i]);
        q.setFromAxisAngle(up, -hd[i]);
        scl.setScalar(sc[i]);
        m4.compose(pos, q, scl);
        mesh.setMatrixAt(i, m4);
        attr.setXYZ(i, ph[i], wiggle ? 0.4 + sp[i] * 1.4 : 0, al[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      attr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.dispose();
      mesh.removeFromParent();
    },
  };
}
