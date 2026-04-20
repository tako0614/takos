import {
  compileGroupDesiredState,
  materializeRoutes,
} from "@/services/deployment/group-state";
import { computeDiff, filterDiffByTargets } from "@/services/deployment/diff";
import type { AppManifest } from "@/application/services/source/app-manifest-types.ts";

import { assertEquals, assertObjectMatch } from "jsr:@std/assert";

function makeManifest(): AppManifest {
  return {
    name: "demo-app",
    version: "1.0.0",
    compute: {
      api: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: ".takos/workflows/deploy.yml",
            job: "build",
            artifact: "worker",
            artifactPath: "dist/worker.js",
          },
        },
        env: { MODE: "base" },
      },
      web: {
        kind: "service",
        image:
          "ghcr.io/example/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        port: 8080,
      },
    },
    routes: [
      { target: "api", path: "/api" },
      { target: "web", path: "/" },
    ],
    publish: [],
    env: {},
    overrides: {
      production: {
        compute: {
          api: {
            kind: "worker",
            env: { MODE: "prod" },
          },
        },
      },
    },
  };
}

Deno.test("group desired state compiler - compiles a manifest into canonical workload/resource/route state", () => {
  const compiled = compileGroupDesiredState(makeManifest(), {
    groupName: "demo-prod",
    backend: "cloudflare",
    envName: "production",
  });

  assertEquals(compiled.groupName, "demo-prod");
  assertEquals(compiled.env, "production");
  assertEquals(compiled.backend, "cloudflare");
  assertEquals(compiled.workloads.api.category, "worker");
  assertEquals(compiled.workloads.api.routeNames, ["api:/api"]);
  assertEquals(
    (compiled.workloads.api.spec as { env?: Record<string, string> }).env?.MODE,
    "prod",
  );
  assertObjectMatch(compiled.routes["web:/"], { target: "web", path: "/" });
});

Deno.test("group desired state compiler - surfaces attached containers as their own workload entries", () => {
  const manifest: AppManifest = {
    ...makeManifest(),
    compute: {
      ...makeManifest().compute,
      api: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: ".takos/workflows/deploy.yml",
            job: "build",
            artifact: "worker",
            artifactPath: "dist/worker.js",
          },
        },
        containers: {
          sidecar: {
            kind: "attached-container",
            image:
              "ghcr.io/example/sidecar@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          },
        },
      },
    },
  };

  const compiled = compileGroupDesiredState(manifest);
  assertEquals(compiled.workloads["api-sidecar"].category, "container");
  assertEquals(compiled.workloads.api.category, "worker");
});

Deno.test("group desired state compiler - namespaces attached containers by parent workload", () => {
  const worker = makeManifest().compute.api;
  const manifest: AppManifest = {
    ...makeManifest(),
    compute: {
      api: {
        ...worker,
        containers: {
          sidecar: {
            kind: "attached-container",
            image:
              "ghcr.io/example/api-sidecar@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          },
        },
      },
      admin: {
        ...worker,
        containers: {
          sidecar: {
            kind: "attached-container",
            image:
              "ghcr.io/example/admin-sidecar@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          },
        },
      },
    },
    routes: [],
  };

  const compiled = compileGroupDesiredState(manifest);

  assertEquals(
    Object.keys(compiled.workloads).sort(),
    ["admin", "admin-sidecar", "api", "api-sidecar"],
  );
  assertEquals(
    compiled.workloads["api-sidecar"].spec.image,
    "ghcr.io/example/api-sidecar@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  );
  assertEquals(
    compiled.workloads["admin-sidecar"].spec.image,
    "ghcr.io/example/admin-sidecar@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  );
});

Deno.test("group diff - detects resource, workload, and route updates from canonical state", () => {
  const desired = compileGroupDesiredState(makeManifest(), {
    groupName: "demo-prod",
    backend: "cloudflare",
    envName: "production",
  });
  const currentRoutes = materializeRoutes(desired.routes, {
    api: {
      serviceId: "svc-api",
      name: "api",
      category: "worker",
      status: "deployed",
      resolvedBaseUrl: "https://api.example.test",
      routeRef: "worker-api",
      specFingerprint: "stale-worker",
      updatedAt: "2026-03-29T00:00:00.000Z",
    },
    web: {
      serviceId: "svc-web",
      name: "web",
      category: "service",
      status: "deployed",
      resolvedBaseUrl: "https://web.example.test",
      specFingerprint: desired.workloads.web.specFingerprint,
      updatedAt: "2026-03-29T00:00:00.000Z",
    },
  });

  const diff = computeDiff(desired, {
    groupId: "group-1",
    groupName: "demo-prod",
    backend: "cloudflare",
    env: "production",
    version: "0.9.0",
    updatedAt: "2026-03-29T00:00:00.000Z",
    resources: {
      db: {
        name: "db",
        type: "sql",
        resourceId: "db-1",
        binding: "OLD_DB",
        status: "active",
        specFingerprint: "stale-resource",
        updatedAt: "2026-03-29T00:00:00.000Z",
      },
    },
    workloads: {
      api: {
        serviceId: "svc-api",
        name: "api",
        category: "worker",
        status: "deployed",
        resolvedBaseUrl: "https://api.example.test",
        routeRef: "worker-api",
        specFingerprint: "stale-worker",
        updatedAt: "2026-03-29T00:00:00.000Z",
      },
      web: {
        serviceId: "svc-web",
        name: "web",
        category: "service",
        status: "deployed",
        resolvedBaseUrl: "https://web.example.test",
        specFingerprint: desired.workloads.web.specFingerprint,
        updatedAt: "2026-03-29T00:00:00.000Z",
      },
    },
    routes: {
      ...currentRoutes,
      "web:/": {
        ...currentRoutes["web:/"],
        path: "/stale",
      },
    },
  });

  assertEquals(diff.summary.update, 2);
  assertEquals(
    diff.entries.filter((entry) => entry.action !== "unchanged").map((
      entry,
    ) => ({
      name: entry.name,
      category: entry.category,
      action: entry.action,
    })),
    [
      { name: "api", category: "worker", action: "update" },
      { name: "web:/", category: "route", action: "update" },
    ],
  );
});

Deno.test("group diff - retries pending and failed workloads even when spec fingerprint matches", () => {
  const desired = compileGroupDesiredState(makeManifest(), {
    groupName: "demo-prod",
    backend: "cloudflare",
    envName: "production",
  });

  const diff = computeDiff(desired, {
    groupId: "group-1",
    groupName: "demo-prod",
    backend: "cloudflare",
    env: "production",
    version: "1.0.0",
    updatedAt: "2026-03-29T00:00:00.000Z",
    resources: {},
    workloads: {
      api: {
        serviceId: "svc-api",
        name: "api",
        category: "worker",
        status: "pending",
        specFingerprint: desired.workloads.api.specFingerprint,
        updatedAt: "2026-03-29T00:00:00.000Z",
      },
      web: {
        serviceId: "svc-web",
        name: "web",
        category: "service",
        status: "failed",
        specFingerprint: desired.workloads.web.specFingerprint,
        updatedAt: "2026-03-29T00:00:00.000Z",
      },
    },
    routes: {},
  });

  assertEquals(
    diff.entries.filter((entry) => entry.category !== "route").map((
      entry,
    ) => ({
      name: entry.name,
      action: entry.action,
      reason: entry.reason,
    })),
    [
      { name: "api", action: "update", reason: "workload status pending" },
      { name: "web", action: "update", reason: "workload status failed" },
    ],
  );
  assertEquals(diff.summary.update, 2);
});

Deno.test("group diff - filters target names with canonical and dotted category keys", () => {
  const diff = filterDiffByTargets({
    entries: [
      { name: "api", category: "worker", action: "update" },
      { name: "web:/", category: "route", action: "update" },
      { name: "admin", category: "service", action: "unchanged" },
    ],
    hasChanges: true,
    summary: { create: 0, update: 2, delete: 0, unchanged: 1 },
  }, ["workers.api", "routes.web:/"]);

  assertEquals(diff.entries.map((entry) => entry.name), ["api", "web:/"]);
  assertEquals(diff.summary, {
    create: 0,
    update: 2,
    delete: 0,
    unchanged: 0,
  });
  assertEquals(diff.hasChanges, true);
});
