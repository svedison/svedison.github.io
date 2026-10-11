// Ch.7 Next shore: the keepsake tally, Replay the journey, Reset (two-step confirm), and the
// "Look closer" mirror for the seed under glass (SPEC §7 Ch.7, §3 row 8), and the copy's fade into the HUD
// band. Fills [data-slot="tally"].
// Reads game state only through app.game; talks to the world only through the bus.
import '../styles/next-shore.css';
import type { App } from '../app';
import { bus } from '../bus';
import { THREE_WORDS, WELLBEING_LINE } from '../content/story';
import { TALLY_COPY } from '../content/ui';
import { announce } from './live';

export function init(app: App): void {
  const slot = document.querySelector<HTMLElement>('[data-slot="tally"]');
  if (!slot) return;
  const { game } = app;

  slot.innerHTML = `
    <div class="tally" role="group" aria-labelledby="tally-count">
      <p class="tally__count" id="tally-count"><span data-count>0</span><span class="tally__of">/${game.total}</span> ${TALLY_COPY.found}</p>
      <ul class="tally__lights" aria-label="${TALLY_COPY.lights}">
        ${THREE_WORDS.map(
          (w) =>
            `<li class="tally__light" data-light="${w.id}" style="--c: var(${w.color})"><span class="tally__dot" aria-hidden="true"></span><span class="tally__name">${w.en}</span><span class="sr-only" data-state></span></li>`,
        ).join('')}
      </ul>
      <div class="tally__actions" data-step="idle">
        <button type="button" class="tally__btn" data-replay>${TALLY_COPY.replay} <span aria-hidden="true">↑</span></button>
        <button type="button" class="tally__btn tally__btn--quiet" data-reset>${TALLY_COPY.reset}</button>
        <p class="tally__confirm" role="group" aria-labelledby="tally-confirm-q">
          <span id="tally-confirm-q">${TALLY_COPY.confirm}</span>
          <span class="tally__confirm-actions">
            <button type="button" class="tally__btn tally__btn--solid" data-reset-yes>${TALLY_COPY.yes}</button>
            <button type="button" class="tally__btn tally__btn--quiet" data-reset-no>${TALLY_COPY.keep}</button>
          </span>
        </p>
      </div>
    </div>`;

  const countEl = slot.querySelector<HTMLElement>('[data-count]')!;
  const actions = slot.querySelector<HTMLElement>('.tally__actions')!;
  const btn = (sel: string) => slot.querySelector<HTMLButtonElement>(sel)!;

  function render() {
    const s = game.get();
    countEl.textContent = String(s.keepsakes.length);
    slot!.querySelectorAll<HTMLElement>('[data-light]').forEach((li) => {
      const on = s.lights.includes(li.dataset.light as (typeof THREE_WORDS)[number]['id']);
      li.classList.toggle('is-on', on);
      li.querySelector('[data-state]')!.textContent = on ? TALLY_COPY.earned : TALLY_COPY.notYet;
    });
  }
  render();
  game.subscribe(() => render());

  function setStep(step: 'idle' | 'confirm') {
    actions.dataset.step = step;
  }

  slot.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-replay]')) {
      setStep('idle');
      announce(TALLY_COPY.back(game.get().keepsakes.length, game.total));
      app.scrollToChapter(0, { instant: app.reducedMotion });
      // move focus to the opening so keyboard users continue from the top, not the footer
      const first = document.querySelector<HTMLElement>('[data-chapter] .chapter__title');
      if (first) {
        if (!first.hasAttribute('tabindex')) first.setAttribute('tabindex', '-1');
        first.focus({ preventScroll: true });
      }
      return;
    }
    if (t.closest('[data-reset-yes]')) {
      game.reset(); // live.ts announces the reset; the world re-syncs through game listeners / keepsakes:sync
      setStep('idle');
      btn('[data-reset]').focus();
      return;
    }
    if (t.closest('[data-reset-no]')) {
      setStep('idle');
      btn('[data-reset]').focus();
      return;
    }
    if (t.closest('[data-reset]')) {
      setStep('confirm');
      btn('[data-reset-no]').focus();
    }
  });
  actions.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && actions.dataset.step === 'confirm') {
      setStep('idle');
      btn('[data-reset]').focus();
    }
  });

  // ---- the HUD hand-off: Next is the one in-flow chapter, so its copy scrolls up into the HUD band. Each block
  // fades out through a mask that ends exactly at the HUD's lower edge (scroll-linked, reversible; no motion of
  // its own, so it applies under reduced motion too). Masks are set only while a block is in the band, since a
  // mask also clips the paper scrim that overhangs the tail.
  const nextCh = document.querySelector<HTMLElement>('.chapter--next');
  const fadeEls = nextCh ? Array.from(nextCh.querySelectorAll<HTMLElement>(':scope > .chapter__hold .chapter__pin, :scope > .chapter__tail')) : [];
  if (fadeEls.length) {
    const FADE = 56;
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:var(--hud-top);visibility:hidden;pointer-events:none';
    document.body.append(probe);
    let band = probe.offsetHeight || 64;
    let raf = 0;
    const update = () => {
      raf = 0;
      for (const el of fadeEls) {
        const fy = band - el.getBoundingClientRect().top;
        const on = fy > -FADE;
        el.classList.toggle('is-hudfade', on);
        if (on) el.style.setProperty('--hud-fy', `${Math.round(fy)}px`);
      }
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', () => {
      band = probe.offsetHeight || 64;
      queue();
    });
    queue();
  }

  // ---- "Look closer": the keyboard / touch mirror of the seed under glass (the 3D cloche hotspot in next.ts).
  // Brings the glass into clear view above the copy and lets it breathe once, tied to the well-being line.
  const now = document.querySelector<HTMLElement>('.chapter--next .shore__now');
  if (now && !now.querySelector('.shore__look')) {
    const look = document.createElement('button');
    look.type = 'button';
    look.className = 'shore__look';
    look.innerHTML = `${TALLY_COPY.lookCloser} <span aria-hidden="true">→</span>`;
    look.setAttribute('aria-describedby', 'shore-now');
    now.id = now.id || 'shore-now';
    now.insertAdjacentElement('afterend', look);
    look.addEventListener('click', () => {
      const r = look.getBoundingClientRect();
      const track = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--track-h')) || 76;
      // scroll up so this button sits just above the journey track: the most world above the copy
      const delta = r.bottom - (window.innerHeight - track - 28);
      if (delta < -8) window.scrollBy({ top: delta, behavior: app.reducedMotion ? 'auto' : 'smooth' });
      bus.emit('next:look', {});
      announce(TALLY_COPY.seed(WELLBEING_LINE));
    });
  }

  // Keepsake changes from anywhere (Satchel reset, pickups) keep this in step; nothing else to do here.
  bus.on('keepsakes:sync', () => render());
}
