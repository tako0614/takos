import { assertEquals } from "jsr:@std/assert";

import releaseCrud from "../release-crud.ts";

Deno.test("latest release route is registered before the tag route", () => {
  const signatures = releaseCrud.routes.map((
    route: { method: string; path: string },
  ) => `${route.method} ${route.path}`);

  const latestIndex = signatures.indexOf("GET /repos/:repoId/releases/latest");
  const tagIndex = signatures.indexOf("GET /repos/:repoId/releases/:tag");

  assertEquals(latestIndex >= 0, true);
  assertEquals(tagIndex >= 0, true);
  assertEquals(latestIndex < tagIndex, true);
});
