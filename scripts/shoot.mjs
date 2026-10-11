// Visual QA: starts its own Vite dev server on a free port, opens headless Chromium (WebGL via SwiftShader),
// scrolls to chapter positions, waits for frames to settle, writes screenshots, and reports console errors.
//
// Usage:
//   node scripts/shoot.mjs --at river:0.5 --at crossing:0.3 [--w 1440 --h 900] [--out shots/name] [--reduced] [--nowebgl]
//          [--wait 2500] [--click "css selector"] [--eval "js expression run before shooting"]
// Output: <out>-<chapter>-<t>.png per --at, plus a JSON line with console errors.
// --at accepts chapter:t (t = 0..1 through that chapter's section) or top / bottom.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const all = (k) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : []));
const has = (k) => args.includes(`--${k}`);

const W = Number(opt('w', 1440));
const H = Number(opt('h', 900));
const out = opt('out', 'shots/shot');
const wait = Number(opt('wait', 2500));
const ats = all('at').length ? all('at') : ['top'];
mkdirSync(dirname(out), { recursive: true });

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  reducedMotion: has('reduced') ? 'reduce' : 'no-preference',
  hasTouch: W < 760,
  isMobile: W < 760,
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
const url = `http://localhost:${port}/${has('nowebgl') ? '?webgl=0' : ''}`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(wait);

for (const at of ats) {
  await page.evaluate((at) => {
    if (at === 'top') return window.scrollTo(0, 0);
    if (at === 'bottom') return window.scrollTo(0, document.documentElement.scrollHeight);
    const [id, t] = at.split(':');
    const el = document.querySelector(`[data-chapter="${id}"]`);
    if (!el) throw new Error(`no chapter ${id}`);
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top + el.offsetHeight * Number(t ?? 0));
  }, at);
  await page.waitForTimeout(wait);
  for (const sel of all('click')) {
    await page.click(sel).catch((e) => errors.push(`click ${sel}: ${e.message}`));
    await page.waitForTimeout(800);
  }
  const ev = opt('eval');
  if (ev) await page.evaluate(ev).catch((e) => errors.push(`eval: ${e.message}`));
  const file = `${out}-${at.replace(/[:.]/g, '_')}.png`;
  await page.screenshot({ path: file });
  console.log(`shot ${file}`);
}
console.log(JSON.stringify({ url, errors: [...new Set(errors)].slice(0, 30) }));
await browser.close();
await server.close();
