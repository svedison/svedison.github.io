// World engine: one renderer, one camera, module routing, seam veil, raycast hotspots,
// quality governor, visibility pause. Chapters live in ./chapters/<moduleId>.ts (default export = factory).
//
// Frame ownership: the module serving the current smoothed chapter renders. While that module is still loading
// (deep link, reload at depth, fast travel, fast scrollbar drag) the chapter's no-WebGL poster (#posters) shows
// under the copy with the poster's tone, and fades out once the module has drawn two frames.
// Reduced motion: modules get each chapter's composed still (REDUCED_STILLS) instead of scroll, beats change through
// a short mist dip, and the loop renders only while something changes.
import * as THREE from 'three';
import { bus, type BusEvents, type ProgressState, type QualityTier } from '../bus';
import { CHAPTERS, type ChapterId } from '../content/story';
import {
  CHAPTER_MODULE,
  POSTER_TONE,
  stillFor,
  type FrameInfo,
  type Hotspot,
  type ModuleId,
  type PointerInfo,
  type WorldContext,
  type WorldModule,
  type WorldModuleFactory,
} from './types';

const loaders: Record<ModuleId, () => Promise<{ default: WorldModuleFactory }>> = {
  jiangyin: () => import('./chapters/jiangyin'),
  crossing: () => import('./chapters/crossing'),
  coast: () => import('./chapters/coast'),
  rain: () => import('./chapters/rain'),
  workshop: () => import('./chapters/workshop'),
  loop: () => import('./chapters/loop'),
  next: () => import('./chapters/next'),
};

const MODULE_ORDER: ModuleId[] = ['jiangyin', 'crossing', 'coast', 'rain', 'workshop', 'loop', 'next'];
/** Share of a module's load per step (loader progress): chunk import, factory build, shader compile. */
const STEP = { imported: 0.3, built: 0.7, compiled: 1 };
const SEAM = 0.07; // fraction of a chapter at each end covered by the veil when the neighbour is another module
const DISSOLVE_MS = 240; // reduced motion: each half of the mist dip between composed stills
const POSTER_FADE_MS = 600;
/**
 * A module that reports ready() = false keeps the DOM poster up at most this long (then its own stand-in shows).
 * Long on purpose: the DOM poster is a still rendered from the finished set, so on a slow device it is a better
 * stand-in than a module's painted placeholder. At 15 s a slow coast build let the reader watch the poster
 * hand over to the painted placeholder mid-chapter (coast 0.35) and then cut a second time to the live set.
 */
const POSTER_MAX_MS = 40000;

/** Quality ladder, best first. The governor lowers DPR before it drops a tier (SPEC §12.4). */
const LADDER: { tier: QualityTier; dpr: number }[] = [
  { tier: 'high', dpr: 2 },
  { tier: 'high', dpr: 1.5 },
  { tier: 'medium', dpr: 1.5 },
  { tier: 'medium', dpr: 1.25 },
  { tier: 'low', dpr: 1 },
];
const GOV_WINDOW_MS = 2000;

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  veil: HTMLElement;
  /** The no-WebGL poster layer (#posters); shown while the owning module loads. */
  posters?: HTMLElement | null;
  /** Element whose data-tone ('light' | 'dark') the engine sets for DOM contrast. */
  toneTarget: HTMLElement;
  reducedMotion: boolean;
  onLabel?: (label: string | null, x: number, y: number) => void;
  /** A module finished loading (its bus subscriptions are live): re-sync game state to it. */
  onModuleReady?: (id: ModuleId) => void;
}

function detectMobile() {
  return matchMedia('(pointer: coarse)').matches || window.innerWidth < 760;
}

/** One rAF (so the loader's main-thread fallback can repaint), with a timeout in case the tab is hidden. */
function yieldFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(go);
    window.setTimeout(go, 80);
  });
}

export async function createEngine(opts: EngineOptions) {
  const { canvas, veil, toneTarget, reducedMotion } = opts;
  const posters = opts.posters ?? null;
  const startLevel = detectMobile() ? 2 : 0;
  let level = startLevel;
  let tier: QualityTier = LADDER[level].tier;
  const dprCap = () => LADDER[level].dpr;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier === 'high', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap()));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20000);
  const ctx: WorldContext = { THREE, renderer, camera, tier, reducedMotion, isMobile: detectMobile() };

  // ---- ?perf=1 probe hook (scripts/perf-probe.mjs): per-frame totals across every render pass of the owner ----
  const PERF = /[?&]perf=1(&|$)/.test(location.search);
  const perfLog = { calls: 0, tris: 0, frames: [] as number[], work: [] as number[], owner: '' as string };
  const perfPx = new Uint8Array(4);
  if (PERF) renderer.info.autoReset = false;

  const modules = new Map<ModuleId, WorldModule>();
  const pending = new Map<ModuleId, Promise<WorldModule | null>>();
  /** Load progress per module, 0..1 (by step weight). */
  const loadFrac = new Map<ModuleId, number>();
  const progressListeners = new Set<() => void>();
  let owner: WorldModule | null = null;
  let progress: ProgressState | null = null;
  let paused = false;
  let running = false;
  let lost = false;
  let disposed = false;
  let raf = 0;
  let last = 0;
  let time = 0;
  const pointer: PointerInfo = { x: 0, y: 0, active: false, speed: 0 };
  let width = 1;
  let height = 1;

  // ---- module loading ----
  function setFrac(id: ModuleId, v: number) {
    loadFrac.set(id, v);
    progressListeners.forEach((fn) => fn());
  }
  // Builds and compiles run one at a time, with a frame between heavy steps, so the main thread breathes.
  let buildChain: Promise<unknown> = Promise.resolve();

  function load(id: ModuleId): Promise<WorldModule | null> {
    if (modules.has(id)) return Promise.resolve(modules.get(id)!);
    if (pending.has(id)) return pending.get(id)!;
    setFrac(id, 0);
    const chunk = loaders[id]();
    const p = chunk
      .then((m) => {
        setFrac(id, STEP.imported);
        const run = buildChain.then(async () => {
          if (disposed) return null;
          await yieldFrame();
          const mod = await m.default(ctx);
          setFrac(id, STEP.built);
          await yieldFrame();
          // Compile shaders now so the first owned frame does not hitch.
          try {
            const r = renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> };
            if (r.compileAsync) {
              // parallel compile where KHR_parallel_shader_compile exists; never wait on it for more than 4 s
              await Promise.race([r.compileAsync(mod.scene, camera), new Promise((res) => window.setTimeout(res, 4000))]);
            } else renderer.compile(mod.scene, camera);
          } catch {
            /* non-fatal */
          }
          if (disposed) {
            mod.dispose();
            return null;
          }
          modules.set(id, mod);
          setFrac(id, STEP.compiled);
          governSkip = true; // a main-thread build is not a frame-time signal
          try {
            opts.onModuleReady?.(id);
          } catch (err) {
            console.error('[world] onModuleReady failed', err);
          }
          if (running) schedule();
          return mod;
        });
        buildChain = run.catch(() => null);
        return run;
      })
      .catch((err) => {
        console.error(`[world] module ${id} failed to load`, err);
        setFrac(id, 1);
        return null;
      });
    pending.set(id, p);
    return p;
  }

  function prefetchAround(id: ModuleId) {
    const i = MODULE_ORDER.indexOf(id);
    [i, i + 1, i + 2, i - 1].forEach((j) => {
      if (j >= 0 && j < MODULE_ORDER.length) load(MODULE_ORDER[j]);
    });
  }

  function resize() {
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    ctx.isMobile = detectMobile();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap()));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  function onResize() {
    resize();
    governSkip = true;
    wake(400);
  }

  // ---- pointer + hotspots ----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered: Hotspot | null = null;
  let lastPx = 0;
  let lastPy = 0;
  let lastPt = 0;
  let downAt = { x: 0, y: 0, t: 0 };

  function onPointerMove(e: PointerEvent) {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -(e.clientY / window.innerHeight) * 2 + 1;
    const now = performance.now();
    const dtp = Math.max(1, now - lastPt) / 1000;
    pointer.speed = Math.hypot(nx - lastPx, ny - lastPy) / dtp;
    lastPx = nx;
    lastPy = ny;
    lastPt = now;
    pointer.x = nx;
    pointer.y = ny;
    pointer.active = true;
    wake(600);
  }
  function onPointerLeave() {
    pointer.active = false;
    setHovered(null);
    wake(300);
  }
  function onPointerDown(e: PointerEvent) {
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    wake(1200);
  }
  function onPointerUp(e: PointerEvent) {
    wake(1200);
    // Clicks on DOM UI (buttons, links, overlays, copy) never fall through to the world.
    const target = e.target as Element | null;
    if (target && target !== canvas && target.closest('a,button,input,textarea,select,label,[data-ui]')) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    if (moved > 6 || performance.now() - downAt.t > 600) return;
    const hit = pick(e.clientX, e.clientY);
    if (hit) {
      // Touch: first tap focuses (shows label), second activates (SPEC §12.5).
      if (e.pointerType === 'touch' && hovered !== hit) {
        setHovered(hit, e.clientX, e.clientY);
        return;
      }
      hit.onActivate();
    }
  }
  const onInput = () => wake(800);

  // ---- which chapter + t the world shows ----
  /** Reduced motion: the still currently on screen, and the mist dip between stills. */
  let shown: { index: number; beat: number; t: number } | null = null;
  let dissolve = 0;
  let dissolveDir: 0 | 1 | -1 = 0;

  function stillTarget(p: ProgressState) {
    const index = Math.min(CHAPTERS.length - 1, p.index);
    const s = stillFor(CHAPTERS[index].id, p.localExact);
    return { index, beat: s.beat, t: s.t };
  }
  function view(): { index: number; t: number } | null {
    if (!progress) return null;
    if (reducedMotion) {
      if (!shown) shown = stillTarget(progress);
      return { index: shown.index, t: shown.t };
    }
    return { index: Math.min(CHAPTERS.length - 1, progress.smoothIndex), t: progress.localSmooth };
  }

  function currentFrame(): FrameInfo | null {
    const v = view();
    if (!progress || !v) return null;
    const ch = CHAPTERS[v.index];
    const exactIndex = Math.min(CHAPTERS.length - 1, progress.index);
    return {
      chapter: ch.id,
      t: v.t,
      tExact: exactIndex === v.index ? progress.localExact : exactIndex > v.index ? 1 : 0,
      dt: 0,
      time,
      aspect: camera.aspect,
      width,
      height,
      pointer,
    };
  }

  function pick(cx: number, cy: number): Hotspot | null {
    const f = currentFrame();
    if (!owner || !f || paused || posterOn) return null;
    ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const spots = owner.hotspots().filter((h) => h.enabled(f));
    if (!spots.length) return null;
    const hits = raycaster.intersectObjects(
      spots.map((s) => s.proxy),
      true,
    );
    if (!hits.length) return null;
    const obj = hits[0].object;
    return spots.find((s) => s.proxy === obj || isAncestor(s.proxy, obj)) ?? null;
  }
  function isAncestor(a: THREE.Object3D, b: THREE.Object3D) {
    let o: THREE.Object3D | null = b;
    while (o) {
      if (o === a) return true;
      o = o.parent;
    }
    return false;
  }
  function setHovered(h: Hotspot | null, x = 0, y = 0) {
    if (hovered === h) {
      if (h) opts.onLabel?.(h.label, x, y);
      return;
    }
    hovered?.onHover?.(false);
    hovered = h;
    hovered?.onHover?.(true);
    canvas.style.cursor = h ? 'var(--cursor-lit)' : '';
    opts.onLabel?.(h ? h.label : null, x, y);
  }
  let hoverQueued = false;
  let hoverX = 0;
  let hoverY = 0;
  function queueHover(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    hoverX = e.clientX;
    hoverY = e.clientY;
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      setHovered(pick(hoverX, hoverY), hoverX, hoverY);
    });
  }

  // ---- quality governor (SPEC §12.4) ----
  // Averages rAF frame time over 2 s windows. Two windows over budget step DOWN one rung (DPR first, then tier);
  // five windows (10 s) locked at display rate step back UP. A rung that failed again soon after a step up is
  // blocked with a doubling back-off, so a device never oscillates. Windows with a module build, a resume from
  // hidden, a resize, a poster or a seam swap are skipped.
  let governSkip = true;
  let gStart = 0;
  let gSum = 0;
  let gN = 0;
  let slowWins = 0;
  let fastWins = 0;
  let govCooldown = 0;
  let lastUpAt = -Infinity;
  let backoff = 30000;
  const blockedUntil = new Array<number>(LADDER.length).fill(0);
  const downMs = () => (ctx.isMobile ? 25 : 20); // budget: 25 ms mobile fallback, 16.7 ms desktop (+ vsync jitter)
  const UP_MS = 17.6; // holding the display's 60 Hz (or better) with room to spare

  const effective = (l: number) => `${LADDER[l].tier}@${Math.min(window.devicePixelRatio, LADDER[l].dpr)}`;
  function applyLevel(l: number) {
    const prevTier = tier;
    level = l;
    tier = LADDER[l].tier;
    ctx.tier = tier;
    resize();
    if (tier !== prevTier) {
      modules.forEach((m) => m.setTier?.(tier));
      bus.emit('quality', { tier });
    }
  }
  function govern(dtMs: number, now: number) {
    if (governSkip || now < govCooldown) {
      governSkip = false;
      gStart = now;
      gSum = 0;
      gN = 0;
      return;
    }
    if (!gStart) gStart = now;
    gSum += Math.min(dtMs, 100);
    gN++;
    if (now - gStart < GOV_WINDOW_MS) return;
    const avg = gSum / gN;
    gStart = now;
    gSum = 0;
    gN = 0;
    if (avg > downMs()) {
      slowWins++;
      fastWins = 0;
    } else if (avg < UP_MS) {
      fastWins++;
      slowWins = 0;
    } else {
      slowWins = 0;
      fastWins = 0;
    }
    if (slowWins >= 2) {
      slowWins = 0;
      let j = level + 1;
      while (j < LADDER.length && effective(j) === effective(level)) j++;
      if (j >= LADDER.length) return;
      if (now - lastUpAt < 20000) {
        blockedUntil[level] = now + backoff;
        backoff = Math.min(backoff * 2, 600000);
      }
      applyLevel(j);
      govCooldown = now + 3000;
    } else if (fastWins >= 5) {
      fastWins = 0;
      let j = level - 1;
      while (j >= startLevel && effective(j) === effective(level)) j--;
      if (j < startLevel || blockedUntil[j] > now) return;
      applyLevel(j);
      lastUpAt = now;
      govCooldown = now + 3000;
    }
  }

  // ---- seam veil ----
  function seamAt(i: number, t: number): number {
    const here = CHAPTER_MODULE[CHAPTERS[i].id];
    const prev = i > 0 ? CHAPTER_MODULE[CHAPTERS[i - 1].id] : here;
    const next = i < CHAPTERS.length - 1 ? CHAPTER_MODULE[CHAPTERS[i + 1].id] : here;
    let v = 0;
    if (prev !== here && t < SEAM) v = Math.max(v, 1 - t / SEAM);
    if (next !== here && t > 1 - SEAM) v = Math.max(v, (t - (1 - SEAM)) / SEAM);
    return v * v * (3 - 2 * v);
  }

  // ---- poster while the owning module loads ----
  // main.ts puts the poster up at boot; the engine fades it once the owning module has drawn two frames.
  let posterOn = !!posters && posters.style.display === 'block';
  let posterTimer = 0;
  let readyFrames = 0;
  let posterSince = performance.now();
  function showPoster(chapter: ChapterId) {
    readyFrames = 0;
    publishHotspots(null, null);
    veil.style.opacity = '0';
    const tone = POSTER_TONE[chapter];
    if (toneTarget.dataset.tone !== tone) toneTarget.dataset.tone = tone;
    if (posterOn) return;
    posterOn = true;
    posterSince = performance.now();
    setHovered(null);
    window.clearTimeout(posterTimer);
    if (posters) {
      posters.style.transition = 'none';
      posters.style.opacity = '1';
      posters.style.display = 'block';
    } else {
      // No poster layer: an opaque neutral mist is still better than the previous chapter's colour.
      veil.style.background = 'var(--dusk)';
      veil.style.opacity = '1';
    }
  }
  function hidePoster() {
    if (!posterOn) return;
    posterOn = false;
    if (!posters) return;
    posters.style.transition = `opacity ${POSTER_FADE_MS}ms ease`;
    posters.style.opacity = '0';
    window.clearTimeout(posterTimer);
    posterTimer = window.setTimeout(clearPosterStyles, POSTER_FADE_MS + 50);
    wake(POSTER_FADE_MS + 100);
  }
  function clearPosterStyles() {
    window.clearTimeout(posterTimer);
    if (!posters) return;
    posters.style.display = '';
    posters.style.opacity = '';
    posters.style.transition = '';
  }

  // ---- hotspot windows -> DOM mirrors (hotspots.ts dims a mirror whose 3D object is out of its window) ----
  let hotKey = '';
  function publishHotspots(mod: WorldModule | null, f: FrameInfo | null) {
    let known: string[] = [];
    let on: string[] = [];
    if (mod && f) {
      const hs = mod.hotspots();
      known = hs.map((h) => h.id);
      on = hs.filter((h) => h.enabled(f)).map((h) => h.id);
    }
    const key = mod && f ? `${known.join(',')}|${on.join(',')}` : '';
    if (key === hotKey) return;
    hotKey = key;
    bus.emit('hotspots:state', { live: !!(mod && f), known, on });
  }

  // ---- mist colour vs mist alpha: `rgba(r, g, b, a)` -> opaque `rgb(r, g, b)` + a (other CSS colours: a = 1) ----
  const mistCache = new Map<string, { color: string; a: number }>();
  function splitMist(css: string): { color: string; a: number } {
    const hit = mistCache.get(css);
    if (hit) return hit;
    let out = { color: css, a: 1 };
    const m = /^\s*rgba\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*[,/]\s*([\d.]+)(%?)\s*\)\s*$/i.exec(css);
    if (m) {
      const a = Number(m[4]) / (m[5] ? 100 : 1);
      if (Number.isFinite(a)) out = { color: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, a: Math.min(1, Math.max(0, a)) };
    }
    if (mistCache.size > 256) mistCache.clear();
    mistCache.set(css, out);
    return out;
  }

  // ---- copy tone across a seam: while the mist covers most of the frame, the mist decides the tone ----
  const toneCache = new Map<string, 'light' | 'dark' | null>();
  function mistTone(css: string): 'light' | 'dark' | null {
    if (toneCache.has(css)) return toneCache.get(css)!;
    let rgb: number[] | null = null;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
    if (hex) {
      const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
      rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    } else {
      const m = /rgba?\(([^)]+)\)/i.exec(css);
      if (m) rgb = m[1].split(/[ ,/]+/).slice(0, 3).map(Number);
    }
    let tone: 'light' | 'dark' | null = null;
    if (rgb && rgb.every((v) => Number.isFinite(v))) {
      const lin = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
      // ink (#1c1b19) vs paper (#f3ede2) text: pick whichever has more contrast on this mist
      tone = (L + 0.05) / (0.0113 + 0.05) > (0.843 + 0.05) / (L + 0.05) ? 'dark' : 'light';
    }
    toneCache.set(css, tone);
    return tone;
  }

  // ---- render scheduling ----
  // Normal motion renders every frame (the scenes are alive). Reduced motion renders while something changes
  // (scroll, pointer, a world event, a dip, a poster fade) and then stops. Overlays and hidden tabs stop the loop.
  let activeUntil = 0;
  function schedule() {
    if (!running || raf || paused || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }
  function wake(ms: number) {
    activeUntil = Math.max(activeUntil, performance.now() + ms);
    schedule();
  }

  function fail() {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
    owner?.leave?.();
    owner = null;
    setHovered(null);
    veil.style.opacity = '0';
    veil.style.background = '';
    posterOn = false;
    clearPosterStyles();
    publishHotspots(null, null);
    const i = progress ? Math.min(CHAPTERS.length - 1, progress.index) : 0;
    toneTarget.dataset.tone = POSTER_TONE[CHAPTERS[i].id];
    canvas.dispatchEvent(new CustomEvent('world:failed'));
  }

  // ---- loop ----
  function frame(now: number) {
    raf = 0;
    if (!running || paused || !progress) return;
    const dtMs = last ? now - last : 16.7;
    last = now;
    const dt = Math.min(dtMs / 1000, 1 / 30);
    time += dt;
    pointer.speed *= Math.exp(-6 * dt);

    let dip = 0;
    if (reducedMotion) {
      const target = stillTarget(progress);
      if (!shown || posterOn) {
        shown = target;
        dissolve = 0;
        dissolveDir = 0;
      } else if ((target.index !== shown.index || target.beat !== shown.beat) && dissolveDir !== 1) {
        dissolveDir = 1;
      }
      // Wall-clock, not the clamped dt: on a slow device (one frame = 300 ms) a clamped step would stretch
      // the 240 ms dip to several seconds of mist.
      const step = Math.min(dtMs, DISSOLVE_MS) / DISSOLVE_MS;
      if (dissolveDir === 1) {
        dissolve = Math.min(1, dissolve + step);
        if (dissolve >= 1) {
          shown = stillTarget(progress);
          dissolveDir = -1;
        }
      } else if (dissolveDir === -1) {
        dissolve = Math.max(0, dissolve - step);
        if (dissolve <= 0) dissolveDir = 0;
      }
      dip = dissolve * dissolve * (3 - 2 * dissolve);
    }

    const v = view()!;
    const chapterId = CHAPTERS[v.index].id;
    const modId = CHAPTER_MODULE[chapterId];
    const mod = modules.get(modId) ?? null;
    // The poster on screen is reveal.ts's still for the EXACT chapter (it follows 'chapter'), which can differ from
    // the smoothed one mid-seam: the copy tone follows the still the reader actually sees.
    const posterChapter = CHAPTERS[Math.min(CHAPTERS.length - 1, progress.index)].id;
    if (!mod) {
      load(modId);
      showPoster(posterChapter);
      governSkip = true;
      // keep polling cheaply until the module lands (load() also reschedules on ready)
      if (!reducedMotion) schedule();
      return;
    }
    if (owner !== mod) {
      owner?.leave?.();
      // The camera is shared: a module that tightens its frustum (workshop: near 0.04 / far 40) must not hand the
      // next owner a far plane that clips its whole set (loop's map sits ~80 units below its camera). Every owner
      // starts from the engine's defaults; a module that wants other values sets them in its own pose().
      camera.near = 0.1;
      camera.far = 20000;
      camera.zoom = 1;
      camera.layers.set(0);
      camera.up.set(0, 1, 0);
      camera.updateProjectionMatrix();
      owner = mod;
      owner.enter?.();
      setHovered(null);
      prefetchAround(modId);
      governSkip = true;
    }
    const f = currentFrame()!;
    f.dt = reducedMotion ? 0 : dt;
    try {
      const perfT0 = PERF ? performance.now() : 0;
      if (PERF) renderer.info.reset();
      mod.update(f);
      mod.pose(f, camera);
      const env = mod.environment(f);
      // A module may thin its own mist (rgba alpha) once its side of the seam is already hidden, e.g. crossing
      // clears by t ~0.04 inside the 7% seam window. Fold that alpha into the veil's opacity and paint the colour
      // opaque, so #veil's opacity is exactly what covers the frame. The reduced-motion dip stays fully opaque.
      const mist = splitMist(env.mist);
      veil.style.background = mist.color;
      const seam = reducedMotion ? 0 : seamAt(v.index, v.t) * mist.a;
      if (seam > 0.02) governSkip = true;
      const cover = Math.max(seam, dip);
      veil.style.opacity = posterOn ? '0' : String(cover);
      // Crossing a seam the reader mostly sees mist, not the scene: let the mist's own lightness pick the tone.
      const tone = cover > 0.5 ? (mistTone(mist.color) ?? env.tone) : env.tone;
      const shownTone = posterOn ? POSTER_TONE[posterChapter] : tone;
      if (toneTarget.dataset.tone !== shownTone) toneTarget.dataset.tone = shownTone;
      if (!mod.render?.(renderer, camera, f)) renderer.render(mod.scene, camera);
      if (PERF) {
        renderer.info.autoReset = false; // a module may restore it after its own debug log
        perfLog.calls = renderer.info.render.calls;
        perfLog.tris = renderer.info.render.triangles;
        perfLog.owner = modId;
        perfLog.frames.push(dtMs);
        // Frame work = CPU update + submit + GPU drain (a 1-px readback forces the GPU to finish this frame).
        const gl = renderer.getContext();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, perfPx);
        perfLog.work.push(performance.now() - perfT0);
        if (perfLog.work.length > 2000) perfLog.work.splice(0, 1000);
        if (perfLog.frames.length > 2000) perfLog.frames.splice(0, 1000);
      }
      if (!posterOn) publishHotspots(mod, f);
    } catch (err) {
      console.error(`[world] module ${modId} frame failed`, err);
      bus.emit('quality', { tier: 'low' });
      fail();
      return;
    }
    // A module that still builds part of its set (ready() = false) keeps the DOM poster up, so the reader never
    // watches the poster fade into the module's own stand-in and later cut again to the finished set.
    if (posterOn && (mod.ready?.() ?? true) && ++readyFrames >= 2) hidePoster();
    else if (posterOn && performance.now() - posterSince > POSTER_MAX_MS) hidePoster();
    if (!reducedMotion) {
      govern(dtMs, now);
      schedule();
    } else if (dissolveDir !== 0 || posterOn || performance.now() < activeUntil) {
      schedule();
    } else {
      last = 0; // idle: the next wake starts with a fresh dt
    }
  }

  const offs: (() => void)[] = [];
  offs.push(
    bus.on('progress', (p) => {
      const moved = !progress || p.exact !== progress.exact || p.smooth !== progress.smooth;
      progress = p;
      if (moved && reducedMotion) wake(500);
    }),
  );
  // Fetch the module for where the reader is going before the camera gets there.
  offs.push(bus.on('chapter', ({ id }) => load(CHAPTER_MODULE[id])));
  offs.push(bus.on('travel:to', ({ id }) => prefetchAround(CHAPTER_MODULE[id])));
  const openOverlays = new Set<string>();
  offs.push(
    bus.on('overlay', ({ name, open }) => {
      // A full-screen overlay hides the world: stop paying for it.
      if (name !== 'logbook' && name !== 'atlas') {
        wake(1500);
        return;
      }
      if (open) openOverlays.add(name);
      else openOverlays.delete(name);
      const was = paused;
      paused = openOverlays.size > 0;
      if (paused) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (was) {
        last = 0;
        governSkip = true;
        wake(500);
      }
    }),
  );
  // World-facing events: keep a reduced-motion world drawing long enough to show their response.
  const wakeOn: (keyof BusEvents)[] = [
    'keepsake:collected',
    'keepsake:focus',
    'keepsakes:sync',
    'inspect:open',
    'inspect:close',
    'record:spin',
    'forgive:done',
    'light:pulse',
    'loop:placed',
    'loop:closed',
    'weather',
    'moon:click',
    'lantern:release',
    'ripple',
    'next:look',
    'quality',
  ];
  wakeOn.forEach((k) => offs.push(bus.on(k, () => wake(2500))));

  const onVis = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (running) {
      last = 0;
      governSkip = true;
      wake(500);
    }
  };
  const onContextLost = (e: Event) => {
    e.preventDefault(); // allows 'webglcontextrestored'
    lost = true;
    fail();
  };
  const onContextRestored = () => {
    if (disposed || !lost) return;
    lost = false;
    // three re-initialises its GL state on restore; resources re-upload on first use.
    resize();
    canvas.dispatchEvent(new CustomEvent('world:restored'));
    running = true;
    last = 0;
    governSkip = true;
    wake(1000);
  };

  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointermove', queueHover, { passive: true });
  document.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onInput);
  window.addEventListener('wheel', onInput, { passive: true });
  document.addEventListener('visibilitychange', onVis);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  resize();
  if (PERF) {
    (window as unknown as { __JY_PERF?: unknown }).__JY_PERF = {
      log: perfLog,
      get tier() {
        return tier;
      },
      dpr: () => renderer.getPixelRatio(),
      memory: () => ({ ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 }),
      /** Lights casting shadows in the owning module's scene. */
      shadowLights: () => {
        let n = 0;
        owner?.scene.traverse((o) => {
          if ((o as THREE.Light).isLight && o.castShadow && o.visible) n++;
        });
        return n;
      },
      loaded: () => [...modules.keys()],
    };
  }

  return {
    renderer,
    camera,
    /**
     * Load the module for where the reader is (deep link, reload at depth; the opening module otherwise) before
     * showing the world, and no longer than `maxWaitMs`: on a slow link or CPU the page is handed over anyway and
     * the chapter poster stands in until the module lands (frame() keeps polling). Neighbours are fetched by
     * prefetchAround() once the owner enters, behind the page rather than behind the loader.
     * Reports 0..1 by step weight after every import / build / compile step.
     */
    async preload(onProgress?: (p: number) => void, startIndex?: number, maxWaitMs = Infinity) {
      const at = startIndex ?? progress?.index ?? 0;
      const here = CHAPTER_MODULE[CHAPTERS[Math.max(0, Math.min(CHAPTERS.length - 1, at))].id];
      let lastReported = -1;
      const report = () => {
        const p = Math.min(1, loadFrac.get(here) ?? (modules.has(here) ? 1 : 0));
        if (p > lastReported + 0.001) {
          lastReported = p;
          onProgress?.(p);
        }
      };
      progressListeners.add(report);
      report();
      let timer = 0;
      try {
        await Promise.race([
          load(here),
          new Promise<void>((res) => {
            if (Number.isFinite(maxWaitMs)) timer = window.setTimeout(res, Math.max(0, maxWaitMs));
          }),
        ]);
      } finally {
        window.clearTimeout(timer);
        progressListeners.delete(report);
      }
      onProgress?.(1);
    },
    start() {
      if (running || lost) return;
      running = true;
      last = 0;
      wake(1000);
    },
    dispose() {
      disposed = true;
      running = false;
      cancelAnimationFrame(raf);
      offs.forEach((o) => o());
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointermove', queueHover);
      document.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onInput);
      window.removeEventListener('wheel', onInput);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      clearPosterStyles();
      modules.forEach((m) => m.dispose());
      renderer.dispose();
    },
    get tier() {
      return tier;
    },
  };
}

export type Engine = Awaited<ReturnType<typeof createEngine>>;
export type { ChapterId };
