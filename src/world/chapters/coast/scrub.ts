// Coastal sage scrub on the bluff top: ragged, see-through clumps that give the foreground edge a soft silhouette
// and something to measure scale against (threejs-landscape: scatter from the same height function, sunk, not
// resting). Each clump is three crossed alpha-tested cards painted from a small canvas of leaf specks, so the
// silhouette breaks up like foliage instead of reading as a rock. One instanced draw.
import type * as THREE_NS from 'three';
import { makeRng, fbm2 } from '../../systems/noise';
import { heightAt, shoreV, wx, wz, bluffEdge } from './geo';
import { applyHaze, type HazeUniforms } from './haze';

type THREE = typeof THREE_NS;

function bushCanvas(): HTMLCanvasElement {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S * 2;
  cv.height = S;
  const g = cv.getContext('2d')!;
  const rng = makeRng(808);
  // a dome of small leaf specks, denser toward the core, ragged at the edge; a few dry twigs poke out
  g.strokeStyle = 'rgb(110,92,70)';
  for (let i = 0; i < 14; i++) {
    const a = 0.3 + rng() * 2.5;
    g.lineWidth = 0.8 + rng();
    g.beginPath();
    g.moveTo(64, 126);
    g.lineTo(64 + Math.cos(a) * (40 + rng() * 26), 126 - Math.sin(a) * (40 + rng() * 26));
    g.stroke();
  }
  for (let i = 0; i < 1500; i++) {
    const a = rng() * Math.PI;
    const r = Math.pow(rng(), 0.6) * 60;
    const x = 64 + Math.cos(a) * r * 1.05;
    const y = 126 - Math.sin(a) * r * 0.95;
    const s = 70 + rng() * 70;
    g.fillStyle = `rgb(${s + 10},${s + 22},${s - 18})`;
    g.beginPath();
    g.ellipse(x, y, 1.2 + rng() * 2.2, 0.8 + rng() * 1.4, rng() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // right half: the clump seen from above (a ragged round cushion), for the cap card. Without it the crossed
  // side cards read as a dark six-pointed star from the bluff-top camera.
  for (let i = 0; i < 1700; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 0.7) * 54 * (0.85 + 0.15 * Math.sin(a * 5 + 1.3));
    const x = 192 + Math.cos(a) * r;
    const y = 64 + Math.sin(a) * r;
    const s = 80 + rng() * 75 - r * 0.25;
    g.fillStyle = `rgb(${s + 10},${s + 22},${s - 18})`;
    g.beginPath();
    g.ellipse(x, y, 1.2 + rng() * 2.4, 0.8 + rng() * 1.5, rng() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return cv;
}

export function createScrub(THREE: THREE, haze: HazeUniforms, mobile: boolean) {
  // three crossed vertical cards (unit radius, height 1, base at y = 0)
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const P = [
      [-cx, 0, -cz, 0, 0],
      [cx, 0, cz, 0.5, 0],
      [cx, 1, cz, 0.5, 1],
      [-cx, 1, -cz, 0, 1],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(P[i][0], P[i][1], P[i][2]);
      uv.push(P[i][3], P[i][4]);
      nrm.push(0, 1, 0); // sky-facing normals: a clump shades as one mass, not as flat planes
    }
  }
  {
    // horizontal cap card a little above mid height
    const r = 0.92;
    const y = 0.5;
    const P = [
      [-r, y, -r, 0.5, 0],
      [r, y, -r, 1, 0],
      [r, y, r, 1, 1],
      [-r, y, r, 0.5, 1],
    ];
    for (const i of [0, 2, 1, 0, 3, 2]) {
      pos.push(P[i][0], P[i][1], P[i][2]);
      uv.push(P[i][3], P[i][4]);
      nrm.push(0, 1, 0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const tex = new THREE.CanvasTexture(bushCanvas());
  tex.colorSpace = THREE.SRGBColorSpace;
  const count = mobile ? 400 : 900;
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 });
  applyHaze(mat, haze, 'scrub');
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'coast-scrub';
  const rng = makeRng(4242);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const sage = new THREE.Color('#7f8a5c');
  const olive = new THREE.Color('#9c9566');
  const dry = new THREE.Color('#b9a07a');
  let n = 0;
  let guard = 0;
  while (n < count && guard++ < count * 20) {
    const u = -280 + rng() * 860;
    // most clumps crowd the bluff edge (the frame's foreground silhouette), the rest scatter inland
    // (the camera looks down onto the plateau, so only a thin scatter sits between it and the edge)
    const edge = rng() < 0.95;
    const d = bluffEdge(u) + (edge ? -1.5 + rng() * 5 : 8 + Math.pow(rng(), 1.5) * 18);
    const v = shoreV(u) - d;
    const h = heightAt(u, v);
    const slope = Math.abs(heightAt(u, v - 1.5) - h) / 1.5 + Math.abs(heightAt(u + 1.5, v) - h) / 1.5;
    if (slope > 0.9) continue;
    if (fbm2(u * 0.05, d * 0.05, 2, 3) < 0.32 + rng() * 0.1) continue;
    const r = 0.4 + rng() * rng() * 0.8;
    p.set(wx(u, v), h - 0.12 * r, wz(u, v));
    q.setFromAxisAngle(s.set(0, 1, 0), rng() * Math.PI * 2);
    s.set(r, r * (0.55 + rng() * 0.45), r);
    m.compose(p, q, s);
    mesh.setMatrixAt(n, m);
    c.copy(sage).lerp(olive, rng()).lerp(dry, rng() * rng());
    mesh.setColorAt(n, c);
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return {
    mesh,
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
      mesh.dispose();
    },
  };
}
