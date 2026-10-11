// Builds public/Jiayi-Zhu-Resume.pdf: the public, redacted résumé.
//
//   node scripts/build-resume-pdf.mjs [--out public/Jiayi-Zhu-Resume.pdf] [--html shots/resume.html]
//
// Facts come from src/content/resume.ts (which mirrors the original PDF) and contact
// details from PERSON in src/content/story.ts. Redactions (CLAUDE.md, SPEC §2):
//   - no phone number;
//   - the Capgemini client is "a major retail client" (already so in resume.ts).
// The script refuses to write the PDF if the rendered text contains a phone-number
// pattern or the client's name.
//
// The only text not taken from src/content is PDF_EXTRAS below: résumé-only details
// that the site does not show, copied verbatim from the original PDF.

import { build } from 'esbuild';
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const OUT = resolve(ROOT, argOf('--out', 'public/Jiayi-Zhu-Resume.pdf'));
const HTML_OUT = argOf('--html', null);

// --- load content (TS -> ESM via esbuild, imported from a data: URL) ---------------
async function loadTs(rel) {
  const res = await build({
    entryPoints: [resolve(ROOT, rel)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
  });
  const code = res.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const { RESUME, SUMMARY } = await loadTs('src/content/resume.ts');
const { PERSON } = await loadTs('src/content/story.ts');

// Résumé-only details, verbatim from Atlassian-Data-Engineer-2027-Graduate-Resume.pdf.
const PDF_EXTRAS = {
  // The PDF's summary continues past the first sentence the site uses (SUMMARY).
  summaryRest:
    'Independently designed an end-to-end master-data-management pipeline on Amazon Aurora PostgreSQL with golden records and field-level lineage, engineered a distributed Apache Spark pipeline on Databricks processing 4.5M+ records, and built Python ETL pipelines with API ingestion and data validation integrating 10+ external datasets. Strong CS fundamentals (data structures & algorithms, probability, statistical modeling) with substantial SQL, Python, and big-data-engine experience from internships, projects, and hackathons.',
  // The PDF marks the Symetra role as ongoing; resume.ts compresses it to a range.
  dates: { 'golden-record': 'Jul 2026 – Present (expected Oct 2026)' },
  // Not on the original PDF; site-only.
  exclude: new Set(['seed-cloche']),
};

// --- render -----------------------------------------------------------------------
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const bare = (url) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const split = (s) => s.split(' · ');

const entries = RESUME.filter((e) => !PDF_EXTRAS.exclude.has(e.id));
const dateOf = (e) => PDF_EXTRAS.dates[e.id] ?? e.dates;

function headRow(left, right, cls = '') {
  return `<div class="row ${cls}"><span>${left}</span><span>${right ?? ''}</span></div>`;
}

function entryBlock(e) {
  let org = esc(e.org);
  let role = esc(e.role);
  if (e.kind === 'project') {
    const [kind, r] = split(e.role);
    org = `${esc(e.org)} <span class="sep">–</span> ${esc(kind)}`;
    role = esc(r ?? '');
  }
  return `<article class="entry">
    ${headRow(`<strong>${org}</strong>`, esc(e.place ?? ''), 'org')}
    ${headRow(`<em>${role}</em>`, `<em>${esc(dateOf(e))}</em>`, 'role')}
    <ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
  </article>`;
}

function educationBlock(e) {
  const [degree, concentration] = split(e.role);
  const [gpaLine, ...rest] = e.bullets;
  // "GPA 3.70 / 4.00 · Dean’s List." -> "GPA: 3.70/4.00 · Dean’s List"
  const gpa = gpaLine.replace(/\.$/, '').replace(/^GPA\s+/, 'GPA: ').replace(' / ', '/');
  return `<article class="entry">
    ${headRow(`<strong>${esc(e.org)}</strong>`, esc(e.place ?? ''), 'org')}
    ${headRow(`<em>${esc(degree.replace(/^B\.S\. /, 'B.S. in '))}</em>`, `<em>${esc(e.dates)}</em>`, 'role')}
    <p class="line">Concentration: ${esc(concentration)} <span class="sep">·</span> ${esc(gpa)}</p>
    ${rest
      .map((b) => {
        const m = b.match(/^([^:]+):\s*(.*)$/);
        return `<p class="line">${m ? `<span class="label">${esc(m[1])}:</span> ${esc(m[2])}` : esc(b)}</p>`;
      })
      .join('')}
  </article>`;
}

function skillsBlock(e) {
  return `<dl class="skills">${e.bullets
    .map((b) => {
      const i = b.indexOf(':');
      return `<div><dt>${esc(b.slice(0, i))}:</dt> <dd>${esc(b.slice(i + 1).trim())}</dd></div>`;
    })
    .join('')}</dl>`;
}

const section = (title, body) => `<section><h2>${title}</h2>${body}</section>`;
const of = (kind) => entries.filter((e) => e.kind === kind);

const contact = [
  `<a href="mailto:${esc(PERSON.email)}">${esc(PERSON.email)}</a>`,
  'Seattle, WA',
  `<a href="${esc(PERSON.github)}">${esc(bare(PERSON.github))}</a>`,
  `<a href="${esc(PERSON.linkedin)}">${esc(bare(PERSON.linkedin))}</a>`,
].join('<span class="sep" aria-hidden="true"> | </span>');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(PERSON.name)} – Résumé</title>
<meta name="author" content="${esc(PERSON.name)}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&display=swap" />
<style>
  /* Site tokens (src/styles/tokens.css), tuned for print: ink on white, lantern as a hairline only. */
  :root {
    --ink: #1c1b19;
    --ink-soft: #4a4740;
    --rule: #b8b2a6;
    --lantern-print: #c98a2a;
    --font-body: 'Newsreader', 'Iowan Old Style', Georgia, serif;
  }
  @page { size: Letter; margin: 0.4in 0.5in 0.36in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { background: #fff; }
  body {
    font-family: var(--font-body);
    font-optical-sizing: auto;
    font-size: 9.3pt;
    line-height: 1.17;
    color: var(--ink);
    font-kerning: normal;
    font-variant-numeric: lining-nums;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  a { color: inherit; text-decoration: none; }
  header { text-align: center; padding-bottom: 4pt; border-bottom: 0.75pt solid var(--lantern-print); margin-bottom: 2pt; }
  h1 { font-size: 20pt; font-weight: 600; letter-spacing: 0.01em; line-height: 1.1; }
  .contact { margin-top: 2pt; font-size: 9.2pt; color: var(--ink-soft); }
  .sep { color: var(--rule); }
  .contact .sep { padding: 0 2pt; }
  section { margin-top: 4.5pt; }
  h2 {
    font-size: 9pt; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    border-bottom: 0.5pt solid var(--rule); padding-bottom: 1pt; margin-bottom: 2.5pt;
  }
  .summary { text-align: left; hyphens: manual; }
  .entry { margin-top: 3pt; break-inside: avoid; }
  .entry:first-of-type { margin-top: 0; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12pt; }
  .row span:last-child { text-align: right; white-space: nowrap; }
  .org { font-size: 10pt; }
  .org strong { font-weight: 600; }
  .org .sep { color: var(--ink-soft); font-weight: 400; }
  .role { color: var(--ink-soft); }
  ul { margin-top: 0.5pt; padding-left: 11pt; }
  li { margin-top: 0.5pt; padding-left: 1pt; }
  li::marker { content: '·  '; color: var(--ink-soft); font-weight: 600; }
  .line { margin-top: 0.5pt; }
  .label, dt { font-weight: 600; }
  .skills > div { margin-top: 0.5pt; }
  dt, dd { display: inline; }
</style>
</head>
<body>
  <header>
    <h1>${esc(PERSON.name)}</h1>
    <p class="contact">${contact}</p>
  </header>
  ${section('Professional Summary', `<p class="summary">${esc(SUMMARY)} ${esc(PDF_EXTRAS.summaryRest)}</p>`)}
  ${section('Education', of('education').map(educationBlock).join(''))}
  ${section('Work Experience', of('experience').map(entryBlock).join(''))}
  ${section('Projects', of('project').map(entryBlock).join(''))}
  ${section('Technical Skills', of('skills').map(skillsBlock).join(''))}
</body>
</html>`;

// --- redaction gate -------------------------------------------------------------------
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
// Terms that must never ship (the client's name) live outside the public repo: the REDACT_TERMS env var
// (comma-separated) or a git-ignored .redact file (one term per line).
const REDACT_SRC = process.env.REDACT_TERMS ?? (existsSync(resolve(ROOT, '.redact')) ? readFileSync(resolve(ROOT, '.redact'), 'utf8') : '');
const REDACT = REDACT_SRC.split(/[,\n]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
if (!REDACT.length) console.warn('No redaction terms (.redact / REDACT_TERMS): only the phone check runs.');
function assertRedacted(text, where) {
  if (PHONE.test(text)) throw new Error(`Phone-number pattern found in ${where}`);
  const low = text.toLowerCase();
  if (REDACT.some((t) => low.includes(t))) throw new Error(`Redacted term found in ${where}`);
}
assertRedacted(html, 'HTML source');

if (HTML_OUT) {
  const p = resolve(ROOT, HTML_OUT);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, html);
}

// --- print --------------------------------------------------------------------------
const browser = await chromium.launch();
try {
  // Viewport = the printable area of Letter minus @page margins (8.5in - 1in wide).
  const page = await browser.newPage({ viewport: { width: 720, height: 983 } });
  await page.emulateMedia({ media: 'print' });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const fontOk = await page.evaluate(() => document.fonts.check('10pt Newsreader'));
  if (!fontOk) console.warn('warning: Newsreader did not load; the PDF falls back to Georgia/serif.');
  assertRedacted(await page.evaluate(() => document.body.innerText), 'rendered text');

  const contentPx = await page.evaluate(() => document.body.getBoundingClientRect().height);

  // One page, or fail loudly.
  const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true, tagged: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
  if (pages !== 1) {
    throw new Error(`Résumé must fit on one page; got ${pages} (content ${Math.round(contentPx)}px of 983px).`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, pdf);
  console.log(`wrote ${pathToFileURL(OUT).pathname} (${pdf.length} bytes, ${pages} page, content ${Math.round(contentPx)}/983px)`);
} finally {
  await browser.close();
}
