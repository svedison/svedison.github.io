// World bible constants for the Jiangyin set. 1 unit = 1 metre. Water at y = 0.
// The Yangtze flows toward -z (downstream); the south bank (Jiangyin) runs along x = BANK_X on the right of a
// downstream-facing camera, the far (north) bank sits ~1.7 km away to the left, lost in haze.
// A canal leaves the river at z = CANAL_Z and runs east (+x) into the water town, ending at the grandparents'
// courtyard wall.
export const BANK_X = 55;
export const QUAY_Y = 0.8;
export const CANAL_Z = -145;
export const CANAL_HALF = 5;
export const CANAL_END_X = 184;
/** Cross canal (T) at the end of the town canal. */
export const CROSS_X0 = 176;
export const CROSS_X1 = 186;
export const COURT_WALL_X = 187.2;
export const BRIDGE_X = 95;

export const NORTH_BANK_X = -1750;
/** Suspension bridge far downstream. */
export const SUSP = { z: -3300, x0: -1900, x1: 420, towerA: -900, towerB: 260, towerH: 190, deckY: 52 };
/** The pagoda-in-mist beat (SPEC ch.1): an ink silhouette on a hill ~1.1 km downstream behind the town. Placed so the
 *  prologue frames see it rise just past the end of the town (left of the seal on desktop) and the first river frames
 *  hold it near the centre, until the glide turns into the canal. */
export const PAGODA_FAR = { x: 160, z: -1100, hill: 22, s: 1.55 };

/** Keepsake anchors (world). */
/** Near the boat's sightline (canal centre z = -145) so they read from the glide, not from a 40 m distance. The small
 *  boat floats just off the north quay (z -150), ~3 m off the camera line, so the glide never brushes it. */
export const KEEP_BOAT = { x: 121, z: -147.9 };
export const KEEP_UMBRELLA = { x: 141.5, y: QUAY_Y, z: -150.45 };
/** Lit window centre (on the grandparents' house front, facing -x). */
export const WINDOW = { x: 192.85, y: 5.72, z: -148.4, w: 1.5, h: 1.25 };
