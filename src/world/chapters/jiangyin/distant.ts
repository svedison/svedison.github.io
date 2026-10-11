// Distant silhouettes (3d-sky-background: low contrast, hue and value close to the horizon): the far north bank,
// the hills behind Jiangyin, and a long generic suspension bridge far downstream. Unlit, unfogged; each layer's
// colour is the live fog colour pulled a fixed fraction toward ink, so depth reads as aerial perspective and the
// layers always belong to whatever sky the visitor's hour produced.
import type * as THREE_NS from 'three';
import { fbm2 } from '../../systems/noise';
import { Bld, buildHip } from './builder';
import { BANK_X, NORTH_BANK_X, PAGODA_FAR, SUSP } from './layout';

type THREE = typeof THREE_NS;

export interface Distant {
  group: THREE_NS.Group;
  /** Recolour every layer from the current fog colour. No allocation. */
  tint(fog: THREE_NS.Color): void;
  /** How far the suspension bridge has resolved out of the haze (0 = barely there, 1 = clear silhouette). */
  setBridge(k: number): void;
  dispose(): void;
}

/** A vertical strip of hills facing direction `face` (+1: faces +x, -1: faces -x; 'z': faces +z). */
function ridge(bl: Bld, axis: 'x' | 'z', fixed: number, a0: number, a1: number, hMin: number, hMax: number, freq: number, seed: number, faceSign: number) {
  const N = 90;
  for (let i = 0; i < N; i++) {
    const s0 = a0 + ((a1 - a0) * i) / N, s1 = a0 + ((a1 - a0) * (i + 1)) / N;
    const h = (s: number) => hMin + (hMax - hMin) * Math.pow(fbm2(s * freq, seed, 4, seed), 1.6) * 1.6;
    const P = (s: number, y: number): [number, number, number] => (axis === 'x' ? [fixed, y, s] : [s, y, fixed]);
    const quad: [number, number, number][] = [P(s0, -4), P(s1, -4), P(s1, h(s1)), P(s0, h(s0))];
    // orient toward the viewer side
    if (faceSign > 0) bl.face(quad);
    else bl.face([quad[1], quad[0], quad[3], quad[2]]);
  }
}

export function createDistant(THREE: THREE): Distant {
  const group = new THREE.Group();
  group.name = 'distant';
  const ink = new THREE.Color('#1d2826');

  // far layer: north bank + the downstream horizon where the river bends away
  const far = new Bld();
  ridge(far, 'x', NORTH_BANK_X, -9000, 3000, 4, 26, 0.0021, 3, 1);
  ridge(far, 'z', -7800, -9000, 2600, 10, 70, 0.0016, 9, 1);
  // a low line of far-bank town blocks, broken, barely there
  for (let z = -2400; z > -6200; z -= 60) {
    const n = fbm2(z * 0.004, 2.0, 3, 5);
    if (n < 0.48) continue;
    const h = 8 + n * 26;
    far.face([
      [NORTH_BANK_X + 40, -2, z],
      [NORTH_BANK_X + 40, -2, z - 34],
      [NORTH_BANK_X + 40, h, z - 34],
      [NORTH_BANK_X + 40, h, z],
    ]);
  }

  // mid layer: hills behind the south bank town
  const mid = new Bld();
  ridge(mid, 'x', 900, -6000, 1200, 18, 95, 0.0032, 17, -1);
  ridge(mid, 'z', -2600, BANK_X + 80, 3000, 12, 60, 0.004, 23, 1);

  // bridge layer
  const br = new Bld();
  const { z: bz, x0, x1, towerA, towerB, towerH, deckY } = SUSP;
  // deck + its edge girder
  br.box((x0 + x1) / 2, deckY, bz, x1 - x0, 4.5, 30, 0, 1);
  // approach piers
  for (let x = x0 + 40; x < x1; x += 70) {
    if (x > towerA - 30 && x < towerB + 30) continue;
    br.box(x, deckY / 2, bz, 7, deckY, 10, 0, 1);
  }
  // towers: two legs + two cross beams, legs leaning in slightly
  for (const tx of [towerA, towerB]) {
    for (const s of [1, -1]) br.box(tx, towerH / 2, bz + s * 15, 9, towerH, 7, 0, 1);
    br.box(tx, towerH * 0.92, bz, 8, 7, 34, 0, 1);
    br.box(tx, deckY - 6, bz, 8, 6, 34, 0, 1);
  }
  // main cables (ribbons facing the camera, a little thicker than real so they survive 3 km of haze)
  const cable = (xa: number, ya: number, xb: number, yb: number, sag: number) => {
    const N = 36;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const y = (t: number) => ya + (yb - ya) * t - sag * 4 * t * (1 - t);
      const xa0 = xa + (xb - xa) * t0, xa1 = xa + (xb - xa) * t1;
      for (const zz of [bz + 15.5, bz - 15.5]) {
        br.face([
          [xa0, y(t0), zz],
          [xa1, y(t1), zz],
          [xa1, y(t1) + 2.6, zz],
          [xa0, y(t0) + 2.6, zz],
        ]);
      }
    }
    // suspenders, sparse
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      const xs = xa + (xb - xa) * t;
      const yc = ya + (yb - ya) * t - sag * 4 * t * (1 - t);
      if (yc - deckY < 4) continue;
      br.face([
        [xs - 0.8, deckY, bz + 15.5],
        [xs + 0.8, deckY, bz + 15.5],
        [xs + 0.8, yc, bz + 15.5],
        [xs - 0.8, yc, bz + 15.5],
      ]);
    }
  };
  cable(towerA, towerH - 2, towerB, towerH - 2, towerH - deckY - 10);
  cable(x0 + 120, deckY + 2, towerA, towerH - 2, 18);
  cable(towerB, towerH - 2, Math.min(x1 - 20, towerB + 160), deckY + 2, 10);

  // pagoda layer: a seven-storey octagonal pagoda on its wooded hill, read as one flat ink-wash value (SPEC ch.1
  // "a pagoda in mist"). Real proportions, scaled up a little so it survives a kilometre of haze at phone width.
  const pg = new Bld();
  {
    const { x: px, z: pz, hill, s: S } = PAGODA_FAR;
    pg.lathe(px, pz, -4, hill, (t) => 150 * Math.pow(1 - t, 0.75) + 9, 6, 16);
    let y = hill - 0.5;
    pg.prismN(px, pz, y, y + 1.6 * S, 6.6 * S, 6.2 * S, 8, Math.PI / 8, true, false, 1);
    y += 1.6 * S;
    for (let k = 0; k < 7; k++) {
      const R = (4.3 - k * 0.38) * S;
      const h = (k === 0 ? 5.4 : 3.7 - k * 0.12) * S;
      pg.prismN(px, pz, y, y + h, R, R * 0.98, 8, Math.PI / 8, false, false, 1);
      const y1 = y + h;
      const Rn = (4.3 - (k + 1) * 0.38) * S;
      buildHip({ cx: px, cz: pz, n: 8, rot: Math.PI / 8, yE: y1 - 0.15 * S, yT: y1 + 1.1 * S, RE: R + 1.7 * S, trunc: Rn * 0.98, lift: 0.6 * S, tip: 0.12, pow: 1.6, flare: 0.1 }, pg, 3, 3);
      y = y1 + 1.1 * S;
    }
    pg.lathe(px, pz, y, y + 7.5 * S, (t) => (0.55 * (1 - t) + 0.08 + 0.4 * Math.max(0, Math.sin(t * Math.PI * 5)) * (1 - t)) * S, 10, 8);
  }

  const layers: { mesh: THREE_NS.Mesh; mat: THREE_NS.MeshBasicMaterial; k: number }[] = [];
  const add = (bl: Bld, k: number, name: string) => {
    const g = bl.geo(THREE);
    if (!g) return;
    const mat = new THREE.MeshBasicMaterial({ color: '#888', fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = -10;
    group.add(mesh);
    layers.push({ mesh, mat, k });
  };
  add(far, 0.1, 'far-bank');
  add(mid, 0.2, 'south-hills');
  add(br, 0.2, 'suspension-bridge');
  add(pg, 0.24, 'pagoda');

  const bridge = layers.find((L) => L.mesh.name === 'suspension-bridge');
  return {
    group,
    tint(fog) {
      for (const L of layers) L.mat.color.copy(fog).lerp(ink, L.k);
    },
    setBridge(k) {
      if (bridge) bridge.k = 0.06 + 0.3 * Math.min(1, Math.max(0, k));
    },
    dispose() {
      for (const L of layers) {
        L.mesh.geometry.dispose();
        L.mat.dispose();
      }
      group.removeFromParent();
    },
  };
}
