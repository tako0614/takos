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
  provider: string,
  options?: {
    webImage?: string;
  },
): GroupDesiredState {
  const webSpec = options?.webImage
    ? { kind: "service" as const, image: options.webImage, port: 8080 }
    : { kind: "service" as const };

  return {
    apiVersion: "takos.dev/v1alpha1",
    kind: "GroupDesiredState",
    groupName: "demo",
    version: "1.0.0",
    provider,
    env: "production",
    manifest: baseManifest(),
    resources: {
      db: {
        name: "db",
        type: "sql",
        spec: { type: "sql" },
        specFingerprint: "db",
      },
      bucket: {
        name: "bucket",
        type: "object-store",
        spec: { type: "object-store" },
        specFingerprint: "bucket",
      },
    },
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

Deno.test("buildTranslationReport - maps cloudflare resources and workloads to native providers", () => {
  const report = buildTranslationReport(makeDesiredState("cloudflare"));

  assertEquals(report.resources, [
    {
      name: "db",
      publicType: "sql",
      semanticType: "sql",
      implementation: "d1",
      driver: "cloudflare-d1",
      provider: "cloudflare-native",
      status: "native",
      resolutionMode: "cloudflare-native",
      requirements: ["CF_ACCOUNT_ID", "CF_API_TOKEN"],
      notes: [
        "Takos runtime realizes this Cloudflare-native resource directly on the Cloudflare backend.",
      ],
    },
    {
      name: "bucket",
      publicType: "object-store",
      semanticType: "object_store",
      implementation: "r2",
      driver: "cloudflare-r2",
      provider: "cloudflare-native",
      status: "native",
      resolutionMode: "cloudflare-native",
      requirements: ["CF_ACCOUNT_ID", "CF_API_TOKEN"],
      notes: [
        "Takos runtime realizes this Cloudflare-native resource directly on the Cloudflare backend.",
      ],
    },
  ]);
  assertEquals(report.workloads, [
    {
      name: "api",
      category: "worker",
      provider: "workers-dispatch",
      runtime: "workers",
      runtimeProfile: "workers",
      status: "native",
      requirements: ["CF_ACCOUNT_ID", "CF_API_TOKEN", "WFP_DISPATCH_NAMESPACE"],
      notes: [
        "Takos runtime realizes worker workloads directly on the Cloudflare backend.",
      ],
    },
    {
      name: "web",
      category: "service",
      provider: "oci",
      runtime: "container-service",
      runtimeProfile: "container-service",
      status: "portable",
      requirements: [],
      notes: [
        "Takos runtime on the Cloudflare backend uses the OCI deployment adapter for service/container workloads.",
      ],
    },
  ]);
  assertEquals(report.routes, [
    {
      name: "api-route",
      target: "api",
      adapter: "hostname-routing",
      provider: "hostname-routing",
      status: "native",
      requirements: ["HOSTNAME_ROUTING"],
      notes: [
        "Takos runtime realizes routing directly through the Cloudflare hostname routing backend.",
      ],
    },
  ]);
  assertEquals(report.unsupported, []);
});

Deno.test("buildTranslationReport - maps non-cloudflare resources and workloads to portable drivers", () => {
  const report = buildTranslationReport(makeDesiredState("aws"));

  assertEquals(report.resources, [
    {
      name: "db",
      publicType: "sql",
      semanticType: "sql",
      implementation: "d1",
      driver: "takos-sql",
      provider: "aws-backing-service",
      status: "portable",
      resolutionMode: "provider-backed",
      requirements: ["POSTGRES_URL or DATABASE_URL"],
      notes: [
        "Takos runtime on aws realizes this Cloudflare-native resource through a provider-backed adapter.",
      ],
    },
    {
      name: "bucket",
      publicType: "object-store",
      semanticType: "object_store",
      implementation: "r2",
      driver: "takos-object-store",
      provider: "aws-backing-service",
      status: "portable",
      resolutionMode: "provider-backed",
      requirements: [],
      notes: [
        "Takos runtime on aws realizes this Cloudflare-native resource through a provider-backed adapter.",
      ],
    },
  ]);
  assertEquals(report.workloads, [
    {
      name: "api",
      category: "worker",
      provider: "runtime-host",
      runtime: "workers",
      runtimeProfile: "workers",
      status: "portable",
      requirements: ["runtime-host adapter"],
      notes: [
        "Takos runtime on aws realizes worker workloads through the runtime-host compatibility layer.",
      ],
    },
    {
      name: "web",
      category: "service",
      provider: "ecs",
      runtime: "container-service",
      runtimeProfile: "container-service",
      status: "portable",
      requirements: [],
      notes: [
        "Takos runtime on aws realizes service execution through the OCI deployment adapter.",
      ],
    },
  ]);
  assertEquals(report.routes, [
    {
      name: "api-route",
      target: "api",
      adapter: "ingress-routing",
      provider: "ingress-routing",
      status: "portable",
      requirements: ["provider ingress adapter", "HOSTNAME_ROUTING store"],
      notes: [
        "Takos runtime on aws realizes routing through Takos-managed hostname routing plus provider ingress.",
      ],
    },
  ]);
  assertEquals(report.supported, true);
  assertEquals(report.unsupported, []);
});

Deno.test("buildTranslationReport - marks portable resources as provider-backed or takos-runtime based on the resolved backend", () => {
  const desiredState = makeDesiredState("aws");
  desiredState.resources.jobs = {
    name: "jobs",
    type: "queue",
    spec: { type: "queue" },
    specFingerprint: "jobs",
  };
  desiredState.resources.vec = {
    name: "vec",
    type: "vector-index",
    spec: { type: "vector-index" },
    specFingerprint: "vec",
  };
  desiredState.resources.events = {
    name: "events",
    type: "analytics-engine",
    spec: { type: "analytics-engine" },
    specFingerprint: "events",
  };
  desiredState.resources.flow = {
    name: "flow",
    type: "workflow",
    spec: {
      type: "workflow",
      workflow: { class: "Main", script: "api" },
    },
    specFingerprint: "flow",
  };
  desiredState.resources.counter = {
    name: "counter",
    type: "durable-object",
    spec: {
      type: "durable-object",
      durableObject: { class: "Counter", script: "api" },
    },
    specFingerprint: "counter",
  };
  desiredState.resources.creds = {
    name: "creds",
    type: "secret",
    spec: { type: "secret" },
    specFingerprint: "creds",
  };

  const report = buildTranslationReport(desiredState);

  assertEquals(report.resources, [
    {
      name: "db",
      publicType: "sql",
      semanticType: "sql",
      implementation: "d1",
      driver: "takos-sql",
      provider: "aws-backing-service",
      status: "portable",
      resolutionMode: "provider-backed",
      requirements: ["POSTGRES_URL or DATABASE_URL"],
      notes: [
        "Takos runtime on aws realizes this Cloudflare-native resource through a provider-backed adapter.",
      ],
    },
    {
      name: "bucket",
      publicType: "object-store",
      semanticType: "object_store",
      implementation: "r2",
      driver: "takos-object-store",
      provider: "aws-backing-service",
      status: "portable",
      resolutionMode: "provider-backed",
      requirements: [],
      notes: [
        "Takos runtime on aws realizes this Cloudflare-native resource through a provider-backed adapter.",
      ],
    },
    {
      name: "jobs",
      publicType: "queue",
      semanticType: "queue",
      implementation: "queue",
      driver: "takos-queue",
      provider: "aws-backing-service",
      status: "portable",
      resolutionMode: "provider-backed",
      requirements: [],
      notes: [
        "Takos runtime on aws realizes this Cloudflare-native resource through a provider-backed adapter.",
      ],
    },
    {
      name: "vec",
      publicType: "vector-index",
      semanticType: "vector_index",
      implementation: "vectorize",
      driver: "takos-vector-store",
      provider: "aws-backing-service",
      status: "portable",
      resolutionMode: "provider-backed",
      requirements: ["POSTGRES_URL or DATABASE_URL", "PGVECTOR_ENABLED=true"],
      notes: [
        "Takos runtime on aws realizes this Cloudflare-native resource through a provider-backed adapter.",
      ],
    },
    {
      name: "events",
      publicType: "analytics-engine",
      semanticType: "analytics_store",
      implementation: "analytics_engine",
      driver: "takos-analytics-store",
      provider: "takos-runtime",
      status: "portable",
      resolutionMode: "takos-runtime",
      requirements: [],
      notes: [
        "Takos runtime on aws realizes this Cloudflare-native resource through the compatibility runtime.",
      ],
    },
    {
      name: "flow",
      publicType: "workflow",
      semanticType: "workflow_runtime",
      implementation: "workflow_binding",
      driver: "takos-workflow-runtime",
      provider: "takos-runtime",
      status: "portable",
      resolutionMode: "takos-runtime",
      requirements: [],
      notes: [
        "Takos runtime on aws realizes this Cloudflare-native resource through the compatibility runtime.",
      ],
    },
    {
      name: "counter",
      publicType: "durable-object",
      semanticType: "durable_namespace",
      implementation: "durable_object_namespace",
      driver: "takos-durable-runtime",
      provider: "takos-runtime",
      status: "portable",
      resolutionMode: "takos-runtime",
      requirements: [],
      notes: [
        "Takos runtime on aws realizes this Cloudflare-native resource through the compatibility runtime.",
      ],
    },
    {
      name: "creds",
      publicType: "secret",
      semanticType: "secret",
      implementation: "secret_ref",
      driver: "takos-secret",
      provider: "aws-backing-service",
      status: "portable",
      resolutionMode: "provider-backed",
      requirements: [],
      notes: [
        "Takos runtime on aws realizes this Cloudflare-native resource through a provider-backed adapter.",
      ],
    },
  ]);
});

Deno.test("buildTranslationReport - uses workload-level image provider when specified", () => {
  const report = buildTranslationReport(makeDesiredState("cloudflare", {
    webImage: "ghcr.io/example/web:latest",
  }));

  assertEquals(report.workloads, [
    {
      name: "api",
      category: "worker",
      provider: "workers-dispatch",
      runtime: "workers",
      runtimeProfile: "workers",
      status: "native",
      requirements: ["CF_ACCOUNT_ID", "CF_API_TOKEN", "WFP_DISPATCH_NAMESPACE"],
      notes: [
        "Takos runtime realizes worker workloads directly on the Cloudflare backend.",
      ],
    },
    {
      name: "web",
      category: "service",
      provider: "oci",
      runtime: "container-service",
      runtimeProfile: "container-service",
      status: "portable",
      requirements: ["OCI_ORCHESTRATOR_URL"],
      notes: [
        "Takos runtime on the Cloudflare backend uses the OCI deployment adapter for service/container workloads.",
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
