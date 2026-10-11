// Pointer petals (SPEC ch.1, build-interactive-particle-trail): the pointer's ripples lift a few plum petals off the
// water; they flutter up, drift with the wind, settle back onto the surface and ride the current until they fade.
// One recycled instanced pool (one draw call), spawned per ripple event (which the trail already emits by distance),
// capped per frame, CPU-integrated (a few dozen instances). The module skips it entirely under reduced motion.
import type * as THREE_NS from 'three';

type THREE = typeof THREE_NS;

export interface Petals {
  mesh: THREE_NS.InstancedMesh;
  /** Lift a petal (or two) at a world point on the water. */
  spawn(x: number, z: number, strength: number): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

export function createPetals(THREE: THREE, count: number, flow: [number, number]): Petals {
  // a petal: a slightly cupped teardrop, ~13 cm (a touch larger than life so it reads at glide distance)
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.065);
  shape.bezierCurveTo(0.05, -0.04, 0.055, 0.03, 0.012, 0.065);
  shape.lineTo(-0.012, 0.065);
  shape.bezierCurveTo(-0.055, 0.03, -0.05, -0.04, 0, -0.065);
  const geo = new THREE.ShapeGeometry(shape, 4);
  const pos = geo.attributes.position as THREE_NS.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, 4 * pos.getX(i) * pos.getX(i));
  geo.computeVertexNormals();
  // unlit (fogged): a petal is thin and translucent, so it reads pale against the water whichever way the sun is
  const mat = new THREE.MeshBasicMaterial({ color: '#e8cdc7', side: THREE.DoubleSide, transparent: true, opacity: 0.82, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'jy-petals';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.count = 0;

  const P = new Float32Array(count * 3); // position
  const V = new Float32Array(count * 3); // velocity
  const A = new Float32Array(count * 4); // age, life, seed, scale
  for (let i = 0; i < count; i++) A[i * 4 + 1] = -1;
  let head = 0, live = 0, spawnedThisFrame = 0;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  let rnd = 0x9e3779b9;
  const rand = () => {
    rnd ^= rnd << 13;
    rnd ^= rnd >>> 17;
    rnd ^= rnd << 5;
    return ((rnd >>> 0) % 10000) / 10000;
  };

  return {
    mesh,
    spawn(x, z, strength) {
      if (spawnedThisFrame >= 2) return;
      const n = rand() < 0.12 + strength * 0.3 ? 1 : 0;
      for (let k = 0; k < n; k++) {
        spawnedThisFrame++;
        const i = head;
        head = (head + 1) % count;
        const a = rand() * Math.PI * 2, r = 0.15 + rand() * 0.45;
        P.set([x + Math.cos(a) * r, 0.03, z + Math.sin(a) * r], i * 3);
        const up = 0.4 + rand() * 0.35 + strength * 0.25;
        V.set([Math.cos(a) * 0.35 + (rand() - 0.5) * 0.2, up, Math.sin(a) * 0.35 + (rand() - 0.5) * 0.2], i * 3);
        A.set([0, 5.5 + rand() * 2.5, rand() * 100, 0.8 + rand() * 0.45], i * 4);
      }
    },
    update(dt, time) {
      spawnedThisFrame = 0;
      const d = Math.min(dt, 1 / 30);
      live = 0;
      let hi = 0;
      for (let i = 0; i < count; i++) {
        const o = i * 4;
        if (A[o + 1] < 0) continue;
        A[o] += d;
        const age = A[o], life = A[o + 1], seed = A[o + 2];
        if (age >= life) {
          A[o + 1] = -1;
          mesh.setMatrixAt(i, ZERO);
          continue;
        }
        const j = i * 3;
        let x = P[j], y = P[j + 1], z = P[j + 2];
        let vx = V[j], vy = V[j + 1], vz = V[j + 2];
        const afloat = y <= 0.006 && vy <= 0;
        if (afloat) {
          // resting on the water: ride the current, a slow turn
          vx += (flow[0] - vx) * Math.min(1, d * 1.5);
          vz += (flow[1] - vz) * Math.min(1, d * 1.5);
          vy = 0;
          y = 0.006;
        } else {
          // airborne: a light thing in the wind, gravity fighting drag, a flutter sideways
          vy -= 1.1 * d;
          const drag = Math.min(1, d * 1.6);
          vx += (0.25 + 0.35 * Math.sin(time * 1.7 + seed) - vx) * drag;
          vz += (-0.1 + 0.3 * Math.cos(time * 1.3 + seed * 1.7) - vz) * drag;
          vy = Math.max(vy, -0.45);
        }
        x += vx * d;
        y = Math.max(0.006, y + vy * d);
        z += vz * d;
        P[j] = x;
        P[j + 1] = y;
        P[j + 2] = z;
        V[j] = vx;
        V[j + 1] = vy;
        V[j + 2] = vz;
        // tumble while airborne, lie flat (with a slow spin) once afloat
        const air = Math.min(1, y * 6);
        e.set(-Math.PI / 2 + air * Math.sin(age * 4.1 + seed) * 1.1, seed + age * (0.3 + air * 2.2), air * Math.cos(age * 3.3 + seed) * 0.9);
        q.setFromEuler(e);
        // fade in fast, out over the last 1.2 s (scale, since the material opacity is shared)
        const k = Math.min(1, age * 5) * Math.min(1, (life - age) / 1.2);
        s.setScalar(A[o + 3] * k);
        p.set(x, y, z);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        live++;
        hi = i + 1;
      }
      mesh.count = hi;
      mesh.visible = live > 0;
      if (live > 0 || hi > 0) mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.removeFromParent();
    },
  };
}
