/**
 * コンテナアプリ（executor、browser など）向けの共通ビルドユーティリティ。
 * Node.js 向けコンテナバンドルを esbuild で共通設定として実行する。
 *
 * 使い方:
 *   import { buildContainer } from '../../scripts/build-container.mjs';
 *   await buildContainer({ entryPoint: 'src/index.ts', name: 'takos-executor', ... });
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {object} opts
 * @param {string} opts.appDir - アプリケーションディレクトリの絶対パス
 * @param {string} opts.name - ログに表示するアプリ名
 * @param {string} [opts.entryPoint] - appDir からのエントリポイント（デフォルト: 'src/index.ts'）
 * @param {string} [opts.outfile] - 出力ファイルのパス（appDir からの相対パス、デフォルト: 'dist/index.js'）
 * @param {Record<string, string>} [opts.alias] - 追加の esbuild エイリアス
 * @param {string[]} [opts.external] - 追加の external 指定パッケージ
 */
export async function buildContainer(opts) {
  const {
    appDir,
    name,
    entryPoint = 'src/index.ts',
    outfile = 'dist/index.js',
    alias = {},
    external = [],
  } = opts;

  await build({
    entryPoints: [resolve(appDir, entryPoint)],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: resolve(appDir, outfile),
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    alias: {
      'takos-common': resolve(REPO_ROOT, 'packages/common/src'),
      ...alias,
    },
    loader: {
      '.md': 'text',
    },
    external: [
      'hono',
      '@hono/node-server',
      ...external,
    ],
    logLevel: 'info',
  });

  console.log(`Build complete (${name}): ${outfile}`);
}
