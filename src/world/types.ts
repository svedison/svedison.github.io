// The contract every world module implements. Read this before writing a chapter.
//
// Architecture (SPEC §3, build-threejs-scroll-worlds "connected sets"):
// - ONE WebGLRenderer, ONE PerspectiveCamera, owned by engine.ts.
// - Each WorldModule owns its OWN THREE.Scene (its "set"). The engine renders only the module that owns
//   the current smoothed progress. Seams between DIFFERENT modules are hidden by the engine's mist veil
//   (a DOM layer coloured by `environment().mist`), so a module never has to know about its neighbours.
// - A module can serve several chapters (e.g. 'jiangyin' serves 'prologue' + 'river' continuously).
// - Modules never touch the DOM story, game state or other modules directly. Talk via `bus` (src/bus.ts).
import type * as THREE_NS from 'three';
import type { ChapterId } from '../content/story';
import type { QualityTier } from '../bus';

export type ModuleId = 'jiangyin' | 'crossing' | 'coast' | 'rain' | 'workshop' | 'loop' | 'next';

/** Which module renders each chapter. */
export const CHAPTER_MODULE: Record<ChapterId, ModuleId> = {
  prologue: 'jiangyin',
  river: 'jiangyin',
  crossing: 'crossing',
  coast: 'coast',
  rain: 'rain',
  workshop: 'workshop',
  loop: 'loop',
  next: 'next',
};

/**
 * Copy tone of each chapter's no-WebGL poster ('light' = light text on a dark still). The engine uses it while a
 * module is still loading (the poster is showing) and after a context loss. Mirrors the poster palette in main.css.
 */
export const POSTER_TONE: Record<ChapterId, 'light' | 'dark'> = {
  prologue: 'dark', // pale mist dusk still under a paper wash: ink copy (rituals.css --poster-wash-prologue, main.css)
  river: 'dark',
  crossing: 'light',
  coast: 'dark',
  rain: 'light',
  workshop: 'light',
  loop: 'dark',
  next: 'dark',
};

/**
 * Reduced motion (SPEC §11: "no scrubbing; the camera snaps to each chapter's composed still"). Each chapter is cut
 * into beats by EXACT local progress: [until, t] means "while local progress < until, show the still at t". The
 * engine feeds modules that still as `f.t` and dips through the mist veil when the beat changes, so no module needs
 * its own reduced-motion camera. Beats follow the authored hotspot windows so a keepsake is in frame while its
 * window is open (river RANGE in jiangyin.ts, crossing/coast/rain gates, one hold per Workshop shelf piece).
 */
const shelfBeats = (n: number, t0: number, span: number): [number, number][] =>
  Array.from({ length: n }, (_, k) => {
    const t = t0 + (span * k) / (n - 1);
    const next = t0 + (span * (k + 1)) / (n - 1);
    return [k === n - 1 ? 1 : (t + next) / 2, t] as [number, number];
  });

export const REDUCED_STILLS: Record<ChapterId, [number, number][]> = {
  prologue: [[1, 0.2]],
  river: [
    [0.44, 0.25],
    [0.6, 0.54],
    [0.78, 0.7],
    [1, 0.9],
  ],
  crossing: [
    [0.48, 0.25],
    [0.72, 0.6],
    [1, 0.86],
  ],
  coast: [
    [0.3, 0.15],
    [0.65, 0.45],
    [1, 0.8],
  ],
  // lake · the quad (summer, the three keepsakes) · winter. Winter takes over at 0.62, as the season itself turns
  // (rain/seasons.ts: winter from 0.63) and before the forgive sheet parks (~0.68), so the sheet sits over snow.
  rain: [
    [0.18, 0.08],
    [0.62, 0.4],
    [1, 0.85],
  ],
  // workshop.ts trackS(): 8 pieces, holds at t = 0.125 + 0.755 * k / 7
  workshop: shelfBeats(8, 0.125, 0.755),
  // loop.ts: the breath after the manifesto, the whole loop drawn on the map. Its step-backs (ring, copy) follow
  // exact scroll under reduced motion, so this camera never bakes a faded stroke into the still.
  loop: [[1, 0.4]],
  next: [
    [0.55, 0.3],
    [1, 0.85],
  ],
};

/** The composed still for a chapter at exact local progress: beat index + the t to render. */
export function stillFor(chapter: ChapterId, local: number): { beat: number; t: number } {
  const beats = REDUCED_STILLS[chapter];
  for (let i = 0; i < beats.length; i++) if (local < beats[i][0]) return { beat: i, t: beats[i][1] };
  const lastBeat = beats.length - 1;
  return { beat: lastBeat, t: beats[lastBeat][1] };
}

export interface WorldContext {
  THREE: typeof THREE_NS;
  renderer: THREE_NS.WebGLRenderer;
  camera: THREE_NS.PerspectiveCamera;
  tier: QualityTier;
  reducedMotion: boolean;
  /** Coarse pointer / narrow viewport: use the authored mobile camera. */
  isMobile: boolean;
}

export interface PointerInfo {
  /** Normalized device coords, -1..1 (y up). */
  x: number;
  y: number;
  /** False when the pointer left the window or is touch-idle. */
  active: boolean;
  /** Speed in NDC units / second (for ripples, trails). */
  speed: number;
}

export interface FrameInfo {
  /** Which chapter (of this module's chapters) owns the frame. */
  chapter: ChapterId;
  /** Smoothed local progress through that chapter, 0..1. Use for camera + visuals.
   *  Under reduced motion the engine passes the chapter's composed still here (REDUCED_STILLS), not scroll. */
  t: number;
  /** Exact local progress, 0..1. Use for gating interactions and counters. */
  tExact: number;
  /** Seconds since last frame, clamped to 1/30. */
  dt: number;
  /** Seconds since world start (stops while hidden). */
  time: number;
  aspect: number;
  width: number;
  height: number;
  pointer: PointerInfo;
}

export interface Environment {
  /** Colour of the DOM mist veil used to hide seams with neighbour modules (CSS colour). */
  mist: string;
  /** Text tone for the DOM copy over this frame: 'light' text on dark scenes, 'dark' text on light scenes. */
  tone: 'light' | 'dark';
}

export interface Hotspot {
  id: string;
  /** Simple proxy mesh to raycast (not the decorative mesh). Can be invisible (visible=true, material.visible=false). */
  proxy: THREE_NS.Object3D;
  label: string;
  /** Only raycastable while this returns true (gate by exact chapter + progress). */
  enabled(f: FrameInfo): boolean;
  onHover?(hovered: boolean): void;
  onActivate(): void;
}

export interface WorldModule {
  id: ModuleId;
  scene: THREE_NS.Scene;
  /** Called every frame while this module owns the frame. Animate here. */
  update(f: FrameInfo): void;
  /** Set camera position / target / fov for this frame. Must be a pure function of f.t (+ small damped pointer parallax). */
  pose(f: FrameInfo, camera: THREE_NS.PerspectiveCamera): void;
  environment(f: FrameInfo): Environment;
  hotspots(): Hotspot[];
  /** Optional custom render (extra passes, post). Return true if it rendered the frame itself. */
  render?(renderer: THREE_NS.WebGLRenderer, camera: THREE_NS.PerspectiveCamera, f: FrameInfo): boolean;
  /** Called when the module becomes / stops being the owner. */
  enter?(): void;
  leave?(): void;
  /**
   * Optional: false while the module still builds part of its set in the background and is drawing a stand-in.
   * The engine keeps the chapter's DOM poster up until this is true (or a safety timeout passes), so a reader
   * never sees the DOM poster fade into a second, internal stand-in. Omit it when the set is complete on build.
   */
  ready?(): boolean;
  /** Quality tier changed (lower particle counts, disable passes). */
  setTier?(tier: QualityTier): void;
  dispose(): void;
}

export type WorldModuleFactory = (ctx: WorldContext) => WorldModule | Promise<WorldModule>;
