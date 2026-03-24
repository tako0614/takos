/**
 * Shared build utility for container apps (executor, browser, etc.).
 * Wraps esbuild with common defaults for Node.js container bundles.
 *
 * Usage:
 *   import { buildContainer } from '../../scripts/build-container.mjs';
 *   await buildContainer({ entryPoint: 'src/index.ts', name: 'takos-executor', ... });
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {object} opts
 * @param {string} opts.appDir - Absolute path to the app directory
 * @param {string} opts.name - App name for logging
 * @param {string} [opts.entryPoint] - Entry point relative to appDir (default: 'src/index.ts')
 * @param {string} [opts.outfile] - Output file relative to appDir (default: 'dist/index.js')
 * @param {Record<string, string>} [opts.alias] - Additional esbuild aliases
 * @param {string[]} [opts.external] - Additional external packages
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
      '@takos/common': resolve(REPO_ROOT, 'packages/common/src'),
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
