// Washi paper textures (3d-paper-material, cost-conscious port): formation clouds + warped kozo fibres + bark flecks,
// baked ONCE on the CPU into two small tileable textures and shared (ref-counted) by every paper object.
//   albedo:   sRGB colour (tint #f0e8d2 modulated by formation, fibres paler, flecks darker)
//   transmit: grey data for emissiveMap — thin formation glows, fibre bundles + flecks hold light back
//             (skill rule: "drive transmission from the same fields as the albedo").
import type * as THREE_NS from 'three';
import { hash2, makeRng } from './noise';

export interface WashiTextures {
  albedo: THREE_NS.Texture;
  transmit: THREE_NS.Texture;
}

const SIZE = 256;
let cache: { tex: WashiTextures; refs: number } | null = null;

function tileNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const m = (v: number) => ((v % period) + period) % period;
  const a = hash2(m(ix), m(iy), seed);
  const b = hash2(m(ix + 1), m(iy), seed);
  const c = hash2(m(ix), m(iy + 1), seed);
  const d = hash2(m(ix + 1), m(iy + 1), seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function bake(THREE: typeof THREE_NS): WashiTextures {
  const N = SIZE;
  const form = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      // formation: two scales of cloudy thick-and-thin, periodic so the tile has no seam
      let f = 0;
      let amp = 0.5;
      let norm = 0;
      for (let o = 0; o < 4; o++) {
        const p = 4 << o;
        f += amp * tileNoise(u * p, v * p, p, 7 + o);
        norm += amp;
        amp *= 0.5;
      }
      const g = tileNoise(u * 16, v * 16, 16, 31) * 0.5 + tileNoise(u * 32, v * 32, 32, 37) * 0.5;
      form[y * N + x] = (f / norm) * 0.62 + g * 0.38;
    }
  }

  const mk = () => {
    const c = document.createElement('canvas');
    c.width = N;
    c.height = N;
    return [c, c.getContext('2d')!] as const;
  };
  const [ca, ga] = mk();
  const [ct, gt] = mk();
  const ia = ga.createImageData(N, N);
  const it = gt.createImageData(N, N);
  // tint #f0e8d2
  const tr = 240;
  const tg = 232;
  const tb = 210;
  for (let i = 0; i < N * N; i++) {
    const f = form[i];
    const k = 0.965 + (f - 0.5) * 0.07;
    ia.data[i * 4] = Math.min(255, tr * k);
    ia.data[i * 4 + 1] = Math.min(255, tg * k);
    ia.data[i * 4 + 2] = Math.min(255, tb * k * 0.99);
    ia.data[i * 4 + 3] = 255;
    // transmission: 0.74 + (0.5-form)*0.85 (skill), remapped to 0..255
    const t = Math.max(0, Math.min(1, 0.7 + (0.5 - f) * 0.9));
    it.data[i * 4] = it.data[i * 4 + 1] = it.data[i * 4 + 2] = t * 255;
    it.data[i * 4 + 3] = 255;
  }
  ga.putImageData(ia, 0, 0);
  gt.putImageData(it, 0, 0);

  // kozo fibres: long, wandering, partially transparent strands, drawn with wrap so the tile is seamless.
  // Both canvases replay the same seed, so the strands that are pale in albedo hold light back in transmission.
  const sx = new Float32Array(8);
  const sy = new Float32Array(8);
  const fibres = (g: CanvasRenderingContext2D, pale: boolean) => {
    const R = makeRng(20040);
    g.lineCap = 'round';
    for (const [count, lw] of [[340, 0.9], [520, 0.45]] as const) {
      for (let s = 0; s < count; s++) {
        let px = R() * N;
        let py = R() * N;
        const len = 14 + R() * 60;
        let ang = (R() < 0.6 ? 0.15 : Math.PI / 2 + 0.2) + (R() - 0.5) * 1.2;
        const a = 0.16 + R() * 0.36;
        g.lineWidth = lw * (0.5 + R() * 0.8);
        g.strokeStyle = pale ? `rgba(252,249,240,${a.toFixed(3)})` : `rgba(40,40,40,${(a * 0.55).toFixed(3)})`;
        sx[0] = px;
        sy[0] = py;
        for (let k = 1; k < 8; k++) {
          ang += (R() - 0.5) * 0.45;
          px += (Math.cos(ang) * len) / 7;
          py += (Math.sin(ang) * len) / 7;
          sx[k] = px;
          sy[k] = py;
        }
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            g.beginPath();
            g.moveTo(sx[0] + ox * N, sy[0] + oy * N);
            for (let k = 1; k < 8; k++) g.lineTo(sx[k] + ox * N, sy[k] + oy * N);
            g.stroke();
          }
        }
      }
    }
  };
  fibres(ga, true);
  fibres(gt, false);

  // bark flecks: tiny stretched ellipses, darker in albedo, opaque in transmission
  const fr = makeRng(77);
  for (let i = 0; i < 9; i++) {
    const x = fr() * N;
    const y = fr() * N;
    const rx = 0.35 + fr() * 0.5;
    const ry = rx * (1.6 + fr());
    const rot = fr() * Math.PI;
    ga.fillStyle = `rgba(150,128,96,${(0.25 + fr() * 0.25).toFixed(2)})`;
    gt.fillStyle = 'rgba(0,0,0,0.6)';
    for (const g of [ga, gt]) {
      g.beginPath();
      g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
      g.fill();
    }
  }

  const albedo = new THREE.CanvasTexture(ca);
  albedo.colorSpace = THREE.SRGBColorSpace;
  const transmit = new THREE.CanvasTexture(ct);
  transmit.colorSpace = THREE.NoColorSpace;
  for (const t of [albedo, transmit]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.needsUpdate = true;
  }
  return { albedo, transmit };
}

/** Get the shared washi textures (baked on first call). Pair every call with releaseWashi(). */
export function acquireWashi(THREE: typeof THREE_NS): WashiTextures {
  if (!cache) cache = { tex: bake(THREE), refs: 0 };
  cache.refs++;
  return cache.tex;
}

export function releaseWashi(): void {
  if (!cache) return;
  cache.refs--;
  if (cache.refs <= 0) {
    cache.tex.albedo.dispose();
    cache.tex.transmit.dispose();
    cache = null;
  }
}
