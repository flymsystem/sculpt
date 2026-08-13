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
