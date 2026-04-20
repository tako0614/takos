import { assertEquals } from "jsr:@std/assert";

import { validateCustomSkillMetadata } from "../managed-skills.ts";

Deno.test("validateCustomSkillMetadata accepts documented output mode aliases", () => {
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
