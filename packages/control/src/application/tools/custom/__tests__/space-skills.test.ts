import { assertEquals } from "jsr:@std/assert";

import { SKILL_CREATE, SKILL_UPDATE } from "../space-skills.ts";

function getOutputModeEnum(tool: typeof SKILL_CREATE | typeof SKILL_UPDATE) {
  const metadata = tool.parameters.properties.metadata;
  const executionContract = metadata.properties?.execution_contract;
  const outputModes = executionContract?.properties?.output_modes;
  return outputModes?.items?.enum ?? [];
}

Deno.test("custom skill tools expose documented output mode aliases", () => {
  const expected = [
    "chat",
    "text",
    "structured",
    "artifact",
    "reminder",
    "repo",
    "app",
    "workspace_file",
  ];

  assertEquals(getOutputModeEnum(SKILL_CREATE), expected);
  assertEquals(getOutputModeEnum(SKILL_UPDATE), expected);
});
