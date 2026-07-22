import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import process from 'node:process';

const secureDompurifyModule = resolve(
  __dirname,
  './src/lib/monaco-secure-dompurify.ts',
);

function monacoSecureDompurifyPlugin() {
  let replacementCount = 0;
  return {
    name: 'takos-monaco-secure-dompurify',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (source !== './dompurify/dompurify.js' || !importer) return null;
      const normalizedImporter = importer?.replaceAll('\\', '/');
      if (
        normalizedImporter?.endsWith(
          '/monaco-editor/esm/vs/base/browser/domSanitize.js',
        )
      ) {
        replacementCount += 1;
        return secureDompurifyModule;
      }
      return null;
    },
    buildStart() {
      replacementCount = 0;
    },
    buildEnd(error: Error | undefined) {
      if (!error && replacementCount !== 1) {
        throw new Error(
          `Expected one Monaco DOMPurify replacement, received ${replacementCount}`,
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDebugBuild = mode === 'staging-debug';
  const webTarget = process.env.TAKOS_WORKER_API_URL ?? 'http://localhost:8787';

  return {
    plugins: [monacoSecureDompurifyPlugin(), solid(), tailwindcss()],
    root: resolve(__dirname),
    resolve: {
      alias: {
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
