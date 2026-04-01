import { computeDiff } from "../src/lib/state/diff.ts";
import type { TakosState } from "../src/lib/state/state-types.ts";
import type { AppManifest } from "../src/lib/app-manifest.ts";
import type { DiffResult } from "../src/lib/state/diff.ts";

// ── Test helpers ────────────────────────────────────────────────────────────

import { assert, assertEquals } from "jsr:@std/assert";

function makeState(overrides: Partial<TakosState> = {}): TakosState {
  return {
    version: 1,
    provider: "cloudflare",
    env: "production",
    group: "test-group",
    groupName: "test-group",
    updatedAt: "2026-01-01T00:00:00Z",
    resources: {},
    workers: {},
    containers: {},
    services: {},
    routes: {},
    ...overrides,
  };
}

function makeManifest(spec: Partial<AppManifest["spec"]> = {}): AppManifest {
  return {
    apiVersion: "takos.dev/v1alpha1",
    kind: "App",
    metadata: { name: "test-app" },
    spec: {
      version: "1.0.0",
      workers: {},
      ...spec,
    },
  };
}

/**
 * Simulate applyDiff: given a diff result, collect the action calls that
 * the coordinator would make. This verifies diff-driven dispatch logic
 * without depending on the actual coordinator implementation (which is
 * being built by another agent).
 */
function simulateApplyDiff(
  diff: DiffResult,
): Array<{ action: string; name: string; category: string }> {
  const calls: Array<{ action: string; name: string; category: string }> = [];

  for (const entry of diff.entries) {
    switch (entry.action) {
      case "create": {
        if (entry.category === "resource") {
          calls.push({
            action: "createResource",
            name: entry.name,
            category: entry.category,
          });
        } else if (entry.category === "worker") {
          calls.push({
            action: "deployWorker",
            name: entry.name,
            category: entry.category,
          });
        } else if (entry.category === "container") {
          calls.push({
            action: "deployContainer",
            name: entry.name,
            category: entry.category,
          });
        } else if (entry.category === "service") {
          calls.push({
            action: "deployService",
            name: entry.name,
            category: entry.category,
          });
        }
        break;
      }
      case "update": {
        if (entry.category === "worker") {
          calls.push({
            action: "deployWorker",
            name: entry.name,
            category: entry.category,
          });
        } else if (entry.category === "container") {
          calls.push({
            action: "deployContainer",
            name: entry.name,
            category: entry.category,
          });
        } else if (entry.category === "service") {
          calls.push({
            action: "deployService",
            name: entry.name,
            category: entry.category,
          });
        }
        break;
      }
      case "delete": {
        if (entry.category === "resource") {
          calls.push({
            action: "deleteResource",
            name: entry.name,
            category: entry.category,
          });
        } else if (entry.category === "worker") {
          calls.push({
            action: "deleteWorker",
            name: entry.name,
            category: entry.category,
          });
        } else if (entry.category === "container") {
          calls.push({
            action: "deleteContainer",
            name: entry.name,
            category: entry.category,
          });
        } else if (entry.category === "service") {
          calls.push({
            action: "deleteService",
            name: entry.name,
            category: entry.category,
          });
        }
        break;
      }
      case "unchanged":
        // no-op
        break;
    }
  }

  return calls;
}

// ── applyDiff tests ─────────────────────────────────────────────────────────

Deno.test("applyDiff - calls createResource for create entries", () => {
  const manifest = makeManifest({
    resources: {
      db: { type: "d1", binding: "DB" },
      cache: { type: "kv" },
    },
  });

  const diff = computeDiff(manifest, null);
  const calls = simulateApplyDiff(diff);

  const createResourceCalls = calls.filter((c) =>
    c.action === "createResource"
  );
  assertEquals(createResourceCalls.length, 2);
  assertEquals(createResourceCalls.map((c) => c.name).sort(), ["cache", "db"]);
});
Deno.test("applyDiff - calls deployWorker for create worker entries", () => {
  const manifest = makeManifest({
    workers: {
      web: {
        build: {
          fromWorkflow: {
            path: ".takos/workflows/build.yml",
            job: "build",
            artifact: "dist",
            artifactPath: "dist/",
          },
        },
      },
    },
  });

  const diff = computeDiff(manifest, null);
  const calls = simulateApplyDiff(diff);

  const deployWorkerCalls = calls.filter((c) => c.action === "deployWorker");
  assertEquals(deployWorkerCalls.length, 1);
  assertEquals(deployWorkerCalls[0].name, "web");
});
Deno.test("applyDiff - calls delete for delete entries", () => {
  const manifest = makeManifest({
    resources: {},
    workers: {},
  });

  const current = makeState({
    resources: {
      db: {
        type: "d1",
        id: "abc",
        binding: "DB",
        createdAt: "2026-01-01T00:00:00Z",
      },
    },
    workers: {
      old: {
        scriptName: "old",
        deployedAt: "2026-01-01T00:00:00Z",
        codeHash: "sha256:xxx",
      },
    },
  });

  const diff = computeDiff(manifest, current);
  const calls = simulateApplyDiff(diff);

  const deleteResourceCalls = calls.filter((c) =>
    c.action === "deleteResource"
  );
  assertEquals(deleteResourceCalls.length, 1);
  assertEquals(deleteResourceCalls[0].name, "db");

  const deleteWorkerCalls = calls.filter((c) => c.action === "deleteWorker");
  assertEquals(deleteWorkerCalls.length, 1);
  assertEquals(deleteWorkerCalls[0].name, "old");
});
Deno.test("applyDiff - skips unchanged entries", () => {
  const manifest = makeManifest({
    resources: {
      db: { type: "d1", binding: "DB" },
    },
    workers: {
      web: {
        build: {
          fromWorkflow: {
            path: ".takos/workflows/build.yml",
            job: "build",
            artifact: "dist",
            artifactPath: "dist/",
          },
        },
      },
    },
  });

  const current = makeState({
    resources: {
      db: {
        type: "d1",
        id: "abc",
        binding: "DB",
        createdAt: "2026-01-01T00:00:00Z",
      },
    },
    workers: {
      web: {
        scriptName: "web",
        deployedAt: "2026-01-01T00:00:00Z",
        codeHash: "sha256:aaa",
      },
    },
  });

  const diff = computeDiff(manifest, current);
  const calls = simulateApplyDiff(diff);

  // No actions should be dispatched for unchanged entries
  assertEquals(calls.length, 0);
  assertEquals(diff.hasChanges, false);
});
Deno.test("applyDiff - respects dependsOn ordering (resources before workers)", () => {
  const manifest = makeManifest({
    resources: {
      db: { type: "d1", binding: "DB" },
    },
    workers: {
      web: {
        build: {
          fromWorkflow: {
            path: ".takos/workflows/build.yml",
            job: "build",
            artifact: "dist",
            artifactPath: "dist/",
          },
        },
      },
    },
  });

  const diff = computeDiff(manifest, null);

  // Verify that resource entries come before worker entries in the diff
  // This is the natural ordering that computeDiff produces, and the
  // coordinator should process entries in order, ensuring resources
  // are created before workers that may depend on them.
  const resourceIndex = diff.entries.findIndex(
    (e) => e.category === "resource" && e.name === "db",
  );
  const workerIndex = diff.entries.findIndex(
    (e) => e.category === "worker" && e.name === "web",
  );
  assert(resourceIndex < workerIndex);

  const calls = simulateApplyDiff(diff);
  const createResourceIdx = calls.findIndex((c) =>
    c.action === "createResource"
  );
  const deployWorkerIdx = calls.findIndex((c) => c.action === "deployWorker");
  assert(createResourceIdx < deployWorkerIdx);
});
Deno.test("applyDiff - handles mixed create, delete, and unchanged", () => {
  const manifest = makeManifest({
    resources: {
      db: { type: "d1", binding: "DB" }, // unchanged
      newcache: { type: "kv" }, // create
    },
    workers: {
      web: { // unchanged
        build: {
          fromWorkflow: {
            path: ".takos/workflows/build.yml",
            job: "build",
            artifact: "dist",
            artifactPath: "dist/",
          },
        },
      },
    },
  });

  const current = makeState({
    resources: {
      db: {
        type: "d1",
        id: "abc",
        binding: "DB",
        createdAt: "2026-01-01T00:00:00Z",
      },
      oldqueue: {
        type: "queue",
        id: "q1",
        binding: "Q",
        createdAt: "2026-01-01T00:00:00Z",
      },
    },
    workers: {
      web: {
        scriptName: "web",
        deployedAt: "2026-01-01T00:00:00Z",
        codeHash: "sha256:aaa",
      },
    },
  });

  const diff = computeDiff(manifest, current);
  const calls = simulateApplyDiff(diff);

  // Should have 1 create (newcache) + 1 delete (oldqueue) = 2 calls
  assertEquals(calls.length, 2);
  assert(
    calls.find((c) =>
      c.action === "createResource" && c.name === "newcache"
    ) !== undefined,
  );
  assert(
    calls.find((c) =>
      c.action === "deleteResource" && c.name === "oldqueue"
    ) !== undefined,
  );
});
Deno.test("applyDiff - handles container and service entries", () => {
  const manifest = makeManifest() as AppManifest & {
    spec: AppManifest["spec"] & {
      containers: Record<string, unknown>;
      services: Record<string, unknown>;
    };
  };
  (manifest.spec as any).containers = { runner: { dockerfile: "Dockerfile" } };
  (manifest.spec as any).services = { backend: { dockerfile: "Dockerfile" } };

  const diff = computeDiff(manifest, null);
  const calls = simulateApplyDiff(diff);

  const containerCalls = calls.filter((c) => c.action === "deployContainer");
  assertEquals(containerCalls.length, 1);
  assertEquals(containerCalls[0].name, "runner");

  const serviceCalls = calls.filter((c) => c.action === "deployService");
  assertEquals(serviceCalls.length, 1);
  assertEquals(serviceCalls[0].name, "backend");
});
