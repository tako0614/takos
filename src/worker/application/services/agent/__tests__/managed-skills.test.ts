import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { validateCustomSkillMetadata } from "../managed-skills.ts";

test("validateCustomSkillMetadata accepts documented output mode aliases", () => {
  const result = validateCustomSkillMetadata({
    execution_contract: {
      output_modes: ["text", "structured", "artifact", "repo"],
    },
  });

  assertEquals(result.fieldErrors, {});
  assertEquals(result.normalized.execution_contract?.output_modes, [
    "chat",
    "artifact",
    "repo",
  ]);
});
