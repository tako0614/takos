import { assertEquals } from "jsr:@std/assert";

const rollbackSource = new URL(
  "../../../../../../packages/control/src/application/services/deployment/rollback.ts",
  import.meta.url,
);

Deno.test("rollback deployment - source keeps routing cleanup and artifact rollback branches", async () => {
  const source = await Deno.readTextFile(rollbackSource);
  assertEquals(source.includes("restoreRoutingSnapshot"), true);
  assertEquals(source.includes("deleteHostnameRouting"), true);
  assertEquals(source.includes("cleanupDeploymentArtifact"), true);
  assertEquals(source.includes("rollback_failed"), true);
  assertEquals(source.includes("upload_bundle"), true);
});
