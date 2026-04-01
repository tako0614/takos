import { assertEquals } from "jsr:@std/assert";

const stateSource = new URL(
  "../../../../../../packages/control/src/application/services/deployment/state.ts",
  import.meta.url,
);

Deno.test("deployment state - source keeps the step lifecycle flow", async () => {
  const source = await Deno.readTextFile(stateSource);
  assertEquals(source.includes("updateDeploymentRecord"), true);
  assertEquals(source.includes("logDeploymentEvent"), true);
  assertEquals(source.includes("step_started"), true);
  assertEquals(source.includes("step_failed"), true);
  assertEquals(source.includes("stuck_reset"), true);
});
