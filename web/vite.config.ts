import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mockApi } from './mock/plugin';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// MOCK=1 serves /api/* from web/mock (sample data, streamed with delays).
// Otherwise /api is proxied to the Worker (`wrangler dev`, port 8787).
const mock = process.env.MOCK === '1';

export default defineConfig({
  root: here('.'),
  publicDir: here('./public'),
  plugins: [react(), ...(mock ? [mockApi({ key: process.env.MOCK_KEY ?? 'cambia-esto' })] : [])],
  resolve: {
    alias: { '@shared': here('../src/shared') },
  },
  server: {
    proxy: mock ? undefined : { '/api': 'http://127.0.0.1:8787', '/health': 'http://127.0.0.1:8787' },
  },
  build: {
    outDir: here('../dist/client'),
    emptyOutDir: true,
    target: 'es2022',
  },
});
