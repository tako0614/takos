import {
  toReleaseAsset,
  toReleaseAssets,
} from "@/services/source/repo-release-assets";

import { assertEquals, assertObjectMatch } from "jsr:@std/assert";

Deno.test("repo release asset mapping - maps package metadata without legacy aliases", () => {
  const asset = toReleaseAsset({
    id: "asset-1",
    assetKey: "releases/release-1/app.zip",
    name: "app.zip",
    contentType: "application/zip",
    sizeBytes: 128,
    downloadCount: 3,
    bundleFormat: null,
    bundleMetaJson: JSON.stringify({
      app_id: "notes-app",
      version: "1.2.3",
      description: "Deployable bundle",
    }),
    createdAt: "2026-03-10T00:00:00.000Z",
  });

  assertObjectMatch(asset, {
    id: "asset-1",
    bundle_format: undefined,
    bundle_meta: {
      app_id: "notes-app",
      version: "1.2.3",
      description: "Deployable bundle",
    },
  });
});
Deno.test("repo release asset mapping - maps asset arrays through the same canonical contract", () => {
  const assets = toReleaseAssets([
    {
      id: "asset-2",
      assetKey: "releases/release-2/readme.txt",
      name: "readme.txt",
      contentType: "text/plain",
      sizeBytes: 64,
      downloadCount: 0,
      bundleFormat: null,
      bundleMetaJson: null,
      createdAt: new Date("2026-03-10T00:00:00.000Z"),
    },
  ]);

  assertEquals(assets.length, 1);
  assertObjectMatch(assets[0], {
    id: "asset-2",
    bundle_format: undefined,
    bundle_meta: undefined,
  });
});
