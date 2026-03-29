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
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', 'src/**/*.d.ts'],
    },
    pool: 'forks',
    globals: true,
  },
  resolve: {
    alias: {
      '@/application': path.resolve(__dirname, 'src/application'),
      '@/infra': path.resolve(__dirname, 'src/infra'),
      '@/local-platform': path.resolve(__dirname, 'src/local-platform'),
      '@/platform': path.resolve(__dirname, 'src/platform'),
      '@/runtime': path.resolve(__dirname, 'src/runtime'),
      '@/server': path.resolve(__dirname, 'src/server'),
      '@/shared': path.resolve(__dirname, 'src/shared'),
      '@/services': path.resolve(__dirname, 'src/application/services'),
      '@/routes': path.resolve(__dirname, 'src/server/routes'),
      '@/middleware': path.resolve(__dirname, 'src/server/middleware'),
      '@/tools': path.resolve(__dirname, 'src/application/tools'),
      '@/durable-objects': path.resolve(__dirname, 'src/runtime/durable-objects'),
      '@/queues': path.resolve(__dirname, 'src/runtime/queues'),
      '@/runner': path.resolve(__dirname, 'src/runtime/runner'),
      '@/worker': path.resolve(__dirname, 'src/runtime/worker'),
      '@/container-hosts': path.resolve(__dirname, 'src/runtime/container-hosts'),
      '@/indexer': path.resolve(__dirname, 'src/runtime/indexer'),
      '@/db': path.resolve(__dirname, 'src/infra/db'),
      '@/types': path.resolve(__dirname, 'src/shared/types'),
      '@/utils': path.resolve(__dirname, 'src/shared/utils'),
    },
  },
});
