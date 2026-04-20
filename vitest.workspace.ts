import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "apps/control/vitest.config.ts",
  "apps/runtime/vitest.config.ts",
  "packages/common",
  "packages/actions-engine",
  "packages/runtime-service",
]);
