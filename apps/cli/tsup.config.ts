import path from 'node:path';
import { defineConfig } from 'tsup';

const actionsEngineEntry = path.resolve(__dirname, '../../packages/actions-engine/src/index.ts');

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: false,
  clean: true,
  platform: 'node',
  target: 'node20',
  // Bundle everything into a single file for easy distribution
  noExternal: [
    '@takos/actions-engine',
    'commander',
    'chalk',
    'ora',
    'conf',
    'node-fetch',
    'form-data',
  ],
  // open v10+ is ESM-only — excluded from bundle, loaded via dynamic import()
  external: ['open'],
  esbuildOptions(options) {
    options.alias = {
      ...(options.alias ?? {}),
      '@takos/actions-engine': actionsEngineEntry,
    };
  },
});
