import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import process from 'node:process';

export default defineConfig(({ mode }) => {
  const isDebugBuild = mode === 'staging-debug';
  const webTarget = process.env.TAKOS_WORKER_API_URL ?? 'http://localhost:8787';

  return {
    plugins: [
      solid(),
      tailwindcss(),
    ],
    define: {
      // Marks this as the takos-embedded build of the shared takosumi dashboard
      // source. The dashboard shell uses it to show a "back to Takos product"
      // affordance; the standalone platform-worker dashboard build leaves it
      // undefined, so that surface only appears when embedded in the takos SPA.
      'import.meta.env.VITE_TAKOS_EMBEDDED': JSON.stringify('1'),
    },
    root: resolve(__dirname),
    resolve: {
      alias: {
        // Takosumi dashboard SPA (account plane + installations screens) lives
        // in takosumi/dashboard and is consumed in-process by this build via
        // the `@takosumi/dashboard` specifier. See app-routes.tsx
        // AccountPlaneRoutes for the consuming route registrations.
        '@takosumi/dashboard': resolve(
          __dirname,
          '../../takosumi/dashboard/src',
        ),
        // The folded dashboard SPA imports the account-plane contract (path
        // builders, DTO/enum types, the materialize permission-digest builder)
        // via this specifier; resolve it for the in-process web build too.
        '@takosjp/takosumi-accounts-contract': resolve(
          __dirname,
          '../../takosumi/accounts/contract/src/mod.ts',
        ),
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
