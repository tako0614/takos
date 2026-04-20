import { assertNotEquals } from "jsr:@std/assert";

import { compileGroupDesiredState } from "../group-state.ts";

Deno.test("compileGroupDesiredState fingerprints root manifest env changes", () => {
  const base = compileGroupDesiredState({
    name: "demo",
    compute: {
      web: {
        kind: "worker",
      },
    },
    routes: [],
    publish: [],
    env: {
      FOO: "one",
    },
  });

  const changed = compileGroupDesiredState({
    name: "demo",
    compute: {
      web: {
        kind: "worker",
      },
    },
    routes: [],
    publish: [],
    env: {
      FOO: "two",
    },
  });

  assertNotEquals(
    base.workloads.web.specFingerprint,
    changed.workloads.web.specFingerprint,
  );
});
