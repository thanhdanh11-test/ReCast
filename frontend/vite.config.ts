import path from "path";
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Static hosts serve "/" from index.html; keep web.html as the source entry.
const webIndex = {
  name: 'topeye-web-index',
  enforce: 'post' as const,
  generateBundle(_: unknown, bundle: Record<string, { fileName: string }>) {
    if (bundle['web.html']) bundle['web.html'].fileName = 'index.html';
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'web' ? [webIndex] : [])],
  base: './',
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  ...(mode === 'web' ? { publicDir: 'public-web' } : {}),
  build: mode === 'web'
    ? { outDir: 'dist-web', rollupOptions: { input: { web: 'web.html' } } }
    : { rollupOptions: { input: { scenario: 'scenario.html' } } },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8800',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
}));
