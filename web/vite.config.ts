import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  MONACO_BASIC_LANGUAGES,
  MONACO_EDITOR_CHUNK_BUDGET,
} from './monaco-language-contract.ts';

const monacoBasicLanguages = new Set<string>(MONACO_BASIC_LANGUAGES);

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

function monacoBundleBoundaryPlugin(): Plugin {
  return {
    name: 'takos-monaco-bundle-boundary',
    generateBundle(_options, bundle) {
      let editorChunkSize: number | null = null;

      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk' || !output.modules) continue;
        for (const moduleId of Object.keys(output.modules)) {
          const normalizedId = moduleId.replaceAll('\\', '/');
          if (normalizedId.endsWith('/web/src/lib/MonacoEditor.tsx')) {
            editorChunkSize = new TextEncoder().encode(output.code ?? '').length;
          }
          if (
            normalizedId.endsWith(
              '/monaco-editor/esm/vs/editor/editor.main.js',
            )
          ) {
            throw new Error(
              'Storage Monaco must use the scoped editor API, not the package root',
            );
          }
          const language = normalizedId.match(
            /\/monaco-editor\/esm\/vs\/basic-languages\/([^/]+)\//u,
          )?.[1];
          if (language && !monacoBasicLanguages.has(language)) {
            throw new Error(
              `Storage Monaco bundled unsupported language: ${language}`,
            );
          }
        }
      }

      if (editorChunkSize === null) {
        throw new Error('Storage Monaco editor chunk was not emitted');
      }
      if (editorChunkSize > MONACO_EDITOR_CHUNK_BUDGET) {
        throw new Error(
          `Storage Monaco editor chunk exceeds ${MONACO_EDITOR_CHUNK_BUDGET} bytes: ${editorChunkSize}`,
        );
      }

      const visited = new Set<string>();
      const inspectInitialChunk = (fileName: string) => {
        if (visited.has(fileName)) return;
        visited.add(fileName);
        const output = bundle[fileName];
        if (output?.type !== 'chunk' || !output.modules) return;
        const monacoModule = Object.keys(output.modules).find((moduleId) =>
          moduleId.replaceAll('\\', '/').includes('/monaco-editor/'),
        );
        if (monacoModule) {
          throw new Error(
            `Public bootstrap statically reaches Monaco through ${monacoModule}`,
          );
        }
        for (const importedFile of output.imports ?? []) {
          inspectInitialChunk(importedFile);
        }
      };

      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && output.isEntry) {
          inspectInitialChunk(output.fileName);
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDebugBuild = mode === 'staging-debug';
  const webTarget = process.env.TAKOS_WORKER_API_URL ?? 'http://localhost:8787';

  return {
    plugins: [
      monacoSecureDompurifyPlugin(),
      monacoBundleBoundaryPlugin(),
      solid(),
      tailwindcss(),
    ],
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
        'takos-api-contract/chat-message': resolve(
          __dirname,
          '../src/contracts/public/chat-message.ts',
        ),
        'takos-api-contract/chat-thread': resolve(
          __dirname,
          '../src/contracts/public/chat-thread.ts',
        ),
        'takos-api-contract/chat-history': resolve(
          __dirname,
          '../src/contracts/public/chat-history.ts',
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
