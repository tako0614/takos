// Guard rail for apps/web/public/robots.txt — search crawlers should be
// kept out of authenticated, internal, and machine surfaces. Adding a path
// like /me or /workers without disallowing it in robots.txt should fail
// loudly so we don't accidentally index a login redirect or worker probe.

import { assertEquals, assertStringIncludes } from "@std/assert";

const ROBOTS_PATH = new URL(
  "../../../public/robots.txt",
  import.meta.url,
);

Deno.test("robots.txt disallows authenticated and internal surfaces", async () => {
  const body = await Deno.readTextFile(ROBOTS_PATH);

  assertStringIncludes(body, "User-agent: *");
  for (
    const required of [
      "Disallow: /auth",
      "Disallow: /me",
      "Disallow: /api",
      "Disallow: /workers",
      "Disallow: /internal",
      "Disallow: /_internal",
    ]
  ) {
    assertStringIncludes(body, required);
  }
});

Deno.test("robots.txt still allows the public marketing surface", async () => {
  const body = await Deno.readTextFile(ROBOTS_PATH);
  assertStringIncludes(body, "Allow: /");

  // Sanity-check the file is not empty and ends with a newline so the
  // last directive is always emitted by static-file servers.
  assertEquals(body.endsWith("\n"), true);
});
