import {
  compileGroupDesiredState,
  materializeRoutes,
} from "@/services/deployment/group-state";
import { computeDiff } from "@/services/deployment/diff";
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
        image: "ghcr.io/example/web:latest",
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
    provider: "cloudflare",
    envName: "production",
  });

  assertEquals(compiled.groupName, "demo-prod");
  assertEquals(compiled.env, "production");
  assertEquals(compiled.resources, {});
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
            image: "ghcr.io/example/sidecar:latest",
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
            image: "ghcr.io/example/api-sidecar:latest",
          },
        },
      },
      admin: {
        ...worker,
        containers: {
          sidecar: {
            kind: "attached-container",
            image: "ghcr.io/example/admin-sidecar:latest",
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
    "ghcr.io/example/api-sidecar:latest",
  );
  assertEquals(
    compiled.workloads["admin-sidecar"].spec.image,
    "ghcr.io/example/admin-sidecar:latest",
  );
});

Deno.test("group diff - detects resource, workload, and route updates from canonical state", () => {
  const desired = compileGroupDesiredState(makeManifest(), {
    groupName: "demo-prod",
    provider: "cloudflare",
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
    provider: "cloudflare",
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
