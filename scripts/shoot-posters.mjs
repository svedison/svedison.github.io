// No-WebGL poster stills (SPEC §11): renders the real WebGL scene at each chapter's composed t with the DOM story,
// HUD, veil and loader hidden, and writes JPEGs for the ?webgl=0 / no-JS poster layer (wired in src/styles/rituals.css).
//
// Usage:
//   node scripts/shoot-posters.mjs                         every chapter, desktop 1440x900 + portrait 390x844
//   node scripts/shoot-posters.mjs --chapters coast,next   only these chapters
//   node scripts/shoot-posters.mjs --at coast:0.5          override a chapter's t (repeatable; implies that chapter)
//   node scripts/shoot-posters.mjs --sizes desktop         desktop | portrait | desktop,portrait (default both)
//   node scripts/shoot-posters.mjs --out shots/posters --tag   write <chapter>-<t>[-portrait].jpg to a review folder
//   [--frames 240]  virtual frames to let the scene settle after each scroll
//   [--hour 18.6]   the prologue's visitor-hour sky (18.6 = the authored dusk)
//
// Output: <out>/<chapter>.jpg (1440x900) and <out>/<chapter>-portrait.jpg (390x844 CSS px at 1.5x = 585x1266),
// JPEG quality 80, stepped down until each file is under 250 kB. Look at every image before committing it:
// reject frames with hotspot rings, debug UI, loading veils or a half-loaded module.
//
// How it stays faithful under SwiftShader: headless WebGL runs at a few fps, which would make the engine's quality
// governor step down to the low tier and leave damped motion mid-flight. Once the loader has gone, the page's
// clock is virtualised: every animation frame advances performance.now() and the rAF timestamp by exactly 1/60 s.
// The governor then sees a steady 60 Hz (the authored tier stays), and "settle for N frames" means the same scene
// state on any machine. Live weather is blocked so Seattle shows the authored rain. Vite runs without HMR or a
// file watcher, so edits elsewhere in the repo cannot reload the page mid-shot.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The most composed frame of each chapter (local progress through its section). Mirrors the reduced-motion
 *  stills in src/world/types.ts where one exists, picked by eye where a chapter has several. */
const COMPOSED = {
  prologue: 0.2,
  river: 0.54,
  crossing: 0.25,
  // coast: the arrival frame (boat, parents, the palm through the sun; friends not yet lit, latitude line not yet
  // drawn), so the loading poster matches the live set on a cold entry and no lantern vanishes at the cross-fade
  coast: 0.05,
  rain: 0.08,
  workshop: 0.05,
  loop: 0.4,
  next: 0.85,
};
const SIZES = {
  desktop: { w: 1440, h: 900, dpr: 1, mobile: false, suffix: '' },
  portrait: { w: 390, h: 844, dpr: 1.5, mobile: true, suffix: '-portrait' },
};
const MAX_BYTES = 250 * 1024;

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const all = (k) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : []));
const has = (k) => args.includes(`--${k}`);

const outDir = opt('out', 'public/posters');
const tagged = has('tag');
const frames = Number(opt('frames', 240));
const hour = Number(opt('hour', 18.6)); // dusk (src/world/systems/sky.ts skyStateForHour)
const sizes = opt('sizes', 'desktop,portrait').split(',').filter((s) => SIZES[s]);
/** [chapter, t] jobs, in story order. */
const overrides = all('at').map((a) => {
  const [id, t] = a.split(':');
  if (!(id in COMPOSED)) throw new Error(`unknown chapter ${id}`);
  return [id, t === undefined ? COMPOSED[id] : Number(t)];
});
const picked = opt('chapters') ? opt('chapters').split(',') : overrides.length ? [] : Object.keys(COMPOSED);
const jobs = [...picked.map((id) => [id, COMPOSED[id]]), ...overrides];
mkdirSync(outDir, { recursive: true });

const server = await createServer({
  server: { port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } },
  logLevel: 'error',
});
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

/** Runs in the page before any script: rAF / performance.now wrappers that switch to a virtual clock on demand. */
function virtualClock(hour) {
  // the prologue sky follows the visitor's hour; the poster is the authored dusk (jiangyin.ts QA override)
  window.__JY_HOUR = hour;
  const realRAF = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  let virt = null;
  let lastStamp = -1;
  window.__vframes = 0;
  window.__vclockOn = () => {
    if (virt === null) virt = realNow();
  };
  performance.now = () => (virt === null ? realNow() : virt);
  window.requestAnimationFrame = (cb) =>
    realRAF((ts) => {
      if (virt === null) return cb(ts);
      if (ts !== lastStamp) {
        lastStamp = ts;
        virt += 1000 / 60;
        window.__vframes++;
      }
      cb(virt);
    });
}

const HIDE_DOM = `
  #story, #ui-root, #veil, #posters, #kb-loader, .skip-link, #live { visibility: hidden !important; opacity: 0 !important; }
  html, body { cursor: none !important; }
`;

const errors = [];
const written = [];
for (const sizeName of sizes) {
  const S = SIZES[sizeName];
  const ctx = await browser.newContext({
    viewport: { width: S.w, height: S.h },
    deviceScaleFactor: S.dpr,
    reducedMotion: 'no-preference',
    hasTouch: S.mobile,
    isMobile: S.mobile,
  });
  await ctx.route(/open-meteo\.com/, (r) => r.abort());
  await ctx.addInitScript(virtualClock, hour);
  // A fresh page per chapter: travelling one session through every module can leave a later module
  // (the Loop, seen in testing) unsettled behind its fog, while a direct load is always clean.
  const open = async () => {
    const page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`${sizeName}: ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`${sizeName}: ${e}`));
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
    // the fire-paper loader hands off and removes itself (6 s safety timeout in head.html)
    await page.waitForFunction(() => window.__kbLoader?.state === 'gone', null, { timeout: 120000 }).catch(() => errors.push(`${sizeName}: loader never left`));
    await page.evaluate(() => window.__vclockOn());
    if (!has('keepdom')) await page.addStyleTag({ content: HIDE_DOM }); // --keepdom: debug what the DOM is doing
    await page.mouse.move(-10, -10).catch(() => {});
    return page;
  };

  for (const [id, t] of jobs) {
    // the Loop's still is the map alone: the DOM ring is the one loop drawn over it (src/world/chapters/loop.ts)
    if (id === 'loop') await ctx.addInitScript(() => (window.__LOOP_MAP_ONLY = true));
    const page = await open();
    await page.evaluate(
      ([id, t]) => {
        const el = document.querySelector(`[data-chapter="${id}"]`);
        if (!el) throw new Error(`no chapter ${id}`);
        const top = el.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, top + el.offsetHeight * t);
      },
      [id, t],
    );
    // let the module load (real time) and the damped camera settle (virtual frames)
    const start = await page.evaluate(() => window.__vframes);
    await page.waitForFunction((n) => window.__vframes >= n, start + frames, { timeout: 300000, polling: 250 });
    await page.waitForTimeout(400);
    const base = tagged ? `${id}-${String(t).replace('.', '_')}` : id;
    const file = join(outDir, `${base}${S.suffix}.jpg`);
    let quality = 80;
    let buf;
    for (;;) {
      buf = await page.screenshot({ type: 'jpeg', quality, timeout: 240000 }); // SwiftShader on a busy machine is slow to compose
      if (buf.length <= MAX_BYTES || quality <= 50) break;
      quality -= 6;
    }
    writeFileSync(file, buf);
    const kb = Math.round(statSync(file).size / 1024);
    written.push({ file, kb, quality });
    console.log(`poster ${file} ${kb} kB (q${quality})`);
    await page.close();
  }
  await ctx.close();
}
console.log(JSON.stringify({ written, errors: [...new Set(errors)].slice(0, 30) }));
await browser.close();
await server.close();
