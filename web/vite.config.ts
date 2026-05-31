import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import process from 'node:process';

export default defineConfig(({ mode }) => {
  const isDebugBuild = mode === 'staging-debug';
  const webTarget = process.env.TAKOS_WORKER_API_URL ??
    process.env.TAKOS_WEB_API_URL ??
    'http://localhost:8787';

  return {
    plugins: [
      solid(),
      tailwindcss(),
    ],
    root: resolve(__dirname),
    resolve: {
      alias: {
        'takos-api-contract/shared/types': resolve(
          __dirname,
          '../src/contracts/public/shared/types/index.ts',
        ),
        'takos-api-contract/rpc-types': resolve(
          __dirname,
          '../src/contracts/public/rpc-types.ts',
        ),
        '@takos/worker-platform-utils': resolve(
          __dirname,
          '../src/worker/platform-utils',
        ),
      },
    },
    build: {
      outDir: resolve(__dirname, '../dist'),
      emptyOutDir: true,
      sourcemap: isDebugBuild,
      minify: isDebugBuild ? false : 'esbuild',
    },
    server: {
      // Wave M-C: LAN listen for hostname-based dev access (= takosumi
      // local-substrate Caddy が app.takos.test → host.docker.internal:5173
      // で TLS 終端 + reverse proxy する前提)。 localhost access も影響受けない。
      host: true,
      proxy: {
        '/api': webTarget,
        '/auth': webTarget,
        '/health': webTarget,
      },
    },
  };
});
