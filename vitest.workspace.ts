import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'apps/control/vitest.config.ts',
  'apps/runtime/vitest.config.ts',
  'apps/cli/vitest.config.ts',
  'packages/common',
  'packages/actions-engine',
  'packages/browser-service',
  'packages/runtime-service',
]);
