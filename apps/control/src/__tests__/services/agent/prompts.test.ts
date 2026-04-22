import {
  buildAvailableToolsPrompt,
  DEFAULT_CORE_PROMPT,
  SYSTEM_PROMPTS,
} from "@/services/agent/prompt-builder";

import { assert, assertStringIncludes } from "jsr:@std/assert";

Deno.test("agent prompts - keeps the default prompt focused on task completion with tool use", () => {
  assertStringIncludes(DEFAULT_CORE_PROMPT, "You are Takos's universal agent.");
  assertStringIncludes(
    DEFAULT_CORE_PROMPT,
    "Only use tools that are explicitly listed",
  );
  assertStringIncludes(
    DEFAULT_CORE_PROMPT,
    "keep moving until the task is actually complete",
  );
  assertStringIncludes(
    DEFAULT_CORE_PROMPT,
    "Do not wait for the user to name a tool",
  );
  assertStringIncludes(DEFAULT_CORE_PROMPT, "Default to spawning sub-agents");
  assertStringIncludes(
    DEFAULT_CORE_PROMPT,
    "Infer the target product from thread context",
  );
  assertStringIncludes(SYSTEM_PROMPTS.default, "workflow manuals");
  assertStringIncludes(
    SYSTEM_PROMPTS.default,
    "before deciding the capability is unavailable",
  );
  assertStringIncludes(
    SYSTEM_PROMPTS.default,
    "Treat the request as work to complete",
  );
  assertStringIncludes(SYSTEM_PROMPTS.default, "spawn sub-agents early");
  assertStringIncludes(
    SYSTEM_PROMPTS.default,
    "infer it from the thread",
  );
});
Deno.test("agent prompts - injects only the runtime-available tool catalog", () => {
  const prompt = buildAvailableToolsPrompt(SYSTEM_PROMPTS.default, [
    { name: "capability_search", description: "Search tools by capability" },
    { name: "wait_agent", description: "Wait for a child run" },
    { name: "space_files_read", description: "Read a space file" },
  ]);

  assertStringIncludes(prompt, "`capability_search`");
  assertStringIncludes(prompt, "`wait_agent`");
  assertStringIncludes(prompt, "`space_files_read`");
  assertStringIncludes(prompt, "If you are unsure which tool fits");
  assert(!prompt.includes("`web_search`"));
});
Deno.test("agent prompts - points toolbox runs toward early capability search", () => {
  const prompt = buildAvailableToolsPrompt(SYSTEM_PROMPTS.default, [
    { name: "toolbox", description: "Search and call tools" },
    { name: "file_read", description: "Read a file" },
    { name: "runtime_exec", description: "Run a command" },
  ]);

  assertStringIncludes(prompt, "`toolbox`");
  assertStringIncludes(prompt, "use `toolbox` early");
  assertStringIncludes(prompt, "action=`search`");
  assertStringIncludes(prompt, "then `call`");
});
Deno.test("agent prompts - keeps specialized prompts focused without hardcoding tool inventories", () => {
  assertStringIncludes(SYSTEM_PROMPTS.implementer, "## Implementation Mode");
  assertStringIncludes(SYSTEM_PROMPTS.reviewer, "## Review Mode");
  assert(!SYSTEM_PROMPTS.implementer.includes("`web_search`"));
  assert(!SYSTEM_PROMPTS.implementer.includes("`container_start`"));
});
Deno.test("agent prompts - keeps assistant and planner as thin universal specializations", () => {
  assertStringIncludes(
    SYSTEM_PROMPTS.assistant,
    "You are Takos's universal agent.",
  );
  assertStringIncludes(SYSTEM_PROMPTS.assistant, "## Assistant Mode");
  assertStringIncludes(
    SYSTEM_PROMPTS.planner,
    "You are Takos's universal agent.",
  );
  assertStringIncludes(SYSTEM_PROMPTS.planner, "## Planning Mode");
  assertStringIncludes(SYSTEM_PROMPTS.assistant, "follow-through");
  assertStringIncludes(SYSTEM_PROMPTS.planner, "decision-ready");
});
