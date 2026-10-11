// Camera grammar for the Seattle chapter: one slow push into the rain. Low across Lake Washington behind the lantern
// convoy, over the shore, then a slowing walk down the cherry-tree path toward the hall that never quite stops: a slow
// push and a slight crane through the winter hold behind the forgive card, then an authored rise toward the tower as
// the first buds return (the chapter ends on a beat). Desktop and portrait poses are authored separately.
// Pure function of t: Catmull-Rom through keyframes, parameterised by chapter progress (not arc length).

export interface CamKey {
  t: number;
  pos: [number, number, number];
  tgt: [number, number, number];
  fov: number;
}

export const DESKTOP: CamKey[] = [
  { t: 0.0, pos: [-0.6, 1.55, 36], tgt: [8.5, 4.6, -140], fov: 44 },
  { t: 0.1, pos: [0.6, 1.75, 12], tgt: [9, 4.6, -140], fov: 44 },
  { t: 0.2, pos: [2.0, 2.15, -22], tgt: [9.5, 4.6, -140], fov: 45 },
  { t: 0.28, pos: [3.4, 2.55, -42], tgt: [9.8, 4.6, -135], fov: 46 },
  { t: 0.4, pos: [4.1, 2.62, -48.5], tgt: [10, 4.6, -132], fov: 46 },
  { t: 0.6, pos: [4.4, 2.72, -52.5], tgt: [10.2, 4.9, -132], fov: 46 },
  { t: 0.8, pos: [4.6, 2.98, -57], tgt: [10.0, 5.3, -132], fov: 45 },
  { t: 0.92, pos: [4.7, 3.22, -60], tgt: [9.6, 5.9, -132], fov: 44.5 },
  { t: 1.0, pos: [4.75, 3.46, -61.5], tgt: [9.4, 6.8, -132], fov: 44 },
];

// Portrait: the copy column covers roughly 0.38-0.88 of the frame, so the lake shots look down (~11°) to lift the
// horizon, the campus and the mountain into the top third; on the quad the camera stands on land and pans right
// toward the CSO lantern and the bench (the arcade letter stays reachable through its DOM mirror).
export const PORTRAIT: CamKey[] = [
  { t: 0.0, pos: [1.2, 2.6, 42], tgt: [5.5, -32, -140], fov: 60 },
  { t: 0.1, pos: [2.0, 2.7, 18], tgt: [6.0, -28, -140], fov: 60 },
  { t: 0.2, pos: [3.0, 2.9, -16], tgt: [7.0, -18, -140], fov: 60 },
  { t: 0.28, pos: [4.0, 3.0, -40], tgt: [8.5, -6, -135], fov: 62 },
  { t: 0.4, pos: [4.4, 3.1, -50], tgt: [11, 0.5, -132], fov: 62 },
  // forgive beat (0.5-0.92): the rice-paper sheet enters late (a copy-free window ~0.36-0.46 shows the seasons) and
  // parks in the lower half (rituals.css). The lens yaws toward the CSO lantern and looks ~19 degrees down, so the
  // lantern, the lights rising from it and the arcade sit in the open top of the frame, above the sheet.
  { t: 0.6, pos: [4.7, 3.2, -54], tgt: [23, -18, -132], fov: 62 },
  { t: 0.68, pos: [4.8, 3.3, -56], tgt: [25, -22, -132], fov: 61.5 },
  { t: 0.8, pos: [4.9, 3.4, -58], tgt: [26, -17, -132], fov: 61 },
  // the sheet scrolls out through the top by ~0.83: the lens lifts (~19 -> ~4 degrees down) so the umbrella on its
  // bench, the path lamps and the CSO lantern come down to the middle of the frame instead of a grey path filling it
  { t: 0.86, pos: [4.9, 3.5, -59.3], tgt: [25, -2, -132], fov: 60.5 },
  { t: 0.92, pos: [4.9, 3.6, -60.5], tgt: [23.5, -0.5, -132], fov: 60.5 },
  { t: 1.0, pos: [4.9, 3.85, -62], tgt: [19, 1.5, -132], fov: 60 },
];

function cr(p0: number, p1: number, p2: number, p3: number, u: number) {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/** Writes pos (0..2), target (3..5), fov (6) into out. */
export function sampleCam(keys: CamKey[], t: number, out: Float32Array | number[]): void {
  const x = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < keys.length - 2 && x > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const p = keys[Math.max(0, i - 1)];
  const n = keys[Math.min(keys.length - 1, i + 2)];
  const u = b.t > a.t ? (x - a.t) / (b.t - a.t) : 0;
  for (let k = 0; k < 3; k++) {
    out[k] = cr(p.pos[k], a.pos[k], b.pos[k], n.pos[k], u);
    out[3 + k] = cr(p.tgt[k], a.tgt[k], b.tgt[k], n.tgt[k], u);
  }
  out[6] = cr(p.fov, a.fov, b.fov, n.fov, u);
}
