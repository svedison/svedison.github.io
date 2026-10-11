// The Jiangnan water town, assembled from builder.ts parts (threejs-towers vocabulary) and merged by material:
// whitewashed walls, black-tile double-pitch roofs (gablePoint: flat at the ridge, steepening, corners lifting
// gently), stepped "horse-head" firewalls, timber fronts, stone quays, a hump-backed stone bridge over the canal,
// moored canopy boats, willows, and the grandparents' courtyard (the pagoda in the mist lives in distant.ts).
import type * as THREE_NS from 'three';
import { makeRng } from '../../systems/noise';
import { Bld, buildGable, gablePoint, type GableRoof } from './builder';
import type { TownMaterials } from './materials';
import {
  BANK_X,
  BRIDGE_X,
  CANAL_HALF,
  CANAL_Z,
  COURT_WALL_X,
  CROSS_X0,
  CROSS_X1,
  QUAY_Y,
  WINDOW,
} from './layout';

type THREE = typeof THREE_NS;
type Key = 'wall' | 'tile' | 'under' | 'timber' | 'stone' | 'hole' | 'foliage' | 'frond';
type B = Record<Key, Bld>;

const KEYS: Key[] = ['wall', 'tile', 'under', 'timber', 'stone', 'hole', 'foliage', 'frond'];

function frameAll(b: B, x: number, y: number, z: number, yaw: number) {
  for (const k of KEYS) b[k].frame(x, y, z, yaw);
}

interface HouseOpts {
  w: number;
  d: number;
  h: number;
  two: boolean;
  horse: boolean;
  lod: 0 | 1 | 2;
  door?: number;
  skirt?: boolean;
  /** Authored house (the grandparents'): no per-house variation, so its upper band stays on the lit window. */
  fixed?: boolean;
}

/** One house in its own frame: centre of footprint at the origin, front facing local +z, ridge along local x. */
/** Stable per-house variation in 0..1 from its position (kept off the layout RNG, so no house moves). */
function hv(x: number, z: number, k: number) {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function house(b: B, x: number, y: number, z: number, yaw: number, o: HouseOpts, rnd: () => number) {
  frameAll(b, x, y, z, yaw);
  const { w, d, h } = o;
  const V = (k: number, def: number) => (o.fixed ? def : hv(x, z, k));
  // a row of one module reads as a repeat: each house takes its own roof pitch, bay rhythm and upper band
  const rise = d * (0.28 + 0.12 * V(1, 0.5));
  const yT = h + rise;
  const roof: GableRoof = {
    cx: 0,
    cz: 0,
    a: o.horse ? w / 2 - 0.05 : w / 2 + 0.38,
    b: d / 2 + 0.78,
    yE: h - 0.28,
    yT,
    pow: 1.5,
    lift: o.horse ? 0.12 : 0.32,
    flare: 0.05,
    tip: 0.1,
  };
  b.wall.box(0, h / 2, 0, w, h, d, 0, 1);
  // gable ends follow the roof curve (a straight triangle would poke through a concave roof)
  if (!o.horse) {
    const uW = w / 2 / roof.a;
    const tw = d / 2 / roof.b;
    const N = o.lod ? 3 : 6;
    for (const s of [1, -1]) {
      for (const side of [1, -1]) {
        for (let i = 0; i < N; i++) {
          const t0 = (i / N) * tw, t1 = ((i + 1) / N) * tw;
          const y0 = gablePoint(roof, side, s * uW, t0)[1] - 0.1;
          const y1 = gablePoint(roof, side, s * uW, t1)[1] - 0.1;
          const z0 = side * t0 * roof.b, z1 = side * t1 * roof.b;
          const X = (s * w) / 2;
          const P: [number, number, number][] = [
            [X, h - 0.01, z0],
            [X, h - 0.01, z1],
            [X, y1, z1],
            [X, y0, z0],
          ];
          // outward winding: +x face wants z decreasing left→right as seen from +x
          if (s * side > 0) b.wall.face([P[1], P[0], P[3], P[2]]);
          else b.wall.face(P);
        }
      }
    }
  }
  buildGable(roof, b.tile, b.under, o.lod === 2 ? 4 : o.lod ? 6 : 10, o.lod === 2 ? 3 : o.lod ? 4 : 6, 0.13, 1);
  // ridge: a raised dark course with gently upturned ends
  const rl = roof.a * 2 + 0.1;
  const ridgeH = 0.2 + 0.16 * V(6, 0.375);
  b.under.box(0, yT + ridgeH / 2 - 0.03, 0, rl, ridgeH, 0.34, 0, 1);
  b.tile.box(0, yT + ridgeH - 0.01, 0, rl - 0.2, 0.08, 0.24, 0, 1);
  if (o.lod < 2)
    for (const s of [1, -1]) b.under.box((s * rl) / 2, yT + ridgeH + 0.04, 0, 0.5, 0.18, 0.3, 0, 1, s * 0.5);

  if (o.horse) {
    // stepped firewalls (马头墙): three tiers following the roof, each capped with a small tile coping
    for (const s of [1, -1]) {
      const X = (s * w) / 2;
      const tiers: [number, number, number][] = [
        [0.6, 1.04, h + 0.75],
        [0.24, 0.6, h + rise * 0.6 + 0.7],
        [0, 0.24, yT + 0.8],
      ];
      for (const [f0, f1, top] of tiers) {
        for (const side of f0 === 0 ? [0] : [1, -1]) {
          const za = f0 === 0 ? -f1 * (d / 2) : side * f0 * (d / 2);
          const zb = f0 === 0 ? f1 * (d / 2) : side * f1 * (d / 2);
          const zc = (za + zb) / 2, zl = Math.abs(zb - za);
          b.wall.box(X, (h - 0.2 + top) / 2, zc, 0.36, top - h + 0.2, zl, 0, 1);
          b.under.box(X, top + 0.05, zc, 0.62, 0.12, zl + 0.1, 0, 1);
          b.tile.box(X, top + 0.17, zc, 0.5, 0.12, zl + 0.16, 0, 1);
          if (side !== 0 && o.lod < 2) {
            const zo = side * (f1 * (d / 2) + 0.1);
            b.tile.box(X, top + 0.3, zo, 0.5, 0.16, 0.32, 0, 1);
          }
        }
      }
    }
  }

  if (o.lod === 2) {
    if (rnd() < 0.6) b.hole.box(0, h * 0.45, d / 2 + 0.02, Math.min(1.2, w * 0.2), 1.1, 0.04, 0, 1);
    return;
  }
  // ---- front: timber ground floor, optional upper lattice band and waist eave
  const zf = d / 2;
  const doors = o.door ?? (rnd() < 0.5 ? 1 : 2);
  const groundH = o.two ? 3.0 : h - 0.6;
  const fw = w * 0.86;
  b.timber.box(0, groundH / 2 + 0.05, zf + 0.04, fw, groundH - 0.1, 0.08, 0, 1);
  // the front is a row of bays (~1.1 m): dark posts, a waist rail and a head rail; door bays carry two panelled
  // leaves, the rest a lattice window over a plain panel (a shop-house front, not one brown slab)
  const bays = Math.max(3, Math.round(fw / (0.95 + 0.45 * V(2, 0.3333))));
  const bw = fw / bays;
  const doorBays = new Set<number>();
  const mid = Math.floor(bays / 2);
  if (doors === 1) doorBays.add(Math.min(bays - 1, Math.max(0, mid + Math.round((rnd() - 0.5) * 2))));
  else {
    doorBays.add(Math.max(0, mid - 1 - (bays > 5 ? 1 : 0)));
    doorBays.add(Math.min(bays - 1, mid + 1 + (bays > 5 ? 1 : 0)));
  }
  const zs = zf + 0.09;
  const headY = groundH - 0.32;
  b.under.box(0, headY, zs, fw, 0.09, 0.05, 0, 1);
  b.under.box(0, 0.98, zs, fw, 0.07, 0.04, 0, 1);
  for (let i = 0; i <= bays; i++) b.under.box(-fw / 2 + i * bw, groundH / 2 + 0.05, zs, 0.08, groundH - 0.1, 0.05, 0, 1);
  for (let i = 0; i < bays; i++) {
    const cx = -fw / 2 + (i + 0.5) * bw;
    if (doorBays.has(i)) {
      // door: a dark gap behind two slightly proud leaves, each with a raised panel
      const dh = Math.min(2.15, headY - 0.1);
      b.hole.box(cx, dh / 2 + 0.03, zs + 0.005, bw - 0.1, dh, 0.03, 0, 1);
      if (o.lod === 0)
        for (const s of [-1, 1]) {
          const lx = cx + s * (bw - 0.1) * 0.25;
          b.timber.box(lx, dh / 2 + 0.03, zs + 0.03, (bw - 0.16) * 0.48, dh - 0.06, 0.03, 0, 1);
          b.under.box(lx, dh * 0.68, zs + 0.05, (bw - 0.16) * 0.3, dh * 0.34, 0.01, 0, 1);
        }
    } else {
      // lattice window between the rails (paper dark at dusk; mullions in timber)
      const wy0 = 1.0 + 0.35 * V(3, 0.5143), wy1 = headY - 0.16;
      if (wy1 - wy0 < 0.4) continue;
      const wh = wy1 - wy0, ww = bw - 0.2, wy = (wy0 + wy1) / 2;
      b.hole.box(cx, wy, zs, ww, wh, 0.02, 0, 1);
      if (o.lod === 0) {
        for (let k = 1; k < 4; k++) b.timber.box(cx - ww / 2 + (k / 4) * ww, wy, zs + 0.025, 0.03, wh, 0.02, 0, 1);
        const rows = Math.max(2, Math.round(wh / 0.32));
        for (let k = 1; k < rows; k++) b.timber.box(cx, wy0 + (k / rows) * wh, zs + 0.025, ww, 0.03, 0.02, 0, 1);
      }
    }
  }
  if (o.two) {
    const yu = 3.0 + (h - 3.0) * (0.42 + 0.16 * V(4, 0.5));
    const bw = w * (0.56 + 0.3 * V(5, 0.5333));
    b.timber.box(0, yu, zf + 0.04, bw, 1.4, 0.1, 0, 1);
    const panes = Math.max(2, Math.round(bw / 1.05));
    for (let i = 0; i < panes; i++) {
      const px = -bw / 2 + ((i + 0.5) / panes) * bw;
      b.hole.box(px, yu + 0.02, zf + 0.1, (bw / panes) * 0.72, 1.05, 0.03, 0, 1);
    }
  }
  if (o.skirt ?? o.two) {
    // waist eave between the floors: a narrow lean-to of tile on dark brackets
    const ys = 3.25, out = 0.85;
    const L = w / 2 + 0.2;
    b.tile.face(
      [
        [-L, ys - 0.32, zf + out],
        [L, ys - 0.32, zf + out],
        [L, ys + 0.12, zf],
        [-L, ys + 0.12, zf],
      ],
      [
        [0, 0],
        [2 * L, 0],
        [2 * L, 0.9],
        [0, 0.9],
      ],
    );
    b.under.face([
      [-L, ys + 0.0, zf],
      [L, ys + 0.0, zf],
      [L, ys - 0.42, zf + out],
      [-L, ys - 0.42, zf + out],
    ]);
    b.under.box(0, ys - 0.38, zf + out, 2 * L, 0.1, 0.06, 0, 1);
  }
}

/** Low-poly lumpy blob (willow crown, shrubs, hill caps). */
function blob(bl: Bld, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, rnd: () => number, droop = 0) {
  const LAT = 5, LON = 8;
  const pts: [number, number, number][][] = [];
  for (let i = 0; i <= LAT; i++) {
    const v = i / LAT, th = v * Math.PI;
    const row: [number, number, number][] = [];
    for (let j = 0; j < LON; j++) {
      const ph = (j / LON) * Math.PI * 2;
      const k = i === 0 || i === LAT ? 1 : 0.82 + rnd() * 0.36;
      const y = Math.cos(th) * ry * k - droop * Math.pow(v, 2) * ry;
      row.push([cx + Math.sin(th) * Math.cos(ph) * rx * k, cy + y, cz + Math.sin(th) * Math.sin(ph) * rz * k]);
    }
    pts.push(row);
  }
  for (let i = 0; i < LAT; i++)
    for (let j = 0; j < LON; j++) {
      const j2 = (j + 1) % LON;
      bl.face([pts[i][j], pts[i][j2], pts[i + 1][j2], pts[i + 1][j]]);
    }
}

function willow(b: B, x: number, y: number, z: number, s: number, rnd: () => number) {
  b.timber.frame(0, 0, 0, 0);
  b.frond.frame(0, 0, 0, 0);
  const r = makeRng(1 + Math.floor(rnd() * 1e6));
  const lean = (r() - 0.5) * 0.3;
  // short gnarled trunk, then a few arching limbs (the willow silhouette is the limbs + the curtain)
  b.timber.box(x, y + 1.2 * s, z, 0.34 * s, 2.4 * s, 0.34 * s, r(), 1, lean);
  const topY = y + 2.3 * s;
  const cx0 = x - lean * 1.2;
  const limbs = 5;
  const tips: [number, number, number][] = [];
  for (let k = 0; k < limbs; k++) {
    const a = (k / limbs) * Math.PI * 2 + r() * 0.8;
    const reach = (1.3 + r() * 0.9) * s;
    const tx = cx0 + Math.cos(a) * reach, tz = z + Math.sin(a) * reach, ty = topY + (1.5 + r() * 0.9) * s;
    b.timber.box((cx0 + tx) / 2, (topY + ty) / 2, (z + tz) / 2, 0.12 * s, Math.hypot(reach, ty - topY), 0.12 * s, -a, 1, -Math.atan2(reach, ty - topY));
    tips.push([tx, ty, tz]);
  }
  // no solid crown: faceted blobs read as low-poly next to the strands. The crown is the densest part of the
  // curtain (more, shorter strands near the limbs), which keeps the willow soft in the mist.
  // the curtain: fronds that leave the crown, arch briefly outward, then fall plumb toward the water. Each frond is
  // an alpha-tested leaf card (frondTexture) that tapers to its tip, crossed with a second card at 90 degrees so it
  // keeps its body from any bearing; the leaf cut-outs give the soft, broken edge the flat ribbons lacked.
  const n = 150;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r());
    const tip = tips[i % limbs];
    const base = 0.35 + 0.65 * rr;
    const sx = cx0 + (tip[0] - cx0) * base * 0.6 + Math.cos(a) * 1.4 * s * rr;
    const sz = z + (tip[2] - z) * base * 0.6 + Math.sin(a) * 1.4 * s * rr;
    const dir = Math.atan2(sz - z, sx - cx0);
    const y0 = topY + (1.6 + 0.9 * (1 - rr * rr) + r() * 0.3) * s;
    const len = (2.2 + r() * 2.4) * s * (0.55 + 0.6 * rr);
    const out = (0.25 + 0.35 * rr) * s;
    const w = (0.07 + r() * 0.05) * s;
    const ox = Math.cos(dir) * out, oz = Math.sin(dir) * out;
    for (const cross of [0, 1]) {
      const wd = dir + (cross ? 0 : Math.PI / 2) + (r() - 0.5) * 0.5;
      const ux = Math.cos(wd) * w, uz = Math.sin(wd) * w;
      const P = (fo: number, fy: number, fw: number): [[number, number, number], [number, number, number]] => [
        [sx - ux * fw + ox * fo, y0 - len * fy, sz - uz * fw + oz * fo],
        [sx + ux * fw + ox * fo, y0 - len * fy, sz + uz * fw + oz * fo],
      ];
      // v runs limb (0) -> tip (1) along the whole frond, so the leaves taper continuously across the segments
      const V = [0, 0.22, 0.58, 1];
      const ps = [P(0, -0.04, 1), P(0.75, 0.18, 0.95), P(1, 0.55, 0.75), P(1.05, 1, 0.45)];
      for (let k = 0; k < 3; k++) {
        const a = ps[k], c = ps[k + 1];
        b.frond.face([c[0], c[1], a[1], a[0]], [[0, V[k + 1]], [1, V[k + 1]], [1, V[k]], [0, V[k]]]);
      }
    }
  }
}

/** Hump-backed stone bridge over the canal: semicircular arch, stepped deck, parapets. Local x runs across. */
function stoneBridge(b: B) {
  const st = b.stone;
  st.frame(BRIDGE_X, 0, CANAL_Z, Math.PI / 2); // local x -> world -z, local z -> world +x
  const L = 8.2, W = 1.7, r = 3.5, yc = -0.35, top = 4.05;
  const deck = (x: number) => QUAY_Y + (top - QUAY_Y) * Math.pow(Math.max(0, 1 - (x / L) ** 2), 0.75);
  const N = 28;
  // spandrel walls
  for (let i = 0; i < N; i++) {
    const x0 = -L + (2 * L * i) / N, x1 = -L + (2 * L * (i + 1)) / N;
    const bot = (x: number) => (Math.abs(x) < r ? yc + Math.sqrt(r * r - x * x) : -1.2);
    const P0: [number, number, number] = [x0, bot(x0), W], P1: [number, number, number] = [x1, bot(x1), W];
    const P2: [number, number, number] = [x1, deck(x1), W], P3: [number, number, number] = [x0, deck(x0), W];
    st.face([P0, P1, P2, P3]);
    st.face([
      [x1, bot(x1), -W],
      [x0, bot(x0), -W],
      [x0, deck(x0), -W],
      [x1, deck(x1), -W],
    ]);
    // parapets (outer, inner, top)
    const ph = 0.55, pt = 0.24;
    for (const s of [1, -1]) {
      const zo = s * W, zi = s * (W - pt);
      const a: [number, number, number] = [x0, deck(x0), zo], bb: [number, number, number] = [x1, deck(x1), zo];
      const c: [number, number, number] = [x1, deck(x1) + ph, zo], dd: [number, number, number] = [x0, deck(x0) + ph, zo];
      if (s > 0) st.face([a, bb, c, dd]);
      else st.face([bb, a, dd, c]);
      const ai: [number, number, number] = [x0, deck(x0), zi], bi: [number, number, number] = [x1, deck(x1), zi];
      const ci: [number, number, number] = [x1, deck(x1) + ph, zi], di: [number, number, number] = [x0, deck(x0) + ph, zi];
      if (s > 0) st.face([bi, ai, di, ci]);
      else st.face([ai, bi, ci, di]);
      st.face([dd, c, ci, di]);
      st.face([di, ci, c, dd]);
    }
  }
  // arch barrel (both windings: seen from the boat passing underneath and from outside)
  const AN = 16;
  for (let i = 0; i < AN; i++) {
    const a0 = (i / AN) * Math.PI, a1 = ((i + 1) / AN) * Math.PI;
    const p = (a: number, z: number): [number, number, number] => [Math.cos(a) * r, yc + Math.sin(a) * r, z];
    st.face([p(a0, -W), p(a1, -W), p(a1, W), p(a0, W)]);
    st.face([p(a0, W), p(a1, W), p(a1, -W), p(a0, -W)]);
  }
  // keystone ring: a slightly proud band around the arch on both faces
  for (let i = 0; i < AN; i++) {
    const a0 = (i / AN) * Math.PI, a1 = ((i + 1) / AN) * Math.PI;
    for (const s of [1, -1]) {
      const z = s * (W + 0.04);
      const q = (a: number, rr: number): [number, number, number] => [Math.cos(a) * rr, yc + Math.sin(a) * rr, z];
      if (s > 0) b.under.face([q(a1, r), q(a0, r), q(a0, r + 0.42), q(a1, r + 0.42)]);
      else b.under.face([q(a0, r), q(a1, r), q(a1, r + 0.42), q(a0, r + 0.42)]);
    }
  }
  // stepped deck: treads + risers
  const step = 0.17;
  for (const s of [1, -1]) {
    let xPrev = s * L;
    let yPrev = QUAY_Y;
    for (let y = QUAY_Y + step; y < top + 0.01; y += step) {
      // find x where deck(x) = y on this side
      let lo = 0, hi = L;
      for (let k = 0; k < 18; k++) {
        const m = (lo + hi) / 2;
        if (deck(m) > y) lo = m;
        else hi = m;
      }
      const xs = s * lo;
      // riser at xPrev from yPrev to y, tread from xPrev to xs at y
      if (s > 0) {
        st.face([
          [xPrev, yPrev, W - 0.2],
          [xPrev, yPrev, -W + 0.2],
          [xPrev, y, -W + 0.2],
          [xPrev, y, W - 0.2],
        ]);
        st.face([
          [xPrev, y, W - 0.2],
          [xPrev, y, -W + 0.2],
          [xs, y, -W + 0.2],
          [xs, y, W - 0.2],
        ]);
      } else {
        st.face([
          [xPrev, yPrev, -W + 0.2],
          [xPrev, yPrev, W - 0.2],
          [xPrev, y, W - 0.2],
          [xPrev, y, -W + 0.2],
        ]);
        st.face([
          [xPrev, y, -W + 0.2],
          [xPrev, y, W - 0.2],
          [xs, y, W - 0.2],
          [xs, y, -W + 0.2],
        ]);
      }
      xPrev = xs;
      yPrev = y;
    }
  }
}

/** A moored canopy boat (乌篷船): timber hull, black woven canopy. Local x = length. */
function canopyBoat(b: B, x: number, z: number, yaw: number) {
  b.timber.frame(x, 0, z, yaw);
  b.under.frame(x, 0, z, yaw);
  const L = 3.4, Wd = 0.75, Wb = 0.4;
  const hull = b.timber;
  const sec = [-L, -L * 0.6, 0, L * 0.6, L];
  const wid = [0.1, Wd * 0.85, Wd, Wd * 0.85, 0.1];
  const yd = [0.55, 0.4, 0.35, 0.4, 0.6];
  for (let i = 0; i < sec.length - 1; i++) {
    for (const s of [1, -1]) {
      const a: [number, number, number] = [sec[i], -0.12, s * wid[i] * (Wb / Wd)];
      const bb: [number, number, number] = [sec[i + 1], -0.12, s * wid[i + 1] * (Wb / Wd)];
      const c: [number, number, number] = [sec[i + 1], yd[i + 1], s * wid[i + 1]];
      const d: [number, number, number] = [sec[i], yd[i], s * wid[i]];
      if (s > 0) hull.face([a, bb, c, d]);
      else hull.face([bb, a, d, c]);
    }
    // deck
    hull.face([
      [sec[i], yd[i] - 0.05, wid[i]],
      [sec[i + 1], yd[i + 1] - 0.05, wid[i + 1]],
      [sec[i + 1], yd[i + 1] - 0.05, -wid[i + 1]],
      [sec[i], yd[i] - 0.05, -wid[i]],
    ]);
  }
  // canopy: half-barrel arches
  const AN = 7;
  for (const [x0, x1, rr] of [
    [-1.3, -0.15, 0.78],
    [-0.1, 1.25, 0.72],
  ]) {
    for (let i = 0; i < AN; i++) {
      const a0 = (i / AN) * Math.PI, a1 = ((i + 1) / AN) * Math.PI;
      const p = (xx: number, a: number): [number, number, number] => [xx, 0.35 + Math.sin(a) * rr * 0.8, Math.cos(a) * rr];
      b.under.face([p(x0, a0), p(x1, a0), p(x1, a1), p(x0, a1)]);
    }
  }
}

export interface Town {
  meshes: THREE_NS.Mesh[];
  window: THREE_NS.Mesh;
  tris: number;
  dispose(): void;
}

export function buildTown(THREE: THREE, M: TownMaterials, lod: 0 | 1): Town {
  const b: B = { wall: new Bld(), tile: new Bld(), under: new Bld(), timber: new Bld(), stone: new Bld(), hole: new Bld(), foliage: new Bld(), frond: new Bld() };
  const rnd = makeRng(2004);

  // ---------------------------------------------------------------- land + quays (stone faces, paved tops)
  frameAll(b, 0, 0, 0, 0);
  const land = (x0: number, x1: number, z0: number, z1: number) =>
    b.stone.box((x0 + x1) / 2, (QUAY_Y - 2) / 2, (z0 + z1) / 2, x1 - x0, QUAY_Y + 2, z1 - z0, 0, 1, 0, 0, 8);
  const zN = CANAL_Z - CANAL_HALF, zS = CANAL_Z + CANAL_HALF;
  land(BANK_X, CROSS_X0, zS, 260);
  land(BANK_X, CROSS_X0, -1400, zN);
  land(CROSS_X1, 700, -1400, 260);
  land(CROSS_X0, CROSS_X1, -1400, -262);
  land(CROSS_X0, CROSS_X1, -34, 260);

  // ---------------------------------------------------------------- canal houses
  const canalRow = (side: 1 | -1) => {
    let x = BANK_X + 9;
    const zFront = side < 0 ? zN - 1.4 : zS + 1.4;
    while (x < CROSS_X0 - 4) {
      const w = 5.4 + rnd() * 3.2;
      if (x + w > BRIDGE_X - 2.6 && x < BRIDGE_X + 2.6) {
        x = BRIDGE_X + 2.7;
        continue;
      }
      const d = 8 + rnd() * 2.5;
      const two = rnd() < (side < 0 ? 0.72 : 0.3);
      // roofline variety: some tall shop-houses, some low sheds, so the canal is not one repeated module
      const tall = two && rnd() < 0.22;
      const h = two ? (tall ? 7.6 + rnd() * 0.7 : 5.9 + rnd() * 1.1) : 3.7 + rnd() * 0.8;
      const cx = x + w / 2;
      const cz = zFront + (side < 0 ? -d / 2 : d / 2);
      house(b, cx, QUAY_Y, cz, side < 0 ? 0 : Math.PI, { w, d, h, two, horse: rnd() < 0.42, lod: lod ? 1 : 0 }, rnd);
      x += w + (rnd() < 0.25 ? 1.2 + rnd() * 1.5 : 0.05);
    }
  };
  canalRow(-1);
  canalRow(1);
  // stone steps down to the water at a few doors
  frameAll(b, 0, 0, 0, 0);
  for (const [sx, side] of [
    [72, -1],
    [113, -1],
    [133, 1],
    [158, -1],
    [104, 1],
  ] as const) {
    const zEdge = side < 0 ? zN : zS;
    // each tread is a solid block from the quay face out to its nosing, seated down into the water, so the flight
    // reads as cut into the bank rather than as slabs hovering off the wall
    for (let k = 0; k < 4; k++) {
      const top = QUAY_Y - 0.2 - k * 0.22, bot = -0.6;
      const inner = -0.15, outer = 0.42 + k * 0.32; // metres out from the quay face (into the canal)
      b.stone.box(sx, (top + bot) / 2, zEdge - side * ((inner + outer) / 2), 2.2, top - bot, outer - inner, 0, 1);
    }
  }
  // quay kerbs along the canal
  for (const ze of [zN, zS]) b.stone.box((BANK_X + CROSS_X0) / 2, QUAY_Y + 0.08, ze + (ze < CANAL_Z ? -0.2 : 0.2), CROSS_X0 - BANK_X, 0.16, 0.4, 0, 1);

  // ---------------------------------------------------------------- riverfront (faces the Yangtze, -x)
  const riverRow = (x0: number, zA: number, zB: number, l: 1 | 2, setback: number) => {
    let z = zA;
    while (z > zB) {
      const w = 6 + rnd() * 4;
      if (z > zN - 14 && z - w < zS + 14) {
        z = zN - 14;
        continue;
      }
      const d = 9 + rnd() * 3;
      const two = rnd() < 0.55;
      const h = two ? 6.3 + rnd() * 1 : 4 + rnd() * 0.6;
      house(b, x0 + setback + d / 2 + rnd() * 2, QUAY_Y, z - w / 2, -Math.PI / 2, { w, d, h, two, horse: rnd() < 0.45, lod: l }, rnd);
      z -= w + (rnd() < 0.3 ? 2 + rnd() * 5 : 0.1);
    }
  };
  riverRow(BANK_X, 150, -560, lod ? 2 : 1, 7);
  riverRow(BANK_X, 140, -520, 2, 21);
  if (!lod) riverRow(BANK_X, 120, -480, 2, 36);
  // back rows behind the canal houses (roofs over roofs)
  for (let x = 108; x < 172; x += 8 + rnd() * 3) {
    house(b, x, QUAY_Y, zN - 17 - rnd() * 3, 0, { w: 7 + rnd() * 2, d: 9, h: 6.6 + rnd(), two: true, horse: rnd() < 0.5, lod: 2 }, rnd);
    house(b, x + 3, QUAY_Y, zS + 17 + rnd() * 3, Math.PI, { w: 7 + rnd() * 2, d: 9, h: 6.6 + rnd(), two: true, horse: rnd() < 0.5, lod: 2 }, rnd);
  }

  // ---------------------------------------------------------------- willows along the river and the canal mouth
  for (let z = 120; z > -540; z -= 16 + rnd() * 22) {
    if (z < zS + 8 && z > zN - 8) continue;
    willow(b, BANK_X + 2.4 + rnd() * 1.5, QUAY_Y, z, 0.9 + rnd() * 0.4, rnd);
  }
  willow(b, BANK_X + 3.5, QUAY_Y, zS + 2.6, 1.15, rnd);
  willow(b, BANK_X + 5, QUAY_Y, zN - 2.8, 1.05, rnd);
  willow(b, CROSS_X0 - 2.2, QUAY_Y, zS + 2.4, 0.95, rnd);

  // ---------------------------------------------------------------- bridge + boats
  stoneBridge(b);
  canopyBoat(b, 84, zS - 1.1, 0.04);
  canopyBoat(b, 150, zN + 1.2, -0.03);

  // ---------------------------------------------------------------- the grandparents' courtyard
  // wall across the end of the canal with a tile coping and a moon gate; the two-storey house behind it.
  frameAll(b, COURT_WALL_X, QUAY_Y, CANAL_Z, -Math.PI / 2); // local +z -> world -x (faces the camera)
  const wallLen = 30, wallH = 3.1, wallT = 0.42;
  // moon gate: a real round opening (the courtyard and the house's dark ground floor seen through it), a stone
  // bore through the wall's thickness and a proud stone ring on both faces. Under the lit window, left of the copy.
  const G = { cx: -3.6, cy: 1.35, R: 1.1 };
  const S = G.R + 0.25;
  const hz = wallT / 2;
  b.wall.box((-wallLen / 2 + G.cx - S) / 2, wallH / 2, 0, G.cx - S + wallLen / 2, wallH, wallT, 0, 1);
  b.wall.box((wallLen / 2 + G.cx + S) / 2, wallH / 2, 0, wallLen / 2 - G.cx - S, wallH, wallT, 0, 1);
  b.wall.box(G.cx, (G.cy + S + wallH) / 2, 0, 2 * S, wallH - G.cy - S, wallT, 0, 1, 0, 0, 1 | 2);
  {
    const N = 24; // 15° steps, so the square's corners (45°, 135°…) land on segment boundaries
    const circ = (a: number, rr: number, z: number): [number, number, number] => [G.cx + Math.cos(a) * rr, G.cy + Math.sin(a) * rr, z];
    const sq = (a: number, z: number): [number, number, number] => {
      const c = Math.cos(a), s2 = Math.sin(a), k = S / Math.max(Math.abs(c), Math.abs(s2));
      return [G.cx + c * k, G.cy + s2 * k, z];
    };
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      // wall fill between the circle and the square, both faces
      b.wall.face([circ(a1, G.R, hz), circ(a0, G.R, hz), sq(a0, hz), sq(a1, hz)]);
      b.wall.face([circ(a0, G.R, -hz), circ(a1, G.R, -hz), sq(a1, -hz), sq(a0, -hz)]);
      // stone bore through the wall (faces inward)
      b.stone.face([circ(a0, G.R, hz), circ(a1, G.R, hz), circ(a1, G.R, -hz), circ(a0, G.R, -hz)]);
      // proud stone ring on both faces, with its outer lip
      for (const sd of [1, -1]) {
        const z = sd * (hz + 0.035);
        const q = [circ(a0, G.R, z), circ(a1, G.R, z), circ(a1, G.R + 0.2, z), circ(a0, G.R + 0.2, z)];
        if (sd > 0) b.stone.face([q[1], q[0], q[3], q[2]]);
        else b.stone.face(q);
        const o0 = circ(a0, G.R + 0.2, z), o1 = circ(a1, G.R + 0.2, z);
        const w0 = circ(a0, G.R + 0.2, sd * hz), w1 = circ(a1, G.R + 0.2, sd * hz);
        if (sd > 0) b.stone.face([o1, o0, w0, w1]);
        else b.stone.face([o0, o1, w1, w0]);
      }
    }
  }
  buildGable({ cx: 0, cz: 0, a: wallLen / 2 + 0.1, b: 0.62, yE: wallH - 0.05, yT: wallH + 0.42, pow: 1.4, lift: 0.18, flare: 0.04, tip: 0.1 }, b.tile, b.under, 12, 2, 0.08, 1);
  // the grandparents' house (front faces -x), its upper window is the one lit window in town
  const gd = 9, gw = 13;
  const gcx = WINDOW.x + 0.15 + gd / 2;
  const gcz = WINDOW.z + 1.6;
  house(b, gcx, QUAY_Y, gcz, -Math.PI / 2, { w: gw, d: gd, h: 6.9, two: true, horse: true, lod: 0, door: 1, skirt: true, fixed: true }, rnd);
  // neighbours behind the courtyard wall
  house(b, gcx + 1, QUAY_Y, gcz + gw / 2 + 4.6, -Math.PI / 2, { w: 7.5, d: 10, h: 6.4, two: true, horse: false, lod: 1 }, rnd);
  house(b, gcx + 2, QUAY_Y, gcz - gw / 2 - 5.2, -Math.PI / 2, { w: 8.5, d: 10, h: 4.6, two: false, horse: true, lod: 1 }, rnd);
  frameAll(b, 0, 0, 0, 0);
  willow(b, COURT_WALL_X + 3.2, QUAY_Y, CANAL_Z + 9.5, 1.2, rnd);

  // (the pagoda-in-mist is a far ink silhouette in distant.ts, PAGODA_FAR: a fogged town-scale pagoda here could
  // not be framed without a second, competing tower appearing once the river haze thins)

  const meshes: THREE_NS.Mesh[] = [];
  let tris = 0;
  for (const k of KEYS) {
    const g = b[k].geo(THREE);
    if (!g) continue;
    tris += b[k].tris;
    const m = new THREE.Mesh(g, M[k]);
    m.name = `town-${k}`;
    m.matrixAutoUpdate = false;
    meshes.push(m);
  }
  // the lit window (its own mesh: the keepsake's visual + the only emissive surface in town)
  const wg = new THREE.PlaneGeometry(WINDOW.w, WINDOW.h);
  const win = new THREE.Mesh(wg, M.window);
  win.position.set(WINDOW.x, WINDOW.y, WINDOW.z);
  win.rotation.y = -Math.PI / 2;
  win.name = 'grandparents-window';
  return {
    meshes,
    window: win,
    tris,
    dispose() {
      meshes.forEach((m) => m.geometry.dispose());
      wg.dispose();
    },
  };
}
