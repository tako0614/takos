import { assertRejects } from "jsr:@std/assert";
import { ConflictError } from "takos-common/errors";

import type { Env } from "../../../../shared/types/index.ts";
import {
  buildSnapshot,
  loadSnapshot,
} from "../group-deployment-snapshot-archives.ts";

function createMemoryBucket() {
  const objects = new Map<string, ArrayBuffer>();
  return {
    objects,
    async put(key: string, value: ArrayBuffer) {
      objects.set(key, value.slice(0));
    },
    async get(key: string) {
      const value = objects.get(key);
      if (!value) return null;
      return {
        async arrayBuffer() {
          return value.slice(0);
        },
      };
    },
  };
}

Deno.test("loadSnapshot rejects a mismatched snapshot hash", async () => {
  const bucket = createMemoryBucket();
  const env = {
    TENANT_SOURCE: bucket,
    GIT_OBJECTS: bucket,
  } as unknown as Env;

  const snapshot = await buildSnapshot(env, "deployment-1", {
    groupName: "demo",
    backendName: "cloudflare",
    envName: "default",
    source: {
      kind: "manifest",
      manifestArtifacts: [],
    },
    manifest: {
      name: "demo",
      compute: {},
      routes: [],
      publish: [],
      env: {},
    },
    artifacts: {},
  });

  await assertRejects(
    () => loadSnapshot(env, snapshot.r2Key, "0".repeat(64)),
    ConflictError,
    "Snapshot hash mismatch",
  );
});
