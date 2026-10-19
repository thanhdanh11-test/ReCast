import path from "path";
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Browser hosts serve "/" from index.html; keep web.html/local.html as source entries.
const browserIndex = (entry: string) => ({
  name: 'topeye-browser-index',
  enforce: 'post' as const,
  generateBundle(_: unknown, bundle: Record<string, { fileName: string }>) {
    if (bundle[entry]) bundle[entry].fileName = 'index.html';
  },
});
const browserBuilds: Record<string, { mode: string; entry: string; outDir: string; publicDir: string | false }> = {
  web: { mode: 'web', entry: 'web.html', outDir: 'dist-web', publicDir: 'public-web' },
  localweb: { mode: 'localweb', entry: 'local.html', outDir: 'dist-local', publicDir: false },
  // Recorded demo: full app over responses captured by scripts/record-demo.mjs into public-demo/.
  demo: { mode: 'demo', entry: 'demo.html', outDir: 'dist-demo', publicDir: 'public-demo' },
};

export default defineConfig(({ mode }) => {
  // Any non-demo mode builds the full localhost app.
  const browser = browserBuilds[mode] ?? browserBuilds.localweb;
  return {
  plugins: [react(), tailwindcss(), browserIndex(browser.entry)],
  base: './',
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  publicDir: browser.publicDir,
  build: { outDir: browser.outDir, rollupOptions: { input: { [browser.mode]: browser.entry } } },
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
    exclude: [...configDefaults.exclude, 'server/**'],
  },
};
});
