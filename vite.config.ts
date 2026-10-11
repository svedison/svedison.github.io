import { defineConfig, type Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
import { readFileSync } from 'node:fs';
import { renderStory, renderLogbook } from './src/render/static';

// Public base path. '/' for local dev, Vercel or a user site; '/<repo>/' for a GitHub Pages project site.
// The Pages workflow sets BASE_PATH=/${{ github.event.repository.name }}/. Runtime links must read
// import.meta.env.BASE_URL rather than hard-coding root-absolute paths.
const base = `/${(process.env.BASE_PATH ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');

/** Prefix root-absolute <a href="/..."> links with the base (Vite rewrites script/link assets, not anchors).
 *  Links already carrying the base are left alone, so this is safe if the renderers add it themselves. */
function rebaseAnchors(html: string): string {
  if (base === '/') return html;
  return html.replace(/(<a\s[^>]*?\bhref=")(\/(?!\/)[^"]*)"/g, (m, pre: string, href: string) =>
    href.startsWith(base) ? m : `${pre}${base}${href.slice(1)}"`,
  );
}

// Inline the full story + Logbook into the HTML at build/dev time so the page is complete without JS.
function staticContent(): Plugin {
  return {
    name: 'static-content',
    transformIndexHtml(html) {
      const loader = readFileSync(resolve(root, 'src/loader/head.html'), 'utf8');
      return rebaseAnchors(
        html
          .replace(/<!-- LOADER:[^>]*-->/, loader)
          .replace('<!--STORY-->', renderStory())
          .replace('<!--LOGBOOK-->', renderLogbook()),
      );
    },
  };
}

export default defineConfig({
  base,
  plugins: [staticContent()],
  build: {
    target: 'es2022',
    // three alone is ~600 kB minified (≈150 kB gzip) and cannot be split further; it gets its own long-cached chunk.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        logbook: resolve(root, 'logbook/index.html'),
      },
      output: {
        // Vendor code in its own chunks so it stays cached across deploys that only touch story/world code.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return 'three';
          if (/[\\/]node_modules[\\/](gsap|lenis)[\\/]/.test(id)) return 'motion';
          return undefined;
        },
      },
    },
  },
});
