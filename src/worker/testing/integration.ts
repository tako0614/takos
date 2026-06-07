// Product-local test integration guard.
//
// The default `bun run test` gate runs the whole suite (`bun test ./src
// ./web/src/__tests__`). A few cases cannot run cleanly in that gate:
//   - genuinely env-coupled tests that need a live external service, and
//   - tests that only pass in isolation (cross-test state pollution) and so
//     are unreliable under the full batch run.
// Such cases are tagged with `integrationTest` / `test.skipIf(!RUN_INTEGRATION_TESTS)`
// so they stay in the tree (and stay runnable) without keeping the rest of the
// suite dark. Set `TAKOS_INTEGRATION=1` to opt back in.
import process from "node:process";

export const RUN_INTEGRATION_TESTS =
  process.env.TAKOS_INTEGRATION === "1" ||
  process.env.TAKOS_INTEGRATION === "true";
