import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

// The built site makes no network requests at all: the compiler, the data and
// the fonts are bundled. The policy below states that and enforces it.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // CodeMirror and Motion set styles at runtime
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const contentSecurityPolicy = (): Plugin => ({
  name: 'quern-csp',
  apply: 'build',
  transformIndexHtml: (html) => ({
    html,
    tags: [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  }),
});

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  build: { outDir: '../dist-playground', emptyOutDir: true, target: 'es2023', assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
});
