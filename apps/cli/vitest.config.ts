import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Node.js environment for CLI testing
    environment: 'node',
    // Include test files
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Exclude node_modules
    exclude: ['node_modules'],
    // Setup files for test utilities and mocks
    setupFiles: ['./test/setup.ts'],
    // Global timeout for tests
    testTimeout: 30000,
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      // Coverage thresholds
      thresholds: {
        // Keep coverage gate effective for changed code paths.
        statements: 25,
        branches: 40,
        functions: 25,
        lines: 25,
      },
      // Include source files
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
      ],
    },
    // Pool configuration for parallel testing
    pool: 'forks',
    // Globals for describe, it, expect, etc.
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@test': path.resolve(__dirname, './test'),
    },
  },
});
