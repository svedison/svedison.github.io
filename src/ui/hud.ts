// HUD (SPEC §8): brush-circle mark with three lights, name, satchel counter, sound, Atlas, Logbook,
// keyboard shortcuts, and the bottom journey track (scroll-progress-timeline) with coords, odometer and
// the prologue's two clocks. Also wires game progression (lights, visits, loop close) to exact progress.
import { gsap } from 'gsap';
import type { App } from '../app';
import { bus, type ProgressState } from '../bus';
import { CHAPTERS, PERSON, STATIONS, THREE_WORDS, type LightId, type StationId } from '../content/story';
import { HUD_COPY } from '../content/ui';
import { POSTER_TONE } from '../world/types';

type OverlayName = 'logbook' | 'atlas' | 'satchel';

// ---------------------------------------------------------------- the mark (圆相 with a gap)
const R = 38;
const C = 50;
const pt = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  return `${(C + R * Math.cos(a)).toFixed(2)} ${(C + R * Math.sin(a)).toFixed(2)}`;
};
/** Clockwise arc from a0 to a1 (degrees, 0 = +x, 90 = down). */
const arc = (a0: number, a1: number) => `M ${pt(a0)} A ${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${pt(a1)}`;
const GAP_START = -86; // the gap sits just left of the top, where a brush lifts off
const GAP_END = -52;
const markSvg = `
<svg class="hud__mark" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <defs>
    <filter id="brush-rough" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6"/>
    </filter>
  </defs>
  <g filter="url(#brush-rough)" fill="none" stroke="currentColor" stroke-linecap="round">
    <path d="${arc(GAP_END, 150)}" stroke-width="8.5"/>
    <path d="${arc(140, 236)}" stroke-width="7"/>
    <path d="${arc(226, 360 + GAP_START)}" stroke-width="4.6"/>
    <path d="${arc(300, 360 + GAP_START + 2)}" stroke-width="2.4" opacity="0.6"/>
    <path class="gap-close" d="${arc(360 + GAP_START, 360 + GAP_END)}" stroke-width="5" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>
  </g>
</svg>`;

// ---------------------------------------------------------------- helpers
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fmtKm = (km: number) => `${Math.round(km).toLocaleString('en-US')} km`;
const firstChapterOf = (station: StationId) => CHAPTERS.findIndex((c) => c.station === station);

function clockFmt(tz: string) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch {
    return null;
  }
}

/** Open an overlay by name. Overlay owners listen for window 'ui:open'. Returns whether one reported open. */
export function openOverlay(name: string): boolean {
  let opened = false;
  const off = bus.on('overlay', (o) => {
    if (o.open) opened = true;
  });
  window.dispatchEvent(new CustomEvent('ui:open', { detail: { name } }));
  off();
  return opened;
}

export function init(app: App): void {
  const rootEl = document.getElementById('ui-root');
  if (!rootEl) return;
  const ui = rootEl;
  const { game } = app;
  const total = game.total;

  // ---------------------------------------------------------------- top bar
  const hud = document.createElement('header');
  hud.className = 'hud';
  hud.setAttribute('aria-label', HUD_COPY.controls);
  hud.innerHTML = `
    <div class="hud__id">
      <a class="hud__home" href="#prologue" data-scroll-to="prologue" aria-label="${HUD_COPY.home(PERSON.name)}">${markSvg}</a>
      <div class="hud__lightsbox">
        <ul class="hud__lights" aria-label="${HUD_COPY.lights}" tabindex="0" aria-describedby="hud-legend">
          ${THREE_WORDS.map(
            (w) => `<li class="hud__light" data-light="${w.id}"><span class="sr-only">${w.en}: <span data-light-state>${HUD_COPY.lightNotYet}</span></span></li>`,
          ).join('')}
        </ul>
        <div class="hud__legend" id="hud-legend" role="tooltip">
          <p class="hud__legend-title">${HUD_COPY.lightsLegendTitle}</p>
          <ul class="hud__legend-list">
            ${THREE_WORDS.map(
              (w) => `<li data-light="${w.id}"><span class="hud__legend-dot" aria-hidden="true"></span><span lang="zh-Hans" aria-hidden="true">${w.cjk}</span> ${w.en}<span class="hud__legend-state" data-legend-state></span></li>`,
            ).join('')}
          </ul>
          <p class="hud__legend-note">${HUD_COPY.lightsLegendNote}</p>
        </div>
        <span class="hud__caption" aria-hidden="true"></span>
      </div>
      <span class="hud__name">${PERSON.name}</span>
    </div>
    <nav class="hud__controls" aria-label="${HUD_COPY.tools}">
      <button type="button" class="hud__btn hud__satchel" data-open="satchel" aria-label="${HUD_COPY.satchel(0, total)}">
        <span class="glyph" aria-hidden="true">◐</span><span class="count" aria-hidden="true">0/${total}</span>
      </button>
      <button type="button" class="hud__btn hud__menu-toggle" aria-expanded="false" aria-controls="hud-menu">${HUD_COPY.menu}</button>
      <div class="hud__menu" id="hud-menu">
        <button type="button" class="hud__btn hud__sound" data-action="sound" aria-pressed="false" aria-label="${HUD_COPY.sound}" title="${HUD_COPY.soundTitle}">
          <span class="glyph" aria-hidden="true">♪</span><span class="hud__menu-label" aria-hidden="true">${HUD_COPY.sound}</span>
        </button>
        <button type="button" class="hud__btn" data-open="atlas" aria-keyshortcuts="M" title="${HUD_COPY.atlasTitle}">${HUD_COPY.atlas} <kbd aria-hidden="true">M</kbd></button>
        <a class="hud__btn" href="${import.meta.env.BASE_URL}logbook/" data-open="logbook" aria-keyshortcuts="L" title="${HUD_COPY.logbookTitle}">${HUD_COPY.logbook} <kbd aria-hidden="true">L</kbd></a>
        <a class="hud__btn hud__pdf" href="${import.meta.env.BASE_URL}${PERSON.resumePdf}" target="_blank" rel="noopener" download>${HUD_COPY.resumePdf}</a>
      </div>
    </nav>`;
  ui.appendChild(hud);

  const satchelBtn = hud.querySelector<HTMLButtonElement>('.hud__satchel')!;
  const soundBtn = hud.querySelector<HTMLButtonElement>('.hud__sound')!;
  const menuToggle = hud.querySelector<HTMLButtonElement>('.hud__menu-toggle')!;
  const gapPath = hud.querySelector<SVGPathElement>('.gap-close')!;
  const soundLabel = soundBtn.querySelector<HTMLElement>('.hud__menu-label')!;
  // On desktop the sound control is the glyph alone; the word appears inside the mobile menu.
  const mqMobile = matchMedia('(max-width: 760px)');
  // The direct résumé link lives in the mobile menu only (Menu, then PDF: two taps from any depth, SPEC §1/§13.2);
  // on desktop the Logbook sits in the bar and carries the download.
  const pdfLink = hud.querySelector<HTMLElement>('.hud__pdf')!;
  const syncSoundLabel = () => {
    soundLabel.style.display = mqMobile.matches ? '' : 'none';
    pdfLink.style.display = mqMobile.matches ? '' : 'none';
  };
  syncSoundLabel();
  mqMobile.addEventListener?.('change', syncSoundLabel);

  // ---------------------------------------------------------------- bottom track
  const blur = document.createElement('div');
  blur.className = 'track-blur';
  blur.setAttribute('aria-hidden', 'true');
  blur.innerHTML = '<div></div><div></div><div></div><div></div><div></div><div></div>';
  ui.appendChild(blur);

  const xs = STATIONS.map((_, i) => i / (STATIONS.length - 1));
  // Knots: exact progress at which each station starts (its first chapter).
  const knots = STATIONS.map((s) => firstChapterOf(s.id));

  const track = document.createElement('nav');
  track.className = 'track';
  track.setAttribute('aria-label', HUD_COPY.journey);
  track.innerHTML = `
    <div class="track__meta track__meta--start">
      <span class="track__label" data-coords-label>${HUD_COPY.position}</span>
      <span class="track__value" data-coords></span>
    </div>
    <div class="track__line">
      <span class="track__fill" aria-hidden="true"></span>
      <ol class="track__stations">
      ${STATIONS.map(
        (s, i) => `<li class="track__station" style="--x:${(xs[i] * 100).toFixed(2)}%" data-station="${s.id}">
          <button type="button" class="track__stop" data-goto="${firstChapterOf(s.id)}">
            <span class="name">${s.cjk ? `<span lang="zh-Hans" aria-hidden="true">${s.cjk}</span><span class="sr-only">${s.label}</span>` : s.label}</span>
            <span class="track__dot" aria-hidden="true"></span>
          </button>
        </li>`,
      ).join('')}
      </ol>
    </div>
    <button type="button" class="track__current" data-open="atlas"><span class="track__here"></span><span class="track__cue" aria-hidden="true">${HUD_COPY.atlas}</span></button>
    <button type="button" class="hud__btn hud__satchel track__satchel" data-open="satchel" aria-label="${HUD_COPY.satchel(0, total)}">
      <span class="glyph" aria-hidden="true">◐</span><span class="count" aria-hidden="true">0/${total}</span>
    </button>
    <div class="track__meta track__meta--end">
      <span class="track__label" data-end-label>${HUD_COPY.travelled}</span>
      <span class="track__value" data-end></span>
    </div>`;
  ui.appendChild(track);

  const fill = track.querySelector<HTMLElement>('.track__fill')!;
  const stationEls = Array.from(track.querySelectorAll<HTMLElement>('.track__station'));
  const stopEls = stationEls.map((el) => el.querySelector<HTMLButtonElement>('.track__stop')!);
  const coordsEl = track.querySelector<HTMLElement>('[data-coords]')!;
  const coordsLabel = track.querySelector<HTMLElement>('[data-coords-label]')!;
  const endLabel = track.querySelector<HTMLElement>('[data-end-label]')!;
  const endEl = track.querySelector<HTMLElement>('[data-end]')!;
  const currentEl = track.querySelector<HTMLButtonElement>('.track__current')!;
  const hereEl = currentEl.querySelector<HTMLElement>('.track__here')!;
  // Phones: the Satchel and the Atlas live in the bottom bar, in the thumb zone (the top bar keeps Menu).
  const satchelBtns = [satchelBtn, track.querySelector<HTMLButtonElement>('.track__satchel')!];

  track.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-goto]');
    if (!b) return;
    // Stations are fast-travel links (SPEC §8): atlas.ts owns the ink smoke, the jump and the cancel.
    const ch = CHAPTERS[Number(b.dataset.goto)];
    if (ch) bus.emit('travel:to', { id: ch.id });
  });

  // ---------------------------------------------------------------- clocks (prologue)
  const fmtJy = clockFmt('Asia/Shanghai');
  const fmtSea = clockFmt('America/Los_Angeles');
  let clockTimer = 0;
  const renderClocks = () => {
    const now = new Date();
    const jy = fmtJy ? fmtJy.format(now) : '';
    const sea = fmtSea ? fmtSea.format(now) : '';
    endEl.innerHTML = `<span class="track__clocks"><span>${HUD_COPY.clocks.jiangyin} ${jy}</span><span>${HUD_COPY.clocks.seattle} ${sea}</span></span>`;
  };

  // ---------------------------------------------------------------- state → DOM
  let lastCount = -1;
  const renderGame = () => {
    const s = game.get();
    const n = s.keepsakes.length;
    if (n !== lastCount) {
      const bump = lastCount >= 0 && n > lastCount;
      lastCount = n;
      for (const b of satchelBtns) {
        if (bump) {
          b.classList.remove('is-bump');
          void b.offsetWidth;
          b.classList.add('is-bump');
        }
        b.querySelector<HTMLElement>('.count')!.textContent = `${n}/${total}`;
        b.setAttribute('aria-label', HUD_COPY.satchel(n, total));
      }
    }
    for (const li of Array.from(hud.querySelectorAll<HTMLElement>('.hud__light'))) {
      const earned = s.lights.includes(li.dataset.light as LightId);
      li.classList.toggle('is-earned', earned);
      li.querySelector('[data-light-state]')!.textContent = earned ? HUD_COPY.lightEarned : HUD_COPY.lightNotYet;
    }
    for (const li of Array.from(hud.querySelectorAll<HTMLElement>('.hud__legend-list > li'))) {
      const earned = s.lights.includes(li.dataset.light as LightId);
      li.classList.toggle('is-earned', earned);
      li.querySelector('[data-legend-state]')!.textContent = earned ? ` · ${HUD_COPY.lightEarned}` : '';
    }
    // The sound toggle's aria-pressed / label belong to ui/audio.ts (it knows the 'locked' state).
  };

  const closeGap = (animate: boolean) => {
    if (!animate || app.reducedMotion) {
      gapPath.style.strokeDashoffset = '0';
      return;
    }
    gsap.to(gapPath, { strokeDashoffset: 0, duration: 1.2, ease: 'power3.out' });
  };
  const openGap = () => {
    gsap.killTweensOf(gapPath);
    gapPath.style.strokeDashoffset = '1';
  };
  if (game.get().loopClosed) closeGap(false);
  renderGame();

  // A light just earned: name it beside the dots for 2 s, so the three dots teach themselves.
  const caption = hud.querySelector<HTMLElement>('.hud__caption')!;
  let captionTimer = 0;
  const showCaption = (id: LightId) => {
    const w = THREE_WORDS.find((x) => x.id === id);
    if (!w) return;
    caption.textContent = HUD_COPY.lightCaption(w.cjk, w.en);
    caption.dataset.light = id;
    caption.classList.add('is-on');
    window.clearTimeout(captionTimer);
    captionTimer = window.setTimeout(() => caption.classList.remove('is-on'), 2000);
  };

  game.subscribe((_s, ev) => {
    renderGame();
    if (ev.type === 'light') {
      bus.emit('light:pulse', { id: ev.id });
      showCaption(ev.id);
    }
    if (ev.type === 'loopClosed') {
      // Every close (the ring ritual after its cycle, or the end of the scroll) lands here exactly once.
      closeGap(true);
      bus.emit('loop:closed', {});
    }
    if (ev.type === 'reset') openGap();
  });

  // A light pulse (earned, or the typed-word easter egg) breathes its dot.
  bus.on('light:pulse', ({ id }) => {
    const dot = hud.querySelector<HTMLElement>(`.hud__light[data-light="${id}"]`);
    if (!dot || app.reducedMotion) return;
    gsap.fromTo(dot, { scale: 1 }, { scale: 1.9, duration: 0.18, ease: 'power2.out', yoyo: true, repeat: 1 });
  });

  // ---------------------------------------------------------------- progress → track, odometer, game
  const LOVE_AT = { i: CHAPTERS.findIndex((c) => c.id === 'river'), t: 0.8 };
  const GRAT_AT = { i: CHAPTERS.findIndex((c) => c.id === 'coast'), t: 0.5 };
  const LAST = CHAPTERS.length - 1;
  const reached = (p: ProgressState, at: { i: number; t: number }) => p.index > at.i || (p.index === at.i && p.localExact >= at.t);

  let lastFill = -1;
  let lastStation = -1;
  let lastIndex = -1;
  let lastEnd = '';
  const toneNoWebgl = () => document.documentElement.classList.contains('no-webgl');

  bus.on('progress', (p) => {
    // fill: piecewise-linear over station knots, exact progress
    let f = 1;
    for (let s = 0; s < knots.length - 1; s++) {
      if (p.exact < knots[s + 1]) {
        f = lerp(xs[s], xs[s + 1], clamp01((p.exact - knots[s]) / (knots[s + 1] - knots[s])));
        break;
      }
    }
    if (Math.abs(f - lastFill) > 0.0005) {
      lastFill = f;
      fill.style.transform = `scaleX(${f.toFixed(4)})`;
    }

    const ch = CHAPTERS[p.index];
    const st = STATIONS.findIndex((s) => s.id === ch.station);
    if (st !== lastStation) {
      lastStation = st;
      stationEls.forEach((el, i) => {
        el.classList.toggle('is-reached', i <= st);
        if (i === st) stopEls[i].setAttribute('aria-current', 'step');
        else stopEls[i].removeAttribute('aria-current');
      });
      const here = STATIONS[st].label === 'Next' ? HUD_COPY.nextShore : STATIONS[st].label;
      hereEl.textContent = here;
      currentEl.setAttribute('aria-label', HUD_COPY.atlasHere(here));
    }
    if (p.index !== lastIndex) {
      lastIndex = p.index;
      // keep each ' · ' separator with the place before it, so a wrapped line never starts with a dot
      coordsEl.textContent = (ch.coords ?? '').replace(/ · /g, ' · ');
      // The Loop's meta is the water cycle, not a position: say so, and keep it on one line.
      coordsLabel.textContent = ch.id === 'loop' ? HUD_COPY.cycle : HUD_COPY.position;
      coordsEl.classList.toggle('is-cycle', ch.id === 'loop');
      window.clearInterval(clockTimer);
      if (ch.id === 'prologue') {
        endLabel.textContent = HUD_COPY.localTime;
        renderClocks();
        clockTimer = window.setInterval(renderClocks, 20000);
        lastEnd = '';
      } else {
        endLabel.textContent = HUD_COPY.travelled;
      }
      if (toneNoWebgl()) document.documentElement.dataset.tone = POSTER_TONE[ch.id];
    }
    if (ch.id !== 'prologue') {
      const km = fmtKm(lerp(ch.km[0], ch.km[1], p.localExact));
      if (km !== lastEnd) {
        lastEnd = km;
        endEl.textContent = km;
      }
    }

    // game progression (exact progress, never smoothed). Each call is a no-op once earned.
    const s = game.get();
    if (!s.lights.includes('love') && reached(p, LOVE_AT)) game.earn('love');
    if (!s.lights.includes('gratitude') && reached(p, GRAT_AT)) game.earn('gratitude');
    // Forgive is earned only through the letting-go ritual (SPEC §4.3), below on 'forgive:done'. A visitor who
    // skips it still gets every light when the loop closes at the end of the scroll (game.closeLoop).
    if (!s.loopClosed && p.index === LAST && (p.localExact >= 0.94 || p.page >= 0.995)) game.closeLoop();
  });

  bus.on('chapter', ({ index }) => game.visit(CHAPTERS[index].station));
  bus.on('forgive:done', () => game.earn('forgive'));

  // ---------------------------------------------------------------- controls
  const setMenu = (open: boolean) => {
    hud.classList.toggle('is-menu-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
  };
  menuToggle.addEventListener('click', () => setMenu(!hud.classList.contains('is-menu-open')));
  pdfLink.addEventListener('click', () => setMenu(false));
  document.addEventListener('click', (e) => {
    if (!hud.contains(e.target as Node)) setMenu(false);
  });

  // ui/audio.ts owns the toggle (it must unlock audio inside the gesture) for both the click and the S key.
  // Toggling here too would cancel it out, so the HUD only steps in if nothing else handled the gesture.
  const soundFallback = () => {
    const before = game.get().sound;
    window.setTimeout(() => {
      if (game.get().sound === before) game.setSound(!before);
    }, 0);
  };
  soundBtn.addEventListener('click', soundFallback);

  // Any [data-open] anywhere (HUD, story CTAs, overlays) asks its overlay owner to open.
  // If no owner reports open synchronously, a link falls back to its href (e.g. /logbook/).
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const el = (e.target as Element | null)?.closest<HTMLElement>('[data-open]');
    if (!el) return;
    const name = el.dataset.open as OverlayName;
    const opened = openOverlay(name);
    const href = el.getAttribute('href');
    if (opened || !href || href.startsWith('#')) e.preventDefault();
    setMenu(false);
  });

  // ---------------------------------------------------------------- keyboard
  const typing = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  let pendingL = 0;
  // The Logbook control answers the L key at once (pressed state), then opens after the short "love" window.
  const logbookBtns = () => Array.from(hud.querySelectorAll<HTMLElement>('[data-open="logbook"]'));
  const pressL = (on: boolean) => logbookBtns().forEach((b) => b.classList.toggle('is-pressed', on));
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    const k = e.key.toLowerCase();
    // "love" typed anywhere is an easter egg (SPEC §4.5): hold L briefly so "lo…" doesn't open the Logbook.
    if (pendingL && k === 'o') {
      window.clearTimeout(pendingL);
      pendingL = 0;
      pressL(false);
      return;
    }
    if (e.key === 'Escape') {
      setMenu(false);
      window.dispatchEvent(new CustomEvent('ui:close', { detail: { name: 'all' } }));
      return;
    }
    if (k === 'm') openOverlay('atlas');
    else if (k === 's' && !e.repeat) soundFallback();
    else if (k === 'l' && !e.repeat) {
      window.clearTimeout(pendingL);
      pressL(true);
      pendingL = window.setTimeout(() => {
        pendingL = 0;
        if (!openOverlay('logbook')) window.location.assign(`${import.meta.env.BASE_URL}logbook/`);
        window.setTimeout(() => pressL(false), 160);
      }, 260);
    }
  });
}
