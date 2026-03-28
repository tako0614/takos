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
      alias: {
        '@takoserver/control/shared/types': resolve(__dirname, '../../../packages/control/src/shared/types/index.ts'),
      },
    },
    build: {
      outDir: resolve(__dirname, '../../dist'),
      emptyOutDir: true,
      sourcemap: isDebugBuild,
      minify: isDebugBuild ? false : 'esbuild',
    },
    server: {
      // Port 8787 must match DEFAULT_LOCAL_PORTS.web in
      // packages/control/src/local-platform/runtime-types.ts
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
