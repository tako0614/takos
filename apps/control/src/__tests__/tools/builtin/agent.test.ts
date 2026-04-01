import { assertEquals } from "jsr:@std/assert";

const agentSource = new URL(
  "../../../../../../packages/control/src/application/tools/builtin/agent.ts",
  import.meta.url,
);

Deno.test("agent tools - source declares both builtin agent tools", async () => {
  const source = await Deno.readTextFile(agentSource);
  assertEquals(source.includes("name: 'spawn_agent'"), true);
  assertEquals(source.includes("name: 'wait_agent'"), true);
  assertEquals(source.includes("required: ['task']"), true);
  assertEquals(source.includes("required: ['run_id']"), true);
  assertEquals(source.includes("export const AGENT_TOOLS"), true);
  assertEquals(source.includes("export const AGENT_HANDLERS"), true);
});

Deno.test("agent tools - source keeps input validation guards", async () => {
  const source = await Deno.readTextFile(agentSource);
  assertEquals(
    source.includes("task is required and must be a non-empty string"),
    true,
  );
  assertEquals(source.includes("run_id is required"), true);
});
