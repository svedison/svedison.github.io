// The Atlas (SPEC §4.4): an ink map of the Pacific rim with fog of war and fast travel.
//
// implement-fog-of-war, adapted to 2D:
//   game.visited (deterministic, persisted) owns the truth  ->  one fog canvas presents it.
//   Nothing reads pixels back; fast travel, station status and pins all read game state directly.
// horizontal-scroll-scenes rule 9/10: a long jump rolls ink smoke in (380 ms), jumps the page to just
//   short of the target, and only the final move plays. Any wheel, touch or nav key cancels.
//   Reduced motion: an instant jump.
//
// The coastline is an honest simplification: hand-placed lon/lat points traced from real coasts,
// smoothed and drawn as brush strokes. No decorative geography is invented.
import '../styles/game.css';
import type { App } from '../app';
import { bus } from '../bus';
import { KEEPSAKES } from '../content/keepsakes';
import {
  CHAPTERS,
  KM_JIANGYIN_TO_OC,
  KM_OC_TO_SEATTLE,
  KM_TOTAL,
  STATIONS,
  type ChapterId,
  type StationId,
} from '../content/story';
import { createModal, esc, gameLayer } from './satchel';
import { ATLAS_COPY } from '../content/ui';

type LL = [number, number]; // [lon, lat], lon in degrees east (negative = west)

// ---------------------------------------------------------------------------------------------
// Geography (simplified, traced from real coastlines)
// ---------------------------------------------------------------------------------------------

const COAST: LL[][] = [
  // Liaodong, Bohai, Shandong, Jiangsu down to the Yangtze's north bank
  [[124.3, 39.9], [123.2, 39.7], [122.3, 39.3], [121.6, 38.9], [121.2, 38.8], [121.5, 39.3], [122.0, 39.9], [122.2, 40.5], [121.4, 40.9], [120.5, 40.3], [119.5, 39.8], [118.6, 39.2], [117.7, 38.9], [117.8, 38.3], [118.6, 37.6], [119.2, 37.2], [120.0, 37.4], [120.8, 37.8], [121.6, 37.5], [122.5, 37.3], [122.1, 36.9], [121.0, 36.5], [120.1, 35.9], [119.3, 35.1], [119.4, 34.6], [120.3, 34.1], [120.8, 33.0], [121.2, 32.3], [121.9, 31.75]],
  // Yangtze's south bank, Hangzhou Bay, Zhejiang, Fujian, Guangdong, Gulf of Tonkin
  [[121.95, 31.05], [121.8, 30.85], [121.0, 30.6], [120.7, 30.35], [121.4, 30.1], [121.9, 29.9], [121.7, 29.2], [121.5, 28.4], [120.8, 27.8], [120.3, 27.0], [119.7, 26.2], [119.4, 25.4], [118.7, 24.6], [118.0, 24.4], [117.3, 23.7], [116.5, 23.1], [115.5, 22.8], [114.3, 22.4], [113.6, 22.2], [112.6, 21.8], [111.5, 21.5], [110.4, 21.1], [110.2, 20.4], [109.7, 21.5], [108.5, 21.6], [107.5, 21.2]],
  // Hainan
  [[110.1, 20.1], [111.0, 19.7], [110.5, 18.7], [109.6, 18.2], [108.7, 18.6], [108.7, 19.4], [109.5, 20.0], [110.1, 20.1]],
  // Taiwan
  [[121.5, 25.3], [121.9, 25.0], [121.6, 24.0], [121.0, 22.6], [120.7, 22.0], [120.3, 22.6], [120.1, 23.1], [120.2, 23.9], [120.8, 24.8], [121.5, 25.3]],
  // Luzon (northern tip)
  [[120.5, 17.2], [120.6, 18.5], [121.9, 18.4], [122.3, 17.2]],
  // Korea, then the Russian Far East coast to the Sea of Okhotsk
  [[124.3, 39.9], [125.0, 39.5], [125.3, 38.6], [126.0, 37.7], [126.6, 37.0], [126.4, 36.0], [126.5, 35.0], [126.4, 34.5], [127.5, 34.6], [128.5, 34.9], [129.3, 35.3], [129.5, 36.0], [129.4, 36.8], [129.0, 37.7], [128.4, 38.6], [127.6, 39.6], [128.4, 40.2], [129.7, 40.9], [129.8, 41.6], [130.6, 42.4], [131.9, 43.1], [133.2, 42.8], [135.2, 43.8], [137.3, 45.5], [138.6, 47.2], [140.3, 48.6], [140.5, 51.0], [141.3, 52.5], [140.9, 53.5], [139.8, 54.2], [137.7, 54.0], [136.8, 54.6], [138.6, 56.4], [141.0, 58.6], [143.5, 59.4], [146.5, 59.2], [148.8, 59.4], [151.3, 58.9], [154.2, 59.1], [155.0, 59.6]],
  // Kamchatka (west coast down, east coast up)
  [[156.0, 57.3], [156.7, 55.0], [156.6, 52.5], [156.7, 51.0], [158.3, 52.0], [160.0, 53.2], [160.0, 54.5], [162.0, 55.2], [163.1, 56.2], [162.3, 57.8], [163.5, 59.8]],
  // Sakhalin
  [[142.0, 46.0], [143.4, 46.6], [142.6, 48.0], [143.1, 49.5], [144.2, 49.0], [143.2, 51.0], [143.3, 53.0], [142.7, 54.3], [142.2, 52.0], [142.1, 49.0], [141.9, 47.0], [142.0, 46.0]],
  // Hokkaido
  [[140.0, 41.5], [140.5, 42.6], [139.9, 42.6], [141.4, 43.4], [141.6, 44.4], [141.9, 45.4], [143.0, 44.6], [144.4, 44.0], [145.3, 43.6], [145.7, 43.3], [144.4, 42.9], [143.3, 42.0], [141.6, 42.6], [140.9, 41.8], [140.0, 41.5]],
  // Honshu
  [[141.4, 41.4], [141.5, 40.6], [142.0, 39.6], [141.6, 38.4], [141.0, 37.9], [140.9, 36.9], [140.6, 35.8], [140.8, 35.3], [139.9, 34.9], [139.8, 35.5], [139.2, 35.2], [138.8, 34.6], [137.6, 34.7], [136.9, 34.5], [136.8, 34.2], [136.0, 33.5], [135.2, 33.8], [135.4, 34.6], [134.0, 34.6], [132.4, 34.3], [131.0, 34.0], [131.0, 34.4], [132.6, 35.5], [134.0, 35.5], [135.7, 35.5], [136.1, 36.2], [136.9, 37.1], [137.3, 36.8], [138.6, 37.6], [139.4, 38.4], [140.0, 39.6], [139.9, 40.6], [140.3, 41.2], [141.4, 41.4]],
  // Shikoku
  [[132.4, 33.9], [133.4, 33.4], [134.7, 33.8], [134.6, 34.2], [133.5, 34.3], [132.6, 34.2], [132.4, 33.9]],
  // Kyushu
  [[130.9, 34.0], [131.7, 33.6], [131.9, 32.6], [131.3, 31.4], [130.7, 31.0], [130.2, 31.4], [130.4, 32.6], [129.8, 33.0], [129.9, 33.6], [130.9, 34.0]],
  // Alaska Peninsula
  [[-148.0, 60.3], [-150.0, 59.6], [-151.5, 59.2], [-153.0, 58.0], [-155.5, 57.0], [-158.5, 56.0], [-161.5, 55.2], [-163.5, 54.7], [-164.9, 54.4]],
  // Gulf of Alaska, British Columbia, Puget Sound, Washington, Oregon, California, Baja, Gulf of California
  [[-148.0, 60.3], [-145.0, 60.3], [-142.0, 60.0], [-139.5, 59.6], [-137.0, 58.5], [-136.0, 57.8], [-134.5, 56.5], [-133.0, 55.2], [-131.5, 54.5], [-130.3, 54.2], [-129.5, 53.1], [-128.4, 52.0], [-127.6, 51.2], [-126.5, 50.6], [-125.0, 50.0], [-124.0, 49.6], [-123.2, 49.1], [-122.8, 48.9], [-122.5, 48.3], [-122.35, 47.75], [-122.4, 47.4], [-122.75, 47.2], [-122.9, 47.55], [-122.75, 48.0], [-123.4, 48.15], [-124.2, 48.25], [-124.7, 48.38], [-124.6, 47.9], [-124.2, 47.0], [-124.0, 46.2], [-123.95, 45.3], [-124.1, 44.4], [-124.2, 43.4], [-124.5, 42.8], [-124.2, 41.9], [-124.1, 41.0], [-124.4, 40.4], [-123.8, 39.6], [-123.7, 38.9], [-123.0, 38.1], [-122.5, 37.7], [-122.4, 37.2], [-121.9, 36.6], [-121.8, 36.2], [-120.9, 35.4], [-120.6, 34.6], [-119.6, 34.4], [-118.8, 34.0], [-118.4, 33.8], [-118.1, 33.75], [-117.9, 33.6], [-117.4, 33.2], [-117.1, 32.5], [-116.7, 31.8], [-116.2, 30.9], [-115.6, 30.3], [-114.9, 29.5], [-114.2, 28.3], [-114.1, 27.6], [-113.0, 26.7], [-112.2, 25.5], [-112.1, 24.6], [-111.0, 24.0], [-110.3, 23.3], [-109.9, 22.9], [-109.5, 23.3], [-110.3, 24.2], [-110.7, 24.8], [-111.4, 26.0], [-112.2, 27.2], [-112.8, 28.6], [-113.6, 29.8], [-114.6, 31.0], [-114.8, 31.8], [-113.6, 31.3], [-112.6, 30.0], [-111.5, 28.6], [-110.6, 27.6], [-109.5, 26.0], [-108.4, 25.2], [-107.2, 24.0], [-106.0, 22.8], [-105.4, 21.0], [-105.6, 20.3]],
  // Vancouver Island
  [[-123.4, 48.4], [-124.4, 48.6], [-125.6, 49.0], [-126.6, 49.6], [-127.6, 50.1], [-128.4, 50.8], [-127.6, 50.9], [-126.0, 50.4], [-125.0, 49.9], [-124.0, 49.3], [-123.4, 48.4]],
  // Haida Gwaii
  [[-131.7, 54.2], [-132.9, 53.9], [-132.1, 52.6], [-131.1, 52.2], [-131.7, 54.2]],
];

/** Island chains drawn as single brush dabs. */
const DABS: LL[] = [
  // Aleutians
  [-166.5, 53.8], [-168.5, 53.1], [-170.5, 52.6], [-173.0, 52.2], [-176.0, 51.8], [-178.5, 51.6], [178.0, 51.8], [175.0, 52.4], [173.0, 52.9],
  // Hawaii
  [-155.5, 19.6], [-156.4, 20.8], [-157.0, 21.45], [-158.0, 21.45], [-159.5, 22.05],
];

/** The Yangtze, from its mouth upstream past Jiangyin, Nanjing and Wuhan. */
const YANGTZE: LL[] = [[121.9, 31.4], [121.3, 31.65], [120.9, 31.95], [120.27, 31.93], [119.9, 32.25], [119.4, 32.2], [118.8, 32.05], [118.4, 31.6], [117.9, 31.0], [117.1, 30.6], [116.3, 29.9], [115.5, 29.8], [114.9, 30.3], [114.3, 30.55], [113.6, 30.2], [112.9, 29.6], [112.2, 30.2], [111.3, 30.7], [110.4, 31.0], [109.5, 30.9], [108.4, 30.6]];

/** The way here: Jiangyin, down the river, across the Pacific (through the Pacific station), up the coast. */
const ROUTE_SEA: LL[] = [[120.27, 31.92], [121.3, 31.6], [122.6, 31.2], [128, 30.6], [140, 31.0], [160, 32.4], [-170.0, 33.0], [-150, 33.6], [-132, 33.4], [-120.5, 33.2], [-117.83, 33.68]];
const ROUTE_COAST: LL[] = [[-117.83, 33.68], [-118.7, 33.4], [-121.2, 34.4], [-123.4, 37.3], [-125.0, 41.4], [-125.3, 45.5], [-125.1, 48.1], [-124.0, 48.35], [-123.0, 48.2], [-122.55, 47.9], [-122.308, 47.655]];

// ---------------------------------------------------------------------------------------------
// Projection: Pacific-centred equirectangular. On tall screens the open ocean band is compressed
// (shown honestly by fold marks) so the two coasts stay legible.
// ---------------------------------------------------------------------------------------------

const LON0 = 104;
const LON1 = 251;
const LAT0 = 16.5;
const LAT1 = 61;
const FOLD0 = 152;
const FOLD1 = 202;
const COS = Math.cos((38 * Math.PI) / 180);

interface View {
  w: number;
  h: number;
  s: number; // px per degree of latitude
  k: number; // ocean-band compression (1 = true proportion)
  ox: number;
  oy: number;
  dpr: number;
}

const norm = (lon: number) => (lon < 0 ? lon + 360 : lon);
function lonDeg(lon: number, k: number) {
  const l = norm(lon);
  if (l <= FOLD0) return l - LON0;
  if (l <= FOLD1) return FOLD0 - LON0 + (l - FOLD0) * k;
  return FOLD0 - LON0 + (FOLD1 - FOLD0) * k + (l - FOLD1);
}
function project(v: View, [lon, lat]: LL): [number, number] {
  return [v.ox + lonDeg(lon, v.k) * COS * v.s, v.oy + (LAT1 - lat) * v.s];
}

// ---------------------------------------------------------------------------------------------
// Deterministic noise (seeded, so the map is the same every time it is drawn)
// ---------------------------------------------------------------------------------------------

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Catmull-Rom densify. */
function smooth(pts: [number, number][], steps = 6): [number, number][] {
  if (pts.length < 3) return pts;
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** A brush stroke: a filled ribbon whose width swells and tapers, plus a dry-brush second pass. */
function brush(ctx: CanvasRenderingContext2D, raw: [number, number][], width: number, seed: number, alpha = 0.86) {
  const pts = smooth(raw, 5);
  const n = pts.length;
  if (n < 2) return;
  const r = rng(seed);
  // cumulative length
  const len: number[] = [0];
  for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[n - 1] || 1;
  // slow pressure wobble
  const knots = Array.from({ length: 12 }, () => 0.75 + r() * 0.5);
  const pressure = (u: number) => {
    const x = u * (knots.length - 1);
    const i = Math.floor(x);
    const f = x - i;
    const a = knots[i];
    const b = knots[Math.min(knots.length - 1, i + 1)];
    return a + (b - a) * (f * f * (3 - 2 * f));
  };
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const u = len[i] / total;
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    const taper = Math.min(1, u / 0.06, (1 - u) / 0.09);
    const w = (width * (0.35 + 0.65 * Math.max(0, taper)) * pressure(u)) / 2;
    left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
    right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  ctx.save();
  ctx.fillStyle = `rgba(28, 27, 25, ${alpha})`;
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const p of left) ctx.lineTo(p[0], p[1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
  // dry brush: thin broken hairlines just outside the ribbon
  ctx.strokeStyle = `rgba(28, 27, 25, ${alpha * 0.28})`;
  ctx.lineWidth = Math.max(0.6, width * 0.18);
  ctx.setLineDash([2 + r() * 10, 3 + r() * 8]);
  ctx.beginPath();
  const off = width * 0.55;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = left[i];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const d = Math.hypot(dx, dy) || 1;
    const x = p[0] + (dx / d) * off;
    const y = p[1] + (dy / d) * off;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------------------------

type Side = 'left' | 'right' | 'above' | 'below';
// Orange County hangs below its pin: to the left, the sea route runs straight through its coordinates.
const SIDE: Record<StationId, Side> = { jiangyin: 'below', pacific: 'above', oc: 'below', seattle: 'left', next: 'above' };

function stationChapter(id: StationId): number {
  return CHAPTERS.findIndex((c) => c.station === id);
}

function coordText(lat: number, lon: number) {
  return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
}

function keepsakesAt(id: StationId) {
  return KEEPSAKES.filter((k) => CHAPTERS.find((c) => c.id === k.chapter)?.station === id);
}

/** Pixel position of a station (the 'next' shore sits just beyond Seattle; it has no new coordinates). */
function stationPoint(v: View, id: StationId): [number, number] {
  const st = STATIONS.find((s) => s.id === id)!;
  const p = project(v, [st.lon, st.lat]);
  // lifted well clear of Seattle, so the two labels and their pins never crowd
  if (id === 'next') return [p[0] + Math.max(34, v.s * 3.2), p[1] - Math.max(50, v.s * 4.4)];
  return p;
}

// ---------------------------------------------------------------------------------------------
// Fast travel (one path for everyone: atlas stations, satchel "Go there", HUD track via 'travel:to')
// ---------------------------------------------------------------------------------------------

let travel: { timers: number[]; anims: Animation[]; off: () => void } | null = null;

function makeSmoke(): HTMLElement {
  let el = document.getElementById('ink-smoke');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ink-smoke';
    el.className = 'ink-smoke';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<i></i><span></span><span></span><span></span><span></span><span></span>';
  }
  if (!el.isConnected) gameLayer().appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------------------------

export function init(app: App): void {
  const root = document.createElement('div');
  root.className = 'atlas';
  root.hidden = true;
  root.innerHTML = `
    <section class="atlas__panel" role="dialog" aria-modal="true" aria-labelledby="atlas-title" aria-describedby="atlas-desc" tabindex="-1">
      <header class="atlas__head">
        <div class="atlas__titles">
          <h2 id="atlas-title" class="atlas__title">${ATLAS_COPY.title}</h2>
          <p id="atlas-desc" class="atlas__sub">${ATLAS_COPY.sub}</p>
        </div>
        <button type="button" class="game-close" data-close aria-label="${ATLAS_COPY.close}"><span aria-hidden="true">×</span></button>
      </header>
      <div class="atlas__stage" data-scroll>
        <div class="atlas__map">
          <canvas class="atlas__canvas" aria-hidden="true"></canvas>
          <p class="atlas__lat"><em>${ATLAS_COPY.latitude}</em> <span class="mono">${ATLAS_COPY.latitudeFigures}</span></p>
          <ol class="atlas__stations"></ol>
        </div>
      </div>
      <footer class="atlas__foot">
        <div class="atlas__odo">
          <p class="atlas__km"><span class="atlas__km-n">${KM_TOTAL.toLocaleString('en-US')}</span> <span class="atlas__km-u">${ATLAS_COPY.km}</span></p>
          <p class="atlas__legs mono">${ATLAS_COPY.legs(KM_JIANGYIN_TO_OC.toLocaleString('en-US'), KM_OC_TO_SEATTLE.toLocaleString('en-US'))}</p>
        </div>
        <ul class="atlas__legend mono" aria-label="${ATLAS_COPY.legend}">
          <li><span class="apin apin--found" aria-hidden="true"></span>${ATLAS_COPY.keepsakeFound}</li>
          <li><span class="apin" aria-hidden="true"></span>${ATLAS_COPY.stillOut}</li>
          <li><span class="fogkey" aria-hidden="true"></span>${ATLAS_COPY.notVisited}</li>
        </ul>
      </footer>
    </section>`;
  gameLayer().appendChild(root);

  const panel = root.querySelector<HTMLElement>('.atlas__panel')!;
  const stage = root.querySelector<HTMLElement>('.atlas__stage')!;
  const mapEl = root.querySelector<HTMLElement>('.atlas__map')!;
  const canvas = root.querySelector<HTMLCanvasElement>('.atlas__canvas')!;
  const latEl = root.querySelector<HTMLElement>('.atlas__lat')!;
  const list = root.querySelector<HTMLOListElement>('.atlas__stations')!;
  const ctx = canvas.getContext('2d')!;

  // Station buttons (DOM, so they are focusable, labelled and crisp); the canvas only draws.
  const btns = new Map<StationId, HTMLButtonElement>();
  for (const st of STATIONS) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `atlas-st atlas-st--${SIDE[st.id]}`;
    b.dataset.station = st.id;
    const ch = CHAPTERS[stationChapter(st.id)];
    const coords = st.id === 'next' ? CHAPTERS.find((c) => c.id === 'next')?.coords ?? '' : coordText(st.lat, st.lon);
    b.innerHTML = `<span class="atlas-st__dot" aria-hidden="true"></span><span class="atlas-st__label">
        <span class="atlas-st__name">${esc(st.id === 'next' ? ATLAS_COPY.nextShore : st.label)}${st.cjk ? ` <span class="atlas-st__cjk" lang="zh">${esc(st.cjk)}</span>` : ''}</span>
        <span class="atlas-st__coords mono">${esc(coords)}</span>
        <span class="atlas-st__status mono"></span>
      </span>`;
    b.addEventListener('click', () => {
      lastClick = b.getBoundingClientRect();
      bus.emit('travel:to', { id: ch.id });
    });
    li.appendChild(b);
    list.appendChild(li);
    btns.set(st.id, b);
  }
  let lastClick: DOMRect | null = null;

  // --- view / caches ---
  let view: View | null = null;
  let base: HTMLCanvasElement | null = null; // paper + ink, rebuilt on resize
  let fogTex: HTMLCanvasElement | null = null; // unrevealed wash, rebuilt on resize
  const fog = document.createElement('canvas'); // per-frame composed fog
  const reveal = new Map<StationId, number>(); // presentation-only reveal progress 0..1
  let raf = 0;

  function layout(): View {
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const latSpan = LAT1 - LAT0;
    const pad = 16;
    const aspect = sw / Math.max(1, sh);
    let k: number;
    let w: number;
    let h: number;
    let s: number;
    if (aspect < 1.05) {
      // Tall screen: fill the height and let the map pan sideways (stage scrolls on x).
      k = 0.42;
      const effW = lonDeg(LON1, k) * COS;
      s = (sh - pad * 2) / latSpan;
      s = Math.min(s, (sw * 2.5) / effW);
      w = Math.ceil(effW * s + pad * 2);
      h = sh;
    } else {
      k = aspect >= 1.55 ? 1 : 0.5 + ((aspect - 1.05) / 0.5) * 0.5;
      const effW = lonDeg(LON1, k) * COS;
      s = Math.min((sw - pad * 2) / effW, (sh - pad * 2) / latSpan);
      w = sw;
      h = sh;
    }
    const effW = lonDeg(LON1, k) * COS;
    const ox = (w - effW * s) / 2;
    const oy = (h - latSpan * s) / 2;
    return { w, h, s, k, ox, oy, dpr };
  }

  function buildBase(v: View) {
    const c = document.createElement('canvas');
    c.width = Math.round(v.w * v.dpr);
    c.height = Math.round(v.h * v.dpr);
    const g = c.getContext('2d')!;
    g.scale(v.dpr, v.dpr);
    const r = rng(7);
    // paper
    g.fillStyle = '#f3ede2';
    g.fillRect(0, 0, v.w, v.h);
    for (let i = 0; i < Math.round((v.w * v.h) / 2600); i++) {
      const x = r() * v.w;
      const y = r() * v.h;
      const a = r() * Math.PI;
      const l = 3 + r() * 9;
      g.strokeStyle = `rgba(90, 70, 45, ${0.03 + r() * 0.04})`;
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    // graticule: quiet parallels every 10°, labelled in mono at the left edge
    g.font = `500 10px ${getComputedStyle(document.documentElement).getPropertyValue('--font-mono') || 'monospace'}`;
    g.textBaseline = 'middle';
    for (let lat = 20; lat <= 60; lat += 10) {
      const y = v.oy + (LAT1 - lat) * v.s;
      g.strokeStyle = 'rgba(28, 27, 25, 0.10)';
      g.lineWidth = 0.75;
      g.setLineDash([1, 5]);
      g.beginPath();
      g.moveTo(v.ox, y);
      g.lineTo(v.w - v.ox, y);
      g.stroke();
      g.setLineDash([]);
      // the parallel's label is drawn above the fog, in drawMarkers(), so the wash never greys it out
    }
    // fold marks where the open ocean is compressed (only when it is)
    if (v.k < 0.98) {
      for (const lon of [FOLD0, FOLD1]) {
        const x = v.ox + lonDeg(lon, v.k) * COS * v.s;
        g.strokeStyle = 'rgba(28, 27, 25, 0.22)';
        g.lineWidth = 1;
        g.beginPath();
        for (let y = v.oy + v.s * 6; y < v.h - v.oy - v.s * 2; y += 7) {
          g.moveTo(x - 2, y);
          g.quadraticCurveTo(x + 2, y + 1.75, x - 2, y + 3.5);
        }
        g.stroke();
      }
    }
    // the route (dotted ink), under the coast
    const route = (pts: LL[]) => smooth(pts.map((p) => project(v, p)), 8);
    g.strokeStyle = 'rgba(28, 27, 25, 0.55)';
    g.lineWidth = 1.4;
    g.setLineDash([1.5, 5]);
    g.lineCap = 'round';
    for (const seg of [ROUTE_SEA, ROUTE_COAST]) {
      const pts = route(seg);
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.stroke();
    }
    g.setLineDash([]);
    // latitude line: Jiangyin to Orange County
    const jy = project(v, [120.27, 31.92]);
    const oc = project(v, [-117.83, 33.68]);
    g.strokeStyle = 'rgba(28, 27, 25, 0.62)';
    g.lineWidth = 1;
    g.setLineDash([7, 6]);
    g.beginPath();
    g.moveTo(jy[0], jy[1]);
    g.lineTo(oc[0], oc[1]);
    g.stroke();
    g.setLineDash([]);
    // coasts
    const cw = Math.max(1.6, Math.min(3.4, v.s * 0.2));
    COAST.forEach((line, i) => brush(g, line.map((p) => project(v, p)), cw, 101 + i * 13));
    for (const [i, d] of DABS.entries()) {
      const [x, y] = project(v, d);
      g.fillStyle = 'rgba(28, 27, 25, 0.78)';
      g.beginPath();
      g.ellipse(x, y, cw * (0.9 + (i % 3) * 0.25), cw * 0.55, -0.35, 0, Math.PI * 2);
      g.fill();
    }
    // the river: thinner, a touch lighter, wider at the mouth
    brush(g, YANGTZE.map((p) => project(v, p)).reverse(), cw * 0.95, 991, 0.72);
    g.font = `italic 400 ${Math.round(Math.max(11, Math.min(15, v.s * 1.05)))}px ${getComputedStyle(document.documentElement).getPropertyValue('--font-display') || 'serif'}`;
    g.fillStyle = 'rgba(28, 27, 25, 0.6)';
    g.textBaseline = 'alphabetic';
    const yz = project(v, [113.5, 29.0]);
    g.fillText(ATLAS_COPY.yangtze, yz[0], yz[1] + v.s * 1.2);
    const pac = project(v, [-160, 44]);
    g.font = `italic 400 ${Math.round(Math.max(13, Math.min(20, v.s * 1.4)))}px ${getComputedStyle(document.documentElement).getPropertyValue('--font-display') || 'serif'}`;
    g.fillStyle = 'rgba(28, 27, 25, 0.38)';
    g.textAlign = 'center';
    g.fillText(ATLAS_COPY.pacific, pac[0], pac[1]);
    g.textAlign = 'start';
    // soft vignette so the sheet reads as paper
    const vg = g.createRadialGradient(v.w / 2, v.h / 2, Math.min(v.w, v.h) * 0.35, v.w / 2, v.h / 2, Math.max(v.w, v.h) * 0.75);
    vg.addColorStop(0, 'rgba(120, 95, 60, 0)');
    vg.addColorStop(1, 'rgba(120, 95, 60, 0.12)');
    g.fillStyle = vg;
    g.fillRect(0, 0, v.w, v.h);
    return c;
  }

  /** The unrevealed ink-wash: layered, uneven, deterministic. */
  function buildFogTex(v: View) {
    const c = document.createElement('canvas');
    c.width = Math.round(v.w * v.dpr);
    c.height = Math.round(v.h * v.dpr);
    const g = c.getContext('2d')!;
    g.scale(v.dpr, v.dpr);
    const r = rng(41);
    g.fillStyle = 'rgba(219, 211, 197, 0.84)';
    g.fillRect(0, 0, v.w, v.h);
    const blobs = Math.round(40 + (v.w * v.h) / 22000);
    for (let i = 0; i < blobs; i++) {
      const x = r() * v.w;
      const y = r() * v.h;
      const rad = (0.08 + r() * 0.22) * Math.max(v.w, v.h * 1.4);
      const dark = r() < 0.35;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, dark ? `rgba(110, 100, 86, ${0.03 + r() * 0.05})` : `rgba(242, 236, 224, ${0.1 + r() * 0.18})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.save();
      g.translate(x, y);
      g.scale(1, 0.45 + r() * 0.3);
      g.translate(-x, -y);
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      g.restore();
    }
    // paper grain on top of the wash, so the fog reads as pigment on the same sheet
    for (let i = 0; i < Math.round((v.w * v.h) / 45); i++) {
      g.fillStyle = `rgba(90, 80, 65, ${0.03 + r() * 0.05})`;
      g.fillRect(r() * v.w, r() * v.h, 1, 1);
    }
    return c;
  }

  /** Clearing shapes for a station, in view px: list of [x, y, radius]. Deterministic per station. */
  function holes(v: View, id: StationId): [number, number, number][] {
    const R = Math.max(46, v.s * 6.4);
    const out: [number, number, number][] = [];
    const seed = { jiangyin: 3, pacific: 5, oc: 7, seattle: 11, next: 13 }[id];
    const r = rng(seed);
    const add = (p: [number, number], rad: number, jitter = 0.28) => {
      for (let i = 0; i < 4; i++) {
        out.push([p[0] + (r() - 0.5) * rad * jitter * 2, p[1] + (r() - 0.5) * rad * jitter * 1.4, rad * (0.72 + r() * 0.34)]);
      }
    };
    // walk a route by arc length so the cleared wake is continuous, not a string of beads
    const along = (route: LL[], rad: number, from = 0, to = 1) => {
      const pts = smooth(route.map((p) => project(v, p)), 6);
      const acc = [0];
      for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = acc[acc.length - 1];
      const step = Math.max(8, rad * 0.32);
      let j = 0;
      for (let d = total * from; d <= total * to; d += step) {
        while (j < acc.length - 2 && acc[j + 1] < d) j++;
        const f = (d - acc[j]) / Math.max(1e-6, acc[j + 1] - acc[j]);
        const p: [number, number] = [pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f];
        out.push([p[0] + (r() - 0.5) * rad * 0.3, p[1] + (r() - 0.5) * rad * 0.3, rad * (0.7 + r() * 0.45)]);
      }
    };
    // A route's wake only reaches a neighbouring station's ground when that station is visited too (fast travel can
    // skip one): otherwise the clearing stops well short, so an unvisited place never looks cleared.
    const seen = (s: StationId) => (reveal.get(s) ?? 0) > 0;
    if (id === 'pacific') {
      along(ROUTE_SEA, R * 0.62, seen('jiangyin') ? 0.04 : 0.12, seen('oc') ? 0.96 : 0.86);
    } else if (id === 'seattle') {
      add(stationPoint(v, 'seattle'), R);
      along(ROUTE_COAST, R * 0.5, seen('oc') ? 0 : 0.62);
    } else {
      add(stationPoint(v, id), id === 'jiangyin' ? R * 1.25 : R);
      if (id === 'jiangyin') add(project(v, [116.0, 30.6]), R * 0.9);
    }
    return out;
  }

  function composeFog(v: View) {
    fog.width = Math.round(v.w * v.dpr);
    fog.height = Math.round(v.h * v.dpr);
    const g = fog.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, fog.width, fog.height);
    g.drawImage(fogTex!, 0, 0);
    g.scale(v.dpr, v.dpr);
    const list: [number, number, number][] = [];
    for (const [id, p] of reveal) {
      if (p <= 0) continue;
      const e = 1 - Math.pow(1 - p, 3);
      for (const [x, y, rad] of holes(v, id)) list.push([x, y, rad * e]);
    }
    // cut
    g.globalCompositeOperation = 'destination-out';
    for (const [x, y, rad] of list) {
      if (rad < 1) continue;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(0.5, 'rgba(0,0,0,0.95)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // a wash dries darker at its edge: tint only where fog remains
    g.globalCompositeOperation = 'source-atop';
    for (const [x, y, rad] of list) {
      if (rad < 1) continue;
      const gr = g.createRadialGradient(x, y, rad * 0.55, x, y, rad * 1.25);
      gr.addColorStop(0, 'rgba(80, 70, 56, 0)');
      gr.addColorStop(0.55, 'rgba(80, 70, 56, 0.1)');
      gr.addColorStop(1, 'rgba(80, 70, 56, 0)');
      g.fillStyle = gr;
      g.fillRect(x - rad * 1.3, y - rad * 1.3, rad * 2.6, rad * 2.6);
    }
    g.globalCompositeOperation = 'source-over';
  }

  function currentStation(): StationId {
    const i = Math.min(CHAPTERS.length - 1, Math.max(0, app.conductor.getState().index));
    return CHAPTERS[i].station;
  }

  function drawMarkers(v: View) {
    const s = app.game.get();
    const g = ctx;
    const here = currentStation();
    // parallels' labels, over the fog with a paper halo (ink at 0.72 on paper passes 4.5:1)
    g.save();
    g.font = `500 10px ${getComputedStyle(document.documentElement).getPropertyValue('--font-mono') || 'monospace'}`;
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 3.5;
    g.strokeStyle = 'rgba(243, 237, 226, 0.92)';
    g.fillStyle = 'rgba(28, 27, 25, 0.72)';
    for (let lat = 20; lat <= 60; lat += 10) {
      const y = v.oy + (LAT1 - lat) * v.s - 7;
      g.strokeText(`${lat}° N`, v.ox + 4, y);
      g.fillText(`${lat}° N`, v.ox + 4, y);
    }
    g.restore();
    for (const st of STATIONS) {
      const [x, y] = stationPoint(v, st.id);
      const visited = s.visited.includes(st.id);
      if (st.id === 'next') {
        // a short dashed tick from Seattle towards the next shore
        const [sx, sy] = stationPoint(v, 'seattle');
        g.strokeStyle = `rgba(28, 27, 25, ${visited ? 0.6 : 0.35})`;
        g.lineWidth = 1;
        g.setLineDash([3, 4]);
        g.beginPath();
        g.moveTo(sx + 6, sy - 5);
        g.lineTo(x - 6, y + 5);
        g.stroke();
        g.setLineDash([]);
      }
      if (st.id === here) {
        g.fillStyle = 'rgba(242, 169, 59, 0.28)';
        g.beginPath();
        g.arc(x, y, 13, 0, Math.PI * 2);
        g.fill();
      }
      g.lineWidth = 1.5;
      g.strokeStyle = '#1c1b19';
      g.fillStyle = visited ? '#1c1b19' : '#f3ede2';
      g.beginPath();
      g.arc(x, y, visited ? 5 : 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (st.id === here) {
        g.fillStyle = '#f2a93b';
        g.beginPath();
        g.arc(x, y, 2.4, 0, Math.PI * 2);
        g.fill();
      }
      // keepsake pins: an arc under the station
      const ks = keepsakesAt(st.id);
      const n = ks.length;
      const rad = 19;
      ks.forEach((k, i) => {
        const a = Math.PI / 2 + (i - (n - 1) / 2) * 0.42 * (SIDE[st.id] === 'below' ? -1 : 1) + (SIDE[st.id] === 'below' ? Math.PI : 0);
        const px = x + Math.cos(a) * rad;
        const py = y + Math.sin(a) * rad;
        const found = s.keepsakes.includes(k.id);
        g.beginPath();
        g.arc(px, py, 3.6, 0, Math.PI * 2);
        if (found) {
          g.fillStyle = '#f2a93b';
          g.fill();
          g.lineWidth = 1;
          g.strokeStyle = '#1c1b19';
          g.setLineDash([]);
          g.stroke();
        } else {
          g.fillStyle = 'rgba(243, 237, 226, 0.9)';
          g.fill();
          g.lineWidth = 1;
          g.strokeStyle = 'rgba(28, 27, 25, 0.62)';
          g.stroke();
        }
      });
    }
  }

  function draw() {
    const v = view;
    if (!v || !base || !fogTex) return;
    composeFog(v);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(fog, 0, 0);
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    drawMarkers(v);
  }

  function positionDom(v: View) {
    const s = app.game.get();
    const here = currentStation();
    for (const st of STATIONS) {
      const b = btns.get(st.id)!;
      const [x, y] = stationPoint(v, st.id);
      b.style.left = `${x}px`;
      b.style.top = `${y}px`;
      const visited = s.visited.includes(st.id);
      const ks = keepsakesAt(st.id);
      const found = ks.filter((k) => s.keepsakes.includes(k.id)).length;
      const status = visited ? (ks.length ? ATLAS_COPY.count(found, ks.length) : ATLAS_COPY.visited) : ATLAS_COPY.fog;
      b.querySelector<HTMLElement>('.atlas-st__status')!.textContent = status;
      b.classList.toggle('is-visited', visited);
      if (st.id === here) b.setAttribute('aria-current', 'location');
      else b.removeAttribute('aria-current');
      const name = st.id === 'next' ? ATLAS_COPY.nextShore : st.label;
      b.setAttribute(
        'aria-label',
        ATLAS_COPY.stationAria(name, st.id === here, visited, found, ks.length),
      );
    }
    // latitude caption sits on the dashed line, over open water
    const jy = project(v, [120.27, 31.92]);
    const oc = project(v, [-117.83, 33.68]);
    const t = 0.3;
    latEl.style.left = `${jy[0] + (oc[0] - jy[0]) * t}px`;
    latEl.style.top = `${jy[1] + (oc[1] - jy[1]) * t}px`;
    const ang = Math.atan2(oc[1] - jy[1], oc[0] - jy[0]);
    latEl.style.setProperty('--ang', `${ang}rad`);
  }

  function resize() {
    if (!modal.isOpen) return;
    const v = layout();
    view = v;
    mapEl.style.width = `${v.w}px`;
    mapEl.style.height = `${v.h}px`;
    canvas.width = Math.round(v.w * v.dpr);
    canvas.height = Math.round(v.h * v.dpr);
    canvas.style.width = `${v.w}px`;
    canvas.style.height = `${v.h}px`;
    base = buildBase(v);
    fogTex = buildFogTex(v);
    positionDom(v);
    draw();
  }

  /** Animate newly visited stations' ink clearing (presentation only; truth is game.visited). */
  function syncReveal(animate: boolean) {
    const visited = new Set(app.game.get().visited);
    for (const id of [...reveal.keys()]) if (!visited.has(id)) reveal.delete(id);
    const fresh: StationId[] = [];
    for (const id of visited) if (!reveal.has(id)) fresh.push(id);
    if (!fresh.length) return draw();
    if (!animate || app.reducedMotion) {
      fresh.forEach((id) => reveal.set(id, 1));
      return draw();
    }
    fresh.forEach((id) => reveal.set(id, 0));
    const t0 = performance.now();
    cancelAnimationFrame(raf);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 1300);
      fresh.forEach((id, i) => reveal.set(id, Math.max(0, Math.min(1, k * 1.25 - i * 0.12))));
      draw();
      if (k < 1 && modal.isOpen) raf = requestAnimationFrame(step);
      else fresh.forEach((id) => reveal.set(id, 1));
    };
    raf = requestAnimationFrame(step);
  }

  const modal = createModal({
    name: 'atlas',
    root,
    initialFocus: () => btns.get(currentStation()) ?? panel,
    onOpen: () => {
      resize();
      syncReveal(true);
      // On a panning (tall) map, start centred on where the visitor is.
      if (view && stage.scrollWidth > stage.clientWidth) {
        const [x] = stationPoint(view, currentStation());
        stage.scrollLeft = Math.max(0, x - stage.clientWidth / 2);
      }
      document.fonts?.ready.then(() => modal.isOpen && resize()).catch(() => {});
    },
    onClose: () => cancelAnimationFrame(raf),
  });

  root.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-close]')) modal.close();
  });
  window.addEventListener('resize', () => modal.isOpen && resize(), { passive: true });

  // Truth: the station of every committed chapter is visited.
  bus.on('chapter', ({ index }) => app.game.visit(CHAPTERS[index].station));
  app.game.subscribe((_s, ev) => {
    if (!modal.isOpen || !view) return;
    if (ev.type === 'visited' || ev.type === 'reset') syncReveal(true);
    positionDom(view);
    draw();
  });

  // Key M: ui/hud.ts opens the atlas (window listener). This document listener runs first: it opens when
  // closed (so M works without the HUD too) and closes when open, stopping the HUD from reopening it.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.key !== 'm' && e.key !== 'M') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (modal.isOpen) {
      e.preventDefault();
      e.stopPropagation();
      modal.close();
    } else {
      modal.open();
    }
  });

  // ---- fast travel ----
  function endTravel() {
    if (!travel) return;
    travel.timers.forEach(clearTimeout);
    travel.off();
    travel = null;
  }

  function liftSmoke(smoke: HTMLElement, ms: number) {
    const a = smoke.animate([{ opacity: getComputedStyle(smoke).opacity }, { opacity: 0 }], {
      duration: ms,
      easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)',
      fill: 'forwards',
    });
    a.finished
      .then(() => {
        smoke.classList.remove('is-on');
        smoke.getAnimations({ subtree: true }).forEach((x) => x.cancel());
        smoke.style.opacity = '0';
      })
      .catch(() => {});
    return a;
  }

  function focusChapter(index: number) {
    const section = document.querySelector<HTMLElement>(`[data-chapter="${CHAPTERS[index].id}"]`);
    const h = section?.querySelector<HTMLElement>('h1, h2');
    if (!h) return;
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }

  /** Move keyboard focus to the target chapter's heading once that chapter is committed (and on stage). */
  let arriveOff: (() => void) | null = null;
  function focusOnArrival(index: number) {
    arriveOff?.();
    let timer = 0;
    const offBus = bus.on('chapter', ({ index: i }) => {
      if (i !== index) return;
      done();
      window.setTimeout(() => focusChapter(index), 120);
    });
    const done = () => {
      offBus();
      clearTimeout(timer);
      arriveOff = null;
    };
    timer = window.setTimeout(done, 4000);
    arriveOff = done;
    if (app.conductor.getState().index === index) {
      done();
      window.setTimeout(() => focusChapter(index), 120);
    }
  }

  function travelTo(index: number) {
    if (index < 0 || index >= CHAPTERS.length) return;
    endTravel();
    const cur = app.conductor.getState().index;
    const arrive = () => focusOnArrival(index);

    if (app.reducedMotion || Math.abs(index - cur) <= 1) {
      modal.close({ restoreFocus: false });
      app.scrollToChapter(index, { instant: app.reducedMotion });
      arrive();
      return;
    }

    const smoke = makeSmoke();
    const origin = lastClick ? { x: lastClick.left + 10, y: lastClick.top + 10 } : { x: innerWidth / 2, y: innerHeight / 2 };
    lastClick = null;
    smoke.style.setProperty('--ox', `${origin.x}px`);
    smoke.style.setProperty('--oy', `${origin.y}px`);
    smoke.getAnimations({ subtree: true }).forEach((x) => x.cancel());
    smoke.classList.add('is-on');
    const anims: Animation[] = [];
    // billows lead from the click point; the flat wash behind them catches up by 380 ms
    smoke.style.opacity = '1';
    anims.push(
      smoke.querySelector('i')!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: 'cubic-bezier(0.55, 0, 0.8, 0.2)', fill: 'forwards' }),
    );
    smoke.querySelectorAll('span').forEach((b, i) => {
      anims.push(
        b.animate(
          [
            { transform: 'translate(-50%, -50%) scale(0.15)', opacity: 0 },
            { transform: `translate(-50%, -50%) scale(${2.4 + i * 0.5})`, opacity: 1 },
          ],
          { duration: 380, delay: i * 26, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
        ),
      );
    });

    const cancel = (e: Event) => {
      if (e instanceof KeyboardEvent && !/^(Arrow|Page|Home|End|Space| |Escape)/.test(e.key === ' ' ? 'Space' : e.key)) return;
      endTravel();
      arriveOff?.();
      liftSmoke(smoke, 220);
    };
    const opts = { passive: true, capture: true } as const;
    window.addEventListener('wheel', cancel, opts);
    window.addEventListener('touchstart', cancel, opts);
    window.addEventListener('keydown', cancel, true);
    travel = {
      timers: [],
      anims,
      off: () => {
        window.removeEventListener('wheel', cancel, opts);
        window.removeEventListener('touchstart', cancel, opts);
        window.removeEventListener('keydown', cancel, true);
      },
    };

    // Covered: close the atlas, jump to just short of the target, then play only the final move.
    travel.timers.push(
      window.setTimeout(() => {
        modal.close({ restoreFocus: false });
        const fwd = index > cur;
        const y = fwd ? app.conductor.yFor(index - 1, 0.9) : app.conductor.yFor(index, 0.24);
        window.scrollTo({ top: y, behavior: 'auto' });
        arrive();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (!travel) return;
            app.scrollToChapter(index);
            liftSmoke(smoke, 640);
            // keep the cancel listeners for the glide, then let go
            travel.timers.push(window.setTimeout(endTravel, 1600));
          }),
        );
      }, 400),
    );
  }

  bus.on('travel:to', ({ id }: { id: ChapterId }) => travelTo(CHAPTERS.findIndex((c) => c.id === id)));
}
