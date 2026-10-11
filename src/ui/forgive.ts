// The letting-go ritual (SPEC §4.3, §7 Ch.4): a sheet of rice paper with the forgive line, an optional
// note (never sent, never stored), and "Let go". The sheet is copied into a frozen frame and burnt away
// from its bottom edge by the paper-cinder pass; behind the line the live rain world shows through.
// Embers rise off the line, cool, and fall back as rain. Reduced motion or no WebGL: the sheet fades
// and dissolves, nothing burns. Then the light is earned (bus 'forgive:done'; hud.ts calls game.earn).
//
// Privacy: the textarea is not in a form, has autocomplete off, is cleared the moment the sheet is
// copied, and its words exist only in the burning texture, which is wiped when the burn ends.
import '../styles/rituals.css';
import type { App } from '../app';
import { bus } from '../bus';
import { CHAPTERS, FORGIVE_COPY, RAIN_BEATS, THREE_WORDS } from '../content/story';
import { stillFor } from '../world/types';
import { groundWeights, seasonAt, type Weights } from '../world/chapters/rain/seasons';
import { createBurner, K, type Burner } from './cinder/burn';
import { createEmbers, type Embers } from './cinder/embers';
import { paintBox, paintSheet, paintWords } from './cinder/paper';

const DURATION = 3.4; // s, the line's sweep (skill: 1.5-5 s all read; 3.0 default)
const DISSOLVE = 1.6; // s, the no-fire path
const M = 26; // CSS px of margin round the sheet inside the fire canvas (fray + glow)
const EMBER_PAD = { x: 70, top: 240, bottom: 300 };
const MAX_CHARS = 140;

const rain = CHAPTERS.find((c) => c.id === 'rain');
const LINE = rain?.body.find((b) => /forgiv/i.test(b)) ?? rain?.body[rain.body.length - 1] ?? '';
const WORD = THREE_WORDS.find((w) => w.id === 'forgive')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, attrs: Record<string, string> = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

export function init(app: App): void {
  const slot = document.querySelector<HTMLElement>('[data-slot="forgive"]');
  if (!slot) return;

  // The forgive line now lives on the sheet; hide its in-flow duplicate (the static page keeps it for no-JS).
  slot
    .closest('[data-chapter]')
    ?.querySelectorAll<HTMLElement>('.chapter__aside')
    .forEach((a) => {
      if (a.textContent?.replace(/\s+/g, ' ').trim() === LINE.trim()) {
        a.hidden = true;
        a.style.display = 'none';
      }
    });

  // ---------------------------------------------------------------- DOM
  // data-ui: clicks anywhere on the ritual (paper, margins) stay in the DOM and never fall through to a 3D hotspot
  const root = el('div', 'forgive', { 'data-ui': '' });
  root.dataset.state = 'idle';
  const stage = el('div', 'forgive__stage');
  const sheet = el('div', 'forgive__sheet', { role: 'group', 'aria-labelledby': 'forgive-line' });
  const paper = el('canvas', 'forgive__paper', { 'aria-hidden': 'true' });
  const inner = el('div', 'forgive__inner');
  const kicker = el('p', 'forgive__kicker');
  kicker.innerHTML = `<span class="forgive__cjk" lang="zh-Hans">${WORD.cjk}</span><span class="forgive__en">${WORD.en}</span>`;
  const line = el('p', 'forgive__line', { id: 'forgive-line' });
  line.textContent = LINE;
  const label = el('label', 'forgive__label', { for: 'forgive-text' });
  label.innerHTML = `${FORGIVE_COPY.label} <span class="forgive__note">${FORGIVE_COPY.note}</span>`;
  const field = el('textarea', 'forgive__field', {
    id: 'forgive-text',
    rows: '3',
    maxlength: String(MAX_CHARS),
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'sentences',
    spellcheck: 'false',
    'data-lpignore': 'true',
    'data-1p-ignore': 'true',
    'aria-describedby': 'forgive-count',
  });
  const row = el('div', 'forgive__row');
  const count = el('span', 'forgive__count', { id: 'forgive-count', 'aria-live': 'off' });
  const go = el('button', 'forgive__go', { type: 'button' });
  go.innerHTML = `<span class="forgive__go-dot" aria-hidden="true"></span>${FORGIVE_COPY.letGo}`;
  row.append(count, go);
  inner.append(kicker, line, label, field, row);
  sheet.append(paper, inner);
  const emberHost = el('div', 'forgive__embers', { 'aria-hidden': 'true' });
  const done = el('div', 'forgive__done', { tabindex: '-1' });
  done.hidden = true;
  done.innerHTML = `<p class="forgive__earned"><span class="forgive__light" aria-hidden="true"></span><span class="forgive__cjk" lang="zh-Hans">${WORD.cjk}</span> · ${WORD.en}${FORGIVE_COPY.earned}</p>
    <button type="button" class="forgive__again">${FORGIVE_COPY.again}</button>`;
  stage.append(sheet, emberHost, done);
  root.append(stage);
  slot.append(root);
  // This ritual sits in its chapter's trailing content, where the pinned copy is (correctly) off stage.
  // reveal.ts travels to a chapter's start on any focusin inside a section whose pin is hidden; that would yank the
  // page away from the sheet while someone types. Scope the exception: stop the event only in exactly that case
  // (pin off stage). When the pin is on stage reveal.ts does nothing, so the event bubbles normally to any
  // global focus handler. (A cleaner contract would be reveal.ts ignoring focus inside [data-focus-local].)
  const pin = slot.closest('[data-chapter]')?.querySelector<HTMLElement>('.chapter__pin') ?? null;
  root.setAttribute('data-focus-local', '');
  root.addEventListener('focusin', (e) => {
    if (pin && !pin.classList.contains('is-active')) e.stopPropagation();
  });

  // ---------------------------------------------------------------- beat captions + beat posters
  // Small mono captions over the world that name what the quad is doing while no reading block is up: the seasons
  // turning (time passing at UW) and, as the pool of lanterns rises, what the lanterns are (CSO, 2,000+). They are
  // derived from local progress only (pure function of native scroll), aria-hidden (the chapter body already says
  // it), and shown in every mode, so the no-WebGL poster beats carry the same words.
  const section = slot.closest<HTMLElement>('[data-chapter]');
  const rainIndex = CHAPTERS.findIndex((c) => c.id === 'rain');
  const cap = el('div', 'rain-beat', { 'aria-hidden': 'true' });
  // divs, not <p>: eggs.ts places its dry-weather aside after the chapter's last paragraph (the body copy)
  cap.innerHTML = `<div class="rain-beat__kicker"><span class="rain-beat__marks"><i></i><i></i><i></i><i></i></span>${RAIN_BEATS.kicker}</div>
    <div class="rain-beat__season"></div>
    <div class="rain-beat__lantern"><span class="rain-beat__dot"></span>${RAIN_BEATS.lantern}</div>`;
  section?.append(cap);
  const capSeason = cap.querySelector<HTMLElement>('.rain-beat__season')!;
  const capMarks = Array.from(cap.querySelectorAll<HTMLElement>('.rain-beat__marks i'));
  /** Caption window (quad arrival, the buds-return beat). The season itself is read from the world's own blend. */
  const SEASON_AT = [0.2, 0.95];
  const wSeason: Weights = [1, 0, 0, 0];
  const wGround: Weights = [1, 0, 0, 0];
  // the season the frame visibly shows: the world's weights (seasons.ts) with winter held back to settled snow
  // (groundWeights), so the caption says Winter only once the ground has whitened, not over fall crowns
  const seasonShown = (tt: number) => {
    groundWeights(seasonAt(tt, wSeason), wGround);
    let best = 0;
    for (let k = 1; k < 4; k++) if (wGround[k] > wGround[best]) best = k;
    return best;
  };
  let capKey = '';
  let posterEl: HTMLElement | null = null;
  let posterBeat = -1;
  // portrait: the pinned copy (and its seal) fills the frame until ~0.34 and already names the CSO, so the captions
  // wait for it to leave
  const portrait = window.matchMedia('(max-aspect-ratio: 4/5)');
  bus.on('progress', (p) => {
    const here = p.index === rainIndex;
    const t = p.localExact;
    // still modes (reduced motion, no WebGL) draw the composed still (REDUCED_STILLS), not t: name that still's
    // season, so the caption never says winter over the summer quad
    const stills = app.reducedMotion || !app.webgl || document.documentElement.classList.contains('no-webgl');
    // live world: name the season the world is drawing, which is resolved from the SMOOTHED progress (engine view()),
    // so the caption never runs ahead of the quad while smoothing catches up. Before smoothing reaches the chapter
    // (or after it has left), hold to the chapter edge it is coming from.
    const tSmooth = p.smoothIndex === rainIndex ? p.localSmooth : p.smoothIndex < rainIndex ? 0 : 1;
    const ts = stills ? stillFor('rain', t).t : tSmooth;
    let s = -1;
    if (here && (stills ? t : ts) >= (portrait.matches ? 0.34 : SEASON_AT[0]) && t < 0.995) s = ts >= SEASON_AT[1] ? 4 : seasonShown(ts);
    // portrait: step aside once the sheet scrolls up to the captions (it leaves through the top as the chapter ends)
    if (s >= 0 && portrait.matches && t > 0.6 && !sheet.hidden && stage.getBoundingClientRect().top < cap.getBoundingClientRect().bottom + 12) s = -1;
    const lantern = s >= 0 && ts >= 0.22 && ts < 0.5;
    const key = `${s}|${lantern ? 1 : 0}`;
    if (key !== capKey) {
      capKey = key;
      cap.classList.toggle('is-on', s >= 0);
      cap.classList.toggle('has-lantern', lantern);
      if (s >= 0) {
        const label = s === 4 ? RAIN_BEATS.again : RAIN_BEATS.seasons[s];
        if (capSeason.textContent !== label) {
          capSeason.textContent = label;
          capSeason.classList.remove('is-new');
          void capSeason.offsetWidth; // restart the short settle
          capSeason.classList.add('is-new');
        }
        capMarks.forEach((m, i) => m.classList.toggle('is-on', i === s % 4));
      }
    }
    // No-WebGL / loading poster: the still that matches the beat (lake, the quad, winter), as the reduced-motion
    // engine picks its stills (REDUCED_STILLS).
    if (here) {
      const beat = stillFor('rain', t).beat;
      if (beat !== posterBeat) {
        posterEl ??= document.querySelector<HTMLElement>('#posters .poster--rain');
        if (posterEl) {
          posterBeat = beat;
          posterEl.dataset.beat = String(beat);
        }
      }
    }
  });

  // ---------------------------------------------------------------- exit under the HUD
  // The stage is sticky (rituals.css) and parks below the HUD (in portrait, lower, so the lantern stays in view
  // above it). When the chapter ends it has to scroll on; rather than slide under the brand and the controls, it is
  // cut at the HUD line and fades as it leaves. Reads scroll position only (native scroll stays the conductor);
  // idle while the ritual is off screen or burning.
  const hudProbe = el('div', '', { 'aria-hidden': 'true' });
  hudProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:calc(var(--hud-top) + 16px);visibility:hidden;pointer-events:none';
  root.append(hudProbe);
  let exitRaf = 0;
  let exitOn = false;
  let exitD = -1;
  const applyExit = () => {
    exitRaf = 0;
    const park = hudProbe.offsetHeight || 72;
    const d = busy ? 0 : Math.max(0, park - stage.getBoundingClientRect().top);
    if (Math.abs(d - exitD) < 0.5) return;
    exitD = d;
    if (d < 0.5) {
      stage.style.clipPath = '';
      stage.style.opacity = '';
    } else {
      stage.style.clipPath = `inset(${d.toFixed(1)}px -400px -400px -400px)`;
      stage.style.opacity = String(Math.max(0, 1 - d / 110).toFixed(3));
    }
  };
  const onExitScroll = () => {
    if (!exitRaf) exitRaf = requestAnimationFrame(applyExit);
  };
  new IntersectionObserver((es) => {
    const on = es.some((e) => e.isIntersecting);
    if (on === exitOn) return;
    exitOn = on;
    if (on) {
      window.addEventListener('scroll', onExitScroll, { passive: true });
      onExitScroll();
    } else window.removeEventListener('scroll', onExitScroll);
  }).observe(root);

  const updateCount = () => {
    count.textContent = `${field.value.length} / ${MAX_CHARS}`;
  };
  updateCount();
  field.addEventListener('input', updateCount);
  // never let the browser restore it from the back/forward cache
  window.addEventListener('pageshow', () => {
    field.value = '';
    updateCount();
  });

  // ---------------------------------------------------------------- paper
  const dprOf = () => Math.min(window.devicePixelRatio || 1, K.DPR_CAP);
  let sheetW = 0, sheetH = 0;
  function paintPaper() {
    const r = sheet.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w < 2 || h < 2 || (w === sheetW && h === sheetH && paper.width)) return;
    sheetW = w;
    sheetH = h;
    const d = dprOf();
    paper.width = Math.round((w + 2 * M) * d);
    paper.height = Math.round((h + 2 * M) * d);
    paper.style.width = `${w + 2 * M}px`;
    paper.style.height = `${h + 2 * M}px`;
    paper.style.left = paper.style.top = `${-M}px`;
    const ctx = paper.getContext('2d')!;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w + 2 * M, h + 2 * M);
    paintSheet(ctx, w, h, M, 11);
  }
  new ResizeObserver(() => paintPaper()).observe(sheet);

  // ---------------------------------------------------------------- the fire (prepared before it is needed)
  // The burner holds its own WebGL context only while it is needed: created at idle as the sheet nears, released
  // (WEBGL_lose_context) as soon as a burn ends, re-prepared at idle if the visitor lets go of something else.
  let burner: Burner | null = null;
  let glOk = app.webgl && !app.reducedMotion;
  const onLost = () => {
    glOk = false;
  };
  function prepare() {
    if (!glOk || burner) return;
    try {
      burner = createBurner();
      burner.ready();
      burner.canvas.addEventListener('webglcontextlost', onLost);
    } catch (err) {
      console.warn('[forgive] burn unavailable, the sheet will dissolve instead', err);
      glOk = false;
      burner = null;
    }
  }
  function release() {
    const b = burner;
    if (!b) return;
    burner = null;
    b.canvas.removeEventListener('webglcontextlost', onLost); // a deliberate release is not a failure
    b.canvas.remove();
    try {
      b.dispose();
    } catch {
      /* already gone */
    }
  }
  const idle = (fn: () => void) => {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(fn, { timeout: 1200 });
    else setTimeout(fn, 200);
  };
  if (glOk) {
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        io.disconnect();
        idle(prepare);
      },
      { rootMargin: '900px 0px' },
    );
    io.observe(slot);
  }

  let embers: Embers | null = null;
  function ensureEmbers() {
    if (!embers) {
      embers = createEmbers();
      emberHost.append(embers.canvas);
    }
    return embers;
  }

  // ---------------------------------------------------------------- the frozen frame
  function rasterize(): HTMLCanvasElement {
    const r = sheet.getBoundingClientRect();
    const d = dprOf();
    const c = document.createElement('canvas');
    c.width = Math.round((r.width + 2 * M) * d);
    c.height = Math.round((r.height + 2 * M) * d);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(paper, 0, 0, c.width, c.height);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    paintBox(ctx, field, r, M);
    paintBox(ctx, go, r, M);
    for (const n of [kicker, line, label, count, go]) paintWords(ctx, n, r, M);
    // the note, laid out exactly as the textarea lays it out, through an invisible mirror
    if (field.value.trim()) {
      const fr = field.getBoundingClientRect();
      const cs = getComputedStyle(field);
      const mirror = el('div', 'forgive__mirror');
      for (const p of ['fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'color'] as const)
        mirror.style[p] = cs[p];
      mirror.style.width = `${field.clientWidth}px`;
      mirror.style.left = `${fr.left - r.left + field.clientLeft}px`;
      mirror.style.top = `${fr.top - r.top + field.clientTop - field.scrollTop}px`;
      mirror.textContent = field.value;
      sheet.append(mirror);
      ctx.save();
      ctx.beginPath();
      ctx.rect(fr.left - r.left + M, fr.top - r.top + M, fr.width, fr.height);
      ctx.clip();
      paintWords(ctx, mirror, r, M);
      ctx.restore();
      mirror.remove();
    }
    return c;
  }

  // ---------------------------------------------------------------- the ritual
  let busy = false;
  let raf = 0;

  function finish() {
    busy = false;
    cancelAnimationFrame(raf);
    root.dataset.state = 'done';
    sheet.hidden = true;
    release();
    done.hidden = false;
    // keep the space the sheet held, so nothing below jumps; the light sits where the paper was
    bus.emit('forgive:done', {});
    const focusWasInside = root.contains(document.activeElement) || document.activeElement === document.body;
    if (focusWasInside) done.focus({ preventScroll: true });
  }

  function letGo() {
    if (busy) return;
    busy = true;
    paintPaper();
    const r = sheet.getBoundingClientRect();
    const W = r.width, H = r.height;
    stage.style.minHeight = `${Math.round(H)}px`;
    const d = dprOf();

    // place the ember canvas round the sheet
    const em = ensureEmbers();
    em.clear();
    const eW = W + 2 * EMBER_PAD.x, eH = H + EMBER_PAD.top + EMBER_PAD.bottom;
    em.resize(eW, eH, d);
    em.canvas.style.left = `${-EMBER_PAD.x}px`;
    em.canvas.style.top = `${-EMBER_PAD.top}px`;

    const useFire = glOk && !app.reducedMotion && (prepare(), burner !== null);
    const frozen = useFire ? rasterize() : null;
    // the visitor's words leave the page now: the only copy is the frozen texture, wiped when it burns out
    field.value = '';
    updateCount();
    bus.emit('forgive:burn', {});
    root.dataset.state = 'burning';
    (document.activeElement as HTMLElement | null)?.blur?.();

    if (useFire && frozen && burner) {
      const b = burner;
      try {
        b.setSheet(frozen, W + 2 * M, H + 2 * M, d);
      } catch (err) {
        console.warn('[forgive] burn failed, dissolving', err);
        glOk = false;
        return dissolve(W, H);
      }
      // wipe the 2D copy as well
      frozen.width = frozen.height = 1;
      if (b.canvas.parentElement !== stage) stage.insertBefore(b.canvas, emberHost);
      b.canvas.className = 'forgive__fire';
      b.canvas.setAttribute('aria-hidden', 'true');
      b.canvas.style.left = b.canvas.style.top = `${-M}px`;
      b.canvas.hidden = false;
      const seed = (1 + Math.floor(Math.random() * 24)) * K.SEED_STEP;
      // The sweep runs on wall-clock time, so it takes DURATION seconds on any device however slow its frames;
      // only the ember simulation steps with a clamped dt (stable integration).
      let t = 0, time = 0, last = 0, after = 0, spawnAcc = 0, start = 0;
      b.draw(K.FRONT_A, 0, seed);
      sheet.classList.add('is-frozen'); // the canvas now shows the sheet; the DOM copy steps aside
      const frame = (now: number) => {
        if (!start) start = now;
        const dt = last ? Math.min(K.DT_MAX, (now - last) / 1000) : 0;
        last = now;
        time = (now - start) / 1000;
        if (t < 1) {
          t = Math.min(1, time / DURATION);
          const raw = Math.min(1, Math.max(0, (t - 0.01) / 0.97));
          const front = K.FRONT_A + K.FRONT_B * raw;
          b.draw(front, time, seed);
          // embers leave the line where there is still paper to burn
          const hx = front + K.HALF;
          const yLine = (1 - hx) * (H + 2 * M) - M; // sheet-space px from its top
          if (yLine > -6 && yLine < H + 6) {
            spawnAcc += dt * 110 * (W / 480);
            while (spawnAcc >= 1) {
              spawnAcc -= 1;
              em.spawn(EMBER_PAD.x + Math.random() * W, EMBER_PAD.top + yLine + (Math.random() - 0.5) * 30, 0.4 + Math.random() * 0.6);
            }
          }
          if (t >= 1) {
            b.canvas.hidden = true;
            b.clear();
            release(); // the burn is over: give the second GL context back now, not at page unload
            sheet.hidden = true;
          }
        } else {
          after = time - DURATION; // wall clock as well: the light is earned 0.25 s after the line clears, on any device
        }
        const live = em.step(dt);
        if (t >= 1 && after > 0.25 && root.dataset.state !== 'done') finish();
        if (t >= 1 && (live === 0 || after > 4)) {
          em.clear();
          return;
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      return;
    }
    dissolve(W, H);
  }

  function dissolve(W: number, H: number) {
    // no fire: the paper fades and dissolves (opacity + a soft blur), and, with motion allowed,
    // a few silver drops fall from it
    sheet.classList.remove('is-frozen');
    sheet.classList.add('is-dissolving');
    sheet.style.setProperty('--dissolve', `${app.reducedMotion ? 0.9 : DISSOLVE}s`);
    const em = app.reducedMotion ? null : ensureEmbers();
    let last = 0, time = 0, start = 0;
    const total = app.reducedMotion ? 0.9 : DISSOLVE;
    const frame = (now: number) => {
      const dt = last ? Math.min(K.DT_MAX, (now - last) / 1000) : 0;
      last = now;
      if (!start) start = now;
      time = (now - start) / 1000; // wall clock: the dissolve lasts its duration on any device
      if (em && time < total) {
        for (let i = 0; i < 2; i++) if (Math.random() < 0.35) em.spawn(EMBER_PAD.x + Math.random() * W, EMBER_PAD.top + Math.random() * H, 0, true);
      }
      const live = em ? em.step(dt) : 0;
      if (time >= total && root.dataset.state !== 'done') finish();
      if (time >= total && (live === 0 || time > total + 4)) {
        em?.clear();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  function again() {
    root.dataset.state = 'idle';
    done.hidden = true;
    sheet.hidden = false;
    sheet.classList.remove('is-frozen', 'is-dissolving');
    stage.style.minHeight = '';
    embers?.clear();
    paintPaper();
    field.focus({ preventScroll: true });
    if (glOk) idle(prepare); // a fresh fire, prepared before the next 'Let go'
  }

  go.addEventListener('click', letGo);
  done.querySelector('.forgive__again')!.addEventListener('click', again);
  // Ctrl/Cmd+Enter in the note lets go, like sending a message you never send
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      letGo();
    }
  });
}
