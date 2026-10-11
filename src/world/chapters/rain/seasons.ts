// One shared 4-weight season state [spring, summer, fall, winter] (3d-four-seasons), resolved as a pure function of
// chapter progress, plus every authored per-season value it drives (sky, light, ground, particles).
// Resolve from authored base values + weights each frame; never tint last frame's colour (no drift).
import type * as THREE_NS from 'three';

export type Weights = [number, number, number, number];

/**
 * Beat ledger for the Seattle chapter (local t). Each season gets a readable dwell (about 0.08-0.10 of the chapter,
 * ~0.2-0.25 viewports at scrollWeight 2.4) before winter takes the long forgive hold:
 *   0.00-0.20  Lake Washington in spring rain, the convoy of lanterns sails in (chapter copy pinned)
 *   0.20-0.30  arrival: the quad in blossom
 *   0.30-0.35  -> summer   (hold to 0.43)
 *   0.43-0.48  -> fall     (hold to 0.56)
 *   0.56-0.63  -> winter   (hold through the forgive ritual card, which parks ~0.68-0.82)
 *   0.90-1.00  the first buds come back: love grows again (the loop)
 */
const KEYS: { t: number; w: Weights }[] = [
  { t: 0.0, w: [1, 0, 0, 0] },
  { t: 0.3, w: [1, 0, 0, 0] },
  { t: 0.35, w: [0, 1, 0, 0] },
  { t: 0.43, w: [0, 1, 0, 0] },
  { t: 0.48, w: [0, 0, 1, 0] },
  { t: 0.56, w: [0, 0, 1, 0] },
  { t: 0.63, w: [0, 0, 0, 1] },
  { t: 0.9, w: [0, 0, 0, 1] },
  { t: 1.0, w: [0.32, 0, 0, 0.68] },
];

const ss = (x: number) => x * x * (3 - 2 * x);

/** Writes the season weights for local progress t into out (no allocation). */
export function seasonAt(t: number, out: Weights): Weights {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i];
    const b = KEYS[i + 1];
    if (x >= a.t && x <= b.t) {
      const u = b.t > a.t ? ss((x - a.t) / (b.t - a.t)) : 0;
      for (let k = 0; k < 4; k++) out[k] = a.w[k] + (b.w[k] - a.w[k]) * u;
      return out;
    }
  }
  const last = KEYS[KEYS.length - 1].w;
  for (let k = 0; k < 4; k++) out[k] = last[k];
  return out;
}

/** Authored per-season palette. Order: spring, summer, fall, winter. */
export const PAL = {
  skyHorizon: ['#b4bfbb', '#c9cfc4', '#c6b79c', '#a9b1b7'],
  skyZenith: ['#6f7f80', '#7f959b', '#6c7473', '#5c666e'],
  skyGround: ['#55665f', '#55685a', '#5f5d4c', '#7f878a'],
  sunColor: ['#e6e2d6', '#fff0d6', '#f2c38c', '#cfd8e0'],
  // overcast: the sun is a brightening in the cloud, kept above the frame so its disc never reads as a moon
  sunAmount: [0.08, 0.16, 0.12, 0.04],
  sunDir: [
    [0.35, 0.62, -0.7],
    [0.3, 0.78, -0.55],
    [0.5, 0.58, -0.64],
    [0.4, 0.55, -0.73],
  ] as [number, number, number][],
  haze: [0.42, 0.32, 0.36, 0.46],
  keyIntensity: [0.55, 1.15, 0.85, 0.32],
  hemiIntensity: [1.45, 1.6, 1.4, 1.5],
  fogDensity: [0.0125, 0.0085, 0.011, 0.014],
  grass: ['#46563f', '#435839', '#5e5a3e', '#d3d8d9'],
  water: ['#25332f', '#2a3a35', '#2b3530', '#26303a'],
  /** Rain multiplier per season (weather-driven base * this). Winter falls as snow. */
  rain: [1, 0.35, 0.85, 0.12],
  windowGlow: [0.75, 0.5, 0.85, 1.25],
};

/** Weighted colour blend of an authored 4-palette into out. */
export function blendColor(out: THREE_NS.Color, pal: THREE_NS.Color[], w: Weights): THREE_NS.Color {
  out.setRGB(0, 0, 0);
  for (let k = 0; k < 4; k++) {
    out.r += pal[k].r * w[k];
    out.g += pal[k].g * w[k];
    out.b += pal[k].b * w[k];
  }
  return out;
}

/**
 * Settled-snow weight: the ground, roofs and limbs only whiten once the fall foliage is mostly down (fall weight
 * below ~0.3), so the fall->winter blend never shows full autumn crowns over white ground (litter reading as dirt).
 */
export function snowCover(w: Weights): number {
  const wi = w[3];
  const k = Math.min(1, Math.max(0, (1 - w[2] - 0.7) / 0.3));
  return wi * k * k * (3 - 2 * k);
}

/** Ground weights: winter's share is held back to snowCover(w); the rest stays with fall (no-alloc). */
export function groundWeights(w: Weights, out: Weights): Weights {
  const g = snowCover(w);
  out[0] = w[0];
  out[1] = w[1];
  out[2] = w[2] + (w[3] - g);
  out[3] = g;
  return out;
}

export function blendNum(vals: number[], w: Weights): number {
  return vals[0] * w[0] + vals[1] * w[1] + vals[2] * w[2] + vals[3] * w[3];
}
