import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Resolve `@astram/types` to the workspace SOURCE so `vite build` works
// without a prior build of packages/shared-types (dist not required).
// UI code uses `import type` only, so the shared module (which pulls in
// node: built-ins) never enters the browser bundle.
const sharedTypesSrc = fileURLToPath(
  new URL('../../shared-types/src/index.ts', import.meta.url)
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@astram/types': sharedTypesSrc,
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3080',
      '/ws': { target: 'ws://127.0.0.1:3080', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
