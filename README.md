# The Long Way Here

Jiayi Zhu's portfolio as a small scroll-driven world. You steer a paper boat with a lantern from Jiangyin on the Yangtze, across the Pacific, to Orange County and then to rainy Seattle. Scrolling moves the boat. Along the way you collect keepsakes and three lights (love, gratitude, forgive), and at the end you close the loop of the water cycle. The résumé is always one click away in the **Logbook** (press `L`, or open `/logbook/`).

- Live site: **https://svedison.github.io/**
- Asset provenance: [`ASSETS.md`](ASSETS.md)

## Run it

Needs Node 22 (CI uses 22; it also runs on newer versions).

```bash
npm ci
npm run dev          # Vite dev server
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production build into dist/
npm run preview      # serve dist/ on http://localhost:4173
npm run resume:pdf   # rebuild public/Jiayi-Zhu-Resume.pdf from src/content/resume.ts
```

### Visual QA

`scripts/shoot.mjs` starts its own Vite server, opens headless Chromium (WebGL through SwiftShader, so it is slow but the pixels are correct), scrolls to chapter positions and saves screenshots.

```bash
npx playwright install chromium   # once
node scripts/shoot.mjs --at river:0.5 --at crossing:0.3 --out shots/check
node scripts/shoot.mjs --at rain:0.5 --w 390 --h 844 --out shots/phone
node scripts/shoot.mjs --at top --reduced --out shots/reduced
node scripts/shoot.mjs --at coast:0.4 --nowebgl --out shots/nogl
```

`--at` takes `chapter:t`, where `t` runs from 0 to 1 through a chapter, or `top` / `bottom`. Chapters: `prologue`, `river`, `crossing`, `coast`, `rain`, `workshop`, `loop`, `next`. `scripts/shoot-logbook.mjs` captures the Logbook page.

## Fallbacks

Each of these should still give you the whole story:

| Situation | What you get |
|---|---|
| Normal | One WebGL canvas behind the DOM story. Native scroll drives the camera. |
| `prefers-reduced-motion` | No smoothing or time-based animation, and no pointer trail. All copy and keepsakes stay reachable. |
| No WebGL, or `?webgl=0` | Poster stills and gradients behind the same DOM story. Keepsakes appear as DOM buttons. |
| No JavaScript | The full story and the Logbook are rendered into the HTML at build time (`src/render/static.ts`). |

Scrolling is always native: no wheel hijacking and no scroll-snap. Every 3D hotspot has a matching DOM button in document order.

## How it is built

- **Vite + TypeScript**, no framework. three.js `0.169.0` (pinned, because the vendored ocean targets r169), plus gsap and lenis.
- **Scroll conductor** (`src/world/conductor.ts`): native scroll is the only input. It works out progress through each chapter `<section>`.
- **Engine** (`src/world/engine.ts`): one renderer and one camera. Each chapter module owns its own `THREE.Scene` and is lazy-loaded. A mist layer (`#veil`) hides the seam where one module hands over to the next.
- **Event bus** (`src/bus.ts`): the only channel between the DOM UI and the world.
- **Game state** (`src/game/state.ts`): keepsakes, lights, visited stations, loop and sound. Saved to `localStorage`.
- **Loader** (`src/loader/head.html`): a burning-paper ring drawn by a Worker on an OffscreenCanvas, inlined into `<head>` at build time.

```
index.html, logbook/index.html   page shells (story + Logbook injected at build time by vite.config.ts)
src/content/                     story.ts, resume.ts, keepsakes.ts: all copy and facts, data only
src/render/static.ts             build-time HTML for the story and Logbook (the no-JS page)
src/world/                       conductor, engine, types, chapters/<module>.ts, systems/, vendor/
src/ui/                          HUD, Logbook overlay, satchel, atlas, reveal, audio, easter eggs, cinder transition
src/game/state.ts                persisted game state
src/styles/                      tokens.css plus per-feature stylesheets
public/                          favicon, résumé PDF, poster stills
scripts/                         shoot.mjs, shoot-logbook.mjs (visual QA); build-resume-pdf.mjs
```

## Deploy

`.github/workflows/deploy.yml` builds with Node 22 and publishes `dist/` to GitHub Pages:

1. Push to a GitHub repository. The default branch must be `main`.
2. Go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. Each push to `main` then builds and deploys the site.

This repository is a **user site** (`svedison.github.io`), so the workflow builds with `BASE_PATH=/`. For a project site served from `https://<owner>.github.io/<repo-name>/`, set `BASE_PATH=/<repo-name>/`. When it is unset, it defaults to `/`. To check a project-site build locally:

```bash
BASE_PATH=/the-long-way-here/ npm run build && npm run preview
# then open http://localhost:4173/the-long-way-here/
```

On Windows Git Bash, put `MSYS_NO_PATHCONV=1` in front of that command. Otherwise MSYS rewrites `/the-long-way-here/` into a Windows path.

### Network at runtime

- Fonts load from Google Fonts.
- One easter egg calls the Open-Meteo forecast API for Seattle weather, and caches the result for 30 minutes. The site works without it.
- Nothing else is fetched from third parties. Nothing you type in the rain is sent or stored.

## Credits

- Story, résumé and words: Jiayi Zhu.
- Type: Newsreader, IBM Plex Mono, Ma Shan Zheng and Noto Serif SC (SIL Open Font License), via Google Fonts.
- Poem: 海上生明月，天涯共此时, Zhang Jiuling (张九龄), Tang dynasty (public domain).
- The world is drawn in code with [three.js](https://threejs.org) (MIT). The techniques follow agent skills from the MengTo Skills library (`github.com/MengTo/Skills`). See [`ASSETS.md`](ASSETS.md) for every asset's origin.

No license file is included yet, so no reuse rights are granted. © 2026 Jiayi Zhu.
