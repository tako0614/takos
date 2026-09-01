import { test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertEquals } from "@takos/test/assert";

import { createPersistentRoutingStore } from "../routing-store.ts";
import { removeLocalDataDir } from "../persistent-shared.ts";

test("persistent routing store creates its parent and survives adapter reload", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "takos-persistent-routing-"),
  );
  const filePath = path.join(tempDir, "nested", "routing.json");
  try {
    const first = createPersistentRoutingStore(filePath);
    assertEquals(await first.getRecord("missing.example"), null);

    const written = await first.putRecord(
      " APP.EXAMPLE ",
      {
        type: "deployments",
        deployments: [{ routeRef: "route_main", weight: 100 }],
      },
      123,
    );
    assertEquals(written.hostname, "app.example");
    assertEquals(written.version, 1);

    const reloaded = createPersistentRoutingStore(filePath);
    assertEquals(await reloaded.getRecord("app.example"), written);
  } finally {
    await removeLocalDataDir(tempDir);
  }
});
