// Performance probe (SPEC §12.4) — a PROXY, not a real phone.
//
// Builds the site into a scratch folder (vite build, no typecheck, so it never clobbers dist/), serves it with
// vite preview, and drives Chromium through every chapter at 2–3 scroll positions in two passes:
//   mobile  : 390×844, DPR 3, touch, CDP CPU throttling 4×, network 'slow 4G' (150 ms RTT, 1.6 Mbps down) unless --fastnet
//   desktop : 1440×900, DPR 2, no throttling
// It tries the real GPU first (new headless + ANGLE/D3D11) and falls back to SwiftShader, and says which it got.
//
// Per sample it reads the engine's ?perf=1 hook (window.__JY_PERF, src/world/engine.ts): draw calls and triangles
// summed over every render pass of the owning module (max over the window), rAF interval p50/p95 over ~3 s, frame
// work p50/p95 (CPU update+submit plus a 1-px readback that drains the GPU: the cost of a frame without vsync),
// quality tier + effective DPR the governor settled on, shadow-casting lights, JS heap (CDP Runtime.getHeapUsage).
// Network: bytes on the wire (CDP encodedDataLength) up to the loader hand-off, and the resources first fetched
// while each chapter was being visited; plus raw/gzip sizes of every built chunk.
//
// Usage: node scripts/perf-probe.mjs [--pass mobile|desktop|both] [--gpu auto|swiftshader] [--skip-build]
//                                    [--window 3000] [--out qa/perf-results.json]
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const has = (k) => args.includes(`--${k}`);
const PASS = opt('pass', 'both');
const GPU = opt('gpu', 'auto');
const WINDOW = Number(opt('window', 3000));
const OUT = opt('out', 'qa/perf-results.json');
const OUTDIR = resolve(opt('outdir', join(tmpdir(), 'jy-perf-dist')));

const SAMPLES = [
  ['prologue', [0.3, 0.7]],
  ['river', [0.3, 0.7]],
  ['crossing', [0.2, 0.5, 0.8]],
  ['coast', [0.2, 0.5, 0.8]],
  ['rain', [0.3, 0.7]],
  ['workshop', [0.3, 0.7]],
  ['loop', [0.3, 0.7]],
  ['next', [0.3, 0.7]],
];
const MODULE = { prologue: 'jiangyin', river: 'jiangyin', crossing: 'crossing', coast: 'coast', rain: 'rain', workshop: 'workshop', loop: 'loop', next: 'next' };

// ---- build + serve ----
if (!has('skip-build')) {
  console.log(`[perf] building into ${OUTDIR}`);
  await build({ logLevel: 'warn', build: { outDir: OUTDIR, emptyOutDir: true } });
}
const chunks = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|html)$/.test(n)) {
      const buf = readFileSync(p);
      chunks.push({ file: relative(OUTDIR, p).replace(/\\/g, '/'), raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length });
    }
  }
})(OUTDIR);
const server = await preview({ logLevel: 'error', build: { outDir: OUTDIR }, preview: { port: 0, strictPort: false } });
const port = server.httpServer.address().port;
const BASE = `http://localhost:${port}/?perf=1`;

// ---- browser ----
async function launch(mode) {
  const gpuArgs = ['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  const swArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ args: mode === 'gpu' ? gpuArgs : swArgs });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('about:blank');
  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    if (!g) return 'none';
    const ext = g.getExtension('WEBGL_debug_renderer_info');
    return ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
  });
  await ctx.close();
  return { browser, gl };
}
let backend;
let browser;
if (GPU !== 'swiftshader') {
  const r = await launch('gpu');
  if (r.gl !== 'none' && !/swiftshader|software|llvmpipe/i.test(r.gl)) {
    browser = r.browser;
    backend = { kind: 'hardware GPU', renderer: r.gl };
  } else {
    console.log(`[perf] GPU launch gave "${r.gl}" — falling back to SwiftShader`);
    await r.browser.close();
  }
}
if (!browser) {
  const r = await launch('swiftshader');
  browser = r.browser;
  backend = { kind: 'SwiftShader (software)', renderer: r.gl };
}
console.log(`[perf] backend: ${backend.kind} — ${backend.renderer}`);

const pct = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(1);
};

async function runPass(name) {
  const mobile = name === 'mobile';
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: mobile ? 3 : 2,
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile
      ? 'Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
      : undefined,
  });
  await ctx.addInitScript(() => {
    window.__probe = { loaderDone: null, lcp: null };
    window.addEventListener('loader:done', () => (window.__probe.loaderDone = performance.now()));
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__probe.lcp = e.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  if (mobile) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  if (mobile && !has('fastnet'))
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  // network ledger
  const reqs = new Map();
  const net = [];
  let phase = 'initial';
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, phase }));
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId);
    if (r) net.push({ url: r.url.replace(/^https?:\/\/[^/]+/, ''), bytes: e.encodedDataLength, phase: r.phase });
  });

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__probe.loaderDone !== null, null, { timeout: 240000 }).catch(() => errors.push('loader:done never fired'));
  const boot = await page.evaluate(() => ({ loaderDone: window.__probe.loaderDone, lcp: window.__probe.lcp }));
  const initialBytes = net.filter((n) => n.phase === 'initial').reduce((s, n) => s + n.bytes, 0);
  const initialList = net.filter((n) => n.phase === 'initial').map((n) => ({ url: n.url, bytes: n.bytes }));
  console.log(`[perf:${name}] loader done at ${Math.round(boot.loaderDone)} ms, initial ${(initialBytes / 1024).toFixed(0)} KB`);
  phase = 'post-boot';
  await page.waitForTimeout(1500);

  const rows = [];
  for (const [chapter, ts] of SAMPLES) {
    for (const t of ts) {
      phase = `${chapter}:${t}`;
      await page.evaluate(
        ([id, t]) => {
          const el = document.querySelector(`[data-chapter="${id}"]`);
          const top = el.getBoundingClientRect().top + window.scrollY;
          window.scrollTo(0, top + el.offsetHeight * t);
        },
        [chapter, t],
      );
      const want = MODULE[chapter];
      const ok = await page
        .waitForFunction((w) => window.__JY_PERF && window.__JY_PERF.log.owner === w, want, { timeout: 120000, polling: 250 })
        .then(() => true)
        .catch(() => false);
      await page.waitForTimeout(2000); // let the smoothed camera arrive and any first-frame work settle
      const s = await page.evaluate(async (win) => {
        const P = window.__JY_PERF;
        P.log.frames.length = 0;
        P.log.work.length = 0;
        let calls = 0;
        let tris = 0;
        let shadows = 0;
        const end = performance.now() + win;
        while (performance.now() < end) {
          calls = Math.max(calls, P.log.calls);
          tris = Math.max(tris, P.log.tris);
          shadows = Math.max(shadows, P.shadowLights());
          await new Promise((r) => setTimeout(r, 200));
        }
        return { frames: [...P.log.frames], work: [...P.log.work], calls, tris, shadows, owner: P.log.owner, tier: P.tier, dpr: P.dpr(), mem: P.memory() };
      }, WINDOW);
      const heap = await cdp.send('Runtime.getHeapUsage');
      const row = {
        at: `${chapter}:${t}`,
        owner: s.owner,
        reached: ok,
        calls: s.calls,
        tris: s.tris,
        shadowLights: s.shadows,
        frames: s.frames.length,
        rafP50: pct(s.frames, 50),
        rafP95: pct(s.frames, 95),
        workP50: pct(s.work, 50),
        workP95: pct(s.work, 95),
        tier: s.tier,
        dpr: s.dpr,
        heapMB: +(heap.usedSize / 1048576).toFixed(1),
        geometries: s.mem.geometries,
        textures: s.mem.textures,
        programs: s.mem.programs,
      };
      rows.push(row);
      console.log(`[perf:${name}] ${row.at} calls ${row.calls} tris ${row.tris} raf p50/p95 ${row.rafP50}/${row.rafP95} work p50/p95 ${row.workP50}/${row.workP95} ${row.tier}@${row.dpr} heap ${row.heapMB}MB${ok ? '' : ' (owner not reached)'}`);
    }
  }
  const perChapter = {};
  for (const n of net) {
    if (n.phase === 'initial') continue;
    (perChapter[n.phase] ??= { bytes: 0, files: [] }).bytes += n.bytes;
    perChapter[n.phase].files.push(`${n.url} (${(n.bytes / 1024).toFixed(1)} KB)`);
  }
  await ctx.close();
  return { name, wallSec: Math.round((Date.now() - t0) / 1000), boot, initialBytes, initialList, perChapter, rows, errors: [...new Set(errors)].slice(0, 20) };
}

const passes = [];
try {
  if (PASS === 'both' || PASS === 'mobile') passes.push(await runPass('mobile'));
  if (PASS === 'both' || PASS === 'desktop') passes.push(await runPass('desktop'));
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), backend, chunks, passes }, null, 2));
console.log(`[perf] wrote ${OUT}`);
