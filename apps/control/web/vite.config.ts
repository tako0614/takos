import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const isDebugBuild = mode === 'staging-debug';

  return {
    plugins: [
      react({
        jsxRuntime: 'automatic',
      }),
      tailwindcss(),
    ],
    root: resolve(__dirname),
    resolve: {
      dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
    },
    build: {
      outDir: resolve(__dirname, '../../dist'),
      emptyOutDir: true,
      sourcemap: isDebugBuild,
      minify: isDebugBuild ? false : 'esbuild',
    },
    server: {
      proxy: {
        '/auth': 'http://localhost:8787',
        '/me': 'http://localhost:8787',
        '/workers': 'http://localhost:8787',
        '/spaces': 'http://localhost:8787',
        '/health': 'http://localhost:8787',
      },
    },
  };
});
