import { assertEquals } from "@std/assert";

const lifecycleSource = new URL(
  "../../../../application/services/resources/lifecycle.ts",
  import.meta.url,
);

Deno.test("resource lifecycle - source keeps backend provisioning and failure recording branches", async () => {
  const source = await Deno.readTextFile(lifecycleSource);
  assertEquals(source.includes("provisionManagedResource"), true);
  assertEquals(source.includes("deletePortableManagedResource"), true);
  assertEquals(source.includes("insertFailedResource"), true);
  assertEquals(source.includes("CloudflareResourceService"), true);
  assertEquals(source.includes("resolvePortableResourceReferenceId"), true);
});
