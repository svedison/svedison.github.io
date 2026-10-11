// Boot: game state, conductor, UI modules, then the WebGL world (if available).
// Keep boot order and failure handling: every UI module must work without the world.
import './styles/main.css';
import { createGame } from './game/state';
import { createConductor } from './world/conductor';
import type { App } from './app';
import { bus } from './bus';
import { CHAPTERS } from './content/story';
import { POSTER_TONE } from './world/types';
import * as hud from './ui/hud';
import * as logbook from './ui/logbook';
import * as satchel from './ui/satchel';
import * as atlas from './ui/atlas';
import * as reveal from './ui/reveal';
import * as live from './ui/live';
import * as eggs from './ui/eggs';
import * as forgive from './ui/forgive';
import * as loopUI from './ui/loopUI';
import * as trail from './ui/trail';
import * as hotspots from './ui/hotspots';
import * as audio from './ui/audio';
import * as tally from './ui/tally';

/** Longest the loader holds the page for the world, in ms after navigation start (src/loader/head.html agrees). */
const LOADER_CAP_MS = 3600;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-chapter]'));
const game = createGame();
const conductor = createConductor({ sections, reducedMotion });
const webgl = hasWebGL() && new URLSearchParams(location.search).get('webgl') !== '0';

const app: App = {
  game,
  conductor,
  reducedMotion,
  webgl,
  scrollToChapter(index, opts) {
    window.scrollTo({ top: conductor.yFor(index, 0.02), behavior: opts?.instant || reducedMotion ? 'auto' : 'smooth' });
  },
};

document.documentElement.classList.add('js');
document.documentElement.classList.toggle('no-webgl', !webgl);
document.documentElement.classList.toggle('reduced-motion', reducedMotion);

// Keepsake activation from any source (3D hotspot or DOM mirror) collects through the game layer.
bus.on('keepsake:activate', ({ id }) => {
  if (game.collect(id)) bus.emit('keepsake:collected', { id });
});

// The poster layer stays out of layout (display: none fetches no backgrounds) until reveal.ts has built the stills
// and lazyPosters() has held back the far ones; reveal.ts measures the page, which would otherwise fetch them all.
const posterHost = document.getElementById('posters');
if (posterHost) posterHost.style.display = 'none';
for (const m of [reveal, hud, live, logbook, satchel, atlas, hotspots, forgive, loopUI, eggs, trail, audio, tally]) {
  try {
    m.init(app);
  } catch (err) {
    console.error('[boot] UI module failed', err);
  }
  if (m === reveal) {
    try {
      lazyPosters();
    } catch (err) {
      console.error('[boot] poster lazy-load failed', err);
    }
    if (posterHost) posterHost.style.removeProperty('display');
  }
}
conductor.start();

// Poster stills (#posters, built by reveal.ts) are CSS backgrounds, and the layer is displayed while the world loads,
// so every still would be fetched at boot. Hold back all but the current chapter and its neighbours; the rest get
// their image once the reader comes within one chapter of them. (The no-JS posters are plain CSS on the chapters.)
function lazyPosters() {
  const els = Array.from(document.querySelectorAll<HTMLElement>('#posters .poster'));
  if (els.length !== CHAPTERS.length) return;
  const near = (index: number) =>
    els.forEach((el, i) => {
      if (Math.abs(i - index) <= 1) {
        el.style.removeProperty('background-image');
        el.dataset.posterLoaded = '';
      } else if (!('posterLoaded' in el.dataset)) el.style.backgroundImage = 'none';
    });
  // The conductor has not measured yet (it emits the first 'chapter' on its first frame), so start with every
  // still held back rather than guess index 0 and fetch the opening stills on a deep link.
  near(-2);
  bus.on('chapter', ({ index }) => near(index));
}

// Committed keepsakes to the world (and tally): on game reset here; on boot and after each module load via the engine.
const syncKeepsakes = () => bus.emit('keepsakes:sync', { ids: [...game.get().keepsakes] });
game.subscribe((_s, ev) => {
  if (ev.type === 'reset') syncKeepsakes();
});

// The loader leaves at the latest LOADER_CAP_MS after navigation start, whatever the world is doing: on a slow link
// three.js and the engine chunk alone can take seconds to arrive, and that wait used to sit in front of preload's
// own cap. The page underneath is complete; the chapter poster stands in until the engine's module lands.
let handedOff = false;
const handOff = () => {
  if (handedOff) return;
  handedOff = true;
  window.clearTimeout(capTimer);
  window.dispatchEvent(new CustomEvent('loader:done'));
};
// Already past the cap (the bundle itself arrived late): hand off now, not a task later behind boot work.
const capLeft = LOADER_CAP_MS - performance.now();
const capTimer = capLeft > 0 ? window.setTimeout(handOff, capLeft) : 0;
if (capLeft <= 0) handOff();

async function startWorld() {
  const canvas = document.getElementById('world') as HTMLCanvasElement;
  const veil = document.getElementById('veil') as HTMLElement;
  const root = document.documentElement;
  const posters = document.getElementById('posters');
  // Until the engine has drawn its first frames, the chapter's poster stands in (deep link / reload at depth),
  // with the poster's copy tone. The engine fades it out once the owning module has rendered.
  let booting = true;
  const posterTone = (index: number) => {
    if (booting) root.dataset.tone = POSTER_TONE[CHAPTERS[Math.max(0, Math.min(CHAPTERS.length - 1, index))].id];
  };
  if (posters) {
    posters.style.transition = 'none';
    posters.style.opacity = '1';
    posters.style.display = 'block';
  }
  posterTone(conductor.getState().index);
  const offTone = bus.on('chapter', ({ index }) => posterTone(index));
  const toPosters = () => {
    // Poster fallback: no mist veil left over the stills; posters and poster tone (hud.ts) take over.
    veil.style.opacity = '0';
    veil.style.background = '';
    if (posters) posters.style.cssText = '';
    root.classList.add('no-webgl');
    app.webgl = false;
  };
  try {
    const { createEngine } = await import('./world/engine');
    const engine = await createEngine({
      canvas,
      veil,
      posters: document.getElementById('posters'),
      toneTarget: root,
      reducedMotion,
      onModuleReady: syncKeepsakes,
    });
    canvas.addEventListener('world:failed', toPosters);
    canvas.addEventListener('world:restored', () => {
      root.classList.remove('no-webgl');
      app.webgl = true;
    });
    // The loader waits for the module where the reader is, but never past LOADER_CAP_MS after navigation start: on a
    // slow link or CPU the page is handed over with the chapter poster up and the module keeps loading behind it.
    await engine.preload(
      (p) => window.dispatchEvent(new CustomEvent('loader:progress', { detail: p })),
      conductor.getState().index,
      handedOff ? 0 : Math.max(0, LOADER_CAP_MS - performance.now()),
    );
    booting = false;
    offTone();
    engine.start();
    syncKeepsakes();
    handOff();
  } catch (err) {
    console.error('[boot] world failed, using poster fallback', err);
    booting = false;
    offTone();
    toPosters();
    handOff();
  }
}

if (webgl) startWorld();
else handOff();
