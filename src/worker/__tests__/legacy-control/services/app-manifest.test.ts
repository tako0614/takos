import { assert, assertEquals, assertThrows } from "@std/assert";

import { parseAppManifestYaml } from "@/application/services/source/app-manifest.ts";

Deno.test("app manifest parses service and worker compute forms", () => {
  const manifest = parseAppManifestYaml(`
name: direct-artifact-app
version: 1.0.0
compute:
  api:
    image: ghcr.io/takos/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 8080
  web:
    kind: worker
`);

  assertEquals(manifest.compute.api?.kind, "service");
  assertEquals(
    manifest.compute.api?.image,
    "ghcr.io/takos/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
  assertEquals(manifest.compute.api?.port, 8080);

  assertEquals(manifest.compute.web?.kind, "worker");
  assertEquals(manifest.compute.web?.image, undefined);
});

Deno.test("app manifest rejects compute entries without build or image", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: broken-app
version: 1.0.0
compute:
  api:
    env:
      FOO: bar
`),
    Error,
    "must define 'image' for service compute or explicit kind: worker",
  );
});

Deno.test("app manifest parses external consumes and worker schedule triggers", () => {
  const manifest = parseAppManifestYaml(`
name: runtime-app
version: 1.0.0
compute:
  api:
    kind: worker
    triggers:
      schedules:
        - cron: "*/5 * * * *"
    consume:
      - publication: search
        as: search-api
        request:
          plan: read-only
        inject:
          env:
            url: SEARCH_URL
`);

  assertEquals(manifest.publish, []);

  const apiCompute = manifest.compute.api;
  assert(apiCompute);
  assertEquals(apiCompute.kind, "worker");
  assertEquals(apiCompute.triggers, {
    schedules: [{ cron: "*/5 * * * *" }],
  });
  assertEquals(apiCompute.consume, [
    {
      publication: "search",
      as: "search-api",
      request: { plan: "read-only" },
      inject: {
        env: {
          url: "SEARCH_URL",
        },
      },
    },
  ]);
});
