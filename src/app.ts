// Shared handle passed to every UI / game module's init(). Created once in main.ts.
import type { Game } from './game/state';
import type { Conductor } from './world/conductor';

export interface App {
  game: Game;
  conductor: Conductor;
  /** prefers-reduced-motion: reduce */
  reducedMotion: boolean;
  /** True when the WebGL world is running (false => poster fallback mode). */
  webgl: boolean;
  /** Scroll to a chapter (fast travel). Implemented by ui/reveal.ts (owns Lenis); main.ts provides a native fallback. */
  scrollToChapter(index: number, opts?: { instant?: boolean }): void;
}
