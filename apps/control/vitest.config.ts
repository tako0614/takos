import { defineConfig } from 'vitest/config';
import path from 'path';
import { readFileSync } from 'fs';

export default defineConfig({
  plugins: [
    {
      name: 'md-raw-loader',
      transform(_code, id) {
        if (id.endsWith('.md')) {
          return `export default ${JSON.stringify(readFileSync(id, 'utf-8'))};`;
        }
      },
    },
  ],
  test: {
    // Use miniflare environment for Cloudflare Workers testing
    environment: 'node',
    // Keep app-owned tests local; package tests run from packages/control.
    include: ['src/__tests__/**/*.test.ts', 'test/**/*.test.ts'],
    // Exclude only dependencies from discovery
    exclude: ['node_modules'],
    // Setup files for test utilities and mocks
    setupFiles: ['./test/integration/setup.ts'],
    // Global timeout for tests
    testTimeout: 30000,
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      // Coverage thresholds (start at 50%, increase as tests are added)
      thresholds: {
        statements: 30,
        branches: 45,
        functions: 35,
        lines: 30,
      },
      // Cover app-owned entrypoints only.
      include: ['src/**/*.ts'],
      exclude: [
        'web/**',
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/**/*.d.ts',
        'src/types.ts',
      ],
    },
    // Pool configuration for parallel testing
    pool: 'forks',
    // Globals for describe, it, expect, etc.
    globals: true,
  },
  resolve: {
    alias: {
      '@/application': path.resolve(__dirname, '../../packages/control/src/application'),
      '@/infra': path.resolve(__dirname, '../../packages/control/src/infra'),
      '@/local-platform': path.resolve(__dirname, '../../packages/control/src/local-platform'),
      '@/platform': path.resolve(__dirname, '../../packages/control/src/platform'),
      '@/runtime': path.resolve(__dirname, '../../packages/control/src/runtime'),
      '@/server': path.resolve(__dirname, '../../packages/control/src/server'),
      '@/shared': path.resolve(__dirname, '../../packages/control/src/shared'),
      '@/services': path.resolve(__dirname, '../../packages/control/src/application/services'),
      '@/routes': path.resolve(__dirname, '../../packages/control/src/server/routes'),
      '@/middleware': path.resolve(__dirname, '../../packages/control/src/server/middleware'),
      '@/tools': path.resolve(__dirname, '../../packages/control/src/application/tools'),
      '@/durable-objects': path.resolve(__dirname, '../../packages/control/src/runtime/durable-objects'),
      '@/queues': path.resolve(__dirname, '../../packages/control/src/runtime/queues'),
      '@/runner': path.resolve(__dirname, '../../packages/control/src/runtime/runner'),
      '@/worker': path.resolve(__dirname, '../../packages/control/src/runtime/worker'),
      '@/container-hosts': path.resolve(__dirname, '../../packages/control/src/runtime/container-hosts'),
      '@/indexer': path.resolve(__dirname, '../../packages/control/src/runtime/indexer'),
      '@/db': path.resolve(__dirname, '../../packages/control/src/infra/db'),
      '@/types': path.resolve(__dirname, '../../packages/control/src/shared/types'),
      '@/utils': path.resolve(__dirname, '../../packages/control/src/shared/utils'),
      '@test': path.resolve(__dirname, './test'),
    },
  },
});
