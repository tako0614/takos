/**
 * What this deployment can actually do.
 *
 * The Cloudflare OpenTofu provider cannot create a Vectorize index or a
 * Container application, so an ordinary production apply lands a Worker whose
 * `VECTORIZE` and executor-container bindings are simply absent. That is a
 * legitimate, documented install — a reduced mode — not a broken one. This
 * module turns "which bindings exist" into one named capability answer, so
 * every consumer degrades the same way and an operator can read the mode off a
 * status endpoint instead of inferring it from a failure.
 */

import { CapabilityUnavailableError } from "@takos/worker-platform-utils/errors";
import type {
  Fetcher,
  VectorIndexBinding,
} from "../shared/types/bindings.ts";

/** Backing store for semantic search, or `disabled` when there is none. */
export type VectorSearchCapability = "vectorize" | "pgvector" | "disabled";

/** Where agent runs execute, or `disabled` when nothing can run them. */
export type AgentContainerCapability =
  | "cloudflare-containers"
  | "external-host"
  | "disabled";

export type RuntimeCapabilities = {
  readonly vectorSearch: VectorSearchCapability;
  readonly agentContainers: AgentContainerCapability;
};

/** Machine-readable name of a capability, used in error details and status. */
export type RuntimeCapabilityName = keyof RuntimeCapabilities;

/**
 * The subset of the environment capability resolution reads. Deliberately
 * structural: the web Env, the background WorkerEnv and the indexer Env all
 * satisfy it, and tests can pass a literal.
 */
export type RuntimeCapabilityEnv = {
  readonly VECTORIZE?: VectorIndexBinding;
  readonly AI?: unknown;
  readonly OPENAI_API_KEY?: string;
  readonly EXECUTOR_CONTAINER?: unknown;
  readonly EXECUTOR_CONTAINER_TIER2?: unknown;
  readonly EXECUTOR_CONTAINER_TIER3?: unknown;
  readonly EXECUTOR_HOST?: Fetcher;
};

const cache = new WeakMap<object, RuntimeCapabilities>();

function hasEmbeddings(env: RuntimeCapabilityEnv): boolean {
  // Vector search needs a model to embed the query as well as an index to
  // search. Workers AI covers the Cloudflare lane; an OpenAI-compatible key
  // covers the node lane (`node-platform/resolvers/ai-resolver.ts`).
  return Boolean(env.AI) || Boolean(env.OPENAI_API_KEY);
}

export function resolveVectorSearchCapability(
  env: RuntimeCapabilityEnv,
): VectorSearchCapability {
  const index = env.VECTORIZE;
  if (!index || !hasEmbeddings(env)) return "disabled";
  // Product-owned adapters describe themselves; a provider-native Vectorize
  // binding does not, so an unmarked index is the Cloudflare one.
  return index.backend === "pgvector" ? "pgvector" : "vectorize";
}

export function resolveAgentContainerCapability(
  env: RuntimeCapabilityEnv,
): AgentContainerCapability {
  // Order matters: `platform/adapters/workers.ts` synthesizes EXECUTOR_HOST
  // from EXECUTOR_CONTAINER, so the container namespace is the more specific
  // signal and has to be tested first.
  if (env.EXECUTOR_CONTAINER) return "cloudflare-containers";
  if (env.EXECUTOR_HOST) return "external-host";
  return "disabled";
}

/** Resolve once per environment object; the answer cannot change under one env. */
export function resolveRuntimeCapabilities(
  env: RuntimeCapabilityEnv,
): RuntimeCapabilities {
  const cached = cache.get(env);
  if (cached) return cached;
  const capabilities: RuntimeCapabilities = {
    vectorSearch: resolveVectorSearchCapability(env),
    agentContainers: resolveAgentContainerCapability(env),
  };
  cache.set(env, capabilities);
  return capabilities;
}

export function isVectorSearchAvailable(env: RuntimeCapabilityEnv): boolean {
  return resolveRuntimeCapabilities(env).vectorSearch !== "disabled";
}

export function areAgentContainersAvailable(
  env: RuntimeCapabilityEnv,
): boolean {
  return resolveRuntimeCapabilities(env).agentContainers !== "disabled";
}

/**
 * Operator-facing explanation of a disabled capability: which binding is
 * missing, so the answer points at the install rather than at the request.
 */
export function describeMissingCapability(
  capability: RuntimeCapabilityName,
  env: RuntimeCapabilityEnv,
): string {
  if (capability === "vectorSearch") {
    if (!env.VECTORIZE && !hasEmbeddings(env)) {
      return "no vector index binding (VECTORIZE) and no embedding model (AI or OPENAI_API_KEY)";
    }
    if (!env.VECTORIZE) return "no vector index binding (VECTORIZE)";
    return "no embedding model (AI or OPENAI_API_KEY)";
  }
  return "no agent executor binding (EXECUTOR_CONTAINER or EXECUTOR_HOST)";
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Refuse a request that needs semantic search in a deployment without it.
 *
 * Used only where vector search IS the feature. Paths that can still answer
 * from the durable text index keep degrading to it and report the capability
 * in their payload instead — a reduced answer beats no answer.
 */
export function requireVectorSearch(
  env: RuntimeCapabilityEnv,
): VectorSearchCapability {
  const capability = resolveRuntimeCapabilities(env).vectorSearch;
  if (capability === "disabled") {
    throw new CapabilityUnavailableError(
      "Vector search is not available in this deployment",
      {
        capability: "vectorSearch",
        reason: describeMissingCapability("vectorSearch", env),
        mode: "disabled",
      },
    );
  }
  return capability;
}

/** Refuse a request that needs an agent container in a deployment without one. */
export function requireAgentContainers(
  env: RuntimeCapabilityEnv,
): AgentContainerCapability {
  const capability = resolveRuntimeCapabilities(env).agentContainers;
  if (capability === "disabled") {
    throw new CapabilityUnavailableError(
      "Agent execution is not available in this deployment",
      {
        capability: "agentContainers",
        reason: describeMissingCapability("agentContainers", env),
        mode: "disabled",
      },
    );
  }
  return capability;
}
