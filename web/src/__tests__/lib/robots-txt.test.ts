// Guard rail for apps/web/public/robots.txt — search crawlers should be
// kept out of authenticated, internal, and machine surfaces. Adding a path
// like /me or /workers without disallowing it in robots.txt should fail
// loudly so we don't accidentally index a login redirect or worker probe.

import { strict as assert, deepStrictEqual as assertEquals } from "node:assert/strict";
import { test } from "bun:test";

const ROBOTS_PATH = new URL(
  "../../../public/robots.txt",
  import.meta.url,
);

test("robots.txt disallows authenticated and internal surfaces", async () => {
  const body = await Bun.file(ROBOTS_PATH).text();

  assert(body.includes("User-agent: *"));
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
    assert(body.includes(required));
  }
});

test("robots.txt still allows the public marketing surface", async () => {
  const body = await Bun.file(ROBOTS_PATH).text();
  assert(body.includes("Allow: /"));

  // Sanity-check the file is not empty and ends with a newline so the
  // last directive is always emitted by static-file servers.
  assertEquals(body.endsWith("\n"), true);
});
