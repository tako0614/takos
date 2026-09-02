import { describe, expect, test } from "bun:test";

import { AppError } from "@takos/worker-platform-utils/errors";
import type {
  VectorIndexBinding,
  VectorizeMatch,
} from "../../shared/types/bindings.ts";
import {
  type RuntimeCapabilityEnv,
  areAgentContainersAvailable,
  describeMissingCapability,
  isVectorSearchAvailable,
  requireAgentContainers,
  requireVectorSearch,
  resolveRuntimeCapabilities,
} from "../runtime-capabilities.ts";

function vectorIndex(
  backend?: "pgvector",
): VectorIndexBinding {
  const matches: VectorizeMatch[] = [];
  return {
    ...(backend ? { backend } : {}),
    query: async () => ({ matches }),
    insert: async () => undefined,
    upsert: async () => undefined,
    deleteByIds: async () => undefined,
  };
}

const workersAi = { run: async () => undefined };
const containerNamespace = { idFromName: () => ({}), get: () => ({}) };
const externalHost = { fetch: async () => new Response("ok") };

describe("vector search capability", () => {
  test("is vectorize when a provider-native index and Workers AI are bound", () => {
    const env: RuntimeCapabilityEnv = {
      VECTORIZE: vectorIndex(),
      AI: workersAi,
    };
    expect(resolveRuntimeCapabilities(env).vectorSearch).toBe("vectorize");
    expect(isVectorSearchAvailable(env)).toBe(true);
  });

  test("is pgvector when the node adapter describes itself", () => {
    const env: RuntimeCapabilityEnv = {
      VECTORIZE: vectorIndex("pgvector"),
      OPENAI_API_KEY: "sk-test",
    };
    expect(resolveRuntimeCapabilities(env).vectorSearch).toBe("pgvector");
  });

  test("is disabled without an index — the ordinary production apply", () => {
    const env: RuntimeCapabilityEnv = { AI: workersAi };
    expect(resolveRuntimeCapabilities(env).vectorSearch).toBe("disabled");
    expect(isVectorSearchAvailable(env)).toBe(false);
    expect(describeMissingCapability("vectorSearch", env)).toBe(
      "no vector index binding (VECTORIZE)",
    );
  });

  test("is disabled without an embedding model, even with an index", () => {
    const env: RuntimeCapabilityEnv = { VECTORIZE: vectorIndex() };
    expect(resolveRuntimeCapabilities(env).vectorSearch).toBe("disabled");
    expect(describeMissingCapability("vectorSearch", env)).toBe(
      "no embedding model (AI or OPENAI_API_KEY)",
    );
  });

  test("names both gaps when neither is bound", () => {
    expect(describeMissingCapability("vectorSearch", {})).toBe(
      "no vector index binding (VECTORIZE) and no embedding model (AI or OPENAI_API_KEY)",
    );
  });
});

describe("agent container capability", () => {
  test("is cloudflare-containers when the executor namespace is bound", () => {
    const env: RuntimeCapabilityEnv = {
      EXECUTOR_CONTAINER: containerNamespace,
    };
    expect(resolveRuntimeCapabilities(env).agentContainers).toBe(
      "cloudflare-containers",
    );
    expect(areAgentContainersAvailable(env)).toBe(true);
  });

  test("prefers the container namespace over the synthesized executor host", () => {
    // `platform/adapters/workers.ts` builds EXECUTOR_HOST from
    // EXECUTOR_CONTAINER, so both being present is the normal Cloudflare shape.
    const env: RuntimeCapabilityEnv = {
      EXECUTOR_CONTAINER: containerNamespace,
      EXECUTOR_HOST: externalHost,
    };
    expect(resolveRuntimeCapabilities(env).agentContainers).toBe(
      "cloudflare-containers",
    );
  });

  test("is external-host when only a forwarding host is configured", () => {
    const env: RuntimeCapabilityEnv = { EXECUTOR_HOST: externalHost };
    expect(resolveRuntimeCapabilities(env).agentContainers).toBe(
      "external-host",
    );
  });

  test("is disabled when nothing can run an agent", () => {
    expect(resolveRuntimeCapabilities({}).agentContainers).toBe("disabled");
    expect(areAgentContainersAvailable({})).toBe(false);
    expect(describeMissingCapability("agentContainers", {})).toBe(
      "no agent executor binding (EXECUTOR_CONTAINER or EXECUTOR_HOST)",
    );
  });
});

describe("resolution is memoized per environment object", () => {
  test("the same env yields the identical answer object", () => {
    const env: RuntimeCapabilityEnv = { AI: workersAi };
    expect(resolveRuntimeCapabilities(env)).toBe(
      resolveRuntimeCapabilities(env),
    );
  });
});

describe("guards", () => {
  test("requireVectorSearch returns the mode when available", () => {
    expect(
      requireVectorSearch({ VECTORIZE: vectorIndex(), AI: workersAi }),
    ).toBe("vectorize");
  });

  test("requireVectorSearch throws a 501 with a stable code and details", () => {
    let thrown: unknown;
    try {
      requireVectorSearch({});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    const error = thrown as AppError;
    expect(error.statusCode).toBe(501);
    expect(error.code).toBe("CAPABILITY_UNAVAILABLE");
    expect(error.toResponse()).toEqual({
      error: {
        code: "CAPABILITY_UNAVAILABLE",
        message: "Vector search is not available in this deployment",
        details: {
          capability: "vectorSearch",
          reason:
            "no vector index binding (VECTORIZE) and no embedding model (AI or OPENAI_API_KEY)",
          mode: "disabled",
        },
      },
    });
  });

  test("requireAgentContainers returns the mode when available", () => {
    expect(
      requireAgentContainers({ EXECUTOR_CONTAINER: containerNamespace }),
    ).toBe("cloudflare-containers");
  });

  test("requireAgentContainers throws a 501 with a stable code and details", () => {
    let thrown: unknown;
    try {
      requireAgentContainers({});
    } catch (error) {
      thrown = error;
    }
    const error = thrown as AppError;
    expect(error.statusCode).toBe(501);
    expect(error.code).toBe("CAPABILITY_UNAVAILABLE");
    expect(error.toResponse()).toEqual({
      error: {
        code: "CAPABILITY_UNAVAILABLE",
        message: "Agent execution is not available in this deployment",
        details: {
          capability: "agentContainers",
          reason:
            "no agent executor binding (EXECUTOR_CONTAINER or EXECUTOR_HOST)",
          mode: "disabled",
        },
      },
    });
  });
});
