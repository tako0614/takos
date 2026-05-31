import { test } from "bun:test";
import { assertEquals } from "@std/assert";

import { compileGroupDesiredState } from "../group-state.ts";
import { validateTargetsAgainstDesiredState } from "../diff.ts";

test("validateTargetsAgainstDesiredState reports unmatched targets", () => {
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
