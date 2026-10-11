// Native-scroll conductor (adapted from build-threejs-scroll-worlds/references/scroll-conductor.js).
// Native scroll is the ONLY source of truth. Derive, never accumulate (horizontal-scroll-scenes rule 1).
// exact = chapterIndex + local, where local = how far the page has scrolled through that chapter's <section>.
import { bus, type ProgressState } from '../bus';
import { CHAPTERS } from '../content/story';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const damp = (c: number, t: number, l: number, dt: number) => c + (t - c) * (1 - Math.exp(-l * dt));
/** Pickup pause (SPEC §4.2): after a collect the camera all but stops for HOLD_MS, then eases back over EASE_MS.
 *  Only the smoothing rate changes; scrollY is never touched, so the reader's scroll is always honoured. */
const HOLD_MS = 230;
const EASE_MS = 200;

export function createConductor(opts: { sections: HTMLElement[]; reducedMotion: boolean; damping?: number }) {
  const { sections } = opts;
  let reduce = opts.reducedMotion;
  const lambda = opts.damping ?? 5.2;
  let tops: number[] = [];
  let heights: number[] = [];
  let exact = 0;
  let smooth = 0;
  let activeIndex = -1;
  let raf = 0;
  let last = 0;
  let running = false;
  let holdAt = -Infinity;
  /** 0..1 multiplier on the smoothing rate: ~0 during the pickup hold, then a smoothstep back to 1. */
  const holdFactor = (now: number) => {
    const s = now - holdAt;
    if (s >= HOLD_MS + EASE_MS) return 1;
    if (s < HOLD_MS) return 0.03;
    const u = (s - HOLD_MS) / EASE_MS;
    return 0.03 + 0.97 * u * u * (3 - 2 * u);
  };

  const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);

  function measure() {
    tops = sections.map((s) => s.getBoundingClientRect().top + window.scrollY);
    heights = sections.map((s) => Math.max(1, s.offsetHeight));
    read();
  }

  function progressAt(y: number) {
    const max = maxScroll();
    y = clamp(y, 0, max);
    for (let i = sections.length - 1; i >= 0; i--) {
      if (y >= tops[i] - 0.5) {
        // The last chapter may be shorter than its section once the page bottoms out.
        const span = i === sections.length - 1 ? Math.max(1, Math.min(heights[i], max - tops[i])) : heights[i];
        return i + clamp((y - tops[i]) / span, 0, 0.99999);
      }
    }
    return 0;
  }

  function read() {
    exact = progressAt(window.scrollY);
    if (reduce) smooth = exact;
  }

  function state(): ProgressState {
    const index = Math.floor(exact);
    const smoothIndex = Math.floor(smooth);
    return {
      exact,
      smooth,
      index,
      localExact: exact - index,
      smoothIndex,
      localSmooth: smooth - smoothIndex,
      page: clamp(window.scrollY / maxScroll(), 0, 1),
    };
  }

  /** Last emitted values (reduced motion emits only on change and then idles). */
  let lastExact = NaN;
  let lastPage = NaN;
  function kick() {
    if (running && !raf && !document.hidden) raf = requestAnimationFrame(tick);
  }

  function tick(now: number) {
    raf = 0;
    if (!running) return;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    // Big jumps (fast travel, Home/End) should not drag the camera through every chapter:
    // snap smooth when it is more than one chapter behind.
    if (Math.abs(exact - smooth) > 1.2) smooth = exact - Math.sign(exact - smooth) * 0.35;
    smooth = reduce ? exact : damp(smooth, exact, lambda * holdFactor(now), dt);
    if (Math.abs(smooth - exact) < 1e-4) smooth = exact;
    const s = state();
    if (s.index !== activeIndex) {
      activeIndex = s.index;
      bus.emit('chapter', { id: CHAPTERS[s.index].id, index: s.index });
    }
    if (reduce && s.exact === lastExact && s.page === lastPage) {
      // Nothing moved: stop until the next scroll / resize (no smoothing to settle under reduced motion).
      last = 0;
      return;
    }
    lastExact = s.exact;
    lastPage = s.page;
    bus.emit('progress', s);
    raf = requestAnimationFrame(tick);
  }

  const onScroll = () => {
    read();
    kick();
  };
  const onResize = () => {
    measure();
    kick();
  };
  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    } else {
      kick();
    }
  };

  let ro: ResizeObserver | null = null;
  // Reduced motion has no smoothing to hold (smooth = exact); the pickup still lands through the UI.
  bus.on('keepsake:collected', () => {
    if (!reduce) holdAt = performance.now();
  });

  return {
    start() {
      if (running) return;
      running = true;
      measure();
      smooth = exact;
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onResize, { passive: true });
      window.addEventListener('pageshow', onResize);
      window.addEventListener('load', onResize);
      document.fonts?.ready.then(onResize).catch(() => {});
      document.addEventListener('visibilitychange', onVisibility);
      ro = new ResizeObserver(() => onResize());
      ro.observe(document.body);
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pageshow', onResize);
      window.removeEventListener('load', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      ro?.disconnect();
    },
    measure: onResize,
    getState: state,
    /** Scroll position (px) for a chapter index + local progress. */
    yFor(index: number, local = 0) {
      if (!tops.length) measure();
      const i = clamp(index, 0, sections.length - 1);
      return tops[i] + heights[i] * clamp(local, 0, 1);
    },
    setReducedMotion(v: boolean) {
      reduce = v;
      if (v) smooth = exact;
      lastExact = NaN;
      kick();
    },
  };
}

export type Conductor = ReturnType<typeof createConductor>;
