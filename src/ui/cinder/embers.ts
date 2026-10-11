// Embers that leave the burning line, rise, cool, and turn into rain: a tiny 2D particle pool.
// Phase 1 (ember): lifted by heat, wobbling, cooling down the ember ramp (gold -> orange -> deep red).
// Phase 2 (turn): at the top of its climb it stops, cools to rain-silver.
// Phase 3 (rain): gravity takes it; it falls as a thin silver streak and fades.
// Additive glow for embers, plain alpha for droplets (rain is not a light).

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  rise: number; // seconds of climb
  size: number;
  wob: number;
  phase: 0 | 1 | 2;
  turn: number; // seconds into the turn
  fall: number; // seconds falling
  heat: number;
}

const MAX = 420;
// ember ramp in sRGB (the burn's own stops, encoded): hot gold, gold, orange, deep red
const RAMP: [number, [number, number, number]][] = [
  [0, [255, 214, 120]],
  [0.3, [255, 168, 64]],
  [0.65, [236, 110, 36]],
  [1, [150, 40, 14]],
];
const SILVER: [number, number, number] = [191, 199, 204]; // --rain-silver

function ramp(t: number): [number, number, number] {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const [t0, a] = RAMP[i - 1], [t1, b] = RAMP[i];
      const k = (t - t0) / (t1 - t0);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export interface Embers {
  canvas: HTMLCanvasElement;
  resize(cssW: number, cssH: number, dpr: number): void;
  /** rain: start as a falling silver drop (no ember), for the no-fire path. */
  spawn(x: number, y: number, heat?: number, rain?: boolean): void;
  /** Advance + draw. Returns the number of live particles. */
  step(dt: number): number;
  clear(): void;
}

export function createEmbers(): Embers {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const pool: P[] = [];
  let W = 0, H = 0, dpr = 1;

  function resize(cssW: number, cssH: number, d: number) {
    W = cssW;
    H = cssH;
    dpr = d;
    canvas.width = Math.max(2, Math.round(cssW * d));
    canvas.height = Math.max(2, Math.round(cssH * d));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }

  function spawn(x: number, y: number, heat = 0.6, rain = false) {
    if (pool.length >= MAX) return;
    pool.push({
      x,
      y,
      vx: rain ? 0 : (Math.random() - 0.5) * 22,
      vy: rain ? 20 : -(36 + Math.random() * 70),
      age: 0,
      rise: 0.7 + Math.random() * 1.1,
      size: 0.7 + Math.random() * 1.5,
      wob: Math.random() * 6.28,
      phase: rain ? 2 : 0,
      turn: 0,
      fall: 0,
      heat,
    });
  }

  function step(dt: number) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (let i = pool.length - 1; i >= 0; i--) {
      const p = pool[i];
      p.age += dt;
      if (p.phase === 0) {
        p.wob += dt * (3 + p.heat * 2);
        p.vx += Math.sin(p.wob) * 30 * dt;
        p.vy *= 1 - 0.9 * dt; // the lift dies away as it cools
        if (p.age > p.rise) p.phase = 1;
      } else if (p.phase === 1) {
        p.turn += dt;
        p.vy *= 1 - 4 * dt;
        p.vx *= 1 - 3 * dt;
        if (p.turn > 0.32) p.phase = 2;
      } else {
        p.fall += dt;
        p.vy = Math.min(p.vy + 900 * dt, 340 + p.size * 60);
        p.vx *= 1 - 2 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const gone = p.phase === 2 && (p.fall > 1.6 || p.y > H + 20);
      if (gone || p.x < -20 || p.x > W + 20 || p.y < -30) {
        pool.splice(i, 1);
        continue;
      }
      if (p.phase === 0) {
        const cool = p.age / p.rise;
        const [r, g, b] = ramp(cool * 0.85 + (1 - p.heat) * 0.2);
        const a = 1 - cool * 0.35;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${0.16 * a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3.2, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.9, 0, 6.2832);
        ctx.fill();
      } else if (p.phase === 1) {
        // cooling to silver: down the ramp, then across to the rain colour
        const k = p.turn / 0.32;
        const e = ramp(0.85);
        const c = [e[0] + (SILVER[0] - e[0]) * k, e[1] + (SILVER[1] - e[1]) * k, e[2] + (SILVER[2] - e[2]) * k];
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${0.75})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.8, 0, 6.2832);
        ctx.fill();
      } else {
        const a = Math.max(0, 0.75 * (1 - p.fall / 1.6));
        const len = Math.min(16, 2 + p.vy * 0.035);
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = `rgba(${SILVER[0]},${SILVER[1]},${SILVER[2]},${a})`;
        ctx.lineWidth = Math.max(0.8, p.size * 0.7);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - len);
        ctx.lineTo(p.x + p.vx * 0.01, p.y);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    return pool.length;
  }

  function clear() {
    pool.length = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { canvas, resize, spawn, step, clear };
}
