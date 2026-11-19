import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { main: './index.html', sw: './src/sw.ts' },
      output: {
        entryFileNames: (chunk) => chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [react()],
  server: { proxy: {
    '/api': 'http://127.0.0.1:8080', '/dec': 'http://127.0.0.1:8080',
    '/download': 'http://127.0.0.1:8080', '/static': 'http://127.0.0.1:8080',
  } },
});
