import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { CAPSULE_STATUSES } from "./takosumi-capsule-status.ts";

/**
 * Compare the mirror to the bytes the pinned package ships, not to another
 * copy of itself. `@takosjp/takosumi-contract` is pinned to an exact version,
 * so this reads the published `types.ts` out of the installed package.
 */
const publishedTypes = await readFile(
  new URL(
    "../../../node_modules/@takosjp/takosumi-contract/types.ts",
    import.meta.url,
  ),
  "utf8",
);

test("the Capsule status mirror matches the published union exactly", () => {
  const declaration = publishedTypes.match(
    /export type GroupSummaryStatus =([\s\S]*?);/u,
  );
  expect(
    declaration,
    "the pinned @takosjp/takosumi-contract no longer declares GroupSummaryStatus",
  ).not.toBeNull();
  const published = Array.from(
    declaration![1]!.matchAll(/"([a-z_]+)"/gu),
    (match) => match[1]!,
  );
  expect(published.length).toBeGreaterThan(0);
  expect([...CAPSULE_STATUSES] as string[]).toEqual(published);
});

test("the union is still unimportable, which is why the mirror exists", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL(
        "../../../node_modules/@takosjp/takosumi-contract/package.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { exports?: Record<string, string>; files?: string[] };
  expect(
    manifest.files,
    "types.ts must still be shipped for this mirror to be checkable",
  ).toContain("types.ts");
  expect(
    Object.keys(manifest.exports ?? {}),
    "types.ts is exported now: delete the mirror and import GroupSummaryStatus directly",
  ).not.toContain("./types");
});
