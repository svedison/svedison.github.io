// Visual QA for the Logbook: /logbook/ page (screen + print), or any path, with optional clicks/eval.
// Usage:
//   node scripts/shoot-logbook.mjs [--path /logbook/] [--w 1440 --h 900] [--out shots/logbook/page]
//          [--full] [--scroll 1200] [--print] [--pdf] [--reduced] [--nojs] [--wait 1500]
//          [--click "css"] [--eval "js"] [--key "l"]
// --print screenshots with print media emulation; --pdf writes <out>.pdf (Letter) and reports its page count.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const out = opt('out', 'shots/logbook/page');
const wait = Number(opt('wait', 1500));
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
  javaScriptEnabled: !has('nojs'),
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const url = `http://localhost:${port}${opt('path', '/logbook/')}`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(wait);
if (opt('scroll')) {
  await page.evaluate((y) => window.scrollTo(0, y), Number(opt('scroll')));
  await page.waitForTimeout(400);
}
for (const k of all('key')) {
  await page.keyboard.press(k);
  await page.waitForTimeout(700);
}
for (const sel of all('click')) {
  await page.click(sel).catch((e) => errors.push(`click ${sel}: ${e.message}`));
  await page.waitForTimeout(800);
}
for (const ev of all('eval')) {
  const r = await page.evaluate(ev).catch((e) => errors.push(`eval: ${e.message}`));
  if (r !== undefined) console.log('eval:', JSON.stringify(r));
  await page.waitForTimeout(800);
}
if (has('print')) await page.emulateMedia({ media: 'print' });
await page.screenshot({ path: `${out}.png`, fullPage: has('full') });
console.log(`shot ${out}.png`);
if (has('pdf')) {
  const pdf = await page.pdf({ format: 'Letter', printBackground: true });
  writeFileSync(`${out}.pdf`, pdf);
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(`pdf ${out}.pdf pages=${pages}`);
}
console.log(JSON.stringify({ url, errors: [...new Set(errors)].slice(0, 30) }));
await browser.close();
await server.close();
