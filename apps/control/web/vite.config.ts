import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { DEFAULT_LOCAL_PORTS } from '../../../packages/control/src/local-platform/runtime-types.ts';

export default defineConfig(({ mode }) => {
  const isDebugBuild = mode === 'staging-debug';
  const webTarget = `http://localhost:${DEFAULT_LOCAL_PORTS.web}`;

  return {
    plugins: [
      solid(),
      tailwindcss(),
    ],
    root: resolve(__dirname),
    resolve: {
      alias: {
        'takos-control/shared/types': resolve(__dirname, '../../../packages/control/src/shared/types/index.ts'),
        'takos-common': resolve(__dirname, '../../../packages/common/src'),
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
