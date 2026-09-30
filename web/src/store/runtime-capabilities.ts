import { createSignal } from "solid-js";

/**
 * What this deployment can do, as reported by `GET /api/runtime/capabilities`.
 *
 * An install whose OpenTofu apply left no Vectorize index or Container
 * application is a documented reduced mode, not a broken one. The UI reads
 * this so it stops offering entry points the deployment cannot serve, instead
 * of surfacing a 501 after the user has already committed to the action.
 */
export type VectorSearchCapability = "vectorize" | "pgvector" | "disabled";
export type AgentContainerCapability =
  | "cloudflare-containers"
  | "external-host"
  | "disabled";

export type RuntimeCapabilities = {
  readonly vectorSearch: VectorSearchCapability;
  readonly agentContainers: AgentContainerCapability;
};

const VECTOR_SEARCH_VALUES: readonly string[] = [
  "vectorize",
  "pgvector",
  "disabled",
];
const AGENT_CONTAINER_VALUES: readonly string[] = [
  "cloudflare-containers",
  "external-host",
  "disabled",
];

/**
 * Read a capabilities payload, or return `null` when it is not one.
 *
 * Returning `null` rather than a defaulted object matters: an unknown answer
 * must leave the UI optimistic, because hiding a working feature is worse than
 * briefly offering one that turns out to be unavailable.
 */
export function parseRuntimeCapabilities(
  payload: unknown,
): RuntimeCapabilities | null {
  if (typeof payload !== "object" || payload === null) return null;
  const capabilities = (payload as { capabilities?: unknown }).capabilities;
  if (typeof capabilities !== "object" || capabilities === null) return null;
  const { vectorSearch, agentContainers } = capabilities as {
    vectorSearch?: unknown;
    agentContainers?: unknown;
  };
  if (
    typeof vectorSearch !== "string" ||
    !VECTOR_SEARCH_VALUES.includes(vectorSearch)
  ) {
    return null;
  }
  if (
    typeof agentContainers !== "string" ||
    !AGENT_CONTAINER_VALUES.includes(agentContainers)
  ) {
    return null;
  }
  return {
    vectorSearch: vectorSearch as VectorSearchCapability,
    agentContainers: agentContainers as AgentContainerCapability,
  };
}

/** True unless the deployment is known to lack the capability. */
export function vectorSearchEnabled(
  capabilities: RuntimeCapabilities | null,
): boolean {
  return capabilities === null || capabilities.vectorSearch !== "disabled";
}

/** True unless the deployment is known to lack an agent executor. */
export function agentExecutionEnabled(
  capabilities: RuntimeCapabilities | null,
): boolean {
  return capabilities === null || capabilities.agentContainers !== "disabled";
}

const [runtimeCapabilities, setRuntimeCapabilities] = createSignal<
  RuntimeCapabilities | null
>(null);

export { runtimeCapabilities };

let inFlight: Promise<RuntimeCapabilities | null> | null = null;

/**
 * Fetch the capability report once per session. Failures leave the signal at
 * `null`, which every consumer reads as "assume available".
 */
export function loadRuntimeCapabilities(): Promise<RuntimeCapabilities | null> {
  if (inFlight) return inFlight;
  inFlight = fetch("/api/runtime/capabilities", {
    headers: { Accept: "application/json" },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      const parsed = parseRuntimeCapabilities(payload);
      if (parsed) setRuntimeCapabilities(parsed);
      return parsed;
    })
    .catch(() => null);
  return inFlight;
}

/** Test seam: forget the cached answer and the in-flight request. */
export function resetRuntimeCapabilities(): void {
  inFlight = null;
  setRuntimeCapabilities(null);
}
