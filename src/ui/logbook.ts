// Logbook overlay (recruiter path, SPEC §6.1) + Workshop inspect caption panel (SPEC §6).
// Opens from: [data-open="logbook"] clicks, the L key (via hud.ts -> ui:open), window CustomEvent('ui:open', {detail:{name:'logbook'}}), #logbook.
// Inspect: listens to bus 'inspect:open' / 'inspect:close'; renders a caption beside the lifted artifact and a DOM
// fallback shelf (buttons) in the Workshop chapter so the résumé is never WebGL- or hover-only.
import '../styles/logbook.css';
import '../styles/logbook-overlay.css';
import type { App } from '../app';
import { bus } from '../bus';
import { RESUME, type ArtifactId, type ResumeEntry } from '../content/resume';
import { CHAPTERS } from '../content/story';
import { renderLogbook } from '../render/static';
import { LOGBOOK_COPY } from '../content/ui';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const figures = (s: string) => esc(s).replace(/\d[\d.,]*[MK]?(?:\+|%)/g, (m) => `<strong>${m}</strong>`);

function visibleFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hidden && el.getClientRects().length > 0 && !el.closest('[hidden], [inert]'),
  );
}

/**
 * Rail behaviour shared by /logbook/ and the overlay: scroll-spy (aria-current on the index rail) and,
 * inside a scroller, in-place anchor navigation that moves focus to the section heading.
 */
export function enhanceLogbook(root: HTMLElement, scroller: HTMLElement | null): () => void {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[data-lb-link]'));
  const sections = links
    .map((a) => root.querySelector<HTMLElement>(`#lb-${a.dataset.lbLink}`))
    .filter((s): s is HTMLElement => Boolean(s));
  const setCurrent = (key: string) =>
    links.forEach((a) => (a.dataset.lbLink === key ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
  setCurrent(links[0]?.dataset.lbLink ?? '');

  const visible = new Map<string, number>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) visible.set(e.target.id.replace(/^lb-/, ''), e.isIntersecting ? e.intersectionRatio : 0);
      // Prefer the first section (in document order) that is meaningfully on screen.
      // At the very top of a two-page spread both pages are in view: the book opens on its first section.
      const top = scroller ? scroller.scrollTop : window.scrollY;
      if (top < 80) return setCurrent(links[0]?.dataset.lbLink ?? '');
      const order = sections.map((s) => s.id.replace(/^lb-/, ''));
      const hit = order.find((k) => (visible.get(k) ?? 0) > 0);
      if (hit) setCurrent(hit);
    },
    { root: scroller, rootMargin: '-15% 0px -55% 0px', threshold: [0, 0.01, 0.25] },
  );
  sections.forEach((s) => io.observe(s));

  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-lb-link]');
    if (!a) return;
    const target = root.querySelector<HTMLElement>(`#lb-${a.dataset.lbLink}`);
    if (!target) return;
    e.preventDefault();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    target.querySelector<HTMLElement>('.lb-section__title')?.focus({ preventScroll: true });
    setCurrent(a.dataset.lbLink ?? '');
    if (!scroller) history.replaceState(null, '', `#lb-${a.dataset.lbLink}`);
  };
  root.addEventListener('click', onClick);

  // Narrow widths: the index is one scrolling row of tabs; an edge fades only on a side with more tabs past it
  // (logbook.css keys the mask off data-more-left / data-more-right), so no tab is ever hard-clipped.
  const rail = root.querySelector<HTMLElement>('.lb-rail__list');
  let edgeRaf = 0;
  const syncEdges = () => {
    edgeRaf = 0;
    if (!rail) return;
    const max = rail.scrollWidth - rail.clientWidth;
    rail.toggleAttribute('data-more-left', max > 2 && rail.scrollLeft > 2);
    rail.toggleAttribute('data-more-right', max > 2 && rail.scrollLeft < max - 2);
  };
  const queueEdges = () => {
    if (!edgeRaf) edgeRaf = requestAnimationFrame(syncEdges);
  };
  rail?.addEventListener('scroll', queueEdges, { passive: true });
  const ro = rail && typeof ResizeObserver === 'function' ? new ResizeObserver(queueEdges) : null;
  if (rail) ro?.observe(rail);
  queueEdges();
  return () => {
    io.disconnect();
    ro?.disconnect();
    cancelAnimationFrame(edgeRaf);
    rail?.removeEventListener('scroll', queueEdges);
    root.removeEventListener('click', onClick);
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Logbook overlay
// ---------------------------------------------------------------------------------------------------------------

interface Overlay {
  open(opts?: { target?: string }): void;
  close(): void;
  isOpen(): boolean;
}

function createOverlay(app: App): Overlay {
  const el = document.createElement('div');
  el.className = 'lb-overlay';
  el.id = 'logbook-dialog';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'lb-title');
  el.hidden = true;
  el.innerHTML = `<div class="lb-overlay__scroll" data-lb-scroll>
  <div class="lb-overlay__bar">
    <p class="lb-overlay__label"><span class="lb-overlay__mark" aria-hidden="true"></span>${LOGBOOK_COPY.title}</p>
    <a class="lb-overlay__page" href="${import.meta.env.BASE_URL}logbook/">${LOGBOOK_COPY.openPage}</a>
    <button type="button" class="lb-overlay__close" data-lb-close><span>${LOGBOOK_COPY.close}</span><kbd aria-hidden="true">Esc</kbd></button>
  </div>
  ${renderLogbook()}
</div>`;
  document.body.appendChild(el);

  const scroller = el.querySelector<HTMLElement>('[data-lb-scroll]')!;
  const book = el.querySelector<HTMLElement>('[data-logbook]')!;
  const title = el.querySelector<HTMLElement>('#lb-title');
  let stopEnhance: (() => void) | null = null;
  let open = false;
  let returnFocus: HTMLElement | null = null;
  let inerted: HTMLElement[] = [];
  let hideTimer = 0;

  const close = () => {
    if (!open) return;
    open = false;
    el.classList.remove('is-open');
    document.documentElement.classList.remove('lb-open');
    inerted.forEach((n) => n.removeAttribute('inert'));
    inerted = [];
    stopEnhance?.();
    stopEnhance = null;
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => (el.hidden = true), app.reducedMotion ? 0 : 360);
    if (location.hash === '#logbook') history.replaceState(null, '', location.pathname + location.search);
    bus.emit('overlay', { name: 'logbook', open: false });
    const back = returnFocus;
    returnFocus = null;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  };

  const openFn = (opts?: { target?: string }) => {
    if (!open) {
      open = true;
      window.clearTimeout(hideTimer);
      const active = document.activeElement as HTMLElement | null;
      returnFocus = active && active !== document.body ? active : null;
      el.hidden = false;
      // Make the page behind truly inert (focus + AT), and stop it scrolling.
      inerted = Array.from(document.body.children).filter(
        (n): n is HTMLElement => n instanceof HTMLElement && n !== el && !n.hasAttribute('inert') && n.tagName !== 'SCRIPT',
      );
      inerted.forEach((n) => n.setAttribute('inert', ''));
      document.documentElement.classList.add('lb-open');
      scroller.scrollTop = 0;
      stopEnhance = enhanceLogbook(book, scroller);
      // Next frame so the transition runs from the hidden state.
      requestAnimationFrame(() => el.classList.add('is-open'));
    }
    // Always report open (even if it already was): the HUD's openOverlay() relies on a synchronous answer.
    bus.emit('overlay', { name: 'logbook', open: true });
    const target = opts?.target ? el.querySelector<HTMLElement>(`#${CSS.escape(opts.target)}`) : null;
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: 'start' });
        const h = target.querySelector<HTMLElement>('h4, h3');
        if (h) {
          h.setAttribute('tabindex', '-1');
          h.focus({ preventScroll: true });
        }
      });
    } else {
      title?.focus({ preventScroll: true });
    }
  };

  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-lb-close]')) close();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = visibleFocusables(el);
    if (!f.length) return;
    const firstEl = f[0];
    const lastEl = f[f.length - 1];
    const cur = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (cur === firstEl || !el.contains(cur) || cur === title)) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && cur === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  });

  return { open: openFn, close, isOpen: () => open };
}

// ---------------------------------------------------------------------------------------------------------------
// Workshop inspect caption + DOM shelf fallback
// ---------------------------------------------------------------------------------------------------------------

const coarse = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
const HINT = coarse
  ? LOGBOOK_COPY.hintTouch
  : LOGBOOK_COPY.hintDesk;

/** Short scan line for the dolly's tag: org, then role · dates, straight from RESUME. */
function tagHtml(r: ResumeEntry): string {
  // the degree for education, the job title otherwise (e.g. 'Databricks ML Hackathon · Data Science & ML Contributor')
  const parts = r.role ? r.role.split(' · ') : [];
  const role = (r.kind === 'education' ? parts[0] : parts[parts.length - 1]) ?? '';
  const meta = [role, r.dates].filter(Boolean).map(esc).join(' · ');
  return `<span class="shelf-tag__org">${esc(r.org)}</span>${meta ? `<span class="shelf-tag__meta">${meta}</span>` : ''}`;
}

function captionHtml(r: ResumeEntry, index: number, total: number): string {
  const when = [r.dates, r.place].filter((s): s is string => Boolean(s)).map(esc).join(' · ');
  const bullets =
    r.kind === 'skills'
      ? `<dl class="inspect-card__skills">${r.bullets
          .map((b) => {
            const at = b.indexOf(': ');
            return at > 0 ? `<div><dt>${esc(b.slice(0, at))}</dt><dd>${esc(b.slice(at + 2))}</dd></div>` : `<div><dd>${esc(b)}</dd></div>`;
          })
          .join('')}</dl>`
      : `<ul class="inspect-card__bullets">${r.bullets.map((b) => `<li>${figures(b)}</li>`).join('')}</ul>`;
  return `<div class="inspect-card__inner">
  <p class="inspect-card__eyebrow"><span>${LOGBOOK_COPY.onShelf}</span><span>${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></p>
  <h2 class="inspect-card__title" id="inspect-card-title" tabindex="-1">${esc(r.artifact)}</h2>
  <p class="inspect-card__why">${esc(r.why)}</p>
  <div class="inspect-card__meta">
    <p class="inspect-card__org">${esc(r.org)}${r.status ? ` <span class="lb-pill">${esc(r.status)}</span>` : ''}</p>
    ${r.role ? `<p class="inspect-card__role">${esc(r.role)}</p>` : ''}
    ${when ? `<p class="inspect-card__when">${when}</p>` : ''}
  </div>
  ${bullets}
  <div class="inspect-card__foot">
    <p class="inspect-card__more" aria-hidden="true">${LOGBOOK_COPY.moreBelow}</p>
    <p class="inspect-card__hint" id="inspect-card-hint">${HINT}</p>
    <div class="inspect-card__actions">
      <button type="button" class="inspect-card__back" data-inspect-close>${LOGBOOK_COPY.putBack}</button>
      <button type="button" class="inspect-card__log" data-inspect-logbook>${LOGBOOK_COPY.readInLogbook}</button>
    </div>
  </div>
</div>`;
}

function createInspect(app: App, overlay: Overlay) {
  const card = document.createElement('aside');
  card.className = 'inspect-card';
  // A non-modal dialog: focus moves to its title when it opens (so it is announced), the page stays usable.
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'false');
  card.setAttribute('aria-labelledby', 'inspect-card-title');
  card.hidden = true;
  const uiRoot = document.getElementById('ui-root') ?? document.body;
  uiRoot.appendChild(card);

  // The dolly's tag: org · role · dates over the piece the camera is holding on (or the name of a hovered piece).
  // Visual only (aria-hidden): the shelf chips carry the same thing as aria-current for assistive tech.
  const tag = document.createElement('div');
  tag.className = 'shelf-tag';
  tag.setAttribute('aria-hidden', 'true');
  uiRoot.appendChild(tag);
  let tagKey = '';
  let tagW = 0,
    tagH = 0;

  let current: ArtifactId | null = null;
  let dwell: ArtifactId | null = null;
  let returnFocus: HTMLElement | null = null;
  let hideTimer = 0;
  let shelf: HTMLElement | null = null;
  const root = document.documentElement;

  const syncShelf = () =>
    shelf?.querySelectorAll<HTMLButtonElement>('button[data-artifact]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.artifact === current));
      if (b.dataset.artifact === dwell) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });

  const show = (id: ArtifactId) => {
    const i = RESUME.findIndex((r) => r.id === id);
    if (i < 0) return;
    if (current === id && !card.hidden) return; // re-announced by 'inspect:sync': nothing to redo
    const wasOpen = current !== null;
    if (!wasOpen) {
      const active = document.activeElement as HTMLElement | null;
      returnFocus = active && active !== document.body ? active : null;
    }
    current = id;
    window.clearTimeout(hideTimer);
    card.innerHTML = captionHtml(RESUME[i], i, RESUME.length);
    card.dataset.artifact = id;
    card.setAttribute('aria-describedby', 'inspect-card-hint');
    card.hidden = false;
    card.scrollTop = 0;
    requestAnimationFrame(() => {
      card.classList.add('is-open');
      syncMore();
    });
    card.querySelector<HTMLElement>('#inspect-card-title')?.focus({ preventScroll: true });
    root.classList.add('ws-inspecting');
    tag.classList.remove('is-on');
    syncShelf();
    if (!wasOpen) bus.emit('overlay', { name: 'inspect', open: true });
  };

  const hide = () => {
    if (current === null) return;
    current = null;
    card.classList.remove('is-open');
    root.classList.remove('ws-inspecting');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => (card.hidden = true), app.reducedMotion ? 0 : 320);
    syncShelf();
    bus.emit('overlay', { name: 'inspect', open: false });
    const back = returnFocus;
    returnFocus = null;
    if (back && document.contains(back) && card.contains(document.activeElement)) back.focus({ preventScroll: true });
    else if (card.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  };

  // Overflow cue: when the bullets run under the sticky footer (hint + buttons), a fade and a 'More below' mark say so.
  const syncMore = () => {
    if (card.hidden) return;
    card.classList.toggle('has-more', card.scrollHeight - card.clientHeight - card.scrollTop > 6);
  };
  card.addEventListener('scroll', syncMore, { passive: true });
  window.addEventListener('resize', syncMore, { passive: true });

  // SPEC 4.5 #7: the golden record sings when it is spun by hand. ui/audio.ts keeps its context private, so this is
  // a tiny self-contained voice: made lazily (the drag is a user gesture), only while sound is on; the world rate-
  // limits 'record:spin', and the context is suspended again once it has been quiet for a few seconds.
  let toneCtx: AudioContext | null = null;
  let toneIdle = 0;
  const NOTES = [196, 220, 246.94, 293.66, 329.63]; // G major pentatonic: faster spins ring higher
  bus.on('record:spin', ({ speed }) => {
    if (!app.game.get().sound || document.hidden) return;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      toneCtx ??= new Ctor({ latencyHint: 'interactive' });
      const c = toneCtx;
      if (c.state === 'suspended') void c.resume();
      const at = c.currentTime + 0.012;
      const f = NOTES[Math.min(NOTES.length - 1, Math.floor(speed * NOTES.length))];
      const out = c.createGain();
      out.gain.value = 0.045 + 0.035 * speed;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1600;
      out.connect(lp).connect(c.destination);
      for (const [mult, amp, dec] of [
        [1, 1, 1.7],
        [2.005, 0.26, 0.9],
        [3.01, 0.07, 0.45],
      ]) {
        const o = c.createOscillator();
        o.frequency.value = f * mult;
        o.detune.setValueAtTime(0, at);
        o.detune.linearRampToValueAtTime(-14, at + dec); // a hint of wow as the platter slows
        const g = c.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(amp, at + 0.035);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dec);
        o.connect(g).connect(out);
        o.start(at);
        o.stop(at + dec + 0.05);
      }
      window.clearTimeout(toneIdle);
      toneIdle = window.setTimeout(() => void toneCtx?.suspend(), 4000);
    } catch {
      /* audio is a nicety */
    }
  });

  /** Ask the world (and ourselves) to put the current artifact back. */
  const requestClose = () => {
    if (current) bus.emit('inspect:close', { id: current });
  };

  bus.on('inspect:open', ({ id }) => show(id));
  bus.on('inspect:close', () => hide());
  // The world module may load after a chip was pressed: when it arrives it asks, and we tell it again.
  bus.on('inspect:sync', () => {
    if (current) bus.emit('inspect:open', { id: current });
  });

  bus.on('shelf:focus', ({ id, x, y, hover }) => {
    if (!hover && id !== dwell) {
      dwell = id;
      syncShelf();
      // phones: the piece's one-line 'why' under the chips (visual only; the chip's name and the caption carry it)
      const why = shelf?.querySelector<HTMLElement>('.shelf-index__why');
      const wr = id ? RESUME.find((e) => e.id === id) : null;
      if (why && wr) why.textContent = wr.why;
      why?.classList.toggle('is-on', Boolean(wr));
      // phones: the chips are one scrolling row there; bring the current one into view (horizontally only)
      const list = shelf?.querySelector<HTMLElement>('.shelf-index__list');
      const b = id ? list?.querySelector<HTMLElement>(`button[data-artifact="${id}"]`) : null;
      if (list && b && list.scrollWidth > list.clientWidth + 2) {
        const lr = list.getBoundingClientRect(),
          br = b.getBoundingClientRect();
        const left = list.scrollLeft + br.left - lr.left - (lr.width - br.width) / 2;
        list.scrollTo({ left, behavior: app.reducedMotion ? 'auto' : 'smooth' });
      }
    }
    if (!id || current) {
      tag.classList.remove('is-on');
      return;
    }
    const r = RESUME.find((e) => e.id === id);
    if (!r) return;
    const key = `${id}:${hover}`;
    if (key !== tagKey) {
      tagKey = key;
      tag.innerHTML = hover
        ? `<span class="shelf-tag__org">${esc(r.artifact)}</span><span class="shelf-tag__meta">${esc(r.org)} · ${LOGBOOK_COPY.pickUp}</span>`
        : tagHtml(r);
      tag.classList.toggle('is-hover', hover);
      tagW = tag.offsetWidth; // measured once per new label, not per frame (no layout reads while scrolling)
      tagH = tag.offsetHeight;
    }
    // keep the tag on screen: it is centred on x and sits just above y
    const vw = window.innerWidth;
    const half = Math.min(tagW || 220, vw - 24) / 2;
    const cx = Math.min(vw - 12 - half, Math.max(12 + half, x));
    const cy = Math.max((tagH || 44) + 64, y);
    tag.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
    tag.classList.add('is-on');
  });

  card.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-inspect-close]')) requestClose();
    else if (t.closest('[data-inspect-logbook]')) {
      // Put the piece back (focus returns to its shelf button), then open the Logbook at its entry.
      const id = current;
      requestClose();
      overlay.open({ target: id ? `lb-entry-${id}` : undefined });
    }
  });

  // Phones: once the dolly starts along the shelf (t > 0.1) the chapter body folds away and the chips become one
  // scrolling row, so the piece gets the middle of the screen (logbook-overlay.css keys off .ws-shelf).
  const WS = CHAPTERS.findIndex((c) => c.id === 'workshop');
  let section: HTMLElement | null = null;
  let onShelf = false;
  bus.on('progress', (p) => {
    const on = p.index === WS && p.localExact > 0.1;
    if (on === onShelf) return;
    onShelf = on;
    section ??= document.querySelector<HTMLElement>('[data-chapter="workshop"]');
    section?.classList.toggle('ws-shelf', on);
  });

  // DOM shelf: one button per artifact, in the Workshop chapter (works without WebGL, hover or a pointer).
  const mountShelf = () => {
    if (shelf && document.contains(shelf)) return true;
    const sec = document.querySelector<HTMLElement>('[data-chapter="workshop"]');
    if (!sec) return false;
    const host = sec.querySelector<HTMLElement>('[data-slot="hotspots"]') ?? sec;
    shelf = document.createElement('div');
    shelf.className = 'shelf-index';
    shelf.setAttribute('role', 'group');
    shelf.setAttribute('aria-labelledby', 'shelf-index-h');
    // Compact chips labelled by org (the fast scan); the artifact name is in the accessible name and tooltip.
    // aria-current marks the piece the camera is holding on, so the chips double as a progress index.
    const short = (r: ResumeEntry) => (r.kind === 'skills' ? LOGBOOK_COPY.shortSkills : r.kind === 'education' ? LOGBOOK_COPY.shortEducation : r.org);
    shelf.innerHTML = `<p class="shelf-index__label" id="shelf-index-h">${LOGBOOK_COPY.onShelf}</p>
<ul class="shelf-index__list">${RESUME.map(
      (r) =>
        `<li><button type="button" data-artifact="${r.id}" aria-pressed="false" aria-label="${esc(r.artifact)}: ${esc(r.org)}" title="${esc(r.artifact)}">${esc(short(r))}</button></li>`,
    ).join('')}</ul>
<p class="shelf-index__why" aria-hidden="true"></p>`;
    host.appendChild(shelf);
    // phones: the chips are one scrolling row; an edge fades only on a side that has more chips past it
    // (logbook-overlay.css keys the mask off data-more-left / data-more-right)
    const list = shelf.querySelector<HTMLElement>('.shelf-index__list')!;
    let edgeRaf = 0;
    const syncEdges = () => {
      edgeRaf = 0;
      const max = list.scrollWidth - list.clientWidth;
      list.toggleAttribute('data-more-left', max > 2 && list.scrollLeft > 2);
      list.toggleAttribute('data-more-right', max > 2 && list.scrollLeft < max - 2);
    };
    const queueEdges = () => {
      if (!edgeRaf) edgeRaf = requestAnimationFrame(syncEdges);
    };
    list.addEventListener('scroll', queueEdges, { passive: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(queueEdges).observe(list);
    else window.addEventListener('resize', queueEdges, { passive: true });
    queueEdges();
    shelf.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-artifact]');
      if (!b) return;
      const id = b.dataset.artifact as ArtifactId;
      if (current === id) return requestClose();
      if (current) bus.emit('inspect:close', { id: current });
      bus.emit('inspect:open', { id });
      returnFocus = b; // Safari doesn't focus clicked buttons; always return here.
    });
    syncShelf();
    return true;
  };
  if (!mountShelf()) {
    // The story may be rendered after us; watch briefly for the Workshop section.
    const mo = new MutationObserver(() => mountShelf() && mo.disconnect());
    mo.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => mo.disconnect(), 15000);
  }

  return { isOpen: () => current !== null, requestClose };
}

// ---------------------------------------------------------------------------------------------------------------

export function init(app: App): void {
  const overlay = createOverlay(app);
  const inspect = createInspect(app, overlay);

  // Opening paths. Clicks are delegated so HUD / footer / chapter CTAs can add [data-open="logbook"] anytime.
  document.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement | null)?.closest?.('[data-open="logbook"]');
    // The HUD's delegated [data-open] handler usually gets here first (it dispatches ui:open and prevents default).
    if (!t || e.defaultPrevented || (e as MouseEvent).button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    overlay.open();
  });
  window.addEventListener('ui:open', (e) => {
    const d = (e as CustomEvent<{ name?: string; target?: string }>).detail;
    if (d?.name === 'logbook') overlay.open({ target: d.target });
  });
  window.addEventListener('ui:close', (e) => {
    const n = (e as CustomEvent<{ name?: string }>).detail?.name;
    if (n === 'logbook' || n === 'all') overlay.close();
  });
  const fromHash = () => {
    if (location.hash === '#logbook') overlay.open();
  };
  window.addEventListener('hashchange', fromHash);
  fromHash();

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (overlay.isOpen()) {
        e.preventDefault();
        overlay.close();
      } else if (inspect.isOpen()) {
        e.preventDefault();
        inspect.requestClose();
      }
    }
    // The L key is owned by ui/hud.ts (debounced for the typed "love" egg); it dispatches ui:open {name:'logbook'}.
  });

  if (import.meta.env.DEV) (window as unknown as { __bus: typeof bus }).__bus = bus;
}
