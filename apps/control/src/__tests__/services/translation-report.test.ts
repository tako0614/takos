import {
  assertTranslationSupported,
  buildTranslationReport,
} from "@/services/deployment/translation-report";
import type { GroupDesiredState } from "@/services/deployment/group-state";
import type { AppManifest } from "@/application/services/source/app-manifest-types.ts";

import { assert, assertEquals, assertThrows } from "jsr:@std/assert";

function baseManifest(): AppManifest {
  return {
    name: "demo",
    version: "1.0.0",
    compute: {},
    routes: [],
    publish: [],
    env: {},
  };
}

function makeDesiredState(
  backend: string,
  options?: {
    webImage?: string;
  },
): GroupDesiredState {
  const webSpec = options?.webImage
    ? { kind: "service" as const, image: options.webImage, port: 8080 }
    : { kind: "service" as const };

  return {
    groupName: "demo",
    version: "1.0.0",
    backend,
    env: "production",
    manifest: baseManifest(),
    workloads: {
      api: {
        name: "api",
        category: "worker",
        spec: { kind: "worker" },
        specFingerprint: "api",
        dependsOn: [],
        routeNames: ["api-route"],
      },
      web: {
        name: "web",
        category: "service",
        spec: webSpec,
        specFingerprint: "web",
        dependsOn: [],
        routeNames: [],
      },
    },
    routes: {
      "api-route": {
        name: "api-route",
        target: "api",
      },
    },
  };
}

Deno.test("buildTranslationReport - maps cloudflare workloads to runtime entries", () => {
  const report = buildTranslationReport(makeDesiredState("cloudflare"));

  assertEquals(report.workloads, [
    {
      name: "api",
      category: "worker",
      runtime: "workers",
      runtimeProfile: "workers",
      status: "compatible",
      requirements: [],
      notes: [
        "tenant runtime realizes worker workloads through the worker runtime.",
      ],
    },
    {
      name: "web",
      category: "service",
      runtime: "container-service",
      runtimeProfile: "container-service",
      status: "compatible",
      requirements: [],
      notes: [
        "tenant runtime realizes service and container workloads through the container runtime.",
      ],
    },
  ]);
  assertEquals(report.routes, [
    {
      name: "api-route",
      target: "api",
      status: "compatible",
      requirements: [],
      notes: [
        "tenant runtime materializes routes through the routing runtime.",
      ],
    },
  ]);
  assertEquals(report.unsupported, []);
});

Deno.test("buildTranslationReport - maps non-cloudflare workloads to the same runtime entries", () => {
  const report = buildTranslationReport(makeDesiredState("aws"));

  assertEquals(report.workloads, [
    {
      name: "api",
      category: "worker",
      runtime: "workers",
      runtimeProfile: "workers",
      status: "compatible",
      requirements: [],
      notes: [
        "tenant runtime realizes worker workloads through the worker runtime.",
      ],
    },
    {
      name: "web",
      category: "service",
      runtime: "container-service",
      runtimeProfile: "container-service",
      status: "compatible",
      requirements: [],
      notes: [
        "tenant runtime realizes service and container workloads through the container runtime.",
      ],
    },
  ]);
  assertEquals(report.routes, [
    {
      name: "api-route",
      target: "api",
      status: "compatible",
      requirements: [],
      notes: [
        "tenant runtime materializes routes through the routing runtime.",
      ],
    },
  ]);
  assertEquals(report.supported, true);
  assertEquals(report.unsupported, []);
});

Deno.test("buildTranslationReport - reports image workload runtime requirements", () => {
  const report = buildTranslationReport(makeDesiredState("cloudflare", {
    webImage: "ghcr.io/example/web:latest",
  }));

  assertEquals(report.workloads, [
    {
      name: "api",
      category: "worker",
      runtime: "workers",
      runtimeProfile: "workers",
      status: "compatible",
      requirements: [],
      notes: [
        "tenant runtime realizes worker workloads through the worker runtime.",
      ],
    },
    {
      name: "web",
      category: "service",
      runtime: "container-service",
      runtimeProfile: "container-service",
      status: "compatible",
      requirements: ["OCI_ORCHESTRATOR_URL"],
      notes: [
        "tenant runtime realizes service and container workloads through the container runtime.",
      ],
    },
  ]);
  assertEquals(report.supported, false);
  assert(report.requirements.includes("OCI_ORCHESTRATOR_URL"));
});

Deno.test("buildTranslationReport - requires OCI orchestrator URL before assertion when image workloads exist", () => {
  const report = buildTranslationReport(makeDesiredState("cloudflare", {
    webImage: "ghcr.io/example/web:latest",
  }));

  assertEquals(report.supported, false);
  assertEquals(report.unsupported, []);
  assertThrows(
    () => assertTranslationSupported(report, {}),
    Error,
    "OCI_ORCHESTRATOR_URL is required",
  );
  assertTranslationSupported(report, {
    ociOrchestratorUrl: "http://orchestrator.internal",
  });
});
