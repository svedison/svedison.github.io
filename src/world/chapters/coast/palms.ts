// Palms: tall Mexican fan palms (the Southern California silhouette) and a few shorter pinnate palms on the bluff
// edge. All palms are baked into world space and merged: one draw for trunks + skirts, one for leaves.
// Leaves are alpha-tested cards from a small canvas atlas, so the sky-ray pass sees real gaps between the leaf
// segments (3d-sky-rays: "match foliage alpha cutouts in the mask"). Back-lit leaves pass a little warm light.
import type * as THREE_NS from 'three';
import { makeRng } from '../../systems/noise';
import { applyHaze, type HazeUniforms } from './haze';

type THREE = typeof THREE_NS;

export interface PalmSpec {
  x: number;
  y: number;
  z: number;
  height: number;
  /** 'fan' = Washingtonia, 'feather' = pinnate. */
  kind: 'fan' | 'feather';
  leanX: number;
  leanZ: number;
  seed: number;
}

// ---- atlas: fan leaf (lower-left), feather frond (top half), solid fibre (lower-right)
function buildAtlas(): HTMLCanvasElement {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  const rng = makeRng(77);

  // feather frond: rachis along x at y = 128, leaflets swept forward and drooping
  g.lineCap = 'round';
  for (let x = 14; x < 500; x += 4.2) {
    const s = x / 512;
    const len = 112 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.75) + 6;
    for (const side of [-1, 1]) {
      const ang = (0.55 + rng() * 0.25) * side;
      const droop = 0.2 + rng() * 0.25;
      const ex = x + Math.cos(ang) * len * 0.55;
      const ey = 128 + Math.sin(ang) * len + side * droop * 18;
      const shade = 70 + rng() * 40;
      g.strokeStyle = `rgb(${shade + 20}, ${shade + 38}, ${shade - 10})`;
      g.lineWidth = 3.2 - s * 1.6;
      g.beginPath();
      g.moveTo(x, 128);
      g.quadraticCurveTo(x + (ex - x) * 0.4, 128 + (ey - 128) * 0.62, ex, ey);
      g.stroke();
    }
  }
  g.strokeStyle = 'rgb(120,112,70)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(4, 128);
  g.lineTo(508, 128);
  g.stroke();

  // fan leaf: hinge at (128, 500), radius 118, upper half-disc; solid folded blade inside, split segments outside
  const hx = 128;
  const hy = 500;
  const R = 118;
  for (let i = 0; i < 46; i++) {
    const a0 = Math.PI * (0.02 + (0.96 * i) / 46);
    const a1 = Math.PI * (0.02 + (0.96 * (i + 1)) / 46);
    const am = (a0 + a1) / 2;
    const rr = R * (0.86 + rng() * 0.14);
    const shade = 78 + rng() * 34;
    g.fillStyle = `rgb(${shade + 6}, ${shade + 30}, ${shade - 6})`;
    // inner blade wedge
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(hx + Math.cos(a0) * R * 0.62, hy - Math.sin(a0) * R * 0.62);
    g.lineTo(hx + Math.cos(a1) * R * 0.62, hy - Math.sin(a1) * R * 0.62);
    g.closePath();
    g.fill();
    // split segment: tapering, splayed, slightly drooping tip
    const w = (a1 - a0) * R * 0.5;
    const tx = hx + Math.cos(am) * rr;
    const ty = hy - Math.sin(am) * rr + 6 * rng();
    g.beginPath();
    g.moveTo(hx + Math.cos(am) * R * 0.6 - Math.sin(am) * w, hy - Math.sin(am) * R * 0.6 - Math.cos(am) * w);
    g.lineTo(tx, ty);
    g.lineTo(hx + Math.cos(am) * R * 0.6 + Math.sin(am) * w, hy - Math.sin(am) * R * 0.6 + Math.cos(am) * w);
    g.closePath();
    g.fill();
  }
  // solid fibre swatch for trunk / skirt (lower right)
  g.fillStyle = 'rgb(150,138,120)';
  g.fillRect(272, 272, 224, 224);
  for (let i = 0; i < 900; i++) {
    const s = 100 + rng() * 80;
    g.fillStyle = `rgba(${s},${s - 14},${s - 30},0.5)`;
    g.fillRect(272 + rng() * 224, 272 + rng() * 224, 1 + rng() * 2, 6 + rng() * 18);
  }
  return cv;
}

// atlas regions (uv, flipY = true: canvas top -> v = 1)
const FEATHER = { u0: 0, u1: 1, v0: 1 - 256 / 512, v1: 1 };
const FAN = { u0: 8 / 512, u1: 248 / 512, v0: (512 - 508) / 512, v1: (512 - 378) / 512 };
const FIBRE = { u: 384 / 512, v: (512 - 384) / 512 };

interface Buf {
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[];
}
const newBuf = (): Buf => ({ pos: [], nrm: [], uv: [], col: [] });

export interface Palms {
  trunks: THREE_NS.Mesh;
  leaves: THREE_NS.Mesh;
  dispose(): void;
}

export function createPalms(THREE: THREE, specs: PalmSpec[], haze: HazeUniforms, sunTrans: THREE_NS.IUniform): Palms {
  const trunk = newBuf();
  const leaf = newBuf();
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const tA = V();
  const tB = V();
  const tC = V();
  const n = V();

  function triTo(b: Buf, a: THREE_NS.Vector3, bb: THREE_NS.Vector3, c: THREE_NS.Vector3, ua: number[], ub: number[], uc: number[], col: number[], smoothN?: THREE_NS.Vector3[]) {
    tA.subVectors(bb, a);
    tB.subVectors(c, a);
    n.crossVectors(tA, tB).normalize();
    const pts = [a, bb, c];
    const uvs = [ua, ub, uc];
    for (let i = 0; i < 3; i++) {
      b.pos.push(pts[i].x, pts[i].y, pts[i].z);
      const nn = smoothN ? smoothN[i] : n;
      b.nrm.push(nn.x, nn.y, nn.z);
      b.uv.push(uvs[i][0], uvs[i][1]);
      b.col.push(col[0], col[1], col[2]);
    }
  }

  /** Fan blade card: hinge at `hinge`, opening along `out`, bottom edge along `side`, folded into a shallow V. */
  function fanCard(hinge: THREE_NS.Vector3, out: THREE_NS.Vector3, side: THREE_NS.Vector3, R: number, cc: number[], fold: number) {
    const w = V().crossVectors(out, side).normalize();
    const L0 = V().copy(hinge).addScaledVector(side, -R).addScaledVector(w, fold * R);
    const R0 = V().copy(hinge).addScaledVector(side, R).addScaledVector(w, fold * R);
    const L1 = V().copy(L0).addScaledVector(out, R * 1.08);
    const R1 = V().copy(R0).addScaledVector(out, R * 1.08);
    const M0 = hinge;
    const M1 = V().copy(hinge).addScaledVector(out, R * 1.08);
    const um = (FAN.u0 + FAN.u1) / 2;
    triTo(leaf, L0, M0, M1, [FAN.u0, FAN.v0], [um, FAN.v0], [um, FAN.v1], cc);
    triTo(leaf, L0, M1, L1, [FAN.u0, FAN.v0], [um, FAN.v1], [FAN.u0, FAN.v1], cc);
    triTo(leaf, M0, R0, R1, [um, FAN.v0], [FAN.u1, FAN.v0], [FAN.u1, FAN.v1], cc);
    triTo(leaf, M0, R1, M1, [um, FAN.v0], [FAN.u1, FAN.v1], [um, FAN.v1], cc);
  }

  for (const p of specs) {
    const rng = makeRng(p.seed);
    const H = p.height;
    const fan = p.kind === 'fan';
    const r0 = fan ? 0.34 : 0.3;
    const r1 = fan ? 0.2 : 0.26;
    const segs = 16;
    const rad = 7;
    const tint = 0.85 + rng() * 0.3;
    const trunkCol = fan ? [0.62 * tint, 0.56 * tint, 0.5 * tint] : [0.58 * tint, 0.52 * tint, 0.44 * tint];
    // centreline: gentle lean that grows with height, plus a slight S-curve
    const curve = (s: number, out: THREE_NS.Vector3) => {
      const bend = Math.pow(s, 1.5);
      const wig = Math.sin(s * Math.PI * 1.3 + p.seed) * 0.25 * s;
      return out.set(p.x + (p.leanX * bend + wig * p.leanZ * 0.4) * H, p.y + s * H, p.z + (p.leanZ * bend - wig * p.leanX * 0.4) * H);
    };
    const ring: THREE_NS.Vector3[][] = [];
    const ringN: THREE_NS.Vector3[][] = [];
    for (let i = 0; i <= segs; i++) {
      const s = i / segs;
      const c0 = curve(s, V());
      const r = (r0 + (r1 - r0) * s) * (1 + 0.7 * Math.exp(-s * 18)); // flared root
      const row: THREE_NS.Vector3[] = [];
      const rowN: THREE_NS.Vector3[] = [];
      for (let j = 0; j <= rad; j++) {
        const a = (j / rad) * Math.PI * 2;
        const nx = Math.cos(a);
        const nz = Math.sin(a);
        row.push(V(c0.x + nx * r, c0.y, c0.z + nz * r));
        rowN.push(V(nx, 0, nz));
      }
      ring.push(row);
      ringN.push(rowN);
    }
    const fu = [FIBRE.u, FIBRE.v];
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < rad; j++) {
        const a = ring[i][j], b = ring[i][j + 1], c = ring[i + 1][j + 1], d = ring[i + 1][j];
        const band = 0.92 + 0.08 * Math.sin(i * 2.7);
        const cc = [trunkCol[0] * band, trunkCol[1] * band, trunkCol[2] * band];
        triTo(trunk, a, c, b, fu, fu, fu, cc, [ringN[i][j], ringN[i + 1][j + 1], ringN[i][j + 1]]);
        triTo(trunk, a, d, c, fu, fu, fu, cc, [ringN[i][j], ringN[i + 1][j], ringN[i + 1][j + 1]]);
      }
    }
    const top = curve(1, V());
    // fan palms: a thin fibrous core plus a skirt of dead leaves folded down under the crown
    if (fan) {
      const skirtH = 1.4 + rng() * 1.4;
      const sk = 8;
      const skirtCol = [0.42, 0.34, 0.26];
      for (let j = 0; j < sk; j++) {
        const a0 = (j / sk) * Math.PI * 2;
        const a1 = ((j + 1) / sk) * Math.PI * 2;
        const yb = top.y - skirtH;
        const p0 = V(top.x + Math.cos(a0) * 0.42, top.y + 0.1, top.z + Math.sin(a0) * 0.42);
        const p1 = V(top.x + Math.cos(a1) * 0.42, top.y + 0.1, top.z + Math.sin(a1) * 0.42);
        const p2 = V(top.x + Math.cos(a1) * 0.3, yb, top.z + Math.sin(a1) * 0.3);
        const p3 = V(top.x + Math.cos(a0) * 0.3, yb, top.z + Math.sin(a0) * 0.3);
        triTo(trunk, p0, p2, p1, fu, fu, fu, skirtCol);
        triTo(trunk, p0, p3, p2, fu, fu, fu, skirtCol);
      }
      // dead fans hanging against the trunk: the same fan card, pointing down, dry brown
      const dead = 10 + Math.floor(rng() * 5);
      for (let k = 0; k < dead; k++) {
        const az = k * 2.39996 + rng();
        const outD = V(Math.cos(az) * 0.32, -1, Math.sin(az) * 0.32).normalize();
        const side = V(-Math.sin(az), 0, Math.cos(az));
        const hinge = V(top.x + Math.cos(az) * 0.35, top.y - rng() * skirtH * 0.5, top.z + Math.sin(az) * 0.35);
        const R = 0.6 + rng() * 0.35;
        const sh = 0.75 + rng() * 0.4;
        fanCard(hinge, outD, side, R, [0.55 * sh, 0.44 * sh, 0.3 * sh], 0.1);
      }
    }

    // crown
    const count = fan ? 32 : 16;
    const leafTint = fan ? [0.24, 0.26, 0.16] : [0.27, 0.31, 0.18];
    for (let k = 0; k < count; k++) {
      const az = k * 2.39996 + rng() * 0.4;
      const f = k / count; // 0 = youngest (upright) .. 1 = oldest (drooping)
      const elev = fan ? 1.2 - f * 2.0 + (rng() - 0.5) * 0.25 : 0.85 - f * 1.25 + (rng() - 0.5) * 0.2;
      const dir = V(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
      const side = V(-Math.sin(az), 0, Math.cos(az));
      const shade = 0.75 + rng() * 0.35;
      const cc = [leafTint[0] * shade, leafTint[1] * shade, leafTint[2] * shade];
      if (fan) {
        // petiole: a thin card along dir
        const pl = 1.3 + rng() * 0.8;
        const base = V().copy(top).addScaledVector(dir, 0.15);
        const tip = V().copy(top).addScaledVector(dir, pl);
        const pw = 0.05;
        const fu2 = [FIBRE.u, FIBRE.v];
        triTo(leaf, V().copy(base).addScaledVector(side, pw), V().copy(tip).addScaledVector(side, pw * 0.5), V().copy(tip).addScaledVector(side, -pw * 0.5), fu2, fu2, fu2, [0.33, 0.28, 0.2]);
        triTo(leaf, V().copy(base).addScaledVector(side, pw), V().copy(tip).addScaledVector(side, -pw * 0.5), V().copy(base).addScaledVector(side, -pw), fu2, fu2, fu2, [0.33, 0.28, 0.2]);
        // fan blade: hinge at the petiole tip, opening along dir and bent down by gravity
        const R = 1.15 + rng() * 0.5;
        const out = V().copy(dir);
        out.y -= 0.45;
        out.normalize();
        // roll each blade about its own axis so the crown is a ball of fans, not a stack of plates
        const roll = (rng() - 0.5) * 1.4;
        const sd = V().copy(side).applyAxisAngle(out, roll);
        fanCard(tip, out, sd, R, cc, 0.3);
      } else {
        // feather frond: arching rachis, V-folded card, 8 segments
        const L = 3.4 + rng() * 1.4;
        const W = 0.62;
        const segsF = 8;
        const droop = 1.2 + rng() * 0.5;
        let prevC: THREE_NS.Vector3 | null = null;
        let prevL: THREE_NS.Vector3 | null = null;
        let prevR: THREE_NS.Vector3 | null = null;
        let prevS = 0;
        const hd = V(Math.cos(az), 0, Math.sin(az));
        for (let i = 0; i <= segsF; i++) {
          const s = i / segsF;
          const th = elev - droop * Math.pow(s, 1.6);
          // integrate the arc
          const cpos = V().copy(top);
          const steps = 6;
          for (let q = 1; q <= steps; q++) {
            const sq = (s * q) / steps;
            const tq = elev - droop * Math.pow(sq, 1.6);
            cpos.addScaledVector(hd, (Math.cos(tq) * L * s) / steps);
            cpos.y += (Math.sin(tq) * L * s) / steps;
          }
          const ww = W * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05 + 0.04)), 0.7);
          const lift = 0.3 * ww;
          const l = V().copy(cpos).addScaledVector(side, -ww);
          l.y += lift - Math.cos(th) * 0.0;
          const r = V().copy(cpos).addScaledVector(side, ww);
          r.y += lift;
          if (prevC && prevL && prevR) {
            const ua = FEATHER.u0 + prevS * (FEATHER.u1 - FEATHER.u0);
            const ub = FEATHER.u0 + s * (FEATHER.u1 - FEATHER.u0);
            const vm = (FEATHER.v0 + FEATHER.v1) / 2;
            triTo(leaf, prevL, prevC, cpos, [ua, FEATHER.v0], [ua, vm], [ub, vm], cc);
            triTo(leaf, prevL, cpos, l, [ua, FEATHER.v0], [ub, vm], [ub, FEATHER.v0], cc);
            triTo(leaf, prevC, prevR, r, [ua, vm], [ua, FEATHER.v1], [ub, FEATHER.v1], cc);
            triTo(leaf, prevC, r, cpos, [ua, vm], [ub, FEATHER.v1], [ub, vm], cc);
          }
          prevC = cpos;
          prevL = l;
          prevR = r;
          prevS = s;
        }
      }
    }
  }

  const tex = new THREE.CanvasTexture(buildAtlas());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const mk = (b: Buf) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.computeBoundingSphere();
    return g;
  };
  const trunkGeo = mk(trunk);
  const leafGeo = mk(leaf);
  const trunkMat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.95 });
  // golden-hour sky fill: a backlit trunk reads as warm dark wood, never a pure black cut-out
  applyHaze(trunkMat, haze, 'palm-trunk', {
    // alpha = 1: the scene target's alpha is the ray pass's sky mask, and the fibre atlas texel's alpha (mip-blended
    // with transparent neighbours at distance) let shafts and glare paint over the trunk
    extraFrag: 'gl_FragColor.rgb += diffuseColor.rgb * vec3(0.34, 0.25, 0.18); gl_FragColor.a = 1.0;',
  });
  const leafMat = new THREE.MeshStandardMaterial({
    map: tex,
    vertexColors: true,
    roughness: 0.8,
    side: THREE.DoubleSide,
    alphaTest: 0.45,
    // soft cut edges where the HDR target has MSAA (high tier); a plain alpha test elsewhere
    alphaToCoverage: true,
  });
  // back-lit leaves: light passing through the blade toward the camera (sun behind the leaf)
  applyHaze(leafMat, haze, 'palm-leaf', {
    extraUniforms: { uSunTrans: sunTrans },
    fragHead: 'uniform vec3 uSunTrans;',
    extraFrag: `{
      vec3 vd = normalize(vHzWorld - cameraPosition);
      float back = pow(max(dot(vd, uSunDir), 0.0), 6.0);
      gl_FragColor.rgb += uSunTrans * back * diffuseColor.rgb * 1.4;
      // warm sky fill so the crown keeps some olive colour against the bright sky instead of going near-black
      gl_FragColor.rgb += diffuseColor.rgb * vec3(0.17, 0.13, 0.08);
      // the scene target's alpha is the ray pass's sky mask: a kept leaf fragment is fully opaque, so the fringe
      // never reads as half-sky (that leaked pale shafts / halos beside the crowns). Under alpha-to-coverage the
      // alpha is the coverage itself (a one-pixel fringe), so it stays.
#ifndef ALPHA_TO_COVERAGE
      gl_FragColor.a = 1.0;
#endif
    }`,
  });
  const trunks = new THREE.Mesh(trunkGeo, trunkMat);
  trunks.name = 'palm-trunks';
  const leaves = new THREE.Mesh(leafGeo, leafMat);
  leaves.name = 'palm-leaves';
  return {
    trunks,
    leaves,
    dispose() {
      trunkGeo.dispose();
      leafGeo.dispose();
      trunkMat.dispose();
      leafMat.dispose();
      tex.dispose();
    },
  };
}
