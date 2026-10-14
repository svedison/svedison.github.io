// Motion system for the DOM story (SPEC §9): Lenis as the single smooth-scroll engine wired to GSAP
// ScrollTrigger, masked word reveals for headlines, eyebrow → headline → body → cue as separate beats,
// and the scroll-scrubbed Loop manifesto. Bypassed entirely under prefers-reduced-motion: final states only.
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { App } from '../app';
import { bus } from '../bus';
import { CHAPTERS } from '../content/story';

let lenis: Lenis | null = null;

/** Exposed so overlays or tests can reach the engine; null under reduced motion. */
export function getLenis(): Lenis | null {
  return lenis;
}

const indexOf = (id: string) => CHAPTERS.findIndex((c) => c.id === id);

function splitHeadline(el: HTMLElement): HTMLElement[] {
  if (el.dataset.splitReady === 'true') return Array.from(el.querySelectorAll<HTMLElement>('.word'));
  const text = (el.textContent ?? '').trim();
  el.setAttribute('aria-label', text);
  el.textContent = '';
  const words: HTMLElement[] = [];
  text.split(/(\s+)/).forEach((part) => {
    if (!part.trim()) {
      el.appendChild(document.createTextNode(part));
      return;
    }
    const mask = document.createElement('span');
    mask.className = 'word-mask';
    mask.setAttribute('aria-hidden', 'true');
    const word = document.createElement('span');
    word.className = 'word';
    word.textContent = part;
    mask.appendChild(word);
    el.appendChild(mask);
    words.push(word);
  });
  el.dataset.splitReady = 'true';
  return words;
}

/** Split a passage into word spans by walking text nodes (keeps inline markup), with an unsplit SR copy. */
function splitScrub(el: HTMLElement): HTMLElement[] {
  if (el.dataset.scrubReady === 'true') return Array.from(el.querySelectorAll<HTMLElement>('.scrub-word'));
  const srCopy = document.createElement('span');
  srCopy.className = 'sr-only';
  srCopy.textContent = (el.textContent ?? '').trim();
  const visual = document.createElement('span');
  visual.setAttribute('aria-hidden', 'true');
  while (el.firstChild) visual.appendChild(el.firstChild);
  el.append(srCopy, visual);

  const walker = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const words: HTMLElement[] = [];
  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    (node.nodeValue ?? '').split(/(\s+)/).forEach((part) => {
      if (!part) return;
      if (!part.trim()) {
        frag.appendChild(document.createTextNode(part));
        return;
      }
      const w = document.createElement('span');
      w.className = 'scrub-word';
      w.textContent = part;
      frag.appendChild(w);
      words.push(w);
    });
    node.parentNode?.replaceChild(frag, node);
  }
  el.dataset.scrubReady = 'true';
  return words;
}

function chapterTimeline(section: HTMLElement): gsap.core.Timeline {
  const q = <T extends Element = HTMLElement>(sel: string) => Array.from(section.querySelectorAll<T & HTMLElement>(sel));
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
  const eyebrow = q('.chapter__pin [data-beat="eyebrow"]');
  const title = section.querySelector<HTMLElement>('.chapter__title[data-split]');
  const words = title ? splitHeadline(title) : [];
  const seal = q('.chapter__pin .seal__glyphs');
  const body = q('.chapter__pin [data-beat="body"]');
  const coords = q('.chapter__pin [data-beat="coords"]');
  const cta = q('.chapter__pin [data-beat="cta"]');

  if (eyebrow.length) tl.from(eyebrow, { autoAlpha: 0, y: 12, duration: 0.8 }, 0);
  if (words.length) tl.fromTo(words, { yPercent: 112 }, { yPercent: 0, duration: 1.0, ease: 'expo.out', stagger: 0.05 }, 0.18);
  if (seal.length) tl.from(seal, { autoAlpha: 0, duration: 1.6, ease: 'power2.out' }, 0.1);
  if (body.length) tl.from(body, { autoAlpha: 0, y: 16, duration: 0.95 }, words.length ? 0.18 + 0.05 * words.length + 0.25 : 0.4);
  if (coords.length) tl.from(coords, { autoAlpha: 0, duration: 0.8 }, '-=0.55');
  // CTAs fade with opacity only (never visibility) so they stay focusable and clickable mid-animation.
  if (cta.length) tl.from(cta, { opacity: 0, y: 10, duration: 0.8 }, '-=0.6');
  return tl;
}

// ---------------------------------------------------------------- the stage
// Each chapter's pinned reading block is a fixed layer. Its opacity is a pure function of native scrollY
// (derive, never accumulate): fade in over the first stretch of its section, hold, fade out before the
// next chapter (or before trailing in-flow content such as the forgive ritual). Reversible at any speed.
interface StageItem {
  i: number;
  section: HTMLElement;
  pin: HTMLElement;
  hold: HTMLElement;
  trailing: boolean;
  a: number;
  b: number;
  v: number;
  late: boolean;
  onShow: (() => void) | null;
}

// Off-stage reading blocks are click-through all the way down (main.css re-enables pointer events on
// some descendants, e.g. the hotspot mirrors, so the pin's own pointer-events is not enough).
// Only staged (fixed) pins carry .is-staged: the in-flow Next shore pin is never off stage, so its
// contact links, "Look closer" and the tally stay clickable.
const OFFSTAGE_CSS = `html.js .chapter__pin.is-staged:not(.is-active) * { pointer-events: none !important; }`;

function createStage(app: App) {
  if (!document.getElementById('reveal-offstage-css')) {
    const st = document.createElement('style');
    st.id = 'reveal-offstage-css';
    st.textContent = OFFSTAGE_CSS;
    document.head.appendChild(st);
  }
  const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-chapter]'));
  const items: StageItem[] = [];
  sections.forEach((section, i) => {
    const pin = section.querySelector<HTMLElement>('.chapter__pin');
    const hold = section.querySelector<HTMLElement>('.chapter__hold');
    if (!pin || !hold || getComputedStyle(pin).position !== 'fixed') return;
    pin.classList.add('is-staged');
    items.push({ i, section, pin, hold, trailing: section.hasAttribute('data-trailing'), a: 0, b: 0, v: -1, late: false, onShow: null });
  });

  let vh = window.innerHeight;
  function measure() {
    vh = window.innerHeight;
    for (const it of items) {
      it.a = it.section.getBoundingClientRect().top + window.scrollY;
      it.b = it.a + it.hold.offsetHeight - (it.trailing ? 0.55 * vh : 0);
    }
    update(true);
  }

  function update(force = false) {
    const y = window.scrollY;
    const fade = 0.16 * vh;
    for (const it of items) {
      const fin = it.i === 0 ? 1 : Math.min(1, Math.max(0, (y - it.a + fade * 0.25) / fade));
      const fout = Math.min(1, Math.max(0, (it.b - y) / fade));
      let v = Math.min(fin, fout);
      if (app.reducedMotion) v = v > 0.5 ? 1 : 0;
      if (force || Math.abs(v - it.v) > 0.003) {
        it.v = v;
        it.pin.style.opacity = v.toFixed(3);
        it.pin.style.transform = app.reducedMotion || v >= 1 ? '' : `translate3d(0, ${((1 - v) * (y < it.a + fade ? 12 : -12)).toFixed(1)}px, 0)`;
        // Off-stage pins stay in the focus order (never visibility:hidden / inert): the keepsake mirrors and
        // the Workshop shelf must be reachable by Tab from the top. They are only transparent and click-through
        // (OFFSTAGE_CSS), and focus moving into one brings its chapter on stage (focusin below).
        it.pin.classList.toggle('is-active', v > 0.5);
        if (v > 0.25 && it.onShow) {
          const f = it.onShow;
          it.onShow = null;
          f();
        }
      }
      const late = y > it.a + 0.42 * (it.b - it.a);
      if (late !== it.late) {
        it.late = late;
        it.pin.classList.toggle('is-late', late);
      }
    }
  }

  // Keyboard: tabbing into a chapter that is not on stage travels there, so focus is never invisible.
  // Pointer focus (a click) only lands on an on-stage pin, so this is the keyboard / AT path in practice.
  // The travel is instant: focus and its ring appear with the chapter, never over a blank stage.
  for (const it of items) {
    it.section.addEventListener('focusin', (e) => {
      // In-flow content (the forgive sheet, the loop ring) is scrolled into view by the browser itself.
      if (it.v >= 0.5 || !it.pin.contains(e.target as Node)) return;
      // Land just past the fade-in (fully on stage, so the focused control is visible and clickable),
      // not at the section's first pixel, where the block is still half faded.
      const fade = 0.16 * vh;
      const y = Math.round(Math.max(it.a, Math.min(it.a + fade, it.b - fade)));
      if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
      else window.scrollTo({ top: y, behavior: 'auto' });
      // the stage follows on the next progress frame; make sure it does even if nothing else is ticking
      requestAnimationFrame(() => update());
    });
  }

  bus.on('progress', () => update());
  window.addEventListener('resize', measure, { passive: true });
  window.addEventListener('load', measure, { once: true });
  document.fonts?.ready.then(measure).catch(() => {});
  new ResizeObserver(() => measure()).observe(document.body);
  measure();
  return { items, measure, update };
}

// ---------------------------------------------------------------- poster layer (no-WebGL)
function buildPosters() {
  const host = document.getElementById('posters');
  if (!host || host.childElementCount) return;
  const els = CHAPTERS.map((c) => {
    const d = document.createElement('div');
    d.className = `poster poster--${c.id}`;
    host.appendChild(d);
    return d;
  });
  let on = -1;
  bus.on('chapter', ({ index }) => {
    if (index === on) return;
    if (on >= 0) els[on].classList.remove('is-on');
    on = index;
    els[on].classList.add('is-on');
  });
}

export function init(app: App): void {
  const root = document.documentElement;
  buildPosters();
  const stage = createStage(app);

  // ---- in-page "Begin" style links: [data-scroll-to="<chapterId>"] ----
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest<HTMLElement>('[data-scroll-to]');
    if (!a) return;
    const i = indexOf(a.dataset.scrollTo ?? '');
    if (i < 0) return;
    e.preventDefault();
    app.scrollToChapter(i);
    // Move keyboard focus with the reader, without a second jump.
    // Wait (briefly) until the heading's stage layer is on stage: focusing an off-stage pin would make the
    // focusin handler jump there instantly and cut the glide short.
    const heading = document.querySelector<HTMLElement>(`#t-${CHAPTERS[i].id}`);
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      const started = performance.now();
      const tryFocus = () => {
        const pin = heading.closest<HTMLElement>('.chapter__pin');
        const onStage = !pin || getComputedStyle(pin).position !== 'fixed' || pin.classList.contains('is-active');
        if (onStage) heading.focus({ preventScroll: true });
        else if (performance.now() - started < 4000) window.setTimeout(tryFocus, 120);
      };
      tryFocus();
    }
  });

  if (app.reducedMotion) {
    // Final states only: no Lenis, no splitting, no scrub. main.ts already provides native scrollToChapter.
    return;
  }
  const stageOf = new Map(stage.items.map((it) => [it.section, it]));

  gsap.registerPlugin(ScrollTrigger);
  gsap.defaults({ ease: 'power3.out', duration: 0.9 });

  // ---- Lenis: the one smooth-scroll engine ----
  try {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 0.9, syncTouch: false });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis?.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  } catch (err) {
    console.error('[reveal] Lenis failed, using native scroll', err);
    lenis = null;
  }

  if (lenis) {
    const l = lenis;
    app.scrollToChapter = (index, opts) => {
      const target = app.conductor.yFor(index, 0.02);
      const dist = Math.abs(target - window.scrollY) / Math.max(1, window.innerHeight);
      l.scrollTo(target, {
        immediate: Boolean(opts?.instant),
        duration: Math.min(2.4, 0.9 + dist * 0.18),
        easing: (t: number) => 1 - Math.pow(1 - t, 4),
        force: true,
      });
    };
    // Scrolling stops under full-screen overlays and resumes when they close.
    const open = new Set<string>();
    bus.on('overlay', ({ name, open: isOpen }) => {
      if (isOpen) open.add(name);
      else open.delete(name);
      if (open.size) l.stop();
      else l.start();
    });
  }
  app.conductor.measure();
  stage.measure();

  // ---- chapter beats ----
  const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-chapter]'));
  for (const section of sections) {
    const tl = chapterTimeline(section);
    const id = section.dataset.chapter;
    if (id === 'prologue') {
      // The hero plays once the loader hands off (or soon after load if no loader reports in).
      let played = false;
      const play = () => {
        if (played) return;
        played = true;
        gsap.delayedCall(0.15, () => tl.play());
      };
      window.addEventListener('loader:done', play, { once: true });
      window.setTimeout(play, 2600);
    } else if (stageOf.has(section)) {
      // Plays the first time the chapter's reading block comes on stage.
      const it = stageOf.get(section)!;
      if (it.v > 0.25) tl.progress(1);
      else it.onShow = () => tl.play();
    } else {
      ScrollTrigger.create({ trigger: section, start: 'top 62%', once: true, onEnter: () => tl.play() });
    }
    // Keyboard users who tab ahead never land on hidden copy.
    section.addEventListener('focusin', () => tl.progress(1), { once: true });

    for (const aside of Array.from(section.querySelectorAll<HTMLElement>('.chapter__aside:not(.chapter__aside--stage) [data-beat="aside"]'))) {
      gsap.from(aside, {
        autoAlpha: 0,
        y: 18,
        duration: 1.1,
        scrollTrigger: { trigger: aside, start: 'top 78%', once: true },
      });
    }
  }

  // ---- the Loop manifesto: scroll-scrubbed word reveal ----
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-scrub]'))) {
    const words = splitScrub(el);
    const section = el.closest<HTMLElement>('[data-chapter]') ?? el;
    const n = words.length;
    const overlap = 2.2; // each word fades across ~2 word-slots so neighbours overlap
    const apply = (p: number) => {
      const head = p * (n + overlap);
      for (let i = 0; i < n; i++) {
        const v = Math.min(1, Math.max(0, (head - i) / overlap));
        words[i].style.setProperty('--p', v.toFixed(3));
      }
    };
    apply(0);
    const proxy = { p: 0 };
    gsap.to(proxy, {
      p: 1,
      ease: 'none',
      onUpdate: () => apply(proxy.p),
      // The manifesto sits on the fixed stage; pace it across the first ~70% of a viewport of its chapter.
      scrollTrigger: { trigger: section, start: 'top top', end: () => `+=${Math.round(window.innerHeight * 0.75)}`, scrub: 1, invalidateOnRefresh: true },
    });
    // Reaching the text by keyboard or find-in-page shows it in full.
    el.closest('.chapter__copy')?.addEventListener('focusin', () => apply(1));
  }

  // ---- re-measure after fonts, load and Lenis init ----
  const remeasure = () => {
    app.conductor.measure();
    ScrollTrigger.refresh();
    stage.measure();
  };
  document.fonts?.ready.then(remeasure).catch(() => {});
  window.addEventListener('load', remeasure, { once: true });
  requestAnimationFrame(remeasure);
  root.classList.add('motion-ready');
}
