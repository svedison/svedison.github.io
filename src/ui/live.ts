// Polite live region (SPEC §11): committed changes only. Keepsakes, lights, arrivals, the loop closing.
// Never announces scroll progress. Also shows the one-time "Welcome back" toast for returning visitors.
import type { App } from '../app';
import { bus } from '../bus';
import { CHAPTERS, STATIONS, THREE_WORDS, type StationId } from '../content/story';
import { KEEPSAKES } from '../content/keepsakes';
import { LIVE_COPY } from '../content/ui';

let region: HTMLElement | null = null;
let timer = 0;

/** Announce a message politely: clear, then set after 30ms so repeats are re-read. */
export function announce(msg: string): void {
  if (!region) return;
  window.clearTimeout(timer);
  region.textContent = '';
  timer = window.setTimeout(() => {
    if (region) region.textContent = msg;
  }, 30);
}

function toast(text: string, ms = 4800) {
  const root = document.getElementById('ui-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('aria-hidden', 'true'); // the live region carries the same words
  el.textContent = text;
  root.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-on')));
  window.setTimeout(() => {
    el.classList.remove('is-on');
    window.setTimeout(() => el.remove(), 700);
  }, ms);
}

// Arrivals are announced only for real places on the map.
const PLACES: StationId[] = ['jiangyin', 'pacific', 'oc', 'seattle'];

export function init(app: App): void {
  region = document.getElementById('live');
  const { game } = app;

  game.subscribe((s, ev) => {
    if (ev.type === 'keepsake') {
      const k = KEEPSAKES.find((x) => x.id === ev.id);
      announce(LIVE_COPY.keepsake(k ? k.title : ev.id, ev.count, ev.total));
    } else if (ev.type === 'light') {
      const w = THREE_WORDS.find((x) => x.id === ev.id);
      announce(LIVE_COPY.light(w ? w.en : ev.id, s.lights.length));
    } else if (ev.type === 'loopClosed') {
      announce(LIVE_COPY.loopClosed);
    } else if (ev.type === 'reset') {
      announce(LIVE_COPY.reset);
    }
  });

  // Arrival at a station: commit only after the reader settles there (no spam during a fast flick).
  let current: StationId | null = null;
  let first = true;
  let settle = 0;
  bus.on('chapter', ({ index }) => {
    const station = CHAPTERS[index].station;
    if (first) {
      first = false;
      current = station;
      return;
    }
    if (station === current) return;
    current = station;
    window.clearTimeout(settle);
    settle = window.setTimeout(() => {
      if (!PLACES.includes(station)) return;
      const label = STATIONS.find((s) => s.id === station)?.label ?? station;
      announce(LIVE_COPY.arrived(label));
    }, 900);
  });

  const s = game.get();
  if (s.returning && s.keepsakes.length > 0) {
    const msg = LIVE_COPY.welcomeBack(s.keepsakes.length, game.total);
    // After the loader hands off, so the toast is seen.
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      toast(msg);
      announce(msg);
    };
    window.addEventListener('loader:done', () => window.setTimeout(show, 600), { once: true });
    window.setTimeout(show, 3200);
  }
}
