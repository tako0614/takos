import { assert, assertEquals } from "jsr:@std/assert";

import {
  normalizeSkillExecutionContract,
  normalizeSkillOutputMode,
  normalizeSkillOutputModes,
} from "../skill-contracts.ts";

Deno.test("normalizeSkillOutputMode accepts documented aliases", () => {
  assertEquals(normalizeSkillOutputMode("text"), "chat");
  assertEquals(normalizeSkillOutputMode("structured"), "chat");
  assertEquals(normalizeSkillOutputMode("artifact"), "artifact");
  assertEquals(normalizeSkillOutputMode("chat"), "chat");
  assertEquals(normalizeSkillOutputMode("unknown"), null);
});

Deno.test("normalizeSkillOutputModes canonicalizes and deduplicates aliases", () => {
  assertEquals(
    normalizeSkillOutputModes([
      "chat",
      "text",
      "structured",
      "artifact",
      "artifact",
      " workspace_file ",
      "",
      null,
    ]),
    ["chat", "artifact", "workspace_file"],
  );
});

Deno.test("normalizeSkillExecutionContract keeps durable modes and alias output modes", () => {
  const contract = normalizeSkillExecutionContract({
    preferred_tools: [" create_artifact ", ""],
    durable_output_hints: ["artifact", "invalid", "repo"],
    output_modes: ["text", "chat", "structured", "artifact", "repo"],
    required_mcp_servers: [" mcp-a ", ""],
    template_ids: [" t1 ", ""],
  });

  assertEquals(contract, {
    preferred_tools: ["create_artifact"],
    durable_output_hints: ["artifact", "repo"],
    output_modes: ["chat", "artifact", "repo"],
    required_mcp_servers: ["mcp-a"],
    template_ids: ["t1"],
  });
});

Deno.test("normalizeSkillExecutionContract defaults output_modes to chat", () => {
  const contract = normalizeSkillExecutionContract({});
  assertEquals(contract.output_modes, ["chat"]);
  assert(contract.durable_output_hints.length === 0);
  assert(contract.required_mcp_servers.length === 0);
});
