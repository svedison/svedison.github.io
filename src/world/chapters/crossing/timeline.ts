// The crossing's beat ledger as data: camera keys (desktop + mobile) and pure weights of chapter progress t.
// World convention: the paper boat sits at the origin and the SEA moves past it (waves.offZ), so travel never
// drifts the world away from float precision. East (sunrise, America) is -z, west (home) is +z.
//
// Beats (t = smoothed chapter progress):
//   0.00-0.10  close on the boat and its two companion lanterns, night, moon low over the western sea
//   0.10-0.40  crane up + pull back: "tiny boat, huge sea"; the grandparents' gold point on the western horizon
//   0.40-0.475 dive toward the water beside the boat; the seam is hidden in churned bubbles (post churn)
//   0.48-0.72  under the surface: god rays converge on the light above, the boat a silhouette overhead,
//              glyph-like brush marks drift past and resolve into Latin letters as the camera rises
//   0.735      resurface (second churn) at dawn, now facing east
//   0.76-1.00  sunrise ahead, crane up and back
import { smoothstep } from '../../systems/noise';

export interface CamKey {
  t: number;
  p: [number, number, number];
  q: [number, number, number]; // look target
  fov: number;
}

/**
 * Desktop / landscape keys. Copy sits in the left third, so the fleet lives right of centre. The opening frames sit
 * almost straight down-sea of the boat, so the moon (authored 10 deg right of the fleet, see authorDirections) and its
 * road stand clearly right of the fleet and the two companion lanterns read as their own gold points, not glitter.
 */
const RAW_DESKTOP: CamKey[] = [
  { t: 0.0, p: [-1.1, 2.6, -12.5], q: [-0.8, 0.9, 8], fov: 36 },
  { t: 0.1, p: [-1.8, 5.2, -21], q: [-1.3, 0.4, 14], fov: 37 },
  { t: 0.24, p: [-8, 17, -62], q: [-2, 0, 90], fov: 38 },
  { t: 0.33, p: [-16, 36, -116], q: [-12, 0, 160], fov: 38 },
  { t: 0.4, p: [-14, 33, -104], q: [-10, 0, 160], fov: 38 },
  { t: 0.45, p: [-6.5, 4.5, -22], q: [-1, -2, 8], fov: 40 },
  { t: 0.475, p: [-4.6, 0, -15], q: [-0.5, -2.2, 4], fov: 44 },
  { t: 0.5, p: [-4, -4.5, -15], q: [-1, -3, 8], fov: 50 },
  { t: 0.56, p: [-3, -11, -17], q: [0, -3.8, 12], fov: 52 },
  { t: 0.63, p: [9, -12, -2], q: [-14, -5, 0], fov: 52 },
  { t: 0.69, p: [3, -8.5, 15], q: [0, -3, -12], fov: 50 },
  { t: 0.715, p: [3, -3, 13.5], q: [0, 0.2, -12], fov: 46 },
  { t: 0.735, p: [3, 0, 13], q: [0, 1.4, -18], fov: 42 },
  { t: 0.765, p: [8.5, 2.9, 19.5], q: [-1.6, 1, -30], fov: 38 },
  { t: 0.87, p: [13, 8, 36], q: [-2, 0, -140], fov: 38 },
  { t: 1.0, p: [16, 19, 70], q: [-10, 0, -320], fov: 38 },
];

/** Portrait keys (aspect < 0.8): pull back + wider lens, fleet low-centre under the copy block (the wide beat
 * narrows the lens again so the fleet stays legible). */
const RAW_MOBILE: CamKey[] = [
  // (looking a little up: the horizon sits near centre so the moon clears the end of the body copy)
  { t: 0.0, p: [-3.2, 3.2, -15], q: [0.6, 3.3, 8], fov: 50 },
  { t: 0.1, p: [-4.2, 6.5, -26], q: [0.6, 6.4, 14], fov: 52 },
  // the wide beat on a phone: the copy fills the top third, so the horizon sits just under the screen centre with
  // the fleet a little left of centre and the moon above
  // and right of it in the clear band between copy and mirrors, and a lower, nearer lens with a longer focal
  // length keeps the three lanterns gold points rather than sub-pixel smudges
  { t: 0.24, p: [1.5, 5.5, -38], q: [1.5, 6.8, 80], fov: 44 },
  { t: 0.33, p: [2.5, 9, -70], q: [2.5, 12, 220], fov: 44 },
  { t: 0.4, p: [2.3, 8.4, -64], q: [2.3, 11.6, 220], fov: 44 },
  { t: 0.45, p: [-4, 4.5, -24], q: [-0.5, -2, 8], fov: 56 },
  { t: 0.475, p: [-3.2, 0, -16], q: [0, -2.4, 4], fov: 60 },
  { t: 0.5, p: [-3, -4.5, -16], q: [-0.5, -4, 8], fov: 64 },
  { t: 0.56, p: [-2, -12, -19], q: [0, -4, 12], fov: 66 },
  { t: 0.63, p: [8, -13, -2], q: [-14, -5, 0], fov: 66 },
  { t: 0.69, p: [2, -9, 17], q: [0, -3, -12], fov: 64 },
  { t: 0.715, p: [2, -3, 15], q: [0, 0.2, -12], fov: 60 },
  { t: 0.735, p: [2, 0, 14], q: [0, 1.4, -18], fov: 56 },
  { t: 0.765, p: [2.4, 3.1, 21.5], q: [-2.6, 0.6, -30], fov: 52 },
  { t: 0.87, p: [4.2, 4.4, 33], q: [-7.5, 3.2, -140], fov: 52 },
  { t: 1.0, p: [6, 6, 58], q: [-1, 5, -320], fov: 54 },
];

// Keys above are authored in a mirrored frame; flip x so that, looking west (+z), the fleet sits screen-right
// (screen-right is -x when facing +z) and, looking east (-z), screen-right is +x.
const mirror = (k: CamKey): CamKey => ({ t: k.t, p: [-k.p[0], k.p[1], k.p[2]], q: [-k.q[0], k.q[1], k.q[2]], fov: k.fov });
export const KEYS_DESKTOP: CamKey[] = RAW_DESKTOP.map(mirror);
export const KEYS_MOBILE: CamKey[] = RAW_MOBILE.map(mirror);

/** The two surface crossings, in t. The camera keys put y = 0 exactly here. */
export const DIVE_T = 0.475;
export const RISE_T = 0.735;

/**
 * Monotone cubic (Fritsch-Carlson) interpolation of one channel over keyed times. Monotone so the dive never
 * overshoots the surface and crosses it twice. No allocation.
 */
function channel(keys: CamKey[], get: (k: CamKey) => number, t: number): number {
  const n = keys.length;
  if (t <= keys[0].t) return get(keys[0]);
  if (t >= keys[n - 1].t) return get(keys[n - 1]);
  let i = 0;
  while (i < n - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[i];
  const k1 = keys[i + 1];
  const h = k1.t - k0.t;
  const y0 = get(k0);
  const y1 = get(k1);
  const d = (y1 - y0) / h;
  const slope = (a: number) => {
    if (a <= 0 || a >= n - 1) return d; // ends: use the segment slope (clamped below)
    const ka = keys[a - 1];
    const kb = keys[a];
    const kc = keys[a + 1];
    const d0 = (get(kb) - get(ka)) / (kb.t - ka.t);
    const d1 = (get(kc) - get(kb)) / (kc.t - kb.t);
    if (d0 * d1 <= 0) return 0;
    const w0 = 2 * (kc.t - kb.t) + (kb.t - ka.t);
    const w1 = (kc.t - kb.t) + 2 * (kb.t - ka.t);
    return (w0 + w1) / (w0 / d0 + w1 / d1);
  };
  let m0 = slope(i);
  let m1 = slope(i + 1);
  if (i === 0) m0 = d;
  if (i + 1 === n - 1) m1 = d;
  if (d === 0) {
    m0 = 0;
    m1 = 0;
  }
  const u = (t - k0.t) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * m1;
}

const GP = [(k: CamKey) => k.p[0], (k: CamKey) => k.p[1], (k: CamKey) => k.p[2]];
const GQ = [(k: CamKey) => k.q[0], (k: CamKey) => k.q[1], (k: CamKey) => k.q[2]];
const GF = (k: CamKey) => k.fov;

export interface CamSample {
  p: [number, number, number];
  q: [number, number, number];
  fov: number;
}

export function sampleCamera(keys: CamKey[], t: number, out: CamSample): CamSample {
  for (let c = 0; c < 3; c++) {
    out.p[c] = channel(keys, GP[c], t);
    out.q[c] = channel(keys, GQ[c], t);
  }
  out.fov = channel(keys, GF, t);
  return out;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 0 = night, 1 = dawn. Changes only while the camera is under water, so the swap is never seen. */
export const dawnWeight = (t: number) => smoothstep(0.55, 0.7, t);
/** Brightening of the dawn after resurfacing. */
export const sunriseWeight = (t: number) => smoothstep(0.735, 1.0, t);
/**
 * Bubble churn that hides the above/below seam; full at each crossing. Deliberately brief: the chapter section is
 * ~1.6 viewports tall, so +-0.012 of t is ~0.02 viewports of scroll above 0.5. The camera keys put y = 0 exactly at
 * DIVE_T and RISE_T, and the camY term only covers the last 0.4 m either side of the waterline.
 */
export function churn(t: number, camY: number): number {
  const a = 1 - smoothstep(0.002, 0.012, Math.abs(t - DIVE_T));
  const b = 1 - smoothstep(0.002, 0.012, Math.abs(t - RISE_T));
  const y = 1 - smoothstep(0.05, 0.4, Math.abs(camY));
  return clamp01(Math.max(Math.max(a, b), y));
}
/** The underwater beat (for the DOM line "The first year was hard..."): 1 strictly between the crossings. */
export const underWeight = (t: number) => smoothstep(DIVE_T, DIVE_T + 0.02, t) * (1 - smoothstep(RISE_T - 0.02, RISE_T, t));
/** Glyph field visibility and resolve (brush marks -> letters as the camera rises). */
export const glyphVisible = (t: number) => smoothstep(0.49, 0.54, t) * (1 - smoothstep(0.7, 0.73, t));
export const glyphResolve = (t: number) => smoothstep(0.6, 0.69, t);
/** Light source underwater swings from the refracted moon (west) to the refracted sun (east). */
export const underLightSwing = (t: number) => smoothstep(0.57, 0.68, t);
