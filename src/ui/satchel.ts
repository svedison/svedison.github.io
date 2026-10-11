// The Satchel (SPEC §4.2): a drawer of found keepsakes and silhouettes of missing ones, with hints.
// build-game-inventory: the drawer is a pure view of game state (one serializable truth); it never
// keeps its own copy of what was found. Pickup feedback: an ember flies from where the keepsake was
// to the HUD satchel button, then the counter pulses (skipped under reduced motion).
import '../styles/game.css';
import type { App } from '../app';
import { bus, type BusEvents } from '../bus';
import { KEEPSAKES } from '../content/keepsakes';
import { CHAPTERS, STATIONS } from '../content/story';
import { SATCHEL_COPY } from '../content/ui';
import { hotspotRect } from './hotspots';
import { glyph } from './glyphs';

type OverlayName = BusEvents['overlay']['name'];

// ---------------------------------------------------------------------------------------------
// Shared modal plumbing (used by the satchel and the atlas)
// ---------------------------------------------------------------------------------------------

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openModal: { name: OverlayName; close: () => void } | null = null;

/** The layer every game overlay is mounted into (re-attached if a sibling module rebuilt #ui-root). */
export function gameLayer(): HTMLElement {
  let layer = document.getElementById('game-ui');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'game-ui';
  }
  if (!layer.isConnected) (document.getElementById('ui-root') ?? document.body).appendChild(layer);
  return layer;
}

export interface Modal {
  readonly isOpen: boolean;
  open(): void;
  close(opts?: { restoreFocus?: boolean }): void;
  toggle(): void;
}

/**
 * Dialog semantics + focus management for a full-screen overlay:
 * role=dialog / aria-modal, focus moves in and is trapped, Esc closes, focus returns to the opener,
 * the story behind is inert, one overlay at a time, and bus 'overlay' is emitted on open/close.
 */
export function createModal(opts: {
  name: OverlayName;
  root: HTMLElement;
  initialFocus: () => HTMLElement | null;
  onOpen?: () => void;
  onClose?: () => void;
}): Modal {
  const { name, root } = opts;
  let isOpen = false;
  let returnTo: HTMLElement | null = null;
  let storyWasInert = false;

  const onKey = (e: KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      modal.close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  };

  // The page must not scroll underneath a modal (the world reads scrollY).
  const onWheel = (e: WheelEvent) => {
    const scroller = (e.target as HTMLElement).closest?.('[data-scroll]') as HTMLElement | null;
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) return;
    e.preventDefault();
  };
  const onTouchMove = (e: TouchEvent) => {
    const scroller = (e.target as HTMLElement).closest?.('[data-scroll]') as HTMLElement | null;
    if (scroller && (scroller.scrollHeight > scroller.clientHeight + 1 || scroller.scrollWidth > scroller.clientWidth + 1)) return;
    e.preventDefault();
  };
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('touchmove', onTouchMove, { passive: false });

  const syncOpeners = () => {
    document.querySelectorAll<HTMLElement>(`[data-open="${name}"]`).forEach((el) => el.setAttribute('aria-expanded', String(isOpen)));
  };

  const modal: Modal = {
    get isOpen() {
      return isOpen;
    },
    open() {
      if (isOpen) return;
      if (openModal && openModal.name !== name) openModal.close();
      gameLayer();
      isOpen = true;
      openModal = { name, close: () => modal.close({ restoreFocus: false }) };
      returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const story = document.getElementById('story');
      if (story) {
        storyWasInert = story.inert;
        story.inert = true;
      }
      root.hidden = false;
      root.classList.remove('is-closing');
      // next frame so the open transition runs from the closed state
      requestAnimationFrame(() => root.classList.add('is-open'));
      document.addEventListener('keydown', onKey, true);
      syncOpeners();
      opts.onOpen?.();
      bus.emit('overlay', { name, open: true });
      (opts.initialFocus() ?? root).focus({ preventScroll: true });
    },
    close(o) {
      if (!isOpen) return;
      isOpen = false;
      if (openModal?.name === name) openModal = null;
      const story = document.getElementById('story');
      if (story) story.inert = storyWasInert;
      root.classList.remove('is-open');
      root.classList.add('is-closing');
      const done = () => {
        if (!isOpen) {
          root.hidden = true;
          root.classList.remove('is-closing');
        }
      };
      const reduce = document.documentElement.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) done();
      else window.setTimeout(done, 320);
      document.removeEventListener('keydown', onKey, true);
      syncOpeners();
      opts.onClose?.();
      bus.emit('overlay', { name, open: false });
      if (o?.restoreFocus !== false && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
      returnTo = null;
    },
    toggle() {
      if (isOpen) modal.close();
      else modal.open();
    },
  };

  // Openers: any [data-open="<name>"] element and window CustomEvent('ui:open', { detail: { name } }).
  // ui/hud.ts delegates every [data-open] click to 'ui:open' and prevents default; only act when it did not.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const el = (e.target as HTMLElement | null)?.closest?.(`[data-open="${name}"]`);
    if (!el) return;
    e.preventDefault();
    modal.open();
  });
  window.addEventListener('ui:open', (e) => {
    if ((e as CustomEvent<{ name?: string }>).detail?.name === name) modal.open();
  });
  window.addEventListener('ui:close', (e) => {
    const n = (e as CustomEvent<{ name?: string }>).detail?.name;
    if (!n || n === 'all' || n === name) modal.close();
  });
  // Another overlay (owned by another module) opened: step aside.
  bus.on('overlay', (p) => {
    if (p.open && p.name !== name && isOpen) modal.close({ restoreFocus: false });
  });

  return modal;
}

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------------------------
// Satchel
// ---------------------------------------------------------------------------------------------

function stationLabel(chapterId: string) {
  const ch = CHAPTERS.find((c) => c.id === chapterId);
  const st = STATIONS.find((s) => s.id === ch?.station);
  if (!ch || !st) return '';
  if (ch.id === 'workshop') return SATCHEL_COPY.workshop;
  if (st.id === 'pacific') return SATCHEL_COPY.crossing;
  return st.cjk ? `${st.label} · ${st.cjk}` : st.label;
}

let lastPointer = { x: -1, y: -1, t: 0 };

export function init(app: App): void {
  const root = document.createElement('div');
  root.className = 'satchel';
  root.hidden = true;
  root.innerHTML = `
    <div class="satchel__scrim" data-close></div>
    <section class="satchel__panel" role="dialog" aria-modal="true" aria-labelledby="satchel-title" tabindex="-1">
      <header class="satchel__head">
        <div>
          <h2 id="satchel-title" class="satchel__title">${SATCHEL_COPY.title}</h2>
          <p class="satchel__count" aria-live="off"><span data-n>0</span> <span class="satchel__of">${SATCHEL_COPY.of(KEEPSAKES.length)}</span></p>
        </div>
        <button type="button" class="game-close" data-close aria-label="${SATCHEL_COPY.close}"><span aria-hidden="true">×</span></button>
      </header>
      <ol class="satchel__list" data-scroll></ol>
      <footer class="satchel__foot">
        <div class="satchel__reset" data-step="idle">
          <button type="button" class="game-link" data-reset>${SATCHEL_COPY.reset}</button>
          <p class="satchel__confirm" role="group" aria-labelledby="satchel-confirm-q">
            <span id="satchel-confirm-q">${SATCHEL_COPY.confirm}</span>
            <span class="satchel__confirm-actions">
              <button type="button" class="game-btn" data-reset-yes>${SATCHEL_COPY.yes}</button>
              <button type="button" class="game-link" data-reset-no>${SATCHEL_COPY.keep}</button>
            </span>
          </p>
        </div>
      </footer>
    </section>`;
  gameLayer().appendChild(root);

  const list = root.querySelector<HTMLOListElement>('.satchel__list')!;
  const nEl = root.querySelector<HTMLElement>('[data-n]')!;
  const reset = root.querySelector<HTMLElement>('.satchel__reset')!;
  const panel = root.querySelector<HTMLElement>('.satchel__panel')!;

  function renderList() {
    const s = app.game.get();
    nEl.textContent = String(s.keepsakes.length);
    let lastGroup = '';
    list.innerHTML = KEEPSAKES.map((k) => {
      const found = s.keepsakes.includes(k.id);
      const group = stationLabel(k.chapter);
      const head = group !== lastGroup ? `<li class="satchel__group" aria-hidden="true">${esc(group)}</li>` : '';
      lastGroup = group;
      const idx = CHAPTERS.findIndex((c) => c.id === k.chapter);
      return `${head}<li class="sitem ${found ? 'is-found' : 'is-missing'}">
        <span class="sitem__mark" aria-hidden="true">${glyph(k.id, 'sitem__glyph')}</span>
        <div class="sitem__body">
          ${
            found
              ? `<h3 class="sitem__title"><span class="sr-only">${esc(group)}: </span>${esc(k.title)}</h3><p class="sitem__story">${esc(k.story)}</p>`
              : `<h3 class="sitem__title sitem__title--missing"><span class="sr-only">${SATCHEL_COPY.notFound}, ${esc(group)}: </span><span aria-hidden="true">${SATCHEL_COPY.notFound}</span></h3>
                 <p class="sitem__hint">${esc(k.hint)}</p>
                 <button type="button" class="game-link sitem__go" data-go="${idx}">${SATCHEL_COPY.goThere}<span class="sr-only"> (${esc(group)})</span></button>`
          }
        </div>
      </li>`;
    }).join('');
  }

  const modal = createModal({
    name: 'satchel',
    root,
    initialFocus: () => panel,
    onOpen: () => {
      renderList();
      list.scrollTop = 0;
      reset.dataset.step = 'idle';
    },
  });

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) return modal.close();
    if (t.closest('[data-reset]')) {
      reset.dataset.step = 'confirm';
      root.querySelector<HTMLElement>('[data-reset-no]')!.focus();
      return;
    }
    if (t.closest('[data-reset-no]')) {
      reset.dataset.step = 'idle';
      root.querySelector<HTMLElement>('[data-reset]')!.focus();
      return;
    }
    if (t.closest('[data-reset-yes]')) {
      app.game.reset();
      reset.dataset.step = 'idle';
      root.querySelector<HTMLElement>('[data-reset]')!.focus();
      return;
    }
    const go = t.closest<HTMLElement>('[data-go]');
    if (go) {
      modal.close({ restoreFocus: false });
      bus.emit('travel:to', { id: CHAPTERS[Number(go.dataset.go)].id });
    }
  });

  app.game.subscribe((_s, ev) => {
    if ((ev.type === 'keepsake' || ev.type === 'reset') && modal.isOpen) renderList();
  });

  // Where did the pickup happen? A recent pointer press (3D hotspot) or the DOM mirror button.
  window.addEventListener(
    'pointerdown',
    (e) => {
      lastPointer = { x: e.clientX, y: e.clientY, t: performance.now() };
    },
    { passive: true, capture: true },
  );

  bus.on('keepsake:collected', ({ id }) => {
    const target = satchelTarget();
    if (app.reducedMotion) {
      pulse(target, true);
      return;
    }
    let from: { x: number; y: number };
    if (performance.now() - lastPointer.t < 900 && lastPointer.x >= 0) from = { x: lastPointer.x, y: lastPointer.y };
    else {
      const r = hotspotRect(id);
      from = r ? { x: r.left + 22, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight * 0.55 };
    }
    flyEmber(from, target);
  });
}

function satchelTarget(): { x: number; y: number } {
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-open="satchel"]'));
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: innerWidth - 56, y: 30 };
}

function flyEmber(from: { x: number; y: number }, to: { x: number; y: number }) {
  const layer = gameLayer();
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Arc: control point lifted above the straighter line, so the ember rises like heat before it lands.
  const cx = from.x + dx * 0.35;
  const cy = Math.max(16, Math.min(from.y, to.y) - Math.max(80, Math.abs(dx) * 0.18));
  const ease = (t: number) => 1 - Math.pow(1 - t, 2.2);
  const frames = (lag: number): Keyframe[] => {
    const out: Keyframe[] = [];
    for (let i = 0; i <= 14; i++) {
      const u = i / 14;
      const t = ease(Math.max(0, u - lag) / (1 - lag));
      const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * cx + t * t * to.x;
      const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * cy + t * t * to.y;
      const s = 1 - 0.55 * t;
      out.push({ transform: `translate(${x}px, ${y}px) scale(${s})`, opacity: u < 0.08 ? u / 0.08 : 1 - 0.3 * t, offset: u });
    }
    return out;
  };
  const make = (cls: string, lag: number, dur: number) => {
    const el = document.createElement('span');
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    layer.appendChild(el);
    const anim = el.animate(frames(lag), { duration: dur, easing: 'linear', fill: 'forwards' });
    return { el, anim };
  };
  const tail = make('ember-fly ember-fly--tail', 0.1, 760);
  const head = make('ember-fly', 0, 700);
  head.anim.finished
    .then(() => {
      pulse(to, false);
    })
    .catch(() => {})
    .finally(() => head.el.remove());
  tail.anim.finished.catch(() => {}).finally(() => tail.el.remove());
}

function pulse(at: { x: number; y: number }, reduced: boolean) {
  const ring = document.createElement('span');
  ring.className = 'ember-ring';
  ring.setAttribute('aria-hidden', 'true');
  ring.style.left = `${at.x}px`;
  ring.style.top = `${at.y}px`;
  gameLayer().appendChild(ring);
  const kf: Keyframe[] = reduced
    ? [{ opacity: 0.9 }, { opacity: 0 }]
    : [
        { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0.95 },
        { transform: 'translate(-50%, -50%) scale(1.9)', opacity: 0 },
      ];
  const a = ring.animate(kf, { duration: reduced ? 900 : 560, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
  a.finished.catch(() => {}).finally(() => ring.remove());
  document.querySelectorAll<HTMLElement>('[data-open="satchel"]').forEach((el) => {
    el.classList.remove('is-pulse');
    void el.offsetWidth;
    el.classList.add('is-pulse');
    window.setTimeout(() => el.classList.remove('is-pulse'), 700);
  });
}
