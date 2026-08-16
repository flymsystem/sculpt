import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  // MUST be '/' — absolute, not './'.
  //
  // The app is served from the site root and uses history-based
  // routing (/dashboard/finance, /dashboard/members, ...) with a
  // catch-all rewrite in _redirects:  /*  ->  /index.html  200
  //
  // With base './' the built index.html referenced ./assets/main-xxx.js.
  // Loading / worked, because './assets' resolves to '/assets'. But a
  // hard refresh on /dashboard/finance resolved './assets' relative to
  // '/dashboard/', requesting /dashboard/assets/main-xxx.js — which does
  // not exist, so the catch-all rewrite returned index.html WITH A 200.
  // The browser then tried to parse HTML as JavaScript and the page went
  // blank. Every deep-link refresh was broken and there was no 404 in the
  // Network tab to point at it.
  //
  // '/' makes asset URLs absolute, so they resolve identically at any
  // route depth. Only change this if the app is ever served from a
  // subdirectory rather than a domain root.
  base: '/',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: 'index.html',
      },
      output: {
        // Keep third-party code in its own chunks so a routine app
        // deploy doesn't invalidate them. Previously everything was one
        // file, so every release made every user re-download the
        // Supabase client and the PDF engine along with the change.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@supabase')) return 'vendor-supabase';
          // html2pdf pulls in jsPDF, html2canvas and canvg (~1 MB).
          // Only reached via the dynamic import in lib/invoice-pdf.js.
          if (id.includes('html2pdf') || id.includes('jspdf') ||
              id.includes('html2canvas') || id.includes('canvg') ||
              id.includes('dompurify') || id.includes('raf') ||
              id.includes('rgbcolor') || id.includes('core-js')) {
            return 'vendor-pdf';
          }
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
  plugins: [
    {
      name: 'sculpt-sw-version',
      // Runs after build completes — stamps a fresh timestamp into sw.js in dist/
      closeBundle() {
        try {
          const swPath = resolve('dist', 'sw.js');
          let sw = readFileSync(swPath, 'utf8');
          const ts = Date.now();
          sw = sw.replace(/'sculpt-\d+'/, `'sculpt-${ts}'`);
          writeFileSync(swPath, sw);
          console.log(`✓ Service worker stamped with version sculpt-${ts}`);
        } catch (e) {
          console.warn('[sculpt-sw-version] Could not stamp sw.js:', e.message);
        }
      }
    }
  ]
});
