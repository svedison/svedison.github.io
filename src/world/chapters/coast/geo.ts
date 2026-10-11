// Coast geography: one analytic height function that the terrain mesh, palms, scrub, surf ribbon, lantern launch
// points and the camera all sample (threejs-landscape: "keep the analytic function separate from the mesh").
//
// Coast frame (metres). The real OC coast runs NW-SE and faces the sunset across the water, so:
//   u = distance along the coast, + toward the north-west ("north up the coast")
//   v = distance offshore, + toward the sea (south-west)
// world = u * C + v * S, with C = (-0.6, 0, -0.8) and S = (-0.8, 0, 0.6) (orthonormal, y up).
// Looking seaward (+S) from the land, +u (north) is to the right of the frame.
import { fbm2, warpedFbm2, smoothstep } from '../../systems/noise';

export const CX = -0.6;
export const CZ = -0.8;
export const SX = -0.8;
export const SZ = 0.6;

export const wx = (u: number, v: number) => CX * u + SX * v;
export const wz = (u: number, v: number) => CZ * u + SZ * v;
export const toU = (x: number, z: number) => CX * x + CZ * z;
export const toV = (x: number, z: number) => SX * x + SZ * z;

/** Smooth ramp: ~0 for x << 0, ~x for x >> k. */
const ramp = (x: number, k: number) => 0.5 * (x + Math.sqrt(x * x + k * k));

/** Seaward position of the waterline at u. Gentle coves near the path; far north the coast bends out to sea. */
export function shoreV(u: number): number {
  const cove = 7 * Math.sin(u / 61 + 0.6) + 16 * (fbm2(u * 0.0062, 3.3, 3, 11) - 0.5);
  return cove + shoreBase(u) + headland(u);
}
/** North of the track the high bluffs swing out to sea as a headland, so from the bluff-top camera their profile
 *  recedes into the haze on the right of the frame. ~0 along the boat's course (u < 260). */
export function headland(u: number): number {
  return 2 * ramp(u - 320, 30);
}
/** The large-scale coast line without the coves (the boat's course follows this). */
export function shoreBase(u: number): number {
  return 0.9 * ramp(u - 340, 240) + 0.55 * ramp(-u - 520, 200);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Where the bluffs stay low (the camera walks the bluff top here). */
function pathMask(u: number) {
  return smoothstep(-330, -170, u) * (1 - smoothstep(300, 470, u));
}

export function beachWidth(u: number) {
  return 12 + 8 * fbm2(u * 0.011, 1.3, 2, 4);
}

function faceWidth(u: number, near: number) {
  return 4 + 7 * fbm2(u * 0.013, 4.1, 3, 8) + (1 - near) * 10;
}
/** Inland distance of the bluff top edge (where the face meets the plateau). */
export function bluffEdge(u: number) {
  return beachWidth(u) + faceWidth(u, pathMask(u));
}

/** Terrain height at coast coords (u, v). */
export function heightAt(u: number, v: number): number {
  const d0 = shoreV(u) - v; // inland distance (negative = under the sea)
  if (d0 < -2) return Math.max(-16, -0.7 + (d0 + 2) * 0.1);
  // domain warp the cross-shore distance so the bluff edge is not parallel to the waterline
  const warp = (fbm2(u * 0.017, d0 * 0.017 + 7.1, 3, 5) - 0.5) * 2;
  const d = d0 + warp * 5 * smoothstep(4, 20, d0);
  const near = pathMask(u);
  const bluffH = lerp(22 + 26 * warpedFbm2(u * 0.0045, 2.2, 4, 0.7, 9), 4.8 + 1.4 * fbm2(u * 0.02, 9.1, 2, 6), near);
  const beachW = beachWidth(u);
  const faceW = faceWidth(u, near);
  if (d0 < 0) return -0.7 * smoothstep(0, -2, d0) - 0.05;
  let h = Math.min(d0 / beachW, 1) * 1.25;
  // bluff face, eroded: ridged gullies cut back into the face
  const s = smoothstep(beachW, beachW + faceW, d);
  const gully = Math.abs(fbm2(u * 0.09, d * 0.05, 3, 12) * 2 - 1);
  const face = Math.pow(s, 0.8) * (1 - 0.18 * (1 - gully) * (1 - s) * 4 * s);
  h += (bluffH - 1.25) * face;
  // terraces of coastal scrub on the plateau
  const top = smoothstep(beachW + faceW, beachW + faceW + 70, d);
  h += top * (warpedFbm2(u * 0.009, d * 0.009, 4, 0.6, 21) - 0.42) * (5 + 14 * (1 - near));
  // far coastal hills (San Joaquin Hills inland), low contrast in haze
  h += smoothstep(220, 1500, d) * Math.pow(warpedFbm2(u * 0.0014, d * 0.0014, 4, 0.8, 33), 1.4) * 360;
  return h;
}

/** Inland distance of a point from the waterline. */
export function inland(u: number, v: number) {
  return shoreV(u) - v;
}
