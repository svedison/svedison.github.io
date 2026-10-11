// Camera ledger for the Jiangyin set. Everything here is a pure function of g = chapter progress across the
// module (prologue 0..1, river 1..2): the boat's place on its water path, and the rig that films it.
// Camera grammar (SPEC §9): a forward glide. The boat leads; the camera follows it down the Yangtze, turns with it
// into the canal mouth, passes under the stone bridge, and settles before the grandparents' courtyard.
import type * as THREE_NS from 'three';
import { CANAL_Z } from './layout';

type THREE = typeof THREE_NS;

/** Monotone cubic (Fritsch–Carlson) through (xs, ys): no overshoot, so the boat never backs up. */
export function monotone(xs: number[], ys: number[]) {
  const n = xs.length;
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export interface Rig {
  back: number;
  side: number;
  height: number;
  ahead: number;
  lookSide: number;
  lookY: number;
  fov: number;
}

const RIG_KEYS: (keyof Rig)[] = ['back', 'side', 'height', 'ahead', 'lookSide', 'lookY', 'fov'];

/** Authored rig keyframes [g, rig] for desktop and mobile (portrait: pull back, lift, widen; never a crop). */
const DESKTOP: [number, Rig][] = [
  // prologue: a real crane. It opens low on the water beside the boat, then rises, pulls back, widens and drifts
  // toward the bank while yawing downstream, so the long bridge resolves out of the haze (the mid-prologue beat)
  // and the town's reflections open up across the water. The horizon is held low (~y 470) the whole time so the
  // hero seal column (top right) always sits on open sky, never on the rooftops.
  [0.0, { back: 4.4, side: -1.3, height: 0.7, ahead: 40, lookSide: -2.6, lookY: 1.3, fov: 34 }],
  [0.3, { back: 6.0, side: -0.8, height: 1.2, ahead: 43, lookSide: -3.5, lookY: 2.0, fov: 37 }],
  [0.62, { back: 8.5, side: 0.2, height: 1.8, ahead: 47, lookSide: -5.0, lookY: 3.0, fov: 41 }],
  [0.93, { back: 11, side: 1.2, height: 2.5, ahead: 50, lookSide: -6.0, lookY: 4.0, fov: 44 }],
  // the copy flips to the right column at the seam (the prologue copy has faded by now): the boat crosses
  // to the left third so the river headline never lands on it
  [1.0, { back: 9.0, side: 1.0, height: 1.9, ahead: 46, lookSide: 0.8, lookY: 1.4, fov: 42 }],
  [1.1, { back: 7.6, side: 0.3, height: 1.8, ahead: 36, lookSide: 1.0, lookY: 0.5, fov: 40 }],
  [1.32, { back: 6.4, side: 0.4, height: 1.5, ahead: 30, lookSide: -1.2, lookY: 0.6, fov: 42 }],
  // in the canal the rig pitches a little down: the boat rides in the lower-middle of the frame (clear of the
  // keepsake row), the vanishing point sits near the upper third and the roofs frame the top
  [1.55, { back: 6.0, side: 0.2, height: 1.6, ahead: 22, lookSide: 0.2, lookY: -0.6, fov: 46 }],
  [1.78, { back: 6.4, side: 0.2, height: 1.7, ahead: 22, lookSide: 0.2, lookY: -0.7, fov: 46 }],
  // the courtyard: Love is earned here (river t 0.8), so the rig comes down low and close behind the boat: the
  // boat and its lantern fill ~10% of the frame height in the lower left third, the lit window sits above it
  // (left of the copy column), and the rig only eases back into the mist at the very end
  [1.88, { back: 6.0, side: 0.2, height: 1.6, ahead: 26, lookSide: 0.5, lookY: -0.9, fov: 42 }],
  [1.96, { back: 6.2, side: 0.2, height: 1.65, ahead: 26, lookSide: 0.5, lookY: -0.8, fov: 41 }],
  [2.0, { back: 7.4, side: 0.3, height: 1.9, ahead: 30, lookSide: 0.8, lookY: -1.0, fov: 41 }],
];
// Portrait: the copy block owns the lower half of the screen (the river eyebrow sits at y ~450 of 844 now that
// the keepsake chips are one row), so the boat, the canal and every keepsake are authored into the band between
// the HUD (~70) and ~440: the boat rides at y ~280-340, the horizon / vanishing point sits at y ~130-240 (never
// under the HUD wash), and the courtyard window lands at y ~170-320 at the end.
const MOBILE: [number, Rig][] = [
  [0.0, { back: 4.6, side: 0, height: 0.62, ahead: 24, lookSide: 0.3, lookY: -5.4, fov: 54 }],
  [0.45, { back: 6.8, side: 0.6, height: 0.95, ahead: 26, lookSide: -0.8, lookY: -5.4, fov: 52 }],
  [0.93, { back: 9.5, side: 1.2, height: 1.35, ahead: 28, lookSide: -1.5, lookY: -5.3, fov: 50 }],
  // open river toward the canal mouth: held level (pitch ~14 deg, not ~29) so the horizon sits at y ~240 and the
  // bank's roofs stand at y ~130-240, clear of the HUD band, with the boat just above the copy at y ~320
  [1.0, { back: 9.5, side: 1.0, height: 1.3, ahead: 26, lookSide: 0.0, lookY: -6.6, fov: 56 }],
  // (pitched a little less here so the bank's roofs land whole below the HUD instead of being cut by it)
  [1.1, { back: 9.2, side: 0.4, height: 1.1, ahead: 24, lookSide: 0.3, lookY: -6.9, fov: 62 }],
  [1.22, { back: 9.4, side: 0.3, height: 1.1, ahead: 24, lookSide: -0.2, lookY: -6.8, fov: 63 }],
  // entering the mouth: the walls rise on both sides, so the rig tips down toward the canal grammar below
  [1.36, { back: 9.0, side: 0.2, height: 1.3, ahead: 24, lookSide: -0.3, lookY: -8.2, fov: 66 }],
  [1.55, { back: 7.0, side: 0.1, height: 1.5, ahead: 22, lookSide: -0.6, lookY: -9.6, fov: 66 }],
  [1.64, { back: 7.2, side: 0.1, height: 1.55, ahead: 22, lookSide: -1.6, lookY: -9.3, fov: 66 }],
  // a slow look toward the north quay so the umbrella under the eaves stays in the top band while its hotspot is
  // open (it sits ~5.5 m off the camera line; a narrow portrait frustum loses it otherwise)
  [1.71, { back: 7.6, side: 0.5, height: 1.6, ahead: 22, lookSide: -3.2, lookY: -9.2, fov: 66 }],
  [1.78, { back: 7.6, side: 0.1, height: 1.6, ahead: 22, lookSide: 0.4, lookY: -9.0, fov: 66 }],
  // the courtyard (Love is earned at river t 0.8): low and close behind the boat, near the water, so the boat and
  // its lantern ride at y ~380-420 just above the copy and the lit window is framed above it in the top band
  [1.88, { back: 5.4, side: 0.0, height: 1.0, ahead: 26, lookSide: -0.8, lookY: -5.0, fov: 62 }],
  [1.96, { back: 4.8, side: 0.0, height: 0.92, ahead: 26, lookSide: -0.8, lookY: -5.1, fov: 62 }],
  [2.0, { back: 5.4, side: 0.1, height: 1.0, ahead: 28, lookSide: -0.6, lookY: -5.4, fov: 62 }],
];

function rigInterp(keys: [number, Rig][]) {
  const xs = keys.map((k) => k[0]);
  const fns = RIG_KEYS.map((k) => monotoneSmooth(xs, keys.map((r) => r[1][k])));
  return (g: number, out: Rig) => {
    for (let i = 0; i < RIG_KEYS.length; i++) out[RIG_KEYS[i]] = fns[i](g);
    return out;
  };
}

/** Smoothstep between keys (zero slope at each key: the rig settles into each composition). */
function monotoneSmooth(xs: number[], ys: number[]) {
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    const n = xs.length;
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
    const s = t * t * (3 - 2 * t);
    return ys[i] + (ys[i + 1] - ys[i]) * s;
  };
}

export interface BoatPath {
  curve: THREE_NS.CatmullRomCurve3;
  /** Point + unit tangent at arc fraction u, from a precomputed table (no allocation per frame). */
  sample(u: number, outP: THREE_NS.Vector3, outT: THREE_NS.Vector3): void;
  /** g (0..2) -> arc-length fraction u along the curve. */
  u(g: number): number;
  rig(g: number, mobile: boolean, out: Rig): Rig;
}

export function createBoatPath(THREE: THREE): BoatPath {
  const P = (x: number, z: number) => new THREE.Vector3(x, 0, z);
  const pts = [
    P(6, 34),
    P(6, 6),
    P(10, -56),
    P(24, -110),
    P(48, -139),
    P(70, CANAL_Z - 0.3),
    P(95, CANAL_Z),
    P(125, CANAL_Z + 0.4),
    P(150, CANAL_Z),
    P(166, CANAL_Z - 0.2),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  curve.arcLengthDivisions = 600;
  // arc fraction of a world point (closest sample)
  const tmp = new THREE.Vector3();
  const uOf = (x: number, z: number) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i <= 1000; i++) {
      curve.getPointAt(i / 1000, tmp);
      const d = (tmp.x - x) ** 2 + (tmp.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i / 1000;
      }
    }
    return best;
  };
  const uPro = uOf(6, 6);
  const uRiver = uOf(12, -66);
  const uMouth = uOf(56, -143);
  const uBridge = uOf(95, CANAL_Z);
  const uBoat = uOf(112, CANAL_Z);
  const uUmb = uOf(134, CANAL_Z);
  // g keys: dwell on the river, ease into the canal, slow by each keepsake, settle before the courtyard
  const g2u = monotone(
    [0, 1, 1.12, 1.33, 1.47, 1.62, 1.76, 1.88, 1.97, 2],
    [0, uPro, uRiver, uMouth, uBridge, uBoat, uUmb, 0.986, 0.995, 1],
  );
  const dk = rigInterp(DESKTOP), mk = rigInterp(MOBILE);
  const NS = 2048;
  const tab = new Float32Array((NS + 1) * 6);
  const tp = new THREE.Vector3(), tt = new THREE.Vector3();
  for (let i = 0; i <= NS; i++) {
    curve.getPointAt(i / NS, tp);
    curve.getTangentAt(Math.min(1, i / NS), tt);
    tab.set([tp.x, tp.y, tp.z, tt.x, tt.y, tt.z], i * 6);
  }
  return {
    curve,
    sample(u, outP, outT) {
      const f = Math.min(1, Math.max(0, u)) * NS;
      const i = Math.min(NS - 1, Math.floor(f)), k = f - i, a = i * 6, b = a + 6;
      outP.set(tab[a] + (tab[b] - tab[a]) * k, tab[a + 1] + (tab[b + 1] - tab[a + 1]) * k, tab[a + 2] + (tab[b + 2] - tab[a + 2]) * k);
      outT.set(tab[a + 3] + (tab[b + 3] - tab[a + 3]) * k, tab[a + 4] + (tab[b + 4] - tab[a + 4]) * k, tab[a + 5] + (tab[b + 5] - tab[a + 5]) * k).normalize();
    },
    u: (g) => Math.min(1, Math.max(0, g2u(g))),
    rig: (g, mobile, out) => (mobile ? mk(g, out) : dk(g, out)),
  };
}
