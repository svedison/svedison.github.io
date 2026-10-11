// The Loop (SPEC §4.3, §7 Ch.6): one brushed ink ring with a gap, three stations on it (river, sea, rain)
// and the three lights. The visitor drags each light onto its place (pointer or touch), or picks it with
// Enter/Space (or a click/tap) and then chooses a station (arrows/Tab + Enter, or a click/tap). A wrong
// station shakes the light gently home; nothing is lost. When all three are home, the ink runs once round
// the ring in the order of the water cycle (river -> sea -> rain -> river) and the gap closes.
// Placing implies earning (game.place); a visitor who skipped the game is never locked out.
import '../styles/rituals.css';
import type { App } from '../app';
import { bus } from '../bus';
import { LOOP_COPY, THREE_WORDS, type LightId } from '../content/story';
import type { GameState } from '../game/state';

const SVGNS = 'http://www.w3.org/2000/svg';
const VB = 400, C = 200, R = 136;
// Station angles in screen degrees (y down). Counter-clockwise on screen runs river -> sea -> rain -> river:
// the river along the bottom to the sea, the sea rising up the right side into cloud, rain falling down the left.
const ANGLE: Record<LightId, number> = { love: 150, gratitude: 30, forgive: 270 };
// Where the brush lifts (the gap), between rain and river on the left.
const GAP_START = 197, GAP_SWEEP = 344;
// The water cycle between stations, in SPEC §2's own words.
const ARCS: { from: LightId; to: LightId; text: string }[] = [
  { from: 'love', to: 'gratitude', text: LOOP_COPY.arcs.love },
  { from: 'gratitude', to: 'forgive', text: LOOP_COPY.arcs.gratitude },
  { from: 'forgive', to: 'love', text: LOOP_COPY.arcs.forgive },
];
const CYCLE_MS = 2800;

const rad = (d: number) => (d * Math.PI) / 180;
const pt = (deg: number, r = R): [number, number] => [C + r * Math.cos(rad(deg)), C + r * Math.sin(rad(deg))];
const f = (n: number) => n.toFixed(2);

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

/** A brushed ring as a filled shape: width swells at the entry, thins and splits into dry streaks at the lift. */
function brushPath(start: number, sweep: number, seed: number, base = 8.5): string {
  const N = 220;
  const outer: string[] = [], inner: string[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const wob = Array.from({ length: 9 }, () => rnd() * 6.28);
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const th = start - sweep * u;
    const entry = Math.min(1, u / 0.045);
    const lift = u > 0.82 ? Math.max(0.12, 1 - (u - 0.82) / 0.18) : 1;
    const press = 0.55 + 0.7 * entry - 0.35 * u + 0.08 * Math.sin(u * 19 + wob[0]) + 0.05 * Math.sin(u * 47 + wob[1]);
    const w = base * press * lift;
    const rr = R + 1.6 * Math.sin(rad(th) * 3 + wob[2]) + 0.9 * Math.sin(rad(th) * 7 + wob[3]);
    const [ox, oy] = pt(th, rr + w / 2);
    const [ix, iy] = pt(th, rr - w / 2);
    outer.push(`${f(ox)},${f(oy)}`);
    inner.push(`${f(ix)},${f(iy)}`);
  }
  return `M${outer.join('L')}L${inner.reverse().join('L')}Z`;
}

/** Circle path starting at `deg`, running counter-clockwise on screen (sweep-flag 0), `turn` degrees. */
function arcPath(deg: number, turn: number, r = R): string {
  const steps = Math.ceil(turn / 179);
  let d = `M${pt(deg, r).map(f).join(',')}`;
  for (let i = 1; i <= steps; i++) {
    const a = deg - (turn * i) / steps;
    d += `A${r},${r} 0 0 0 ${pt(a, r).map(f).join(',')}`;
  }
  return d;
}

/** As arcPath, clockwise on screen (sweep-flag 1). */
function arcPathCW(deg: number, turn: number, r = R): string {
  const steps = Math.ceil(turn / 179);
  let d = `M${pt(deg, r).map(f).join(',')}`;
  for (let i = 1; i <= steps; i++) {
    const a = deg + (turn * i) / steps;
    d += `A${r},${r} 0 0 1 ${pt(a, r).map(f).join(',')}`;
  }
  return d;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Loop-local layout and legibility (layered over rituals.css). The ritual always sits on the loop chapter's
// paper, so its ink, scrims and chips are fixed paper/ink values, legible over any frame behind it: the map,
// the mist veil while the world loads, or the poster in no-WebGL mode.
const LOCAL_CSS = `
.loop {
  --fg: #1c1b19;
  --fg-2: rgba(28, 27, 25, 0.82);
  --fg-3: rgba(28, 27, 25, 0.74);
  --loop-chip: rgba(243, 237, 226, 0.86);
  /* a breath after the manifesto: the kicker only enters once the pinned reading block has gone */
  padding-top: 40svh;
  isolation: isolate;
}
/* the hold: an empty run after the stage, so the stage (kicker, hint, ring) stays put for this much scroll while
   the visitor plays (a sticky box only travels inside its parent's content box, not its padding) */
.loop__hold {
  height: 38svh;
  flex: none;
}
.slot.slot--loop {
  margin-bottom: 6svh;
}
/* The ritual stage holds still in the band between the HUD and the journey track (loopUI.ts sets --stage-top
   so the whole ring, its labels and the hint sit in that band, centred), instead of scrolling past the hand. */
.loop__stage {
  position: sticky;
  top: var(--stage-top, calc(var(--hud-top) + 12px));
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.loop__kicker,
.loop__status {
  position: relative;
  isolation: isolate;
}
.loop__kicker::before,
.loop__status::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: -6px -14px;
  border-radius: 999px;
  background: var(--loop-chip);
}
.loop__status::before {
  inset: -8px -22px;
  border-radius: 22px;
}
.loop__status:empty::before {
  display: none;
}
/* the instruction line sits under the kicker, in frame with the ring; its height is held at two lines so a
   longer message (picked / wrong / placed) never shifts the ring under the hand */
.loop .loop__kicker {
  margin-bottom: 14px;
}
.loop .loop__status {
  min-height: 2.9em;
  margin: 0 0 clamp(10px, 2.2vh, 22px);
  font-size: 16px;
  line-height: 1.45;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* the ring, its station labels and the hint always fit between the HUD and the journey track with air */
.loop__board {
  width: min(540px, 100%, calc(100svh - var(--hud-top) - var(--track-h) - 190px));
  min-width: min(280px, 100%);
}
.loop__board::before {
  inset: -15%;
  opacity: 1;
  background: radial-gradient(closest-side, rgba(243, 237, 226, 0.9) 0%, rgba(243, 237, 226, 0.86) 64%, rgba(243, 237, 226, 0) 100%);
}
.loop__label {
  padding: 3px 10px 4px;
  border-radius: 14px;
  background: var(--loop-chip);
}
html[data-tone] .loop__socket {
  background: #f3ede2;
}
.loop__word {
  fill: var(--fg-2);
  font-size: 12px;
}
/* closed: the ring hands the loop back to the map; the lights stay lit on their places */
.loop__art {
  transition: opacity 1200ms var(--ease-out);
}
.loop[data-world='true'][data-state='closed'] .loop__art {
  opacity: 0.5;
}
.loop[data-world='true'][data-state='closed'] .loop__board::before {
  opacity: 0.55;
  transition: opacity 1200ms var(--ease-out);
}
@media (max-width: 760px) {
  /* A phone's chapter is mostly pinned manifesto, so the ritual only begins past its middle: a short breath (the
     manifesto is already fading as the kicker enters, with clear air between) and a long hold, so the stage is
     settled in the band above the journey track from about 0.46 to 0.76 of the chapter, never riding into it. */
  .loop {
    padding-top: 14svh;
  }
  .loop__hold {
    height: 96svh;
  }
  .loop .loop__kicker {
    margin-bottom: 12px;
  }
  .loop .loop__status {
    max-width: 30ch;
    font-size: 15px;
    /* room for the rain station's label, which stands above the ring */
    margin-bottom: 34px;
  }
  .loop__board {
    width: min(100%, calc(100svh - var(--hud-top) - var(--track-h) - 210px));
  }
  .loop__board::before {
    inset: -9%;
  }
  .loop__word {
    font-size: 13.5px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .loop__art,
  .loop[data-state='closed'] .loop__board::before,
  .loop::before {
    transition: none;
  }
}
/* No live world behind the ring (no WebGL, the context was lost, or the chapter poster is still up while the
   world loads): the poster is a still of the map (scripts/shoot-posters.mjs renders it without the 3D stroke), and
   while the ritual is on screen a soft paper sheet lies over it so the ring and its labels read cleanly. It fades
   with the poster, never pops. */
.loop::before {
  content: '';
  position: absolute;
  z-index: -1;
  /* from just above the kicker (the .loop's breath stays clear) to just past the hold */
  inset: 22svh -100vw 0;
  background: rgba(243, 237, 226, 0.92);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 14svh, #000 calc(100% - 14svh), transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0, #000 14svh, #000 calc(100% - 14svh), transparent 100%);
  pointer-events: none;
  opacity: 0;
  transition: opacity 600ms var(--ease-out);
}
.loop[data-world='false']::before,
.loop[data-poster='true']::before {
  opacity: 1;
}
@media (max-width: 760px) {
  /* the shorter breath: the sheet still starts 14svh above the kicker */
  .loop::before {
    inset: 0 -100vw 0;
  }
}
/* No-WebGL poster: the ring stands alone (no second, mismatched poster circle behind it) */
html .chapter--loop,
html .poster--loop {
  --poster:
    radial-gradient(80% 50% at 50% 100%, rgba(157, 181, 168, 0.4), transparent 70%),
    linear-gradient(to bottom, #d8d6d0 0%, #ece6da 40%, #f3ede2 70%, #e3ddd0 100%);
}
`;

function injectCss() {
  if (document.getElementById('loop-ui-css')) return;
  const st = document.createElement('style');
  st.id = 'loop-ui-css';
  st.textContent = LOCAL_CSS;
  document.head.append(st);
}

export function init(app: App): void {
  const slot = document.querySelector<HTMLElement>('[data-slot="loop"]');
  if (!slot) return;
  const { game } = app;
  injectCss();

  // ---------------------------------------------------------------- DOM
  const root = document.createElement('div');
  root.className = 'loop';
  root.dataset.state = 'open';
  root.dataset.world = String(app.webgl);
  const kicker = document.createElement('p');
  kicker.className = 'loop__kicker';
  kicker.id = 'loop-kicker';
  kicker.textContent = LOOP_COPY.kicker;
  const board = document.createElement('div');
  board.className = 'loop__board';
  board.setAttribute('role', 'group');
  board.setAttribute('aria-labelledby', 'loop-kicker');
  board.setAttribute('aria-describedby', 'loop-status');

  const art = svg('svg', { viewBox: `0 0 ${VB} ${VB}`, class: 'loop__art', 'aria-hidden': 'true', focusable: 'false' });
  const defs = svg('defs');
  const rough = svg('filter', { id: 'loop-rough', x: '-10%', y: '-10%', width: '120%', height: '120%' });
  rough.append(
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.85', numOctaves: 2, seed: 4, result: 'n' }),
    svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: 2.4, xChannelSelector: 'R', yChannelSelector: 'G' }),
  );
  const mask = svg('mask', { id: 'loop-ink-mask', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: VB, height: VB });
  const runner = svg('path', {
    d: arcPath(ANGLE.love, 362),
    fill: 'none',
    stroke: '#fff',
    'stroke-width': 34,
    'stroke-linecap': 'round',
    pathLength: 1,
    'stroke-dasharray': '1 1',
    'stroke-dashoffset': 1,
  });
  mask.append(runner);
  defs.append(rough, mask);
  // arcs for the cycle words, just outside the ring, trimmed clear of the stations
  ARCS.forEach((a, i) => {
    const from = ANGLE[a.from], to = ANGLE[a.to];
    const turn = (from - to + 360) % 360;
    // side arcs are drawn so their words stand with their tops outward (left reads up, right reads down)
    const d = a.from === 'love' ? arcPath(from - 24, turn - 48, R + 20) : arcPathCW(to + 24, turn - 48, R + 20);
    defs.append(svg('path', { id: `loop-arc-${i}`, d }));
  });
  art.append(defs);

  const ring = svg('g', { class: 'loop__ring', filter: 'url(#loop-rough)' });
  ring.append(
    svg('path', { class: 'loop__ink', d: brushPath(GAP_START, GAP_SWEEP, 11) }),
    // dry-brush streaks where the brush lifts
    svg('path', { class: 'loop__dry', d: arcPath(GAP_START - GAP_SWEEP * 0.78, GAP_SWEEP * 0.2, R + 3.2), 'stroke-dasharray': '14 5 22 7 9 12' }),
    svg('path', { class: 'loop__dry', d: arcPath(GAP_START - GAP_SWEEP * 0.8, GAP_SWEEP * 0.19, R - 3.4), 'stroke-dasharray': '9 9 18 4 26 10' }),
  );
  const closing = svg('g', { class: 'loop__closing', mask: 'url(#loop-ink-mask)', filter: 'url(#loop-rough)' });
  closing.append(svg('path', { class: 'loop__ink loop__ink--close', d: brushPath(ANGLE.love + 4, 368, 29, 9.5) }));
  const words = svg('g', { class: 'loop__words' });
  ARCS.forEach((a, i) => {
    const t = svg('text', { class: 'loop__word', dy: -2 });
    const tp = svg('textPath', { href: `#loop-arc-${i}`, startOffset: '50%', 'text-anchor': 'middle' });
    tp.textContent = a.text;
    t.append(tp);
    words.append(t);
  });
  const traveller = svg('circle', { class: 'loop__traveller', r: 5, cx: -20, cy: -20 });
  const travellerGlow = svg('circle', { class: 'loop__traveller-glow', r: 16, cx: -20, cy: -20 });
  art.append(ring, closing, words, travellerGlow, traveller);
  board.append(art);

  type Station = { id: LightId; btn: HTMLButtonElement; x: number; y: number };
  type Token = { id: LightId; btn: HTMLButtonElement; hx: number; hy: number };
  const stations: Station[] = [];
  const tokens: Token[] = [];

  THREE_WORDS.forEach((w) => {
    const [x, y] = pt(ANGLE[w.id]);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'loop__station';
    b.dataset.light = w.id;
    b.style.left = `${(x / VB) * 100}%`;
    b.style.top = `${(y / VB) * 100}%`;
    b.style.setProperty('--c', `var(${w.color})`);
    b.innerHTML = `<span class="loop__socket" aria-hidden="true"></span>`;
    const lab = document.createElement('span');
    lab.className = `loop__label loop__label--${w.id}`;
    lab.setAttribute('aria-hidden', 'true');
    const [lx, ly] = pt(ANGLE[w.id], R + (w.id === 'forgive' ? 46 : 50));
    lab.style.left = `${(lx / VB) * 100}%`;
    lab.style.top = `${(ly / VB) * 100}%`;
    lab.innerHTML = `<span class="loop__water">${w.water}</span><span class="loop__name"><span class="loop__cjk" lang="zh-Hans">${w.cjk}</span> ${w.en}</span>`;
    board.append(b, lab);
    stations.push({ id: w.id, btn: b, x, y });
  });

  const homeY = C + 6;
  THREE_WORDS.forEach((w, i) => {
    const hx = C + (i - 1) * 74;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'loop__token';
    b.dataset.light = w.id;
    b.style.left = `${(hx / VB) * 100}%`;
    b.style.top = `${(homeY / VB) * 100}%`;
    b.style.setProperty('--c', `var(${w.color})`);
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span class="loop__orb" aria-hidden="true"></span><span class="loop__tname" aria-hidden="true">${w.en}</span>`;
    board.append(b);
    tokens.push({ id: w.id, btn: b, hx, hy: homeY });
  });

  // tab order: the lights first, then their places (pick, then Tab or arrows on to a station)
  stations[0].btn.before(...tokens.map((t) => t.btn));

  const status = document.createElement('p');
  status.className = 'loop__status';
  status.id = 'loop-status';
  status.setAttribute('aria-live', 'polite');
  // the instruction sits directly under the kicker, so it is always in frame with the ring (never below the
  // fold on desktop, never under the bottom blur and journey track on a phone)
  const stage = document.createElement('div');
  stage.className = 'loop__stage';
  stage.append(kicker, status, board);
  const hold = document.createElement('div');
  hold.className = 'loop__hold';
  hold.setAttribute('aria-hidden', 'true');
  root.append(stage, hold);
  slot.append(root);
  // Centre the held stage in the band between the HUD and the journey track (both are CSS lengths, read once per
  // resize through a probe). If the stage is taller than the band, its foot stays clear of the track.
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:var(--hud-top);height:var(--track-h);visibility:hidden;pointer-events:none';
  document.body.append(probe);
  const placeStage = () => {
    const hud = probe.offsetWidth || 64;
    const track = probe.offsetHeight || 76;
    const vh = window.innerHeight;
    const h = stage.offsetHeight;
    const free = vh - hud - track - h;
    const top = free >= 0 ? hud + free * 0.45 : vh - track - 16 - h;
    root.style.setProperty('--stage-top', `${Math.round(Math.max(8, top))}px`);
  };
  // The edges of the frame: the HUD band (top) and the journey track with its blur (bottom) are transparent, so
  // the stage fades out through a mask as it passes into either one instead of sliding under it at full ink
  // (the same hand-off as Next's copy, tally.ts). Scroll-linked and reversible, with no motion of its own, so it
  // holds under reduced motion and without WebGL too. The mask layer reaches past the stage (no-clip + an
  // oversized layer) so the board's scrim, which overhangs the stage's foot, is not cut by it; and it is set only
  // while the fade actually meets the stage's content (the board's lowest ~12% is scrim, no ink).
  const FADE = 56;
  const MASK_PROPS = ['mask-image', 'mask-size', 'mask-position', 'mask-repeat', 'mask-clip'];
  let masked = false;
  let fadeRaf = 0;
  const fadeEdges = () => {
    fadeRaf = 0;
    const hud = probe.offsetWidth || 64;
    const track = probe.offsetHeight || 76;
    const r = stage.getBoundingClientRect();
    const inkFoot = r.height - 0.12 * board.offsetHeight;
    const topCut = hud - r.top; // px into the stage where the HUD's lower edge falls
    const botCut = window.innerHeight - track - 8 - r.top; // px into the stage where the track's blur begins
    if (!(topCut > -FADE || botCut - FADE < inkFoot)) {
      if (masked) {
        for (const p of MASK_PROPS) stage.style.removeProperty(p), stage.style.removeProperty(`-webkit-${p}`);
        masked = false;
      }
      return;
    }
    const over = Math.round(0.3 * board.offsetHeight); // the layer's reach past the stage on every side
    const a = Math.round(topCut) + over, b = Math.round(botCut) + over;
    const set: Record<string, string> = {
      'mask-image': `linear-gradient(to bottom, transparent ${a}px, #000 ${a + FADE}px, #000 ${b - FADE}px, transparent ${b}px)`,
      'mask-size': `${Math.round(r.width) + 2 * over}px ${Math.round(r.height) + 2 * over}px`,
      'mask-position': `${-over}px ${-over}px`,
      'mask-repeat': 'no-repeat',
      'mask-clip': 'no-clip',
    };
    for (const p of MASK_PROPS) stage.style.setProperty(p, set[p]), stage.style.setProperty(`-webkit-${p}`, set[p]);
    masked = true;
  };
  const queueFade = () => {
    if (!fadeRaf) fadeRaf = requestAnimationFrame(fadeEdges);
  };
  window.addEventListener('scroll', queueFade, { passive: true });
  new ResizeObserver(() => {
    placeStage();
    queueFade();
  }).observe(stage);
  window.addEventListener(
    'resize',
    () => {
      placeStage();
      queueFade();
    },
    { passive: true },
  );
  placeStage();
  queueFade();
  // The world can fail (context loss) or come back at runtime: the closed-state hand-back to the map only
  // applies while a world is actually drawn behind the ring.
  const worldEl = document.getElementById('world');
  const setWorld = (on: boolean) => (root.dataset.world = String(on));
  worldEl?.addEventListener('world:failed', () => setWorld(false));
  worldEl?.addEventListener('world:restored', () => setWorld(true));
  // While the world loads (deep link, reload at depth, a slow device) the engine holds the chapter's DOM poster up
  // (#posters, inline display/opacity). That still has the map's loop in full ink, so the paper sheet covers it
  // under the ritual until the live frame (with its loop stepped back) takes over.
  const posters = document.getElementById('posters');
  if (posters) {
    const posterUp = () =>
      (root.dataset.poster = String(app.webgl && posters.style.display === 'block' && posters.style.opacity !== '0'));
    new MutationObserver(posterUp).observe(posters, { attributes: true, attributeFilter: ['style'] });
    posterUp();
  }
  // This ritual sits in its chapter's trailing content, where the pinned copy is (correctly) off stage.
  // reveal.ts travels to a chapter's start on any focusin while its pin is hidden; keep focus here local
  // so typing or picking never yanks the page away.
  root.addEventListener('focusin', (e) => e.stopPropagation());

  const HINT = LOOP_COPY.hint;
  const say = (s: string) => {
    status.textContent = s;
  };

  // ---------------------------------------------------------------- state
  const word = (id: LightId) => THREE_WORDS.find((w) => w.id === id)!;
  let picked: Token | null = null;
  let completing = false;
  let closeRaf = 0; // the running closing cycle, cancelled by a reset

  function label() {
    const s = game.get();
    tokens.forEach((t) => {
      const w = word(t.id);
      const placed = s.placed.includes(t.id) || s.loopClosed;
      const earned = s.lights.includes(t.id);
      t.btn.dataset.earned = String(earned || placed);
      t.btn.dataset.placed = String(placed);
      t.btn.tabIndex = placed ? -1 : 0;
      t.btn.setAttribute('aria-disabled', String(placed));
      t.btn.setAttribute(
        'aria-label',
        placed ? LOOP_COPY.tokenPlaced(w.en, w.cjk, w.water) : LOOP_COPY.tokenOpen(w.en, w.cjk, earned),
      );
    });
    stations.forEach((st) => {
      const w = word(st.id);
      const filled = s.placed.includes(st.id) || s.loopClosed;
      st.btn.dataset.filled = String(filled);
      st.btn.setAttribute(
        'aria-label',
        filled
          ? LOOP_COPY.stationFilled(w.water, w.en, w.cjk)
          : picked
            ? LOOP_COPY.stationArmed(word(picked.id).en, w.water, w.en, w.cjk)
            : LOOP_COPY.stationIdle(w.water, w.en, w.cjk),
      );
    });
    root.dataset.armed = String(Boolean(picked));
  }

  function moveTo(t: Token, x: number, y: number, animate: boolean, done?: () => void) {
    const from = { left: t.btn.style.left, top: t.btn.style.top };
    t.btn.style.left = `${(x / VB) * 100}%`;
    t.btn.style.top = `${(y / VB) * 100}%`;
    t.btn.style.translate = '';
    if (!animate || app.reducedMotion) return done?.();
    const anim = t.btn.animate([from, { left: t.btn.style.left, top: t.btn.style.top }], { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    anim.onfinish = () => done?.();
  }

  function shakeHome(t: Token) {
    const b = t.btn;
    b.dataset.wrong = 'true';
    const settle = () => {
      if (app.reducedMotion) return void setTimeout(() => (b.dataset.wrong = 'false'), 700);
      b.animate(
        [{ transform: 'translate(-50%, -50%) translateX(0)' }, { transform: 'translate(-50%, -50%) translateX(-5px)' }, { transform: 'translate(-50%, -50%) translateX(4px)' }, { transform: 'translate(-50%, -50%) translateX(-2px)' }, { transform: 'translate(-50%, -50%) translateX(0)' }],
        { duration: 420, easing: 'ease-out' },
      ).onfinish = () => (b.dataset.wrong = 'false');
    };
    moveTo(t, t.hx, t.hy, true, settle);
  }

  function pick(t: Token | null) {
    if (picked) picked.btn.setAttribute('aria-pressed', 'false');
    picked = t;
    if (t) {
      t.btn.setAttribute('aria-pressed', 'true');
      const w = word(t.id);
      say(LOOP_COPY.picked(w.en));
    }
    label();
  }

  function attempt(t: Token, st: Station) {
    const s = game.get();
    if (s.placed.includes(t.id) || completing) return;
    const w = word(t.id);
    if (st.id !== t.id) {
      pick(null);
      say(LOOP_COPY.wrong(w.en, w.cjk, w.water));
      shakeHome(t);
      t.btn.focus({ preventScroll: true });
      return;
    }
    pick(null);
    moveTo(t, st.x, st.y, true);
    const willClose = s.placed.length === 2;
    // The loop closes in game state only once the cycle has gone round (complete() below): the HUD gap, the
    // live announcement, the world bloom and the resolve cue all key off that one commit (hud.ts emits 'loop:closed').
    game.place(t.id, { close: false });
    bus.emit('loop:placed', { id: t.id });
    if (!willClose) {
      say(LOOP_COPY.placed(w.en, w.cjk, w.water));
      const next = tokens.find((x) => !game.get().placed.includes(x.id));
      next?.btn.focus({ preventScroll: true });
    } else {
      complete(true);
    }
  }

  // ---------------------------------------------------------------- the cycle, once round
  function setClosed() {
    root.dataset.state = 'closed';
    runner.setAttribute('stroke-dashoffset', '0');
    tokens.forEach((t) => {
      const st = stations.find((s) => s.id === t.id)!;
      moveTo(t, st.x, st.y, false);
    });
    say(LOOP_COPY.closed);
    label();
  }

  function complete(animate: boolean) {
    if (root.dataset.state === 'closed' || completing) return;
    if (!animate || app.reducedMotion) {
      setClosed();
      game.closeLoop();
      return;
    }
    completing = true;
    root.dataset.state = 'closing';
    say(LOOP_COPY.closing);
    const len = runner.getTotalLength();
    const cols = THREE_WORDS.map((w) => css(w.color) || '#f2a93b');
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / CYCLE_MS);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // ease in-out cubic: a pour, not a spin
      runner.setAttribute('stroke-dashoffset', String(1 - e));
      const p = runner.getPointAtLength(len * e);
      const seg = Math.min(2, Math.floor(e * 3));
      for (const c of [traveller, travellerGlow]) {
        c.setAttribute('cx', f(p.x));
        c.setAttribute('cy', f(p.y));
        c.style.setProperty('--c', cols[seg]);
      }
      if (k < 1) closeRaf = requestAnimationFrame(tick);
      else {
        closeRaf = 0;
        completing = false;
        // only close if the game still agrees (a reset mid-cycle cancels this tick, but be sure)
        if (game.get().placed.length < 3 && !game.get().loopClosed) return sync(game.get());
        setClosed();
        game.closeLoop();
      }
    };
    closeRaf = requestAnimationFrame(tick);
  }

  function cancelClosing() {
    if (closeRaf) cancelAnimationFrame(closeRaf);
    closeRaf = 0;
    completing = false;
    for (const c of [traveller, travellerGlow]) {
      c.setAttribute('cx', '-20');
      c.setAttribute('cy', '-20');
    }
  }

  // ---------------------------------------------------------------- input
  let suppressClick = false;
  tokens.forEach((t) => {
    const b = t.btn;
    let start: { x: number; y: number; id: number } | null = null;
    let dragging = false;
    b.addEventListener('pointerdown', (e) => {
      if (game.get().placed.includes(t.id) || completing || e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dragging = false;
      b.setPointerCapture(e.pointerId);
    });
    b.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragging && Math.hypot(dx, dy) > 6) {
        dragging = true;
        b.dataset.dragging = 'true';
        pick(t);
      }
      if (dragging) b.style.translate = `${dx}px ${dy}px`;
    });
    const end = (e: PointerEvent, cancelled = false) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      if (!dragging) return; // a tap: the click handler picks it up
      dragging = false;
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      b.dataset.dragging = 'false';
      const br = board.getBoundingClientRect();
      const scale = br.width / VB;
      let best: Station | null = null, bestD = Infinity;
      for (const st of stations) {
        const d = Math.hypot(e.clientX - (br.left + st.x * scale), e.clientY - (br.top + st.y * scale));
        if (d < bestD) (bestD = d), (best = st);
      }
      const r = b.getBoundingClientRect();
      const cx = (r.left + r.width / 2 - br.left) / scale, cy = (r.top + r.height / 2 - br.top) / scale;
      // the drop point becomes the token's position, so the move home starts where the hand let go
      b.style.translate = '';
      b.style.left = `${(cx / VB) * 100}%`;
      b.style.top = `${(cy / VB) * 100}%`;
      if (!cancelled && best && bestD < Math.max(46, 64 * scale)) attempt(t, best);
      else {
        pick(null);
        say(HINT);
        moveTo(t, t.hx, t.hy, true);
      }
    };
    b.addEventListener('pointerup', (e) => end(e));
    b.addEventListener('pointercancel', (e) => end(e, true));
    b.addEventListener('click', () => {
      if (suppressClick || game.get().placed.includes(t.id) || completing) return;
      pick(picked === t ? null : t);
      if (!picked) say(HINT);
    });
    b.addEventListener('keydown', (e) => {
      if (!picked || picked !== t) return;
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const order = stations.filter((s) => !game.get().placed.includes(s.id));
        (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? order[order.length - 1] : order[0])?.btn.focus();
      }
    });
  });

  stations.forEach((st, i) => {
    st.btn.addEventListener('click', () => {
      if (completing || game.get().placed.includes(st.id)) return;
      if (!picked) {
        say(LOOP_COPY.pickFirst(word(st.id).water, word(st.id).en));
        return;
      }
      attempt(picked, st);
    });
    st.btn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && picked) {
        e.preventDefault();
        const t = picked;
        pick(null);
        say(HINT);
        t.btn.focus();
        return;
      }
      if (!e.key.startsWith('Arrow')) return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      const open = stations.filter((s) => !game.get().placed.includes(s.id));
      if (!open.length) return;
      const at = open.indexOf(st);
      open[(at + dir + open.length) % open.length].btn.focus();
      void i;
    });
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && picked) {
      const t = picked;
      pick(null);
      say(HINT);
      t.btn.focus();
    }
  });

  // ---------------------------------------------------------------- persisted state + outside changes
  function sync(s: Readonly<GameState>) {
    if (s.loopClosed) {
      if (!completing) setClosed();
      return;
    }
    if (s.placed.length >= 3 && !completing) {
      // all three were placed but the page went away mid-cycle: finish quietly
      complete(false);
      return;
    }
    root.dataset.state = 'open';
    runner.setAttribute('stroke-dashoffset', '1');
    tokens.forEach((t) => {
      const st = stations.find((x) => x.id === t.id)!;
      if (s.placed.includes(t.id)) moveTo(t, st.x, st.y, false);
      else moveTo(t, t.hx, t.hy, false);
    });
    say(HINT);
    label();
  }
  sync(game.get());
  game.subscribe((s, ev) => {
    if (ev.type === 'reset') {
      cancelClosing();
      pick(null);
      sync(s);
    } else if (ev.type === 'loopClosed' && root.dataset.state === 'open' && !completing && s.placed.length < 3) {
      // closed from elsewhere (the end of the scroll): show it complete, quietly
      setClosed();
    } else if (ev.type === 'light') label();
  });
}
