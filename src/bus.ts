// Tiny typed event bus: the only channel between DOM/UI modules and the 3D world.
// Add new events here (one line each) rather than importing across layers.
import type { ChapterId, LightId } from './content/story';
import type { KeepsakeId } from './content/keepsakes';
import type { ArtifactId } from './content/resume';

export interface BusEvents {
  /** Conductor: committed chapter change (exact progress). */
  chapter: { id: ChapterId; index: number };
  /** Conductor: every frame with progress (exact + smoothed). */
  progress: ProgressState;
  /** A keepsake hotspot (3D or DOM mirror) was activated. Game layer collects it. */
  'keepsake:activate': { id: KeepsakeId };
  /** The world should play its pickup flourish for this keepsake (after a successful collect). */
  'keepsake:collected': { id: KeepsakeId };
  /** A keepsake's DOM mirror gained/lost focus or pointer hover (world warms the 3D object, hover parity). */
  'keepsake:focus': { id: KeepsakeId; on: boolean };
  'keepsake:inrange': { id: KeepsakeId; on: boolean }; // world: this keepsake's 3D object is in frame + raycastable; hotspots.ts gives its DOM mirror a quiet lantern edge
  /** Engine: which hotspots the owning module has ('known') and which are raycastable now ('on'). live=false while
   *  no module owns the frame (poster, failure, no WebGL): every DOM mirror is then the full path. Fires on change. */
  'hotspots:state': { live: boolean; known: string[]; on: string[] };
  'keepsakes:sync': { ids: KeepsakeId[] }; // committed keepsakes, emitted on boot + game reset so the world can restore/hide pickups
  /** Workshop: open / close inspect for an artifact (3D lift + DOM caption). */
  'inspect:open': { id: ArtifactId };
  'inspect:close': { id: ArtifactId };
  /** Workshop: the world (re)joined; the UI re-emits 'inspect:open' if a caption is already up (missed while loading). */
  'inspect:sync': Record<string, never>;
  'record:spin': { speed: number }; // Workshop: the golden record was spun by hand (speed 0..1); UI voices a soft tone if sound is on (SPEC 4.5 #7)
  /** Workshop: the piece the dolly dwells on (hover=false) or the pointer is over (hover=true); x,y = CSS px above it. */
  'shelf:focus': { id: ArtifactId | null; x: number; y: number; hover: boolean };
  /** Forgive ritual: DOM requests the burn; world/overlay reports completion. */
  'forgive:burn': Record<string, never>;
  'forgive:done': Record<string, never>;
  /** A light was earned or pulsed (typed word easter egg). */
  'light:pulse': { id: LightId };
  /** Loop chapter: a light was placed on the ring. */
  'loop:placed': { id: LightId };
  'loop:closed': Record<string, never>; // emitted once per close by hud.ts (on the game 'loopClosed' commit), after the ring's cycle
  /** Live Seattle weather (0 = dry, 1 = heavy rain). */
  weather: { rain: number; label: string; live: boolean };
  /** Moon easter egg clicked in the crossing. */
  'moon:click': Record<string, never>;
  /** CSO lantern clicked in the rain chapter. */
  'lantern:release': { count: number };
  /** Atlas fast-travel request. */
  'travel:to': { id: ChapterId };
  /** Quality governor changed tiers. */
  quality: { tier: QualityTier };
  /** Pointer ripple on water at normalized device coords. */
  ripple: { x: number; y: number; strength: number };
  /** Overlays open/close (pause world rendering while a full-screen overlay is up). */
  'next:look': Record<string, never>; // Next shore: 'Look closer' (DOM mirror of the seed under glass) asks the glass to breathe once
  overlay: { name: 'logbook' | 'atlas' | 'satchel' | 'inspect' | 'forgive'; open: boolean };
}

export type QualityTier = 'high' | 'medium' | 'low';

export interface ProgressState {
  /** Fractional chapter progress from native scroll, e.g. 2.35 = 35% through chapter index 2. Exact. */
  exact: number;
  /** Damped version of exact (render only). Equals exact under reduced motion. */
  smooth: number;
  index: number;
  localExact: number;
  smoothIndex: number;
  localSmooth: number;
  /** 0..1 over the whole document. */
  page: number;
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;
const handlers = new Map<keyof BusEvents, Set<Handler<any>>>();

export const bus = {
  on<K extends keyof BusEvents>(type: K, fn: Handler<K>) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type)!.add(fn);
    return () => handlers.get(type)!.delete(fn);
  },
  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]) {
    handlers.get(type)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[bus] ${String(type)} handler failed`, err);
      }
    });
  },
};
