import { assertEquals } from "jsr:@std/assert";

import {
  describePortableResourceResolution,
  isPortableResourceProvider,
} from "@/services/resources/portable-runtime";

const portableRuntimeSource = new URL(
  "../../../../../../packages/control/src/application/services/resources/portable-runtime.ts",
  import.meta.url,
);

Deno.test("portable runtime - resolves provider-backed and takos-runtime resources", () => {
  const awsSql = describePortableResourceResolution("aws", "sql");
  const localQueue = describePortableResourceResolution("local", "queue");
  const _unsupported = describePortableResourceResolution("cloudflare", "sql");

  assertEquals(awsSql?.mode, "provider-backed");
  assertEquals(awsSql?.backend, "postgres-schema-d1-adapter");
  assertEquals(localQueue?.mode, "takos-runtime");
  assertEquals(localQueue?.backend, "persistent-queue");
});

Deno.test("portable runtime - recognizes non-cloudflare providers", () => {
  assertEquals(isPortableResourceProvider("aws"), true);
  assertEquals(isPortableResourceProvider("gcp"), true);
  assertEquals(isPortableResourceProvider("local"), true);
  assertEquals(isPortableResourceProvider("cloudflare"), false);
  assertEquals(isPortableResourceProvider(null), false);
});

Deno.test("portable runtime - source keeps cache reset and materialization entry points", async () => {
  const source = await Deno.readTextFile(portableRuntimeSource);
  assertEquals(source.includes("ensurePortableManagedResource"), true);
  assertEquals(source.includes("deletePortableManagedResource"), true);
  assertEquals(
    source.includes("resetPortableResourceRuntimeCachesForTests"),
    true,
  );
  assertEquals(source.includes("createPrefixedKvNamespace"), true);
});
