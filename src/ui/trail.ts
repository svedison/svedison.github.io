// Wind-trace pointer trail (SPEC §6 "the pointer is the wind", pointer-trail-emitter).
// A 2-D canvas above the mist veil and below #ui-root. The pointer moves constantly, so this stays at a
// whisper: a few small embers, emitted by DISTANCE along a lagged emitter path and only while the hand is
// actually sweeping (a slow hover over copy draws nothing), never over links or buttons, never while still.
// Off for coarse pointers, reduced motion, open overlays and hidden tabs; the RAF sleeps when nothing is alive.
// Pointer motion also feeds bus 'ripple' (NDC, ~20 Hz) for the water modules, on every pointer type.
import type { App } from '../app';
import { bus } from '../bus';

// pointer-trail-emitter numbers, translated from its 2.2-unit plane to the viewport height H.
const PLANE = 2.2;
const STEP = 0.2 / PLANE; // emission step (x H): one ember per ~9% of the viewport height, not a spray
const CAP = 2; // spawns per frame (teleport guard)
const LAG = 16; // emitter damping
const SWEEP = 0.5 / PLANE; // emitter speed (x H / s) below which the hand is hovering, not sweeping: no embers
const SCATTER = 0.05 / PLANE; // spawn scatter (x H). Tighter than the wisp default: embers hug the lantern's path.
const LIFE: [number, number] = [0.7, 1.15];
const LAUNCH_BACK = 0.09 / PLANE; // against travel (x H / s)
const LAUNCH_SIDE = 0.12 / PLANE; // lateral (x H / s)
const COAST = 0.9; // velocity *= 1 - COAST * dt
const BUOY = 0.022 / PLANE; // rise (x H / s^2)
const CURL: [number, number] = [0.12 / PLANE, 0.1 / PLANE];
const SIZE: [number, number] = [0.012 / PLANE, 0.03 / PLANE]; // diameter (x H)
const ALPHA = 0.6; // peak opacity of an ember
const POOL = 24; // hard cap on what can be on screen at once
// The lantern: one soft glow that follows the pointer on a lag and breathes for a moment after the hand rests.
const GLOW_LAG = 9; // follow damping (a beat behind the hand, never jittering on it)
const GLOW_SIZE = 0.05; // diameter incl. halo (x H)
const GLOW_ALPHA = 0.55;
const GLOW_BREATHE_FOR = 4; // s of breathing after the last move, then it holds steady and the loop sleeps
const RIPPLE_MS = 50;

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  phase: number;
}

function sprite(inner: string, mid: string) {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.18, mid);
  grd.addColorStop(0.42, mid.replace(/[\d.]+\)$/, '0.28)'));
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return c;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const damp = (a: number, b: number, l: number, dt: number) => b + (a - b) * Math.exp(-l * dt);

export function init(app: App): void {
  // --- ripples: every pointer type, throttled, NDC
  let lastRipple = 0;
  let rx = 0;
  let ry = 0;
  window.addEventListener(
    'pointermove',
    (e) => {
      const now = performance.now();
      if (now - lastRipple < RIPPLE_MS) return;
      const x = (e.clientX / innerWidth) * 2 - 1;
      const y = -(e.clientY / innerHeight) * 2 + 1;
      const dt = Math.max(0.016, (now - lastRipple) / 1000);
      const d = Math.hypot(x - rx, y - ry);
      lastRipple = now;
      rx = x;
      ry = y;
      if (d < 0.002 || dt > 0.5) return; // first move after rest just re-anchors
      bus.emit('ripple', { x, y, strength: Math.min(1, d / dt / 3) });
    },
    { passive: true },
  );

  // --- trail
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  if (app.reducedMotion) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'ember-trail';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: '9',
  } satisfies Partial<CSSStyleDeclaration>);
  const uiRoot = document.getElementById('ui-root');
  if (uiRoot?.parentNode) uiRoot.parentNode.insertBefore(canvas, uiRoot);
  else document.body.appendChild(canvas);
  const g = canvas.getContext('2d', { alpha: true });
  if (!g) return;

  const gold = sprite('rgba(255,240,205,1)', 'rgba(242,169,59,0.95)');
  const deep = sprite('rgba(255,190,120,0.9)', 'rgba(214,92,30,0.9)');

  const pool: Mote[] = Array.from({ length: POOL }, () => ({ x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 0, size: 0, phase: 0 }));
  let slot = 0;
  let alive = 0;

  let W = 0;
  let H = 0;
  let dpr = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  // Emitter state (lagged behind the pointer).
  const E = { x: 0, y: 0, lx: 0, ly: 0, acc: 0, px: 0, py: 0, has: false, inside: false, overUI: false, still: 0 };
  const G = { x: 0, y: 0, a: 0 }; // the lantern glow: position and its eased presence (0..1)
  const UI = 'a, button, input, textarea, select, [role="button"], [role="dialog"]';

  const overlays = new Set<string>();
  let eggOpen = document.documentElement.classList.contains('egg-open');
  const enabled = () => fine.matches && overlays.size === 0 && !eggOpen && !document.hidden;

  function spawn(x: number, y: number, ux: number, uy: number) {
    const i = slot; // take the slot BEFORE advancing it (ring-buffer ordering trap)
    slot = (slot + 1) % POOL;
    const m = pool[i];
    if (m.age >= m.life) alive++;
    const s = SCATTER * H;
    m.x = x + rand(-s, s) * 0.5;
    m.y = y + rand(-s, s) * 0.5;
    const back = LAUNCH_BACK * H;
    const side = rand(-1, 1) * LAUNCH_SIDE * H;
    m.vx = -ux * back + -uy * side;
    m.vy = -uy * back + ux * side;
    m.age = 0;
    m.life = rand(...LIFE);
    m.size = rand(SIZE[0], SIZE[1]) * H;
    m.phase = Math.random() * Math.PI * 2;
  }

  let raf = 0;
  let last = 0;
  let time = 0;

  function frame(now: number) {
    raf = 0;
    const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
    last = now;
    time += dt;
    const on = enabled();

    // Emit by distance along the lagged emitter path.
    if (on && E.has && E.inside) {
      E.lx = E.x;
      E.ly = E.y;
      E.x = damp(E.x, E.px, LAG, dt);
      E.y = damp(E.y, E.py, LAG, dt);
      const dx = E.x - E.lx;
      const dy = E.y - E.ly;
      const moved = Math.hypot(dx, dy);
      const step = STEP * H;
      const sweeping = dt > 0 && moved / dt > SWEEP * H && !E.overUI;
      if (sweeping) {
        const ux = dx / moved;
        const uy = dy / moved;
        E.acc += moved;
        let n = 0;
        while (E.acc >= step && n < CAP) {
          n++;
          E.acc -= step;
          const t = Math.min(1, (n * step) / moved); // place each mote where it is owed
          spawn(E.lx + dx * t, E.ly + dy * t, ux, uy);
        }
        if (E.acc > step) E.acc = 0; // drop a teleport's leftover instead of paying it next frame
      } else {
        E.acc = 0; // a hover or a pause owes nothing: the next sweep starts clean
      }
      E.still = moved > 0.5 ? 0 : E.still + dt;
    }

    // The lantern follows, and shows only where it belongs (inside, not over a control).
    const want = on && E.has && E.inside && !E.overUI ? 1 : 0;
    G.a = damp(G.a, want, want > G.a ? 6 : 10, dt);
    if (G.a < 0.004) G.a = 0;
    if (E.has) {
      G.x = damp(G.x, E.px, GLOW_LAG, dt);
      G.y = damp(G.y, E.py, GLOW_LAG, dt);
    }

    // Update + draw.
    g!.setTransform(dpr, 0, 0, dpr, 0, 0);
    g!.globalCompositeOperation = 'source-over';
    g!.clearRect(0, 0, W, H);
    g!.globalCompositeOperation = 'lighter';
    const coast = Math.max(0, 1 - COAST * dt);
    const buoy = BUOY * H * dt;
    let count = 0;
    for (let i = 0; i < POOL; i++) {
      const m = pool[i];
      if (m.age >= m.life) continue;
      m.age += dt;
      if (m.age >= m.life) {
        alive--;
        continue;
      }
      count++;
      const u = m.age / m.life;
      m.vx = m.vx * coast + Math.sin(time * 1.3 + m.phase) * CURL[0] * H * dt;
      m.vy = m.vy * coast + Math.cos(time * 1.1 + 1.7 * m.phase) * CURL[1] * H * dt - buoy;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const a = (u < 0.12 ? u / 0.12 : u > 0.22 ? 1 - (u - 0.22) / 0.78 : 1) * ALPHA;
      if (a <= 0.003) continue;
      const d = m.size * (1 + 0.55 * u) * 2.2; // sprite includes the halo
      const h = d / 2;
      // Gold cools to deep orange over the mote's life.
      g!.globalAlpha = a * (1 - u);
      g!.drawImage(gold, m.x - h, m.y - h, d, d);
      g!.globalAlpha = a * u * 0.85;
      g!.drawImage(deep, m.x - h, m.y - h, d, d);
    }
    if (G.a > 0) {
      const breathing = E.still < GLOW_BREATHE_FOR;
      const breath = breathing ? 0.88 + 0.12 * Math.sin(time * 2.1) : 0.88;
      const d = GLOW_SIZE * H * (0.96 + 0.04 * breath);
      g!.globalAlpha = GLOW_ALPHA * G.a * breath;
      g!.drawImage(gold, G.x - d / 2, G.y - d / 2, d, d);
    }
    g!.globalAlpha = 1;
    alive = count;

    const glowMoving = G.a > 0 && (Math.hypot(E.px - G.x, E.py - G.y) > 0.3 || E.still < GLOW_BREATHE_FOR);
    const glowFading = G.a > 0 && G.a < 0.999;
    if (alive > 0 || glowMoving || glowFading || (on && E.inside && Math.hypot(E.px - E.x, E.py - E.y) > 0.5)) wake();
    else if (G.a === 0) g!.clearRect(0, 0, W, H);
  }

  function wake() {
    if (raf || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }

  function clearAll() {
    for (const m of pool) m.age = m.life;
    alive = 0;
    E.acc = 0;
    G.a = 0;
    g!.setTransform(1, 0, 0, 1, 0, 0);
    g!.clearRect(0, 0, canvas.width, canvas.height);
  }

  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      E.px = e.clientX;
      E.py = e.clientY;
      E.inside = true;
      E.overUI = e.target instanceof Element && !!e.target.closest(UI);
      E.still = 0;
      if (!E.has) {
        E.has = true;
        E.x = E.lx = G.x = E.px;
        E.y = E.ly = G.y = E.py;
      }
      if (!enabled()) return;
      if (!raf) last = performance.now();
      wake();
    },
    { passive: true },
  );
  const leave = () => {
    E.inside = false;
    wake(); // let the lantern fade out
  };
  document.documentElement.addEventListener('pointerleave', leave);
  window.addEventListener('blur', leave);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else {
      last = performance.now(); // reset the time base on resume
      if (alive > 0) wake();
    }
  });

  bus.on('overlay', ({ name, open }) => {
    if (open) overlays.add(name);
    else overlays.delete(name);
    if (overlays.size) clearAll();
  });

  new MutationObserver(() => {
    const was = eggOpen;
    eggOpen = document.documentElement.classList.contains('egg-open');
    if (eggOpen && !was) clearAll();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  fine.addEventListener?.('change', () => {
    if (!fine.matches) clearAll();
  });

  // Dev hook for visual QA: report live mote count.
  if (import.meta.env.DEV) (window as unknown as { __trail?: () => number }).__trail = () => alive;
}
