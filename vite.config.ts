import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { defineConfig, Plugin } from 'vite';

function copyManifestPlugin(): Plugin {
  return {
    name: 'copy-manifest-plugin',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist');
      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(outDir, 'manifest.json')
      );
    },
  };
}

export default defineConfig({
  plugins: [copyManifestPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background.js';
          return 'assets/[name].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
