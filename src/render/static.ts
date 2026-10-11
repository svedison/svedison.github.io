// Pure HTML renderers (no DOM APIs): used at BUILD time by vite.config.ts to inline the full story and
// Logbook into the HTML, so the site is complete with JavaScript disabled (SPEC §11).
// renderStory() is owned by the shell agent; renderLogbook() content is owned by the logbook agent.
import {
  CHAPTERS,
  COLOPHON,
  LATITUDE_LINE,
  MOON_POEM,
  PERSON,
  PROLOGUE_CTA,
  SHORE_COPY,
  STATIONS,
  THREE_WORDS,
  WELLBEING_LINE,
  type Chapter,
} from '../content/story';
import { HOTSPOT_COPY, LOGBOOK_COPY } from '../content/ui';
import { KEEPSAKES } from '../content/keepsakes';
import { RESUME } from '../content/resume';
import { glyph } from '../ui/glyphs';
import { SUMMARY as LB_SUMMARY } from '../content/resume'; // renderLogbook

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The public base path ('/' or '/<repo>/' for a GitHub Pages project site). In the browser (the JS Logbook
 * overlay) Vite supplies import.meta.env.BASE_URL; at build time vite.config.ts imports this file in Node, where
 * import.meta.env is undefined, so derive it from BASE_PATH exactly as vite.config.ts does.
 */
const BASE: string =
  import.meta.env?.BASE_URL ??
  `/${(globalThis.process?.env?.BASE_PATH ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
/** A path under the site base: withBase('logbook/') -> '/logbook/' or '/<repo>/logbook/'. */
const withBase = (path: string) => BASE + path.replace(/^\/+/, '');

/** Accessible equivalent for a calligraphic seal (the seal itself is decorative). */
function sealLabel(cjk: string): string {
  const word = THREE_WORDS.find((w) => w.cjk === cjk);
  if (word) return `${cjk}: ${word.en}`;
  const station = STATIONS.find((s) => s.cjk === cjk);
  if (station) return `${cjk}: ${station.label}`;
  return cjk;
}

/** Authored placement of each chapter's reading block (varies per chapter; never all centred). */
const PLACE: Record<Chapter['id'], string> = {
  prologue: 'hero',
  river: 'right-low',
  crossing: 'left-high',
  coast: 'right-mid',
  rain: 'left-low',
  workshop: 'left-high',
  loop: 'center',
  next: 'left-mid',
};

function heading(c: Chapter): string {
  const tag = c.id === 'prologue' ? 'h1' : 'h2';
  return `<${tag} class="chapter__title" data-split>${esc(c.title)}</${tag}>`;
}

function seal(c: Chapter): string {
  if (!c.seal) return '';
  return `<p class="seal" lang="zh-Hans"><span class="seal__glyphs" aria-hidden="true">${esc(c.seal)}</span><span class="sr-only">${esc(
    sealLabel(c.seal),
  )}</span></p>`;
}

function ctas(c: Chapter): string {
  if (c.id === 'prologue') {
    const next = CHAPTERS[1];
    return `<div class="cta-row" data-beat="cta">
        <a class="cta cta--primary" href="#${next.id}" data-scroll-to="${next.id}">${esc(PROLOGUE_CTA.begin)} <span class="cta__arrow" aria-hidden="true">↓</span></a>
        <a class="cta cta--quiet" href="${withBase('logbook/')}" data-open="logbook">${esc(PROLOGUE_CTA.skip)}</a>
      </div>`;
  }
  return '';
}

function nextShore(): string {
  return `<div class="shore" data-beat="cta">
      <p class="shore__now">${esc(WELLBEING_LINE)}</p>
      <p class="shore__dates">${esc(SHORE_COPY.available)} ${esc(PERSON.available)}</p>
      <div class="cta-row">
        <a class="cta cta--primary" href="mailto:${esc(PERSON.email)}">${esc(SHORE_COPY.hello)}</a>
      </div>
      <ul class="shore__links" aria-label="${esc(SHORE_COPY.elsewhere)}">
        <li><a href="${withBase('logbook/')}" data-open="logbook">${esc(SHORE_COPY.logbook)}</a></li>
        <li><a href="${esc(withBase(PERSON.resumePdf))}" download>${esc(SHORE_COPY.resume)}</a></li>
        <li><a href="${esc(PERSON.github)}" rel="noopener" target="_blank">${esc(SHORE_COPY.github)}</a></li>
        <li><a href="${esc(PERSON.linkedin)}" rel="noopener" target="_blank">${esc(SHORE_COPY.linkedin)}</a></li>
      </ul>
      <p class="shore__mail mono"><a href="mailto:${esc(PERSON.email)}">${esc(PERSON.email)}</a></p>
    </div>`;
}

function colophon(): string {
  const C = COLOPHON.rows;
  return `<footer class="colophon">
      <svg class="colophon__mark" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="M62 13 C 84 20, 93 44, 86 64 C 78 85, 52 93, 32 84 C 12 75, 6 50, 15 32 C 22 18, 36 11, 50 11" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg>
      <dl class="colophon__credits">
        <div><dt>${esc(C.type.term)}</dt><dd>${esc(C.type.text)}</dd></div>
        <div><dt>${esc(C.poem.term)}</dt><dd><span lang="zh-Hans">${esc(MOON_POEM.zh)}</span> ${esc(MOON_POEM.attribution)}. ${esc(C.poem.text)}</dd></div>
        <div><dt>${esc(C.world.term)}</dt><dd>${esc(C.world.text)}</dd></div>
        <div><dt>${esc(C.sound.term)}</dt><dd>${esc(C.sound.text)}</dd></div>
      </dl>
      <p class="colophon__copy">${esc(COLOPHON.copyright(PERSON.name))}</p>
    </footer>`;
}

/**
 * No-JS keepsakes (SPEC §11: the full story without JS). Every keepsake's story is printed as a native
 * <details> card (title, then the story), so a reader without JS still finds the grandparents line and the rest.
 * With JS, CSS hides [data-static-keepsake] (html.js) and ui/hotspots.ts builds the real buttons in this slot.
 * Visible keepsakes first, hidden ones last: the same order hotspots.ts uses.
 */
function staticKeepsakes(c: Chapter): string {
  const list = KEEPSAKES.filter((k) => k.chapter === c.id);
  const ordered = [...list.filter((k) => !k.hidden), ...list.filter((k) => k.hidden)];
  const card = (id: string, title: string, body: string) =>
    `<li class="keepsake-static" data-static-keepsake="${id}"><details><summary><span class="keepsake-static__mark" aria-hidden="true">${glyph(id, 'keepsake-static__glyph')}</span>${esc(
      title,
    )}</summary><p>${body}</p></details></li>`;
  const items = ordered.map((k) => card(k.id, k.title, esc(k.story)));
  // The moon is an easter egg in the live world (SPEC §4.5); without JS its poem is printed here.
  if (c.id === 'crossing') {
    items.push(
      card(
        'moon',
        MOON_POEM.label,
        `<span lang="zh-Hans">${esc(MOON_POEM.zh)}</span><br />${esc(MOON_POEM.en)}<br /><span class="keepsake-static__by">${esc(
          MOON_POEM.attribution,
        )}</span>`,
      ),
    );
  }
  if (!items.length) return '';
  return `<ul class="keeps-static" data-static-keepsake aria-label="${esc(HOTSPOT_COPY.group)}">${items.join('')}</ul>`;
}

/** The coast's "nearly the same latitude" moment is drawn in the world; this says it in words (sr-only). */
function latitudeLine(): string {
  const a = STATIONS.find((s) => s.id === 'jiangyin');
  const b = STATIONS.find((s) => s.id === 'oc');
  return a && b ? `<p class="sr-only">${esc(LATITUDE_LINE(a, b))}</p>` : '';
}

/** Chapters whose later lines appear inside the pinned stage (e.g. the underwater line) rather than in flow. */
const ASIDE_IN_STAGE = new Set<Chapter['id']>(['crossing']);

function chapter(c: Chapter): string {
  const [lead, ...asides] = c.body;
  const inStage = ASIDE_IN_STAGE.has(c.id);
  const asideHtml = asides
    .map(
      (p, i) =>
        `<div class="chapter__aside chapter__aside--${i + 1}${inStage ? ' chapter__aside--stage' : ''}" data-ui><p data-beat="aside">${esc(p)}</p></div>`,
    )
    .join('\n  ');
  const bodyAttr = c.id === 'loop' ? 'data-scrub' : 'data-beat="body"';
  const tail =
    c.id === 'rain'
      ? '<div class="slot slot--forgive" data-slot="forgive"></div>'
      : c.id === 'loop'
        ? '<div class="slot slot--loop" data-slot="loop"></div>'
        : c.id === 'next'
          ? `<div class="slot slot--tally" data-slot="tally"></div>
  ${colophon()}`
          : '';
  const trailing = (asides.length && !inStage) || c.id === 'rain' || c.id === 'loop';
  return `<section class="chapter chapter--${c.id}" id="${c.id}" data-chapter="${c.id}" aria-labelledby="t-${c.id}" style="--weight:${c.scrollWeight}"${
    trailing ? ' data-trailing' : ''
  }>
  <div class="chapter__hold">
    <div class="chapter__pin" data-place="${PLACE[c.id]}">
      ${seal(c)}
      <div class="chapter__copy" data-ui>
        <p class="eyebrow" data-beat="eyebrow">${esc(c.eyebrow)}</p>
        ${heading(c).replace('class="chapter__title"', `class="chapter__title" id="t-${c.id}"`)}
        ${
          // Next shore: the headline, the well-being line and the dates line already say everything in the
          // chapter body, so the shore block carries it (no triple repetition of the same facts).
          c.id === 'next' ? '' : `<p class="chapter__body" ${bodyAttr}>${esc(lead)}</p>`
        }
        ${c.coords ? `<p class="coords mono" data-beat="coords">${esc(c.coords)}</p>` : ''}
        ${c.id === 'coast' ? latitudeLine() : ''}
        ${ctas(c)}
        ${c.id === 'next' ? nextShore() : ''}
      </div>
      ${inStage ? asideHtml : ''}
      <div class="slot slot--hotspots" data-slot="hotspots" data-ui>${staticKeepsakes(c)}</div>
    </div>
  </div>
  <div class="chapter__tail">
  ${inStage ? '' : asideHtml}
  ${tail}
  </div>
</section>`;
}

export function renderStory(): string {
  return CHAPTERS.map(chapter).join('\n');
}

// <logbook-agent:renderLogbook> (owned by the logbook agent; edit only inside these markers)
/**
 * The Logbook: the recruiter path (SPEC §6.1), as a book-serif-index spread.
 * Used for /logbook/ (static), the <noscript> fallback on the main page, and the JS overlay (ui/logbook.ts).
 * Facts come only from RESUME / SUMMARY / PERSON. No phone number, ever. Owned by the logbook agent.
 */
export function renderLogbook(): string {
  const strip = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  // Make résumé numbers scannable in ten seconds: 134+, 50K+, 4.5M+, 30%, 2,000+ ...
  const figures = (s: string) => esc(s).replace(/\d[\d.,]*[MK]?(?:\+|%)/g, (m) => `<strong>${m}</strong>`);
  const sections = [
    { key: 'experience', label: LOGBOOK_COPY.sections.experience },
    { key: 'projects', label: LOGBOOK_COPY.sections.projects },
    { key: 'education', label: LOGBOOK_COPY.sections.education },
    { key: 'skills', label: LOGBOOK_COPY.sections.skills },
    { key: 'contact', label: LOGBOOK_COPY.sections.contact },
  ] as const;
  type Key = (typeof sections)[number]['key'];
  type Entry = (typeof RESUME)[number];
  const num = (i: number) => String(i + 1).padStart(2, '0');
  const sectionHead = (key: Key) => {
    const i = sections.findIndex((s) => s.key === key);
    return `<h3 class="lb-section__title" id="lb-${key}-h" tabindex="-1"><span class="lb-section__num" aria-hidden="true">${num(i)}</span> ${sections[i].label}</h3>`;
  };
  const note = (r: Entry, extra = '') =>
    `<p class="lb-entry__note${extra}"><span class="lb-entry__shelf">${esc(LOGBOOK_COPY.onShelf)}</span> ${esc(r.artifact)}. <em>${esc(r.why)}</em></p>`;

  let first = true;
  const entry = (r: Entry) => {
    const lead = first ? ' lb-entry--lead' : '';
    first = false;
    const pill = r.status ? ` <span class="lb-pill">${esc(r.status)}</span>` : '';
    return `<article class="lb-entry${lead}" id="lb-entry-${r.id}" aria-labelledby="lb-entry-${r.id}-h">
  <div class="lb-entry__margin">
    ${r.dates ? `<p class="lb-entry__dates">${esc(r.dates).replace(" – ", " – <br />")}</p>` : ''}
    ${r.place ? `<p class="lb-entry__place">${esc(r.place)}</p>` : ''}
    ${note(r)}
  </div>
  <div class="lb-entry__body">
    <h4 class="lb-entry__org" id="lb-entry-${r.id}-h">${esc(r.org)}${pill}</h4>
    ${r.role ? `<p class="lb-entry__role">${esc(r.role)}</p>` : ''}
    <ul class="lb-entry__bullets">${r.bullets.map((b) => `<li>${figures(b)}</li>`).join('')}</ul>
  </div>
</article>`;
  };
  const of = (kind: Entry['kind']) => RESUME.filter((r) => r.kind === kind);

  const skills = of('skills')
    .map(
      (r) => `<dl class="lb-skills" id="lb-entry-${r.id}">${r.bullets
        .map((b) => {
          const at = b.indexOf(': ');
          return at > 0
            ? `<div class="lb-skills__row"><dt>${esc(b.slice(0, at))}</dt><dd>${esc(b.slice(at + 2))}</dd></div>`
            : `<div class="lb-skills__row"><dd>${esc(b)}</dd></div>`;
        })
        .join('')}</dl>
${note(r, ' lb-entry__note--inline')}`,
    )
    .join('');

  const pdf = `<a class="lb-pdf" href="${esc(withBase(PERSON.resumePdf))}" download="Jiayi-Zhu-Resume.pdf"><span>${esc(LOGBOOK_COPY.download)}</span> <span class="lb-pdf__ext">${esc(LOGBOOK_COPY.pdf)}</span></a>`;
  const ext = ' rel="noopener" target="_blank"';
  const contact = [
    { label: LOGBOOK_COPY.email, href: `mailto:${PERSON.email}`, text: PERSON.email, attrs: '' },
    { label: LOGBOOK_COPY.github, href: PERSON.github, text: strip(PERSON.github), attrs: ext },
    { label: LOGBOOK_COPY.linkedin, href: PERSON.linkedin, text: strip(PERSON.linkedin), attrs: ext },
  ];

  return `<div class="lb" data-logbook>
<nav class="lb-rail" aria-label="${esc(LOGBOOK_COPY.index)}">
  <p class="lb-rail__title"><span>${esc(LOGBOOK_COPY.title)}</span> <span class="lb-rail__sub">${esc(PERSON.name)}</span></p>
  <ol class="lb-rail__list">
    ${sections
      .map((s, i) => `<li><a href="#lb-${s.key}" data-lb-link="${s.key}"><span class="lb-rail__num" aria-hidden="true">${num(i)}</span> ${s.label}</a></li>`)
      .join('\n    ')}
  </ol>
  <div class="lb-rail__foot">
    ${pdf}
    <p class="lb-rail__meta">${esc(LOGBOOK_COPY.graduating)} ${esc(PERSON.graduation)}<br />${esc(LOGBOOK_COPY.available)} ${esc(PERSON.available)}</p>
  </div>
</nav>
<div class="lb-spread">
  <div class="lb-page lb-page--verso">
    <header class="lb-head">
      <p class="lb-kicker">${esc(LOGBOOK_COPY.kicker)}</p>
      <h2 class="lb-name" id="lb-title" tabindex="-1">${esc(PERSON.name)}</h2>
      <p class="lb-summary">${esc(LB_SUMMARY)}</p>
      <ul class="lb-links">
        ${contact.map((c) => `<li><a href="${esc(c.href)}" data-print="${esc(c.text)}"${c.attrs}>${c.label}</a></li>`).join('\n        ')}
        <li class="lb-links__pdf">${pdf}</li>
      </ul>
    </header>
    <section class="lb-section" id="lb-experience" aria-labelledby="lb-experience-h">
      ${sectionHead('experience')}
      ${of('experience').map(entry).join('\n')}
    </section>
    <p class="lb-folio" aria-hidden="true"><span>${esc(LOGBOOK_COPY.title)}</span><span>i</span></p>
  </div>
  <div class="lb-page lb-page--recto">
    <section class="lb-section" id="lb-projects" aria-labelledby="lb-projects-h">
      ${sectionHead('projects')}
      ${of('project').map(entry).join('\n')}
    </section>
    <section class="lb-section" id="lb-education" aria-labelledby="lb-education-h">
      ${sectionHead('education')}
      ${of('education').map(entry).join('\n')}
    </section>
    <section class="lb-section" id="lb-skills" aria-labelledby="lb-skills-h">
      ${sectionHead('skills')}
      ${skills}
    </section>
    <section class="lb-section lb-contact" id="lb-contact" aria-labelledby="lb-contact-h">
      ${sectionHead('contact')}
      <dl class="lb-contact__list">
        ${contact
          .map((c) => `<div class="lb-contact__row"><dt>${c.label}</dt><dd><a href="${esc(c.href)}"${c.attrs}>${esc(c.text)}</a></dd></div>`)
          .join('\n        ')}
        <div class="lb-contact__row"><dt>${esc(LOGBOOK_COPY.resume)}</dt><dd>${pdf}</dd></div>
      </dl>
    </section>
    <p class="lb-folio" aria-hidden="true"><span>${esc(PERSON.name)}</span><span>ii</span></p>
  </div>
</div>
</div>`;
}
// </logbook-agent:renderLogbook>
