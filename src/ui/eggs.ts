// Easter eggs (SPEC §4.5). Discoverable, never required; each one degrades to nothing.
// 1. Typed words: "love" / "gratitude" / "forgive" anywhere outside a field pulses that light + a calligraphic flash.
// 2. The moon (bus 'moon:click'): the Zhang Jiuling couplet, then the current time in Jiangyin.
// 3. Live Seattle weather (Open-Meteo, no key, cached 30 min) -> bus 'weather'; a caption if it is dry.
// 4. CSO lanterns (bus 'lantern:release'): a counter climbs with each release and tops out at "2,000+ Students reached".
import '../styles/eggs.css';
import type { App } from '../app';
import { bus } from '../bus';
import { EGG_COPY, MOON_POEM, THREE_WORDS, type ChapterId, type LightId } from '../content/story';

const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=47.655&longitude=-122.308&current=precipitation,rain,weather_code';
const WEATHER_KEY = 'tlwh.weather';
const WEATHER_TTL = 30 * 60 * 1000;
const AUTHORED_RAIN = { rain: 0.6, label: 'authored rain', live: false } as const;
const DRY_CAPTION = EGG_COPY.dryCaption;
const LANTERN_CAPTION = EGG_COPY.lanternCaption;
const LANTERN_LABEL = EGG_COPY.lanternLabel;
const LANTERN_TOP = EGG_COPY.lanternTop; // résumé: CSO, 2,000+ students (the counter never passes it)
const LANTERN_THRESHOLD = 5; // releases until the counter tops out

type Weather = { rain: number; label: string; live: boolean };

let root: HTMLElement;
let reduced = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function announce(msg: string) {
  const live = document.getElementById('live');
  if (!live) return;
  live.textContent = '';
  requestAnimationFrame(() => (live.textContent = msg));
}

// ---------------------------------------------------------------------------------------------
// 1. Typed words

function initTypedWords() {
  const words = THREE_WORDS.map((w) => ({ ...w, word: w.id as string }));
  const longest = Math.max(...words.map((w) => w.word.length));
  let typed = '';
  const flash = el('div', 'egg-flash');
  flash.setAttribute('aria-hidden', 'true');
  root.appendChild(flash);
  let timer = 0;

  function show(id: LightId) {
    const w = THREE_WORDS.find((x) => x.id === id)!;
    flash.textContent = w.cjk;
    flash.style.setProperty('--egg-color', `var(${w.color})`);
    flash.classList.remove('is-on');
    void flash.offsetWidth; // restart the animation
    flash.classList.add('is-on');
    clearTimeout(timer);
    timer = window.setTimeout(() => flash.classList.remove('is-on'), 1700);
    announce(`${w.en}.`);
  }

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
      typed = '';
      return;
    }
    if (e.key.length !== 1 || !/[a-z]/i.test(e.key)) {
      typed = '';
      return;
    }
    typed = (typed + e.key.toLowerCase()).slice(-longest);
    for (const w of words) {
      if (typed.endsWith(w.word)) {
        typed = '';
        bus.emit('light:pulse', { id: w.id });
        bus.emit('ripple', { x: 0, y: -0.2, strength: 1 });
        show(w.id);
        break;
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 2. The moon

function jiangyinTime() {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', minute: '2-digit' }).format(new Date());
  } catch {
    return null;
  }
}

function initMoon() {
  const overlay = el('div', 'egg-moon');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'egg-moon-en');

  const disc = el('div', 'egg-moon__disc');
  disc.setAttribute('aria-hidden', 'true');

  const fig = el('figure', 'egg-moon__poem');
  const zh = el('p', 'egg-moon__zh');
  zh.lang = 'zh-Hans';
  // One column per line of the couplet (vertical, read right to left).
  for (const line of MOON_POEM.zh.split(/(?<=，)/)) zh.appendChild(el('span', 'egg-moon__col', line));
  const en = el('p', 'egg-moon__en', MOON_POEM.en);
  en.id = 'egg-moon-en';
  const cite = el('figcaption', 'egg-moon__cite', MOON_POEM.attribution);
  fig.append(zh, en, cite);

  const now = el('p', 'egg-moon__now');
  const close = el('button', 'egg-moon__close', MOON_POEM.close);
  close.type = 'button';

  const inner = el('div', 'egg-moon__inner');
  inner.append(fig, now, close);
  overlay.append(disc, inner);
  root.appendChild(overlay);

  let lastFocus: HTMLElement | null = null;
  let open = false;

  function show() {
    if (open) return;
    open = true;
    const time = jiangyinTime();
    now.textContent = time ? MOON_POEM.now(time) : MOON_POEM.nowFallback;
    lastFocus = document.activeElement as HTMLElement | null;
    overlay.hidden = false;
    document.documentElement.classList.add('egg-open');
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    close.focus({ preventScroll: true });
  }

  function hide() {
    if (!open) return;
    open = false;
    overlay.classList.remove('is-open');
    document.documentElement.classList.remove('egg-open');
    const done = () => {
      if (!open) overlay.hidden = true;
    };
    if (reduced) done();
    else setTimeout(done, 650);
    lastFocus?.focus?.({ preventScroll: true });
  }

  overlay.addEventListener('click', hide);
  window.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      hide();
    } else if (e.key === 'Tab') {
      // Single focusable element: keep focus inside the dialog.
      e.preventDefault();
      close.focus();
    }
  });
  bus.on('moon:click', show);
}

// ---------------------------------------------------------------------------------------------
// 3. Seattle weather

function codeToWeather(code: number): { base: number; label: string } {
  if (code >= 95) return { base: 1, label: 'thunderstorm' };
  if (code === 82) return { base: 0.95, label: 'heavy showers' };
  if (code === 81) return { base: 0.7, label: 'showers' };
  if (code === 80) return { base: 0.5, label: 'light showers' };
  if (code >= 85) return { base: 0.4, label: 'snow showers' };
  if (code >= 71) return { base: 0.35, label: 'snow' };
  if (code === 65 || code === 67) return { base: 0.9, label: 'heavy rain' };
  if (code === 63 || code === 66) return { base: 0.65, label: 'rain' };
  if (code === 61) return { base: 0.45, label: 'light rain' };
  if (code >= 51) return { base: 0.28, label: 'drizzle' };
  if (code >= 45) return { base: 0.05, label: 'fog' };
  return { base: 0, label: code <= 1 ? 'clear' : 'cloudy' };
}

export function mapWeather(cur: { precipitation?: number; rain?: number; weather_code?: number }): Weather {
  const code = Number(cur.weather_code ?? 0);
  const mm = Math.max(Number(cur.precipitation ?? 0), Number(cur.rain ?? 0));
  const { base, label } = codeToWeather(code);
  const rain = Math.min(1, Math.max(base, mm / 4));
  return { rain: Math.round(rain * 100) / 100, label: mm > 0 && base === 0 ? 'light rain' : label, live: true };
}

function readCache(): Weather | null {
  try {
    const raw = localStorage.getItem(WEATHER_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as { at: number; w: Weather };
    if (!c || Date.now() - c.at > WEATHER_TTL || typeof c.w?.rain !== 'number') return null;
    return c.w;
  } catch {
    return null;
  }
}

function writeCache(w: Weather) {
  try {
    localStorage.setItem(WEATHER_KEY, JSON.stringify({ at: Date.now(), w }));
  } catch {
    /* storage blocked: refetch next time */
  }
}

async function fetchWeather(): Promise<Weather> {
  const cached = readCache();
  if (cached) return cached;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 6000);
  try {
    const res = await fetch(WEATHER_URL, { signal: ac.signal });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { current?: { precipitation?: number; rain?: number; weather_code?: number } };
    if (!json.current) throw new Error('no current');
    const w = mapWeather(json.current);
    writeCache(w);
    return w;
  } catch {
    return { ...AUTHORED_RAIN };
  } finally {
    clearTimeout(t);
  }
}

function initWeather() {
  let weather: Weather = { ...AUTHORED_RAIN };
  let resolved = false;
  const emit = () => resolved && bus.emit('weather', weather);

  // The world loads after the UI, and the bus does not replay: re-send on load and on reaching the rain.
  bus.on('chapter', ({ id }) => {
    if (id === 'rain' || id === 'workshop') emit();
  });
  window.addEventListener('loader:done', () => setTimeout(emit, 50));

  void fetchWeather().then((w) => {
    weather = w;
    resolved = true;
    emit();
    if (w.live && w.rain < 0.05) placeDryCaption();
  });
}

function placeDryCaption() {
  const section = document.querySelector<HTMLElement>('[data-chapter="rain"]');
  if (!section || section.querySelector('.egg-dry')) return;
  const cap = el('p', 'egg-dry', DRY_CAPTION);
  const paras = section.querySelectorAll('p');
  const anchor = paras[paras.length - 1];
  if (anchor?.parentElement) anchor.parentElement.insertBefore(cap, anchor.nextSibling);
  else section.appendChild(cap);
}

// ---------------------------------------------------------------------------------------------
// 4. CSO lanterns

function initLanterns() {
  // A mono counter that climbs with each release and tops out at the real number, "2,000+", then the
  // caption "Students reached" (SPEC §4.5 #6). It never shows a number above the résumé's 2,000+.
  const cap = el('p', 'egg-lanterns');
  cap.hidden = true;
  const num = el('span', 'egg-lanterns__n', '0');
  const label = el('span', 'egg-lanterns__label', LANTERN_LABEL);
  label.hidden = true;
  cap.append(num, label);
  cap.setAttribute('aria-hidden', 'true'); // the live region carries the one real fact
  root.appendChild(cap);
  let shown = false;
  let chapter: ChapterId | null = null;
  let released = 0;
  let shownN = 0;
  let tween = 0;
  let hideTimer = 0;

  const fmt = (n: number) => n.toLocaleString('en-US');
  const target = () => Math.min(LANTERN_TOP, Math.round((released / LANTERN_THRESHOLD) * LANTERN_TOP));

  function paint(n: number) {
    shownN = n;
    num.textContent = n >= LANTERN_TOP ? `${fmt(LANTERN_TOP)}+` : fmt(n);
  }

  function climb() {
    const to = target();
    cancelAnimationFrame(tween);
    if (reduced) return paint(to);
    const from = shownN;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 650);
      const e = 1 - Math.pow(1 - k, 3);
      paint(k < 1 ? Math.min(LANTERN_TOP - 1, Math.round(from + (to - from) * e)) : to);
      if (k < 1) tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  }

  function release() {
    // Before the first chapter event the chapter is unknown; lanterns only exist in the rain anyway.
    if (chapter !== null && chapter !== 'rain') return;
    released++;
    window.clearTimeout(hideTimer);
    cap.hidden = false;
    requestAnimationFrame(() => cap.classList.add('is-on'));
    climb();
    if (released >= LANTERN_THRESHOLD) {
      label.hidden = false;
      if (!shown) announce(LANTERN_CAPTION);
      shown = true;
    }
  }

  // The world (rain.ts) answers every CSO-lantern activation (3D click or DOM mirror) with 'lantern:release'.
  // Without WebGL, or before the rain module has loaded, nobody answers: then the UI sends it itself, so the
  // counter, the caption and any other listener (sound) work the same everywhere.
  let heard = false;
  let selfEmit = false;
  bus.on('lantern:release', () => {
    if (!selfEmit) heard = true;
    release();
  });
  bus.on('keepsake:activate', ({ id }) => {
    if (id !== 'red-lantern') return;
    heard = false;
    queueMicrotask(() => {
      if (heard) return;
      selfEmit = true;
      bus.emit('lantern:release', { count: released + 1 });
      selfEmit = false;
    });
  });
  bus.on('chapter', ({ id }) => {
    chapter = id;
    if (id !== 'rain' && !cap.hidden) {
      cap.classList.remove('is-on');
      hideTimer = window.setTimeout(() => {
        if (!cap.classList.contains('is-on')) cap.hidden = true;
      }, reduced ? 0 : 700);
    }
  });
}

// ---------------------------------------------------------------------------------------------

export function init(app: App): void {
  reduced = app.reducedMotion;
  const host = document.getElementById('ui-root') ?? document.body;
  root = el('div', 'eggs');
  host.appendChild(root);
  if (reduced) root.classList.add('is-reduced');

  if (import.meta.env.DEV) (window as unknown as { __bus?: typeof bus }).__bus = bus;

  initTypedWords();
  initMoon();
  initWeather();
  initLanterns();
  injectCss();
}

// Counter layout on top of eggs.css's .egg-lanterns pill (mono number, then the caption once it tops out).
function injectCss() {
  if (document.getElementById('eggs-local-css')) return;
  const st = document.createElement('style');
  st.id = 'eggs-local-css';
  st.textContent = `
.egg-lanterns { display: flex; align-items: baseline; gap: 10px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.egg-lanterns[hidden] { display: none; }
.egg-lanterns::before { align-self: center; margin-right: 0; }
.egg-lanterns__n { min-width: 5.5ch; text-align: right; }
.egg-lanterns__label[hidden] { display: none; }
.egg-lanterns__label { font-family: var(--font-body); font-style: italic; letter-spacing: 0; }
`;
  document.head.appendChild(st);
}
