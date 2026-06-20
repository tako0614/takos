import type { ResourceCapability } from "../../../shared/types/index.ts";
import {
  normalizePortableResourceBackend,
  type PortableResourceBackend,
} from "./capabilities.ts";
import {
  optionalEnv,
  resolvePostgresUrl,
} from "../../../node-platform/resolvers/env-utils.ts";
import type {
  PortableResourceRef,
  PortableResourceResolution,
} from "./portable-runtime.ts";

export type PortableBackend = PortableResourceBackend;

export function sanitizeName(name: string): string {
  const sanitized = name
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || "resource";
}

export function sanitizeSqlIdentifier(name: string): string {
  return sanitizeName(name).replace(/[^a-zA-Z0-9_]/g, "_");
}

function missingPortablePgVectorRequirements(): string[] {
  const missing: string[] = [];
  if (!resolvePostgresUrl()) {
    missing.push("POSTGRES_URL or DATABASE_URL");
  }
  if (optionalEnv("PGVECTOR_ENABLED") !== "true") {
    missing.push("PGVECTOR_ENABLED=true");
  }
  return missing;
}

// Multi-cloud materialization (aws/gcp/k8s: DynamoDB/Firestore/S3/GCS/SQS/PubSub
// secret managers) is operator-substrate scope owned by Takosumi runner policy,
// not the Takos worker. Only the native `cloudflare` backend and the portable
// self-hosted `local` backend are provisioned in-worker. `normalizePortableBackend`
// always yields `local`, so the portable resolutions are a single static table
// rather than a per-backend registry.
const PORTABLE_RESOURCE_RESOLUTIONS: Record<
  ResourceCapability,
  PortableResourceResolution
> = {
  sql: {
    mode: "takos-runtime",
    backend: "sqlite-d1-adapter",
    requirements: [],
  },
  object_store: {
    mode: "takos-runtime",
    backend: "persistent-r2-bucket",
    requirements: [],
  },
  kv: {
    mode: "takos-runtime",
    backend: "persistent-kv-namespace",
    requirements: [],
  },
  queue: {
    mode: "takos-runtime",
    backend: "persistent-queue",
    requirements: [],
  },
  vector_index: {
    mode: "takos-runtime",
    backend: "pgvector-store",
    requirements: ["POSTGRES_URL or DATABASE_URL", "PGVECTOR_ENABLED=true"],
  },
  analytics_store: {
    mode: "takos-runtime",
    backend: "analytics-engine-binding",
    requirements: [],
  },
  workflow_runtime: {
    mode: "takos-runtime",
    backend: "workflow-binding",
    requirements: [],
  },
  durable_namespace: {
    mode: "takos-runtime",
    backend: "persistent-durable-objects",
    requirements: [],
  },
  secret: {
    mode: "takos-runtime",
    backend: "local-secret-store",
    requirements: [],
  },
};

export function normalizePortableBackend(
  backendName?: string | null,
): PortableBackend {
  return normalizePortableResourceBackend(backendName);
}

export function getPortableBackendResolution(
  _backend: PortableBackend,
  capability: ResourceCapability,
): PortableResourceResolution | null {
  const resolution = PORTABLE_RESOURCE_RESOLUTIONS[capability];
  if (!resolution) return null;
  return {
    ...resolution,
    requirements: [...resolution.requirements],
    ...(resolution.notes ? { notes: [...resolution.notes] } : {}),
  };
}

export function missingPortableBootstrapRequirementsForBackend(
  _backend: PortableBackend,
  capability: ResourceCapability,
): string[] {
  return capability === "vector_index"
    ? missingPortablePgVectorRequirements()
    : [];
}

export async function resolvePortableQueueReferenceId(
  resource: PortableResourceRef,
): Promise<string | null> {
  return sanitizeName(resource.backing_resource_name ?? resource.id);
}
