import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { DEFAULT_LOCAL_PORTS } from '../../../packages/control/src/local-platform/runtime-types.ts';

export default defineConfig(({ mode }) => {
  const isDebugBuild = mode === 'staging-debug';
  const webTarget = `http://localhost:${DEFAULT_LOCAL_PORTS.web}`;

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
        'takos-control/shared/types': resolve(__dirname, '../../../packages/control/src/shared/types/index.ts'),
      },
    },
    build: {
      outDir: resolve(__dirname, '../../dist'),
      emptyOutDir: true,
      sourcemap: isDebugBuild,
      minify: isDebugBuild ? false : 'esbuild',
    },
    server: {
      proxy: {
        '/auth': webTarget,
        '/me': webTarget,
        '/workers': webTarget,
        '/spaces': webTarget,
        '/health': webTarget,
      },
    },
  };
});
