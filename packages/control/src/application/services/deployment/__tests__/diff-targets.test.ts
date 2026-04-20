import { assertEquals } from "jsr:@std/assert";

import { compileGroupDesiredState } from "../group-state.ts";
import { validateTargetsAgainstDesiredState } from "../diff.ts";

Deno.test("validateTargetsAgainstDesiredState reports unmatched targets", () => {
  const desiredState = compileGroupDesiredState({
    name: "demo",
    compute: {
      web: { kind: "worker" },
    },
    routes: [{ target: "web", path: "/" }],
    publish: [],
    env: {},
  });

  assertEquals(
    validateTargetsAgainstDesiredState(desiredState, ["missing", "web"]),
    ["missing"],
  );
});
