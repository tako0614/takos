import { assertEquals } from "jsr:@std/assert";

import { parseReleaseAssetUploadMetadata } from "../release-assets.ts";

Deno.test("parseReleaseAssetUploadMetadata returns undefined when absent", () => {
  const metadata = parseReleaseAssetUploadMetadata(undefined);

  assertEquals(metadata, undefined);
});

Deno.test("parseReleaseAssetUploadMetadata parses safe metadata JSON", () => {
  const metadata = parseReleaseAssetUploadMetadata(
    JSON.stringify({
      app_id: "deployable-app",
      version: "1.2.3",
      category: "app",
      tags: ["release", " stable "],
      dependencies: [
        { repo: "takos/example", version: "0.1.0" },
        { repo: "takos/missing-version" },
      ],
    }),
  );

  assertEquals(metadata, {
    app_id: "deployable-app",
    version: "1.2.3",
    category: "app",
    tags: ["release", "stable"],
    dependencies: [{ repo: "takos/example", version: "0.1.0" }],
  });
});

Deno.test("parseReleaseAssetUploadMetadata ignores invalid metadata JSON", () => {
  const metadata = parseReleaseAssetUploadMetadata("{invalid-json");

  assertEquals(metadata, undefined);
});

Deno.test("parseReleaseAssetUploadMetadata requires version in metadata JSON", () => {
  const metadata = parseReleaseAssetUploadMetadata(
    JSON.stringify({ app_id: "deployable-app" }),
  );

  assertEquals(metadata, undefined);
});
