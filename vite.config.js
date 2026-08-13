import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: './',
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
      name: 'flym-sw-version',
      // Runs after build completes — stamps a fresh timestamp into sw.js in dist/
      closeBundle() {
        try {
          const swPath = resolve('dist', 'sw.js');
          let sw = readFileSync(swPath, 'utf8');
          const ts = Date.now();
          sw = sw.replace(/'flym-\d+'/, `'flym-${ts}'`);
          writeFileSync(swPath, sw);
          console.log(`✓ Service worker stamped with version flym-${ts}`);
        } catch (e) {
          console.warn('[flym-sw-version] Could not stamp sw.js:', e.message);
        }
      }
    }
  ]
});
