import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { readRunBootstrapCapsuleContext } from "../executor-run-state.ts";

test("readRunBootstrapCapsuleContext extracts the canonical capsule context", () => {
  assertEquals(
    readRunBootstrapCapsuleContext(JSON.stringify({
      capsule_id: " cap_1 ",
      runtimeNamespace: " shared-cell://tokyo-cell-01/namespaces/cap_1 ",
    })),
    {
      capsuleId: "cap_1",
      runtimeNamespace: "shared-cell://tokyo-cell-01/namespaces/cap_1",
    },
  );
});

test("readRunBootstrapCapsuleContext ignores missing or invalid run input", () => {
  assertEquals(readRunBootstrapCapsuleContext(JSON.stringify({})), {});
  assertEquals(readRunBootstrapCapsuleContext("{not json"), {});
  assertEquals(readRunBootstrapCapsuleContext(JSON.stringify([])), {});
  assertEquals(readRunBootstrapCapsuleContext(null), {});
});
