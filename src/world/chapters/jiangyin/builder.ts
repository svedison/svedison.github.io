// Geometry vocabulary for the Jiangnan water town (threejs-towers): every part appends into shared
// position/normal/uv/index arrays, so a whole material's worth of buildings becomes ONE draw call.
// A builder carries a "frame" (origin + yaw) so each building is authored in its own local axes.
// UVs are in world metres (towers skill: BoxGeometry's 0..1 UVs make every part read as plastic).
import type * as THREE_NS from 'three';

type THREE = typeof THREE_NS;
type V3 = [number, number, number];
type UV = [number, number];

export class Bld {
  p: number[] = [];
  n: number[] = [];
  u: number[] = [];
  i: number[] = [];
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private c = 1;
  private s = 0;

  /** Local frame: origin + yaw (rotation about +y; local -z maps to (-sin yaw, 0, -cos yaw)). */
  frame(x: number, y: number, z: number, yaw: number) {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
    return this;
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) {
    const { c, s } = this;
    this.p.push(this.ox + x * c + z * s, this.oy + y, this.oz - x * s + z * c);
    this.n.push(nx * c + nz * s, ny, -nx * s + nz * c);
    this.u.push(u, v);
    return this.p.length / 3 - 1;
  }

  /** Quad (or degenerate tri when P[3]==P[2]) with a computed normal. Counter-clockwise = front. */
  face(P: V3[], uv?: UV[]) {
    const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], az = P[1][2] - P[0][2];
    const bx = P[2][0] - P[0][0], by = P[2][1] - P[0][1], bz = P[2][2] - P[0][2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    const q = uv ?? DEF_UV;
    const a = this.vert(P[0][0], P[0][1], P[0][2], nx, ny, nz, q[0][0], q[0][1]);
    const b = this.vert(P[1][0], P[1][1], P[1][2], nx, ny, nz, q[1][0], q[1][1]);
    const cc = this.vert(P[2][0], P[2][1], P[2][2], nx, ny, nz, q[2][0], q[2][1]);
    const d = this.vert(P[3][0], P[3][1], P[3][2], nx, ny, nz, q[3][0], q[3][1]);
    this.i.push(a, b, cc, a, cc, d);
  }

  tri(A: V3, B: V3, C: V3, uv?: [UV, UV, UV]) {
    const q = uv ?? [[0, 0], [1, 0], [1, 1]];
    this.face([A, B, C, C], [q[0], q[1], q[2], q[2]]);
  }

  /**
   * Box centred at (cx,cy,cz), size (sx,sy,sz), yaw ry, roll rz (about local z). World-metre UVs scaled by S:
   * side faces u = along the face, v = height (absolute y when unrolled, so wall grime sits at the base).
   */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0, S = 1, rz = 0, uOff = 0, skip = 0) {
    const co = Math.cos(ry), si = Math.sin(ry), cr = Math.cos(rz), sr = Math.sin(rz);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const V = (a: number, b: number, c: number): V3 => {
      const x = a * hx, y = b * hy, z = c * hz;
      const x2 = x * cr - y * sr, y2 = x * sr + y * cr;
      return [cx + x2 * co + z * si, cy + y2, cz - x2 * si + z * co];
    };
    const y0 = (cy - hy) * S, y1 = (cy + hy) * S;
    const side = (w: number): UV[] => [[uOff, y0], [uOff + w * S, y0], [uOff + w * S, y1], [uOff, y1]];
    const flat: UV[] = [[0, 0], [sx * S, 0], [sx * S, sz * S], [0, sz * S]];
    if (!(skip & 1)) this.face([V(1, -1, 1), V(1, -1, -1), V(1, 1, -1), V(1, 1, 1)], side(sz));
    if (!(skip & 2)) this.face([V(-1, -1, -1), V(-1, -1, 1), V(-1, 1, 1), V(-1, 1, -1)], side(sz));
    if (!(skip & 4)) this.face([V(-1, 1, 1), V(1, 1, 1), V(1, 1, -1), V(-1, 1, -1)], flat);
    if (!(skip & 8)) this.face([V(-1, -1, -1), V(1, -1, -1), V(1, -1, 1), V(-1, -1, 1)], flat);
    if (!(skip & 16)) this.face([V(-1, -1, 1), V(1, -1, 1), V(1, 1, 1), V(-1, 1, 1)], side(sx));
    if (!(skip & 32)) this.face([V(1, -1, -1), V(-1, -1, -1), V(-1, 1, -1), V(1, 1, -1)], side(sx));
  }

  /** n-gon prism (outward winding), optional caps. Corner k at angle k*2π/n + rot. */
  prismN(cx: number, cz: number, y0: number, y1: number, R0: number, R1: number, n: number, rot = 0, capTop = false, capBot = false, S = 1) {
    const pt = (k: number, R: number): [number, number] => {
      const a = (k * Math.PI * 2) / n + rot;
      return [cx + Math.cos(a) * R, cz + Math.sin(a) * R];
    };
    const side = 2 * R0 * Math.sin(Math.PI / n);
    for (let k = 0; k < n; k++) {
      const a = pt(k, R0), b = pt(k + 1, R0), c = pt(k + 1, R1), d = pt(k, R1);
      this.face(
        [[b[0], y0, b[1]], [a[0], y0, a[1]], [d[0], y1, d[1]], [c[0], y1, c[1]]],
        [[k * side * S, y0 * S], [(k + 1) * side * S, y0 * S], [(k + 1) * side * S, y1 * S], [k * side * S, y1 * S]],
      );
    }
    if (capTop)
      for (let k = 1; k < n - 1; k++) {
        const a = pt(0, R1), b = pt(k, R1), c = pt(k + 1, R1);
        this.tri([a[0], y1, a[1]], [c[0], y1, c[1]], [b[0], y1, b[1]]);
      }
    if (capBot)
      for (let k = 1; k < n - 1; k++) {
        const a = pt(0, R0), b = pt(k + 1, R0), c = pt(k, R0);
        this.tri([a[0], y0, a[1]], [c[0], y0, c[1]], [b[0], y0, b[1]]);
      }
  }

  /** Surface of revolution about (cx, cz): radius prof(t) for t 0..1 between heights y0..y1. */
  lathe(cx: number, cz: number, y0: number, y1: number, prof: (t: number) => number, steps: number, seg: number) {
    const rings: V3[][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, y = y0 + (y1 - y0) * t, r = prof(t), ring: V3[] = [];
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        ring.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]);
      }
      rings.push(ring);
    }
    for (let i = 0; i < steps; i++)
      for (let j = 0; j < seg; j++) {
        const j2 = (j + 1) % seg;
        this.face([rings[i][j2], rings[i][j], rings[i + 1][j], rings[i + 1][j2]]);
      }
  }

  geo(THREE: THREE): THREE_NS.BufferGeometry | null {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }

  get tris() {
    return this.i.length / 3;
  }
}

const DEF_UV: UV[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

// ---------------------------------------------------------------------------------------------------------
// Roofs: one function of position along the eave (towers skill). Jiangnan houses use a double-pitch gable
// roof: flat near the ridge, steepening, the eave corners lifting only gently. Six numbers shape it.
export interface GableRoof {
  /** Centre (local frame). Ridge runs along local x. */
  cx: number;
  cz: number;
  /** Half ridge length including gable overhang. */
  a: number;
  /** Horizontal ridge→eave distance (including overhang). */
  b: number;
  /** Eave and ridge heights. */
  yE: number;
  yT: number;
  /** Sag exponent (1 = straight; 1.3–1.6 = Jiangnan curve). */
  pow: number;
  /** Corner lift at the eave ends (metres). */
  lift: number;
  /** Plan flare at the corners (fraction). */
  flare: number;
  /** Extra eave beyond t=1 (fraction of b). */
  tip: number;
}

/** Point on a gable panel. side = ±1 (local +z / -z), u -1..1 along the ridge, t 0 (ridge) .. 1+tip (eave). */
export function gablePoint(o: GableRoof, side: number, u: number, t: number): V3 {
  // Math.pow(negative, k) is NaN: clamp t and add the overshoot back linearly (towers skill).
  const tc = Math.min(1, t), over = Math.max(0, t - 1);
  const g = 1 - Math.pow(1 - tc, o.pow);
  const corner = Math.pow(Math.abs(u), 6.0); // only the last stretch of the eave lifts
  const flare = 1 + o.flare * corner * Math.pow(tc, 3.2);
  const y = o.yT - (o.yT - o.yE) * g + o.lift * corner * Math.pow(tc, 2.6) - over * (o.yT - o.yE) * 0.55;
  return [o.cx + u * o.a * flare, y, o.cz + side * o.b * t];
}

/** Tile surface (top) into `tile`, soffit + fascia + barge edges into `under`. tileS = tile-texture repeats/m. */
export function buildGable(o: GableRoof, tile: Bld, under: Bld, NU = 10, NT = 6, TH = 0.12, tileS = 1) {
  for (const side of [1, -1]) {
    const top: V3[][] = [];
    const bot: V3[][] = [];
    const tmax = 1 + o.tip;
    for (let it = 0; it <= NT; it++) {
      const t = (it / NT) * tmax;
      const rowT: V3[] = [], rowB: V3[] = [];
      for (let iu = 0; iu <= NU; iu++) {
        const u = -1 + (2 * iu) / NU;
        const P = gablePoint(o, side, u, t);
        rowT.push(P);
        rowB.push([P[0], P[1] - TH, P[2]]);
      }
      top.push(rowT);
      bot.push(rowB);
    }
    const slope = Math.hypot(o.b, o.yT - o.yE) * tmax;
    for (let it = 0; it < NT; it++)
      for (let iu = 0; iu < NU; iu++) {
        const u0 = ((iu / NU) * 2 * o.a) * tileS, u1 = (((iu + 1) / NU) * 2 * o.a) * tileS;
        const v0 = (it / NT) * slope * tileS * 0.5, v1 = ((it + 1) / NT) * slope * tileS * 0.5;
        const q: UV[] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        // winding so the normal faces up/outward for both panels
        if (side > 0) {
          tile.face([top[it][iu], top[it + 1][iu], top[it + 1][iu + 1], top[it][iu + 1]], [q[0], q[3], q[2], q[1]]);
          under.face([bot[it][iu + 1], bot[it + 1][iu + 1], bot[it + 1][iu], bot[it][iu]]);
        } else {
          tile.face([top[it][iu + 1], top[it + 1][iu + 1], top[it + 1][iu], top[it][iu]], [q[1], q[2], q[3], q[0]]);
          under.face([bot[it][iu], bot[it + 1][iu], bot[it + 1][iu + 1], bot[it][iu + 1]]);
        }
      }
    // fascia along the eave (roof thickness), and barge edges at both gables
    for (let iu = 0; iu < NU; iu++) {
      const A = top[NT][iu], B = top[NT][iu + 1], C = bot[NT][iu + 1], D = bot[NT][iu];
      if (side > 0) under.face([D, C, B, A]);
      else under.face([A, B, C, D]);
    }
    for (let it = 0; it < NT; it++) {
      for (const e of [0, NU]) {
        const A = top[it][e], B = top[it + 1][e], C = bot[it + 1][e], D = bot[it][e];
        const flip = (e === 0) !== side > 0;
        if (flip) under.face([A, B, C, D]);
        else under.face([D, C, B, A]);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Pagoda hip roof (n-gon plan), the towers skill's roofPoint generalised from 4 to n sides with `trunc`.
export interface HipRoof {
  cx: number;
  cz: number;
  n: number;
  rot: number;
  yE: number;
  yT: number;
  RE: number;
  trunc: number;
  lift: number;
  tip: number;
  pow: number;
  flare: number;
}

function hipPoint(o: HipRoof, p: number, u: number, t: number): V3 {
  const tc = Math.min(1, t), over = Math.max(0, t - 1);
  const g = 1 - Math.pow(1 - tc, o.pow);
  const f = (u + 1) / 2;
  const ang = (k: number) => (k * Math.PI * 2) / o.n + o.rot;
  const oa = [Math.cos(ang(p + 1)), Math.sin(ang(p + 1))], ob = [Math.cos(ang(p)), Math.sin(ang(p))];
  const ox = oa[0] + (ob[0] - oa[0]) * f, oz = oa[1] + (ob[1] - oa[1]) * f;
  const ix = ox * o.trunc, iz = oz * o.trunc;
  const corner = Math.pow(Math.abs(u), 2.0);
  const flare = 1 + o.flare * corner * Math.pow(tc, 3.2);
  const RE = o.RE * flare;
  const y = o.yT - (o.yT - o.yE) * g + o.lift * corner * Math.pow(tc, 2.6) - over * (o.yT - o.yE) * 0.45;
  return [o.cx + ix + (ox * RE - ix) * t, y, o.cz + iz + (oz * RE - iz) * t];
}

export function buildHip(o: HipRoof, surf: Bld, NU = 6, NT = 5) {
  for (let p = 0; p < o.n; p++) {
    const rows: V3[][] = [];
    for (let it = 0; it <= NT; it++) {
      const t = (it / NT) * (1 + o.tip);
      const r: V3[] = [];
      for (let iu = 0; iu <= NU; iu++) r.push(hipPoint(o, p, -1 + (2 * iu) / NU, t));
      rows.push(r);
    }
    for (let it = 0; it < NT; it++)
      for (let iu = 0; iu < NU; iu++) {
        surf.face([rows[it][iu], rows[it][iu + 1], rows[it + 1][iu + 1], rows[it + 1][iu]]);
        surf.face([rows[it + 1][iu], rows[it + 1][iu + 1], rows[it][iu + 1], rows[it][iu]]);
      }
  }
}
