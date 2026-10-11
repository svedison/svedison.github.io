// Next shore: the near beach (a heightfield behind a sinuous bay shoreline that tapers under the water toward the
// plane's far edges, so no cut edge ever shows),
// a scatter of slate pebbles, dune-grass tufts, and the far shore line (three hazy ridge strips at the horizon).
// All geometry is built once; nothing here allocates per frame.
import type * as THREE_NS from 'three';
import { fbm2, makeRng, smoothstep } from '../../systems/noise';

type THREE = typeof THREE_NS;

/** Extent of the land plane (world units; the cloche stands near the origin). */
const PLANE = { x0: -3.2, x1: 12.5, z0: -10, z1: 8.6 };

/** x of the shoreline at depth z: a shallow bay that sweeps away to the right in the distance, with a wander. */
function shoreX(z: number): number {
  const s = z + 0.3;
  return -0.42 - 0.3 * s + 0.045 * s * s + (fbm2(z * 0.42 + 7.3, 2.1, 3, 17) - 0.5) * 0.7 + 0.05 * Math.sin(z * 2.3);
}

/** Land height at (x, z). Water level is 0; the beach tops out near +0.24 inland. */
export function shoreHeight(x: number, z: number): number {
  const d = (x - shoreX(z)) * 0.95 + (fbm2(x * 0.9, z * 0.9, 2, 23) - 0.5) * 0.06; // > 0 inland
  const u = Math.max(0, d + 0.75);
  let h = 0.3 * (1 - Math.exp(-u * 0.34)) - 0.06;
  // taper under the water toward the far edges of the plane
  const edge =
    smoothstep(PLANE.z0, PLANE.z0 + 3.5, z) * smoothstep(PLANE.x1, PLANE.x1 - 2.5, x) * smoothstep(PLANE.z1, PLANE.z1 - 1.5, z);
  h = -0.08 + (h + 0.08) * edge;
  // wind-laid ripples and pebble bumps on the dry sand, fading out toward the waterline
  const dry = smoothstep(0.02, 0.2, h);
  h += (fbm2(x * 2.6, z * 2.6, 3, 5) - 0.5) * 0.035 * (0.4 + dry);
  h += Math.sin(x * 9.0 + z * 4.0 + fbm2(x, z, 2, 9) * 6.0) * 0.004 * dry;
  return h;
}

export interface ShoreOptions {
  mobile: boolean;
}

export interface Shore {
  group: THREE_NS.Group;
  grass: THREE_NS.InstancedMesh;
  /** Ridges at the horizon (separate group so they can sit outside fog). */
  far: THREE_NS.Group;
  dispose(): void;
}

export function createShore(THREE: THREE, opts: ShoreOptions): Shore {
  const group = new THREE.Group();
  group.name = 'next-shore';
  const disposables: { dispose(): void }[] = [];

  // ---- sand heightfield --------------------------------------------------------------------------------------
  const W = PLANE.x1 - PLANE.x0;
  const D = PLANE.z1 - PLANE.z0;
  const segX = opts.mobile ? 140 : 220;
  const segZ = opts.mobile ? 166 : 260;
  const sandGeo = new THREE.PlaneGeometry(W, D, segX, segZ);
  sandGeo.rotateX(-Math.PI / 2);
  sandGeo.translate((PLANE.x0 + PLANE.x1) / 2, 0, (PLANE.z0 + PLANE.z1) / 2);
  const pos = sandGeo.attributes.position as THREE_NS.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const wet = new THREE.Color('#8a7166');
  const damp = new THREE.Color('#c09f88');
  const dry = new THREE.Color('#e8cfb3');
  const pale = new THREE.Color('#f2e0c8');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = shoreHeight(x, z);
    pos.setY(i, h);
    // colour by height above the water: wet band → damp → dry sand, with a paler wind-blown crest
    c.copy(wet).lerp(damp, smoothstep(-0.005, 0.03, h));
    c.lerp(dry, smoothstep(0.03, 0.11, h));
    c.lerp(pale, smoothstep(0.16, 0.26, h) * 0.6);
    const speck = fbm2(x * 7.0, z * 7.0, 2, 21);
    c.multiplyScalar(0.92 + speck * 0.16);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  sandGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  sandGeo.computeVertexNormals();
  // fine grain: a tiny tiled value texture so the sand near the lens is not a smooth vertex-colour wash
  const grainCv = document.createElement('canvas');
  grainCv.width = grainCv.height = 128;
  {
    const g = grainCv.getContext('2d')!;
    const img = g.createImageData(128, 128);
    const gr = makeRng(41);
    for (let i = 0; i < 128 * 128; i++) {
      const v = 214 + gr() * 41 - (gr() > 0.94 ? 50 : 0);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v * 0.98;
      img.data[i * 4 + 2] = v * 0.95;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  const grain = new THREE.CanvasTexture(grainCv);
  grain.colorSpace = THREE.SRGBColorSpace;
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(W * 4.8, D * 4.8);
  grain.anisotropy = 4;
  disposables.push(grain);
  const sandMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, roughness: 0.94, metalness: 0 });
  // Pixel-exact waterline from world height (the vertex grid is too coarse for it): sand darkens and goes glossy
  // where the water has just been, and a thin pale lap line of spent wavelet sits right at the edge.
  sandMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWY;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWY;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float wetK = smoothstep(0.035, 0.0, vWY);
        diffuseColor.rgb *= mix(1.0, 0.86, wetK);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.6, smoothstep(0.015, 0.0, vWY));`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // wet sand holds a little of the dawn sky; a soft lap glow (not a line) at the very edge
        float wetE = smoothstep(0.03, 0.0, vWY);
        float lap = smoothstep(0.007, 0.0, vWY) * smoothstep(-0.004, 0.001, vWY);
        totalEmissiveRadiance += vec3(0.95, 0.76, 0.66) * (wetE * 0.16 + lap * 0.1);`,
      );
  };
  const sand = new THREE.Mesh(sandGeo, sandMat);
  sand.name = 'sand';
  group.add(sand);
  disposables.push(sandGeo, sandMat);

  // ---- pebbles (one instanced draw) --------------------------------------------------------------------------
  const rng = makeRng(77);
  const stoneGeo = new THREE.IcosahedronGeometry(1, 1);
  {
    // lumpy, flattened river stones
    const sp = stoneGeo.attributes.position as THREE_NS.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i);
      const y = sp.getY(i);
      const z = sp.getZ(i);
      const k = 0.86 + 0.28 * fbm2(x * 1.7 + 4, z * 1.7 + y * 1.3, 2, 3);
      sp.setXYZ(i, x * k, y * k * 0.55, z * k);
    }
    stoneGeo.computeVertexNormals();
  }
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#b3aaa6', roughness: 0.78, metalness: 0, flatShading: true });
  const stoneSpots: [number, number, number][] = [
    // x, z, size: clustered near the waterline, a few strays inland
    [-0.5, 0.42, 0.035],
    [-0.38, 0.55, 0.02],
    [0.42, -0.36, 0.03],
    [0.56, -0.28, 0.018],
    [1.3, -0.95, 0.05],
    [1.46, -0.84, 0.025],
    [2.2, -1.6, 0.04],
    [0.32, 0.6, 0.025],
    [2.8, -2.2, 0.07],
    [3.1, -2.05, 0.03],
    [0.9, 1.1, 0.03],
    [-0.62, 1.45, 0.028],
    [0.7, 0.25, 0.015],
    [-0.15, 2.2, 0.03],
  ];
  const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, stoneSpots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tint = new THREE.Color();
  stoneSpots.forEach(([x, z, r], i) => {
    e.set((rng() - 0.5) * 0.3, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
    q.setFromEuler(e);
    s.set(r * (1 + rng() * 0.5), r, r * (0.8 + rng() * 0.4));
    p.set(x, shoreHeight(x, z) + r * 0.18, z);
    m.compose(p, q, s);
    stones.setMatrixAt(i, m);
    tint.setHSL(0.05 + rng() * 0.06, 0.05 + rng() * 0.07, 0.42 + rng() * 0.26);
    stones.setColorAt(i, tint);
  });
  stones.instanceMatrix.needsUpdate = true;
  if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
  group.add(stones);
  disposables.push(stoneGeo, stoneMat);

  // ---- dune grass tufts (one instanced draw of a 7-blade tuft) ------------------------------------------------
  const bladePos: number[] = [];
  const bladeCol: number[] = [];
  const tr = makeRng(5);
  const base = new THREE.Color('#6d6a3e');
  const tip = new THREE.Color('#d9bf86');
  for (let b = 0; b < 7; b++) {
    const ang = (b / 7) * Math.PI * 2 + tr() * 0.6;
    const lean = 0.18 + tr() * 0.38;
    const hgt = 0.7 + tr() * 0.55;
    const w = 0.035;
    const ox = Math.cos(ang) * 0.04;
    const oz = Math.sin(ang) * 0.04;
    const tx = ox + Math.cos(ang) * lean;
    const tz = oz + Math.sin(ang) * lean;
    const px = -Math.sin(ang) * w;
    const pz = Math.cos(ang) * w;
    // two triangles: wide base → bent mid → tip
    const mx = ox + (tx - ox) * 0.35;
    const mz = oz + (tz - oz) * 0.35;
    const my = hgt * 0.6;
    bladePos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, mx + px * 0.6, my, mz + pz * 0.6);
    bladePos.push(ox - px, 0, oz - pz, mx + px * 0.6, my, mz + pz * 0.6, mx - px * 0.6, my, mz - pz * 0.6);
    bladePos.push(mx - px * 0.6, my, mz - pz * 0.6, mx + px * 0.6, my, mz + pz * 0.6, tx, hgt, tz);
    const mids = [0, 0, 0.6, 0, 0.6, 0.6, 0.6, 0.6, 1];
    for (let k = 0; k < 9; k++) {
      c.copy(base).lerp(tip, mids[k]);
      bladeCol.push(c.r, c.g, c.b);
    }
  }
  const tuftGeo = new THREE.BufferGeometry();
  tuftGeo.setAttribute('position', new THREE.Float32BufferAttribute(bladePos, 3));
  tuftGeo.setAttribute('color', new THREE.Float32BufferAttribute(bladeCol, 3));
  tuftGeo.computeVertexNormals();
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const tufts: [number, number, number][] = [];
  const gr = makeRng(19);
  for (let i = 0; i < 64 && tufts.length < 34; i++) {
    const x = 1.4 + gr() * 7.5;
    const z = -2.6 + gr() * 6.5;
    if (shoreHeight(x, z) < 0.17) continue;
    tufts.push([x, z, 0.16 + gr() * 0.2]);
  }
  const grass = new THREE.InstancedMesh(tuftGeo, grassMat, Math.max(1, tufts.length));
  tufts.forEach(([x, z, sc], i) => {
    e.set(0, gr() * Math.PI * 2, 0);
    q.setFromEuler(e);
    s.set(sc, sc * (0.8 + gr() * 0.5), sc);
    p.set(x, shoreHeight(x, z) - 0.01, z);
    m.compose(p, q, s);
    grass.setMatrixAt(i, m);
  });
  grass.count = tufts.length;
  grass.instanceMatrix.needsUpdate = true;
  group.add(grass);
  disposables.push(tuftGeo, grassMat);

  // ---- far shore line: three ridge strips, aerial-perspective coloured, no fog (they are the fog) -----------
  const far = new THREE.Group();
  far.name = 'far-shore';
  const haze = new THREE.Color('#f2c3a6');
  const ridge = (dist: number, height: number, color: string, seed: number, hump: number, humpX: number, order: number, feather: number) => {
    const N = 220;
    const span = dist * 4.2;
    const verts: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = (u - 0.5) * span;
      const n = fbm2(u * 9.0 + seed, seed * 0.37, 4, seed);
      const n2 = fbm2(u * 31.0 + seed * 2.0, 1.3, 2, seed + 1);
      let y = height * (0.25 + 0.75 * n) + height * 0.18 * n2;
      // a broad, low rise somewhere along the line (generic hills, not a landmark)
      const hx = (x - humpX) / (dist * 0.32);
      y += hump * Math.exp(-hx * hx);
      // foot, crest, and a feathered row above the crest: the top edge melts into the sky instead of cutting it
      verts.push(x, -height * 0.15, -dist, x, y, -dist, x, y + feather, -dist);
      if (i < N) {
        const a = i * 3;
        idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    // aerial perspective: each ridge's foot dissolves into the low haze lying on the water
    const top = new THREE.Color(color);
    const foot = top.clone().lerp(haze, 0.62);
    const cols: number[] = [];
    const crest = top.clone().lerp(haze, 0.2);
    for (let i = 0; i <= N; i++) cols.push(foot.r, foot.g, foot.b, 1, crest.r, crest.g, crest.b, 0.92, crest.r, crest.g, crest.b, 0);
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, fog: false, depthWrite: false });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    far.add(mesh);
    disposables.push(g, mat);
  };
  // farthest first: palest, closest to the horizon colour
  // the farthest coast is barely a shade darker than the haze; each nearer ridge gains a little body
  ridge(1250, 34, '#e8c2b4', 5, 54, -820, -903, 22);
  ridge(1100, 26, '#dcb2ad', 3, 30, -700, -902, 14);
  ridge(800, 18, '#c9a3aa', 7, 20, 300, -901, 8);
  ridge(560, 9, '#ae8f9f', 13, 7, -180, -900, 3);

  return {
    group,
    grass,
    far,
    dispose() {
      disposables.forEach((d) => d.dispose());
      group.removeFromParent();
      far.removeFromParent();
    },
  };
}
