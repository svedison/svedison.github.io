// DOM mirrors for every keepsake (SPEC §4.1, §11). One real <button> per keepsake, in document order,
// inside its chapter's [data-slot="hotspots"]. They are the keyboard / screen-reader path to every 3D
// hotspot and the whole game when WebGL is off. Hidden keepsakes stay in the DOM and the tab order but
// are drawn as a faint glint, so they remain a discovery.
//
// Truth lives in game state (build-game-inventory): buttons only request a pickup through the bus and
// reflect `found` from the committed state. A duplicate click is harmless (game.collect rejects it).
import '../styles/game.css';
import type { App } from '../app';
import { bus } from '../bus';
import { KEEPSAKES, type KeepsakeDef } from '../content/keepsakes';
import { CHAPTERS, MOON_POEM } from '../content/story';
import { HOTSPOT_COPY } from '../content/ui';
import { glyph } from './glyphs';

const buttons = new Map<string, HTMLButtonElement>();
/** Every mirror by its 3D hotspot id (keepsake ids + 'moon'), for the dormant state. */
const mirrors = new Map<string, HTMLButtonElement>();

// The world reports when a keepsake's 3D object is in frame and raycastable ('keepsake:inrange'); its mirror
// answers with a quiet lantern edge, so the row says which pickup the camera is looking at.
const LOCAL_CSS = `
.keep.is-near:not(.is-found)::after {
  background:
    linear-gradient(rgba(242, 169, 59, 0.8), rgba(242, 169, 59, 0.8)) top / 100% 1px no-repeat,
    linear-gradient(rgba(242, 169, 59, 0.8), rgba(242, 169, 59, 0.8)) bottom / 100% 1px no-repeat;
}
.keep.is-near:not(.is-found) .keep__mark { color: var(--lantern); }
.keep--hidden.is-near:not(.is-found) .keep__mark { opacity: 0.6; }
.keep--egg { font-style: normal; }
/* Dormant: the 3D object is outside its window (e.g. no moon at dawn). Still a real, focusable button. */
.keep.is-dormant:not(.is-found) { opacity: 0.55; }
.keep.is-dormant:not(.is-found) .keep__mark { border-inline-end-style: dotted; }
.keep.is-dormant:not(.is-found):hover,
.keep.is-dormant:not(.is-found):focus-visible { opacity: 0.85; }
/* Phones: a short row (three mirrors or fewer) wraps instead of scrolling sideways, so no chip is ever cut at the
   screen edge; the hint may break onto a second line inside its tag. Longer rows keep the sideways scroller, with
   an edge fade only on a side that has more past it (data-more-*, set below). */
@media (max-width: 760px) {
  .chapter:not(.chapter--workshop) .slot--hotspots.keeps:has(> .keep + .keep):not(:has(> .keep ~ .keep ~ .keep ~ .keep)) {
    flex-wrap: wrap;
    overflow: visible;
    gap: 6px 8px;
    padding: 4px 0;
    margin-inline: 0;
    -webkit-mask-image: none;
    mask-image: none;
  }
  .chapter:not(.chapter--workshop) .keeps:has(> .keep + .keep):not(:has(> .keep ~ .keep ~ .keep ~ .keep)) > .keep {
    flex: 0 1 auto;
    min-inline-size: 0;
    max-inline-size: 100%;
    white-space: normal;
  }
  .chapter:not(.chapter--workshop) .slot--hotspots.keeps:has(> .keep ~ .keep ~ .keep ~ .keep) {
    --fade-l: 0px;
    --fade-r: 0px;
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent);
    mask-image: linear-gradient(90deg, transparent, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent);
  }
  .chapter:not(.chapter--workshop) .slot--hotspots.keeps[data-more-left]:has(> .keep ~ .keep ~ .keep ~ .keep) { --fade-l: 40px; }
  .chapter:not(.chapter--workshop) .slot--hotspots.keeps[data-more-right]:has(> .keep ~ .keep ~ .keep ~ .keep) { --fade-r: 48px; }
}
`;

/** A sideways-scrolling row marks which edge has more chips past it, so the CSS fade is a true scroll cue. */
function watchEdges(slot: HTMLElement) {
  let raf = 0;
  const sync = () => {
    raf = 0;
    const max = slot.scrollWidth - slot.clientWidth;
    slot.toggleAttribute('data-more-left', max > 2 && slot.scrollLeft > 2);
    slot.toggleAttribute('data-more-right', max > 2 && slot.scrollLeft < max - 2);
  };
  const queue = () => {
    if (!raf) raf = requestAnimationFrame(sync);
  };
  slot.addEventListener('scroll', queue, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(queue).observe(slot);
  else window.addEventListener('resize', queue, { passive: true });
  queue();
}
function injectCss() {
  if (document.getElementById('hotspots-css')) return;
  const st = document.createElement('style');
  st.id = 'hotspots-css';
  st.textContent = LOCAL_CSS;
  document.head.appendChild(st);
}

function slotFor(section: HTMLElement): HTMLElement {
  let slot = section.querySelector<HTMLElement>('[data-slot="hotspots"]');
  if (!slot) {
    slot = document.createElement('div');
    slot.dataset.slot = 'hotspots';
    section.appendChild(slot);
  }
  slot.classList.add('keeps');
  return slot;
}

function render(btn: HTMLButtonElement, k: KeepsakeDef, found: boolean) {
  btn.setAttribute('aria-pressed', String(found));
  btn.classList.toggle('is-found', found);
  const text = btn.querySelector<HTMLElement>('.keep__text')!;
  const sr = btn.querySelector<HTMLElement>('.keep__sr')!;
  if (k.hidden && !found) {
    text.textContent = '';
    sr.textContent = HOTSPOT_COPY.hidden(k.hint);
  } else {
    text.textContent = found ? k.title : k.hint;
    sr.textContent = found ? HOTSPOT_COPY.found : HOTSPOT_COPY.open;
  }
  // The CSO lantern keeps working after pickup: every press sends one more lantern up (SPEC §4.5 #6).
  btn.title = found
    ? k.id === 'red-lantern'
      ? HOTSPOT_COPY.releaseLantern(k.title)
      : HOTSPOT_COPY.inSatchel(k.title)
    : k.hidden
      ? HOTSPOT_COPY.somethingHidden
      : HOTSPOT_COPY.pickUp;
}

export function init(app: App): void {
  injectCss();
  for (const ch of CHAPTERS) {
    const list = KEEPSAKES.filter((k) => k.chapter === ch.id);
    if (!list.length) continue;
    const section = document.querySelector<HTMLElement>(`[data-chapter="${ch.id}"]`);
    if (!section) continue;
    const slot = slotFor(section);
    if (!slot.hasAttribute('aria-label')) slot.setAttribute('aria-label', HOTSPOT_COPY.group);
    slot.setAttribute('role', 'group');
    // Visible keepsakes first, hidden glints last (they sit quietly at the end of the row).
    const ordered = [...list.filter((k) => !k.hidden), ...list.filter((k) => k.hidden)];
    for (const k of ordered) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = k.hidden ? 'keep keep--hidden' : 'keep';
      btn.dataset.keepsake = k.id;
      btn.innerHTML =
        `<span class="keep__mark" aria-hidden="true">${glyph(k.id, 'keep__glyph')}</span>` + '<span class="keep__sr sr-only"></span><span class="keep__text"></span><span class="keep__state sr-only"></span>';
      btn.addEventListener('click', () => bus.emit('keepsake:activate', { id: k.id }));
      // Hover / focus parity with the 3D raycast: the world warms the object's light (SPEC §4.1).
      const warm = (on: boolean) => () => bus.emit('keepsake:focus', { id: k.id, on });
      btn.addEventListener('pointerenter', warm(true));
      btn.addEventListener('pointerleave', () => {
        if (document.activeElement !== btn) warm(false)();
      });
      btn.addEventListener('focus', warm(true));
      btn.addEventListener('blur', () => {
        if (!btn.matches(':hover')) warm(false)();
      });
      slot.appendChild(btn);
      buttons.set(k.id, btn);
      mirrors.set(k.id, btn);
      render(btn, k, app.game.hasKeepsake(k.id));
    }
  }

  addMoonMirror();
  document.querySelectorAll<HTMLElement>('.chapter:not(.chapter--workshop) .keeps').forEach(watchEdges);

  bus.on('keepsake:inrange', ({ id, on }) => buttons.get(id)?.classList.toggle('is-near', on));

  // The world's hotspot windows (engine.ts): a mirror whose 3D object is out of its window is drawn dormant,
  // with an honest label, but stays in the tab order and still works (it is the keyboard path).
  bus.on('hotspots:state', ({ live, known, on }) => {
    mirrors.forEach((btn, id) => {
      const dormant = live && known.includes(id) && !on.includes(id);
      if (btn.classList.contains('is-dormant') === dormant) return;
      btn.classList.toggle('is-dormant', dormant);
      const st = btn.querySelector<HTMLElement>('.keep__state');
      if (st) st.textContent = dormant ? `, ${id === 'moon' ? HOTSPOT_COPY.moonDormant : HOTSPOT_COPY.dormant}` : '';
    });
  });

  app.game.subscribe((state, ev) => {
    if (ev.type !== 'keepsake' && ev.type !== 'reset') return;
    for (const k of KEEPSAKES) {
      const btn = buttons.get(k.id);
      if (btn) render(btn, k, state.keepsakes.includes(k.id));
    }
  });
}

/**
 * The moon (SPEC §4.5 #1) is a 3D hotspot in the crossing; this is its DOM mirror, after the keepsakes in
 * document order, so keyboard, screen-reader and no-WebGL visitors can find the poem too. eggs.ts opens it.
 */
function addMoonMirror() {
  const section = document.querySelector<HTMLElement>('[data-chapter="crossing"]');
  if (!section || section.querySelector('[data-egg="moon"]')) return;
  const slot = slotFor(section);
  slot.setAttribute('role', 'group');
  if (!slot.hasAttribute('aria-label')) slot.setAttribute('aria-label', HOTSPOT_COPY.group);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'keep keep--egg';
  btn.dataset.egg = 'moon';
  btn.title = MOON_POEM.hint;
  btn.innerHTML = `<span class="keep__mark" aria-hidden="true">${glyph('moon', 'keep__glyph')}</span><span class="keep__text">${MOON_POEM.label}</span><span class="keep__state sr-only"></span>`;
  btn.addEventListener('click', () => bus.emit('moon:click', {}));
  slot.appendChild(btn);
  mirrors.set('moon', btn);
}

/** Screen position of a keepsake's DOM mirror, if it is on screen (used by the satchel's ember flight). */
export function hotspotRect(id: string): DOMRect | null {
  const btn = buttons.get(id);
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) return null;
  return r;
}
