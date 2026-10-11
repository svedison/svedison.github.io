# Performance: measured against SPEC §12.4

> **This is a proxy, not an iPhone 12 or a Pixel 6.** These numbers come from desktop Chromium with device emulation.
> Draw calls, triangles, shadowed lights, transfer sizes and JS heap are properties of the page, so they carry over to a
> phone. Frame time does not carry over: the CPU is throttled 4×, but the GPU is a desktop RTX 2080 SUPER, which is
> roughly an order of magnitude faster than a phone GPU. Treat every frame-time figure below as a **lower bound** for a phone.

- **Date:** 2026-10-10. **Probe:** `node scripts/perf-probe.mjs` (raw output in `qa/perf-results.json`).
- **Build:** `vite build` into a temp folder, served by `vite preview` (gzip on, as in production).
- **Backend:** real GPU through new headless and ANGLE/D3D11: `NVIDIA GeForce RTX 2080 SUPER`. The SwiftShader
  fallback was not needed. **Host CPU:** Intel i9-9900K.
- **Mobile pass:** 390×844, DPR 3, touch, Pixel 6 user agent, **CDP CPU throttle 4×**, **network "slow 4G"** (150 ms RTT, 1.6 Mbps down).
- **Desktop pass:** 1440×900, DPR 2, no throttling.
- **Per sample:** scroll to the chapter at t, wait until that chapter's module owns the frame, settle for 2 s, then sample for 3 s.
- **Hook:** `?perf=1` exposes `window.__JY_PERF` (`src/world/engine.ts`). Without `?perf=1` it adds nothing.
  - Draw calls and triangles are **summed over every render pass of a frame**: reflection, cube-camera, post and
    overlay passes. The figure is the maximum over the window, so it overstates *visible* triangles, which is the safe direction.
  - **Frame work** = CPU update + submit, plus a 1-px `readPixels` that waits for the GPU to finish the frame.
    It is the cost of one frame with vsync taken out.
  - The rAF interval is also recorded, but headless Chromium paces frames on a ~2.8 ms grid, so that interval
    shows the grid, not the cost of the frame.

## Verdict vs budget

| §12.4 item | Budget (mobile / desktop) | Measured, mobile proxy | Measured, desktop | Status |
|---|---|---|---|---|
| DPR cap | 1.25–1.5 / 1.5–2 | 1.5 (starts at `medium@1.5`; the governor can step down to 1.25, then 1) | 2 (`high@2`) | Pass |
| Triangles (worst chapter) | ≤ 300k / ≤ 1.2M | **264k** (Jiangyin, prologue 0.3) | 440k (coast 0.8) | Pass, mobile at 88% of budget |
| Draw calls (worst) | ≤ 90 / ≤ 160 | 53 (coast 0.8) | 102 (coast 0.8) | Pass |
| Shadowed lights | 1 / 2 | 1 (workshop), 0 elsewhere | 1 (workshop) | Pass |
| Critical initial transfer | ≤ 4 MB / ≤ 8 MB | 1.98 MB | 2.40 MB | Pass |
| Frame time | ≤ 16.7 ms ideal, ≤ 25 ms fallback / ≤ 16.7 ms | work p95 ≤ 10.8 ms (crossing 0.2) | work p95 ≤ 6.6 ms | Pass on proxy; **must re-check on a phone GPU** |
| LCP | ≤ 2.5 s on 4G / ≤ 1.5 s | 2.22 s (slow 4G + 4× CPU) | 0.23 s | Pass, mobile is close to the limit |
| JS heap | (no budget) | 41–61 MB | 49–61 MB | Steady across one pass, with no climb |

No measurement exceeded the budget, so no chapter caps were changed.

## Per-chapter samples

Work and rAF columns are in ms, as p50 / p95. Heap is the JS heap in MB, read through CDP `Runtime.getHeapUsage`.

### Mobile proxy (390×844, DPR 3, 4× CPU, slow 4G)

| at | module | calls | triangles | shadow lights | work p50/p95 | rAF p50/p95 | tier@DPR | heap MB |
|---|---|---|---|---|---|---|---|---|
| prologue:0.3 | jiangyin | 34 | 263,974 | 0 | 6.6 / 9.7 | 8.4 / 13.9 | medium@1.5 | 44.3 |
| prologue:0.7 | jiangyin | 34 | 263,974 | 0 | 5.2 / 8.3 | 8.3 / 13.8 | medium@1.5 | 47.1 |
| river:0.3 | jiangyin | 32 | 260,848 | 0 | 5.5 / 8.4 | 8.3 / 13.8 | medium@1.5 | 47.6 |
| river:0.7 | jiangyin | 42 | 261,588 | 0 | 6.0 / 9.4 | 8.3 / 13.9 | medium@1.5 | 47.7 |
| crossing:0.2 | crossing | 46 | 112,116 | 0 | 6.8 / 10.8 | 10.9 / 16.6 | medium@1.5 | 49.3 |
| crossing:0.5 | crossing | 21 | 992 | 0 | 3.6 / 5.4 | 5.6 / 8.4 | medium@1.5 | 54.8 |
| crossing:0.8 | crossing | 47 | 112,118 | 0 | 6.2 / 10.0 | 8.4 / 14.0 | medium@1.5 | 53.9 |
| coast:0.2 | coast | 35 | 206,944 | 0 | 5.0 / 8.2 | 8.3 / 13.8 | medium@1.5 | 57.3 |
| coast:0.5 | coast | 44 | 207,734 | 0 | 5.4 / 8.1 | 8.3 / 13.8 | medium@1.5 | 55.9 |
| coast:0.8 | coast | 53 | 208,856 | 0 | 5.5 / 8.2 | 8.4 / 13.8 | medium@1.5 | 60.9 |
| rain:0.3 | rain | 37 | 72,692 | 0 | 4.5 / 6.9 | 8.3 / 11.1 | medium@1.5 | 43.0 |
| rain:0.7 | rain | 33 | 31,990 | 0 | 4.0 / 5.9 | 5.6 / 11.1 | medium@1.5 | 41.1 |
| workshop:0.3 | workshop | 26 | 8,900 | 1 | 5.9 / 8.4 | 8.4 / 13.9 | medium@1.5 | 40.7 |
| workshop:0.7 | workshop | 32 | 7,640 | 1 | 5.5 / 8.4 | 8.4 / 13.9 | medium@1.5 | 42.8 |
| loop:0.3 | loop | 8 | 43,560 | 0 | 3.0 / 3.8 | 5.6 / 8.4 | medium@1.5 | 44.9 |
| loop:0.7 | loop | 8 | 43,560 | 0 | 2.9 / 3.6 | 5.5 / 8.4 | medium@1.5 | 42.9 |
| next:0.3 | next | 41 | 61,096 | 0 | 4.0 / 6.0 | 5.6 / 11.1 | medium@1.5 | 46.6 |
| next:0.7 | next | 45 | 61,490 | 0 | 4.4 / 7.0 | 8.2 / 11.1 | medium@1.5 | 42.5 |

### Desktop (1440×900, DPR 2)

| at | module | calls | triangles | shadow lights | work p50/p95 | rAF p50/p95 | tier@DPR | heap MB |
|---|---|---|---|---|---|---|---|---|
| prologue:0.3 | jiangyin | 38 | 402,534 | 0 | 2.4 / 3.0 | 2.8 / 5.6 | high@2 | 55.0 |
| prologue:0.7 | jiangyin | 38 | 402,534 | 0 | 2.4 / 3.0 | 2.8 / 5.6 | high@2 | 58.6 |
| river:0.3 | jiangyin | 41 | 397,362 | 0 | 3.5 / 4.2 | 5.5 / 5.6 | high@2 | 48.8 |
| river:0.7 | jiangyin | 45 | 397,820 | 0 | 3.6 / 4.2 | 5.5 / 5.6 | high@2 | 48.9 |
| crossing:0.2 | crossing | 46 | 172,452 | 0 | 3.7 / 4.3 | 5.5 / 5.6 | high@2 | 50.3 |
| crossing:0.5 | crossing | 22 | 1,042 | 0 | 2.8 / 3.0 | 2.8 / 5.6 | high@2 | 52.4 |
| crossing:0.8 | crossing | 47 | 172,454 | 0 | 3.4 / 3.9 | 2.9 / 5.6 | high@2 | 49.7 |
| coast:0.2 | coast | 63 | 436,078 | 0 | 3.9 / 4.5 | 5.5 / 5.6 | high@2 | 57.9 |
| coast:0.5 | coast | 88 | 438,444 | 0 | 4.2 / 4.6 | 5.5 / 5.7 | high@2 | 53.2 |
| coast:0.8 | coast | 102 | 440,016 | 0 | 4.4 / 4.9 | 5.5 / 5.7 | high@2 | 51.9 |
| rain:0.3 | rain | 38 | 112,124 | 0 | 2.7 / 3.0 | 2.8 / 5.6 | high@2 | 54.8 |
| rain:0.7 | rain | 33 | 66,298 | 0 | 2.2 / 2.4 | 2.8 / 2.9 | high@2 | 53.7 |
| workshop:0.3 | workshop | 36 | 15,888 | 1 | 3.7 / 6.6 | 5.5 / 8.4 | high@2 | 55.5 |
| workshop:0.7 | workshop | 51 | 12,332 | 1 | 3.7 / 6.2 | 5.5 / 8.4 | high@2 | 56.8 |
| loop:0.3 | loop | 8 | 139,356 | 0 | 1.0 / 1.2 | 2.8 / 2.9 | high@2 | 60.0 |
| loop:0.7 | loop | 8 | 139,356 | 0 | 1.0 / 1.4 | 2.8 / 2.9 | high@2 | 61.1 |
| next:0.3 | next | 45 | 129,410 | 0 | 1.9 / 2.1 | 2.8 / 2.9 | high@2 | 58.8 |
| next:0.7 | next | 49 | 129,804 | 0 | 1.9 / 2.1 | 2.8 / 2.9 | high@2 | 56.7 |

Renderer memory after the whole pass, with every module resident: 262 geometries, 52 textures, 245 shader programs.

## Transfer

Sizes are bytes on the wire, which is gzip for the JS, CSS and HTML.

| Initial load, up to loader hand-off | Mobile | Desktop |
|---|---|---|
| JS: main, motion, three, engine, jiangyin, crossing, coast deps, logbook | 362 KB | 362 KB |
| CSS, including the Google Fonts CSS | 115 KB | 115 KB |
| Web fonts (Newsreader, IBM Plex Mono, Ma Shan Zheng and Noto Serif SC CJK slices) | **1,006 KB** | **1,081 KB** |
| Posters (all 8 chapters, portrait or landscape) | 482 KB | 819 KB |
| HTML (the full static story and Logbook) | 18 KB | 18 KB |
| **Total** | **1.98 MB** | **2.40 MB** |
| Loader hand-off (`loader:done`) | 14.6 s (slow 4G + 4×); 5.4 s with a fast network | 1.1 s |
| LCP | 2.22 s | 0.23 s |

These chunks were fetched later, while each chapter was on screen. They are prefetched 1–2 modules ahead, so each one
lands before its chapter.

| Fetched while at | Chunk | Wire size |
|---|---|---|
| crossing | rain module | 21.9 KB |
| coast | workshop module | 25.6 KB |
| rain | loop module | 14.1 KB |
| workshop | next module | 9.8 KB |

Built chunk sizes, raw / gzip:

| Chunk | Raw / gzip |
|---|---|
| three | 671 / 172 KB |
| main | 152 / 55 KB |
| motion (gsap, lenis) | 123 / 47 KB |
| workshop | 68 / 25 KB |
| rain | 62 / 22 KB |
| jiangyin | 57 / 23 KB |
| crossing | 55 / 20 KB |
| coast | 51 / 20 KB |
| loop | 37 / 14 KB |
| next | 22 / 10 KB |
| sky | 22 / 8 KB |
| ocean | 21 / 8 KB |
| engine | 13 / 6 KB |

## Findings worth acting on (none breaks the budget)

1. **On slow 4G the loader holds the page for about 14.6 s.**
   - `#kb-loader` covers the screen until `engine.preload()` finishes the Jiangyin and Crossing modules.
   - Without network throttling the hand-off takes 5.4 s, so about 9 s comes from bandwidth contention.
   - The critical JS shares the link with about 1 MB of web fonts and all 8 posters.
   - LCP still measures 2.2 s, but only because the DOM paints underneath the loader.
   - Fix (owned by the loader and boot code, not this pass): cap the loader wait on slow connections and hand off to
     the poster for the current chapter, or preload only the module for the current chapter.
2. **CJK web fonts are about half of the initial transfer.**
   - Noto Serif SC and Ma Shan Zheng arrive as 12 unicode-range slices, about 870 KB.
   - The site uses only 24 distinct CJK glyphs across `src/content`, `src/ui`, `src/render` and `index.html`.
   - Adding `&text=<those glyphs>` to their Google Fonts request, or self-hosting a subset, should cut this to a few KB.
3. **All 8 posters load at boot** (482 KB on mobile, 819 KB on desktop).
   - Only the poster for the current chapter is critical.
   - The rest could load lazily, for example the current chapter ±1.
4. **Jiangyin on mobile is at 88% of the triangle budget** (264k of 300k).
   - Anything added to the river set must be paid for elsewhere, or kept off the mobile tier.
5. **Coast on desktop uses 102 calls**, which is within the 160 desktop budget.
   - The same scene uses 53 calls on the mobile tier, so the mobile caps already work.
6. **245 shader programs once every module is resident.**
   - Modules stay loaded after the reader leaves them. Heap stays flat at 40–61 MB, so this is not a leak.
   - On a phone it is GPU memory and compile time, so check it on a real device (finding 4 below).

## Must still be verified on a real device (iPhone 12, Pixel 6)

1. **Frame time per chapter with a phone GPU.** This proxy only throttles the CPU.
   - Coast, with its ocean, reflection and post, and Jiangyin, with its planar reflection and 264k triangles, are the
     GPU- and fill-rate-heavy chapters.
   - Check that the governor holds at `medium@1.5` or settles at 1.25 without oscillating.
   - Safari Web Inspector Timelines (iPhone) and Chrome remote debugging with the Performance panel (Pixel) are enough.
     Load with `?perf=1` and read `__JY_PERF.log.work` in the console.
2. **Thermal throttling over 5 minutes** of scrolling back and forth. Check frame time and governor steps.
3. **JS heap and GPU memory after a 5-minute session** (SPEC §13.2 Health). Check iOS Safari tab reloads under memory
   pressure: 245 programs and about 50 textures stay resident.
4. **Shader compile hitches** when a module is first owned, especially coast and crossing on a cold cache.
   - `compileAsync` with `KHR_parallel_shader_compile` is not available everywhere on iOS.
5. **LCP and loader hand-off on a real 4G connection**, including the time a cold Google Fonts connection adds (DNS, TLS).
6. **DPR in practice.** iPhone 12 is DPR 3, so the cap gives 1.5 and draws 585×1266 px.
   - Confirm the text is sharp enough and the canvas does not look soft next to the DOM copy.
7. **Collapsing URL bar and orientation change** mid-chapter: no resize storm or governor-skip loop.
8. **`webglcontextlost` on iOS after backgrounding the tab.** Check that the posters take over and the world restores.
