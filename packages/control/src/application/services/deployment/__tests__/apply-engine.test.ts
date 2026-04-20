import { assertEquals } from "jsr:@std/assert";

import { compileGroupDesiredState } from "../group-state.ts";
import { buildGroupSnapshotUpdate } from "../apply-engine.ts";

Deno.test(
  "buildGroupSnapshotUpdate keeps the previous group snapshot on degraded apply",
  () => {
    const desiredState = compileGroupDesiredState({
      name: "demo",
      version: "2.0.0",
      compute: {},
      routes: [],
      publish: [],
      env: {},
    });
    const currentGroup = {
      appVersion: "1.0.0",
      backend: "aws",
      env: "production",
      desiredSpecJson: JSON.stringify({
        name: "demo",
        version: "1.0.0",
      }),
      backendStateJson: JSON.stringify({ ok: true }),
    } as never;

    assertEquals(
      buildGroupSnapshotUpdate(desiredState, currentGroup, "degraded"),
      {
        appVersion: "1.0.0",
        backend: "aws",
        env: "production",
        desiredSpecJson: JSON.stringify({
          name: "demo",
          version: "1.0.0",
        }),
        backendStateJson: JSON.stringify({ ok: true }),
        reconcileStatus: "degraded",
      },
    );
  },
);

Deno.test("buildGroupSnapshotUpdate advances the group snapshot on success", () => {
  const desiredState = compileGroupDesiredState({
    name: "demo",
    version: "2.0.0",
    compute: {},
    routes: [],
    publish: [],
    env: {},
  });
  const currentGroup = {
    appVersion: "1.0.0",
    backend: "aws",
    env: "production",
    desiredSpecJson: JSON.stringify({
      name: "demo",
      version: "1.0.0",
    }),
    backendStateJson: JSON.stringify({ ok: true }),
  } as never;

  assertEquals(buildGroupSnapshotUpdate(desiredState, currentGroup, "ready"), {
    appVersion: "2.0.0",
    backend: "cloudflare",
    env: "default",
    desiredSpecJson: JSON.stringify(desiredState.manifest),
    backendStateJson: JSON.stringify({ ok: true }),
    reconcileStatus: "ready",
  });
});
