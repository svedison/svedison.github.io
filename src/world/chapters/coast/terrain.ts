// Coastal bluffs (threejs-landscape): a heightfield whose resolution follows the lens. The camera tracks laterally
// along the bluff top, so instead of rings around one point the grid is laid out in coast coordinates (u along the
// shore, d inland) and graded: ~1.2 m cells where the lens actually looks (waterline, beach, bluff face, the track),
// growing ×1.06 per row/column toward the far hills. Same "dense near, sparse far" rule, bent to a lateral track.
// Ground is coloured by what it is doing (slope, height, wetness), never by a tiled texture.
import type * as THREE_NS from 'three';
import { fbm2, smoothstep } from '../../systems/noise';
import { heightAt, shoreV, wx, wz, beachWidth } from './geo';
import { applyHaze, type HazeUniforms } from './haze';

type THREE = typeof THREE_NS;

function graded(a: number, b: number, denseA: number, denseB: number, step: number, grow: number, maxStep: number) {
  const out: number[] = [];
  for (let x = denseA; x <= denseB + 1e-6; x += step) out.push(x);
  let s = step;
  let x = denseB;
  while (x < b) {
    s = Math.min(maxStep, s * grow);
    x += s;
    out.push(Math.min(x, b));
  }
  s = step;
  x = denseA;
  const head: number[] = [];
  while (x > a) {
    s = Math.min(maxStep, s * grow);
    x -= s;
    head.push(Math.max(x, a));
  }
  return head.reverse().concat(out);
}

export interface Terrain {
  mesh: THREE_NS.Mesh;
  dispose(): void;
}

export function createTerrain(THREE: THREE, haze: HazeUniforms, mobile: boolean): Terrain {
  const k = mobile ? 1.7 : 1;
  const us = graded(-2400, 4200, -260, 520, 2.2 * k, 1.055, 140);
  const ds = graded(-70, 5200, -14, 70, 1.15 * k, 1.06, 220);
  const nu = us.length;
  const nd = ds.length;
  const pos = new Float32Array(nu * nd * 3);
  const col = new Float32Array(nu * nd * 3);
  const hgt = new Float32Array(nu * nd);

  // palette (sRGB hex, converted to linear by Color)
  const wetSand = new THREE.Color('#8f7862');
  const sand = new THREE.Color('#d9bb94');
  const rock = new THREE.Color('#a77d58');
  const rockDark = new THREE.Color('#6f5040');
  const scrub = new THREE.Color('#5d6040');
  const dryGrass = new THREE.Color('#a78d62');
  const hills = new THREE.Color('#8d7a63');
  const c = new THREE.Color();
  const tmp = new THREE.Color();

  for (let i = 0; i < nu; i++) {
    const u = us[i];
    const sv = shoreV(u);
    for (let j = 0; j < nd; j++) {
      const d = ds[j];
      const v = sv - d;
      const h = heightAt(u, v);
      const idx = i * nd + j;
      pos[idx * 3] = wx(u, v);
      pos[idx * 3 + 1] = h;
      pos[idx * 3 + 2] = wz(u, v);
      hgt[idx] = h;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const index: number[] = [];
  for (let i = 0; i < nu - 1; i++) {
    for (let j = 0; j < nd - 1; j++) {
      const a = i * nd + j;
      const b = (i + 1) * nd + j;
      const c1 = (i + 1) * nd + j + 1;
      const d1 = i * nd + j + 1;
      index.push(a, b, c1, a, c1, d1);
    }
  }
  geo.setIndex(index);
  geo.computeVertexNormals();
  // winding check: the ground must face up (threejs-landscape: "watch the winding")
  const nrm = geo.getAttribute('normal') as THREE_NS.BufferAttribute;
  let up = 0;
  for (let i = 0; i < nrm.count; i += 97) up += nrm.getY(i);
  if (up < 0) {
    for (let i = 0; i < index.length; i += 3) {
      const t = index[i + 1];
      index[i + 1] = index[i + 2];
      index[i + 2] = t;
    }
    geo.setIndex(index);
    geo.computeVertexNormals();
  }

  for (let i = 0; i < nu; i++) {
    const u = us[i];
    const bw = beachWidth(u);
    for (let j = 0; j < nd; j++) {
      const d = ds[j];
      const idx = i * nd + j;
      const h = hgt[idx];
      const ny = nrm.getY(idx);
      const slope = 1 - ny;
      const n1 = fbm2(u * 0.05, d * 0.05, 3, 31);
      const n2 = fbm2(u * 0.011, d * 0.011, 3, 41);
      // beach: wet near the waterline, dry up toward the bluff toe
      c.copy(wetSand).lerp(sand, smoothstep(0.5, 6, d));
      // bluff face: sandstone, banded by height, darker in the gullies
      const faceW = smoothstep(0.32, 0.6, slope);
      tmp.copy(rock).lerp(rockDark, smoothstep(0.35, 0.75, n1) * 0.7 + 0.25 * Math.sin(h * 1.7) * 0.5);
      c.lerp(tmp, faceW * smoothstep(bw * 0.6, bw + 2, d) + smoothstep(bw + 1, bw + 6, d) * smoothstep(0.18, 0.3, slope));
      // plateau: coastal sage scrub in patches over dry grass
      const flatTop = smoothstep(bw + 4, bw + 14, d) * (1 - smoothstep(0.22, 0.4, slope));
      tmp.copy(dryGrass).lerp(scrub, smoothstep(0.38, 0.62, n2 + (n1 - 0.5) * 0.4));
      c.lerp(tmp, flatTop);
      // far hills
      c.lerp(hills, smoothstep(300, 1200, d) * 0.7);
      // under the sea: dark wet sand (only seen through wave troughs)
      if (d < 0) c.copy(wetSand).multiplyScalar(0.6);
      // fine mottling so no surface reads as clay: ice plant / bare soil / dry grass patches on the top
      const n3 = fbm2(u * 0.35, d * 0.35, 2, 51);
      if (flatTop > 0.01) {
        tmp.setRGB(0.32, 0.22, 0.14).lerp(scrub, smoothstep(0.35, 0.65, n3));
        c.lerp(tmp, flatTop * 0.45 * smoothstep(0.3, 0.7, fbm2(u * 0.09, d * 0.09, 2, 61)));
      }
      const lum = 0.78 + 0.24 * n1 + 0.16 * (n3 - 0.5);
      col[idx * 3] = c.r * lum;
      col[idx * 3 + 1] = c.g * lum;
      col[idx * 3 + 2] = c.b * lum;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  // Golden-hour sky fill. The sun sits low behind the sea, so everything the bluff-top camera sees (the plateau and
  // the beach, both facing up and away from the sun) gets almost no direct light, and the physical hemisphere term
  // alone left the beach a near-black slab. A bright apricot sky fills it, so sand reads as sand: warm and light,
  // never brighter than the sky.
  const fill = { value: new THREE.Color(0.86, 0.66, 0.5) };
  applyHaze(mat, haze, 'terrain', {
    extraUniforms: { uFill: fill },
    fragHead: 'uniform vec3 uFill;',
    extraFrag: 'gl_FragColor.rgb += diffuseColor.rgb * uFill * (0.55 + 0.45 * clamp(normal.y * 0.5 + 0.5, 0.0, 1.0));',
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'coast-terrain';
  return {
    mesh,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
