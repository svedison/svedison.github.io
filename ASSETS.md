# Assets and provenance

Every asset the site ships, and where it came from. The rule (SPEC §5.4, §10, §12.2) is that nothing ships without a known origin. The site uses no stock photography, no third-party images, no audio files and no 3D model files.

## Summary

| Asset | Origin | License / status |
|---|---|---|
| 3D world (all chapters) | Procedural, written in this repo with three.js | Project code |
| `src/world/vendor/ocean.mjs` | Vendored from the `3d-ultra-realistic-water` skill | See note |
| `src/world/vendor/underwater-light.mjs` | Vendored from the `3d-underwater-god-rays` skill | See note |
| Cinder transition GLSL (`src/ui/cinder/glsl-kibori.ts`) | Ported verbatim from the `paper-cinder-transition` skill demo | See note |
| Loader (`src/loader/head.html`) | Adapted from the `fire-paper-loader` skill | See note |
| Textures (washi paper, water detail, glyphs, map masks, etc.) | Generated at runtime on the CPU or GPU | Project code |
| Audio | Synthesized at runtime with Web Audio (`src/ui/audio.ts`) | Project code; no audio files |
| Pacific-rim coastlines (`src/world/chapters/loop/geo.ts`, `src/ui/atlas.ts`) | Hand-simplified lat/lon points traced from real coasts | Project data; no map dataset shipped |
| Fonts | Google Fonts, loaded at runtime | SIL Open Font License 1.1 |
| `public/posters/*.jpg` | Rendered from this site's own WebGL scenes | Project output |
| `public/Jiayi-Zhu-Resume.pdf` | Generated from `src/content/resume.ts` | Jiayi Zhu |
| `public/favicon.svg` | Hand-written SVG lantern in `--lantern` (#f2a93b) | Project asset |
| Poem 海上生明月，天涯共此时 | Zhang Jiuling (张九龄), Tang dynasty | Public domain |

## Details

### Procedural world
Every chapter scene in `src/world/chapters/` is built from three.js primitives, shaders and noise: the Jiangyin canal town, the Pacific crossing, the Orange County coast, the Seattle rain, the workshop, the loop map and the final chapter. Shared helpers live in `src/world/systems/`. Textures such as washi paper (`systems/washi.ts`) are baked once at runtime into `CanvasTexture` / `DataTexture` objects. No image or model files are loaded.

### Vendored modules
- **`src/world/vendor/ocean.mjs`** is the open-ocean water module from the `3d-ultra-realistic-water` skill in `.claude/skills/`. The skill says it was extracted from that skill's own "Pirate Ship Sunset" three.js r169 scene. It targets three r169, which is why `three` is pinned to `0.169.0`. It takes the project's own `THREE` and does not import a second copy.
- **`src/world/vendor/underwater-light.mjs`** is the underwater god-ray module from the `3d-underwater-god-rays` skill.
- **`src/ui/cinder/glsl-kibori.ts`** holds GLSL ported verbatim from the `paper-cinder-transition` skill demo. Its header credits the look to the skill (which calls it KIBORI's own GLSL).
- **`src/loader/head.html`** is the `fire-paper-loader` skill's worker-drawn ring, re-skinned as the brush circle.

These skills come from the MengTo Skills library (`github.com/MengTo/Skills`, SPEC "Source material"). **Licence status: to confirm.** The skill folders in `.claude/skills/` include no LICENSE file for these modules. Before making the repository public, check the library's licence terms, or get the author's permission, and record the answer here.

### Fonts
Loaded from Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`) with `display=swap`. They are not self-hosted.
- Newsreader (SIL OFL 1.1)
- IBM Plex Mono (SIL OFL 1.1)
- Ma Shan Zheng (SIL OFL 1.1), CJK calligraphic accents
- Noto Serif SC (SIL OFL 1.1)

### Audio
`src/ui/audio.ts` synthesizes every sound at runtime with oscillators, noise and filters. The repo has no audio files and no `public/audio/` folder. Sound is off until the visitor turns it on.

### Poster stills (`public/posters/`)
These are the no-WebGL and loading fallbacks (SPEC §11). They are screenshots of the site's own scenes, rendered in headless Chromium (Playwright with SwiftShader WebGL, the same pipeline as `scripts/shoot.mjs`) at desktop and portrait sizes, then saved as JPEG. Current files:
- `rain-lake.jpg` and `rain-lake-portrait.jpg`: the Seattle rain chapter's lake arrival (convoy, campus, Rainier).

The Orange County coast also draws a cheap in-engine arrival poster (`src/world/chapters/coast/poster.ts`). It is shader output and not a file.

### Résumé PDF
`public/Jiayi-Zhu-Resume.pdf` is meant to be generated from `src/content/resume.ts` with `npm run resume:pdf` (`scripts/build-resume-pdf.mjs`). The public PDF must not contain the phone number or the name of the Capgemini client. The original source résumé (`Atlassian-Data-Engineer-2027-Graduate-Resume.pdf`) contains both, so it is git-ignored and must never be published.

### External runtime services
- Google Fonts (above).
- Open-Meteo forecast API (`api.open-meteo.com`), called by one easter egg for Seattle's current weather (`src/ui/eggs.ts`). No key is used, and nothing personal is sent.
