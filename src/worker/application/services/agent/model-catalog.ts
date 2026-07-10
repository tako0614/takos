import { logWarn } from "../../../shared/utils/logger.ts";

export type ModelBackend = "openai" | "anthropic" | "google";

export type ModelOption = {
  id: string;
  name: string;
  description?: string;
  source?: ModelCatalogSource;
  disabled?: boolean;
};

export type ModelCatalogSource = "models_api" | "gateway" | "fallback";
export type ModelCatalogStatus =
  "fresh" | "cached" | "fallback" | "unconfigured";

export type AvailableModelsByBackend = Readonly<
  Record<ModelBackend, ReadonlyArray<ModelOption>>
>;

export type ModelCatalog = {
  status: ModelCatalogStatus;
  availableModelsByBackend: AvailableModelsByBackend;
};

type ModelCatalogEnv = {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  TAKOS_ALLOWED_MODELS?: string;
  OIDC_ISSUER_URL?: string;
  OIDC_CLIENT_ID?: string;
  ENCRYPTION_KEY?: string;
  TAKOSUMI_ACCOUNTS_URL?: string;
  TAKOSUMI_ACCOUNTS_INTERNAL_URL?: string;
};

type ResolveModelCatalogOptions = {
  currentModel?: string | null;
  fetchImpl?: typeof fetch;
  now?: number;
};

export const SUPPORTED_MODEL_IDS = [
  "gpt-5.5",
  "takosumi/default",
  "deepseek/chat",
  "zai/glm",
  "gemini/chat",
] as const;
export type SupportedModelId = (typeof SUPPORTED_MODEL_IDS)[number];

// These model ids are product-facing aliases that are valid for the Takosumi AI
// Gateway and other OpenAI-compatible endpoints. Direct OpenAI deployments can
// keep using `gpt-5.5`; Gateway deployments set OPENAI_BASE_URL/OPENAI_API_KEY
// and can expose provider aliases such as DeepSeek, GLM, or Gemini without a
// second Takos-specific model backend.
export const OPENAI_COMPATIBLE_MODELS: ReadonlyArray<ModelOption> = [
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    description: "Default direct OpenAI-compatible model",
  },
  {
    id: "takosumi/default",
    name: "Takosumi Default",
    description: "Operator-selected model through Takosumi AI Gateway",
  },
  {
    id: "deepseek/chat",
    name: "DeepSeek Chat",
    description: "OpenAI-compatible alias through Takosumi AI Gateway",
  },
  {
    id: "zai/glm",
    name: "Z.AI GLM",
    description: "OpenAI-compatible alias through Takosumi AI Gateway",
  },
  {
    id: "gemini/chat",
    name: "Gemini Chat",
    description: "OpenAI-compatible alias through Takosumi AI Gateway",
  },
];

export const OPENAI_MODELS = OPENAI_COMPATIBLE_MODELS;

export const TAKOSUMI_GATEWAY_DEFAULT_MODEL_ID = "takosumi/default";

export const AVAILABLE_MODELS_BY_BACKEND: AvailableModelsByBackend = {
  openai: OPENAI_COMPATIBLE_MODELS,
  anthropic: [],
  google: [],
};

export const DEFAULT_MODEL_ID = OPENAI_MODELS[0].id;

export function normalizeModelId(model?: string | null): string | null {
  if (!model) return null;
  const normalized = model.toLowerCase().trim();
  return /^[a-z0-9][a-z0-9._:/-]{0,127}$/.test(normalized) ? normalized : null;
}

export function getModelBackend(model: string): ModelBackend {
  const normalized = model.toLowerCase().trim();
  if (normalized.startsWith("gpt-")) {
    return "openai";
  }
  if (normalized.startsWith("claude-")) {
    return "anthropic";
  }
  if (normalized.startsWith("gemini-")) {
    return "google";
  }
  return "openai";
}

const MODEL_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const modelCatalogCache = new Map<
  string,
  { expiresAt: number; catalog: ModelCatalog }
>();

export function clearModelCatalogCacheForTests(): void {
  modelCatalogCache.clear();
}

function modelCatalogCacheKey(env: ModelCatalogEnv): string {
  return JSON.stringify({
    baseUrl: env.OPENAI_BASE_URL?.trim() || "",
    allowed: env.TAKOS_ALLOWED_MODELS?.trim() || "",
  });
}

function withFallbackSource(
  option: ModelOption,
  source: ModelCatalogSource = "fallback",
): ModelOption {
  return { ...option, source };
}

function fallbackModels(env: ModelCatalogEnv): ReadonlyArray<ModelOption> {
  if (!usesTakosumiManagedAiGateway(env)) return OPENAI_COMPATIBLE_MODELS;

  const allowed = parseAllowedModels(env.TAKOS_ALLOWED_MODELS);
  if (!allowed) {
    return OPENAI_COMPATIBLE_MODELS.filter(
      (option) => option.id === TAKOSUMI_GATEWAY_DEFAULT_MODEL_ID,
    );
  }
  allowed.add(TAKOSUMI_GATEWAY_DEFAULT_MODEL_ID);
  return OPENAI_COMPATIBLE_MODELS.filter((option) => allowed.has(option.id));
}

function fallbackModelCatalog(
  status: ModelCatalogStatus,
  env: ModelCatalogEnv,
): ModelCatalog {
  return {
    status,
    availableModelsByBackend: {
      openai: fallbackModels(env).map((option) => withFallbackSource(option)),
      anthropic: [],
      google: [],
    },
  };
}

function nonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** True when runs obtain a short-lived credential from Takosumi Accounts. */
export function usesTakosumiManagedAiGateway(env: ModelCatalogEnv): boolean {
  return (
    !nonEmpty(env.OPENAI_API_KEY) &&
    nonEmpty(env.OIDC_ISSUER_URL) &&
    nonEmpty(env.OIDC_CLIENT_ID) &&
    nonEmpty(env.ENCRYPTION_KEY) &&
    (nonEmpty(env.TAKOSUMI_ACCOUNTS_URL) ||
      nonEmpty(env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ||
      nonEmpty(env.OIDC_ISSUER_URL))
  );
}

/** Resolve a saved/requested model against the credential path used at run time. */
export function resolveExecutionModel(
  env: ModelCatalogEnv,
  requestedModel?: string | null,
): string {
  const normalized = normalizeModelId(requestedModel) ?? DEFAULT_MODEL_ID;
  if (!usesTakosumiManagedAiGateway(env)) return normalized;
  if (normalized === TAKOSUMI_GATEWAY_DEFAULT_MODEL_ID) return normalized;

  const allowed = parseAllowedModels(env.TAKOS_ALLOWED_MODELS);
  return allowed?.has(normalized)
    ? normalized
    : TAKOSUMI_GATEWAY_DEFAULT_MODEL_ID;
}

function parseAllowedModels(value?: string | null): Set<string> | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  let parts: unknown[];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      parts = Array.isArray(parsed) ? parsed : [];
    } catch {
      parts = [];
    }
  } else {
    parts = raw.split(",");
  }

  const allowed = new Set<string>();
  for (const part of parts) {
    if (typeof part !== "string") continue;
    const normalized = normalizeModelId(part);
    if (normalized) allowed.add(normalized);
  }
  return allowed.size > 0 ? allowed : null;
}

function openAiModelsUrl(baseUrl?: string): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return "https://api.openai.com/v1/models";

  const parsed = new URL(trimmed);
  if (parsed.username || parsed.password) {
    throw new Error("OPENAI_BASE_URL must not embed credentials");
  }
  const normalized = parsed.toString().replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) {
    return `${normalized.slice(0, -"/chat/completions".length)}/models`;
  }
  if (normalized.endsWith("/models")) {
    return normalized;
  }
  return `${normalized}/models`;
}

function isDirectOpenAiChatModel(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  if (
    normalized.includes("embedding") ||
    normalized.includes("moderation") ||
    normalized.includes("tts") ||
    normalized.includes("transcribe") ||
    normalized.includes("whisper") ||
    normalized.includes("image") ||
    normalized.includes("realtime")
  ) {
    return false;
  }
  return (
    normalized.startsWith("gpt-") ||
    /^o[0-9]/.test(normalized) ||
    normalized.startsWith("chatgpt-")
  );
}

function modelDisplayName(modelId: string): string {
  const fallback = OPENAI_COMPATIBLE_MODELS.find(
    (model) => model.id === modelId,
  );
  if (fallback) return fallback.name;
  return modelId
    .split(/[._:/-]+/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 3
        ? part.toUpperCase()
        : part[0].toUpperCase() + part.slice(1),
    )
    .join(" ");
}

function normalizeFetchedModels(
  body: unknown,
  source: ModelCatalogSource,
  allowedModels: Set<string> | null,
  trustGatewayCatalog: boolean,
): ModelOption[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  const seen = new Set<string>();
  const out: ModelOption[] = [];
  for (const entry of data) {
    const rawId =
      typeof entry === "string" ? entry : (entry as { id?: unknown })?.id;
    const id = normalizeModelId(typeof rawId === "string" ? rawId : null);
    if (!id || seen.has(id)) continue;
    if (allowedModels && !allowedModels.has(id)) continue;
    if (!trustGatewayCatalog && !isDirectOpenAiChatModel(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: modelDisplayName(id),
      source,
    });
  }
  return out;
}

function withCurrentModel(
  catalog: ModelCatalog,
  currentModel?: string | null,
): ModelCatalog {
  const model = normalizeModelId(currentModel);
  if (!model) return catalog;
  const models = catalog.availableModelsByBackend.openai;
  if (models.some((option) => option.id === model)) return catalog;
  return {
    ...catalog,
    availableModelsByBackend: {
      ...catalog.availableModelsByBackend,
      openai: [
        {
          id: model,
          name: modelDisplayName(model),
          description: "Saved model is not in the current model catalog",
          source: "fallback",
          disabled: true,
        },
        ...models,
      ],
    },
  };
}

export async function resolveModelCatalog(
  env: ModelCatalogEnv,
  options: ResolveModelCatalogOptions = {},
): Promise<ModelCatalog> {
  const now = options.now ?? Date.now();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const key = modelCatalogCacheKey(env);
  const cached = modelCatalogCache.get(key);
  const withCurrent = (catalog: ModelCatalog) =>
    withCurrentModel(catalog, options.currentModel);

  if (cached && cached.expiresAt > now) {
    return withCurrent({ ...cached.catalog, status: "cached" });
  }

  if (!env.OPENAI_API_KEY) {
    const status = usesTakosumiManagedAiGateway(env)
      ? "fallback"
      : "unconfigured";
    return withCurrent(fallbackModelCatalog(status, env));
  }

  try {
    const trustGatewayCatalog = Boolean(env.OPENAI_BASE_URL?.trim());
    const source: ModelCatalogSource = trustGatewayCatalog
      ? "gateway"
      : "models_api";
    const response = await fetchImpl(openAiModelsUrl(env.OPENAI_BASE_URL), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Model catalog API returned ${response.status}`);
    }
    const models = normalizeFetchedModels(
      await response.json(),
      source,
      parseAllowedModels(env.TAKOS_ALLOWED_MODELS),
      trustGatewayCatalog,
    );
    if (models.length === 0) {
      throw new Error("Model catalog API returned no selectable models");
    }
    const catalog: ModelCatalog = {
      status: "fresh",
      availableModelsByBackend: {
        openai: models,
        anthropic: [],
        google: [],
      },
    };
    modelCatalogCache.set(key, {
      expiresAt: now + MODEL_CATALOG_CACHE_TTL_MS,
      catalog,
    });
    return withCurrent(catalog);
  } catch (error) {
    logWarn("Model catalog fetch failed; using fallback catalog", {
      module: "services/agent/model-catalog",
      error: error instanceof Error ? error.message : String(error),
    });
    if (cached) {
      return withCurrent({ ...cached.catalog, status: "cached" });
    }
    return withCurrent(fallbackModelCatalog("fallback", env));
  }
}

export function isModelSelectable(
  catalog: Pick<ModelCatalog, "availableModelsByBackend">,
  model: string,
): boolean {
  const normalized = normalizeModelId(model);
  if (!normalized) return false;
  return catalog.availableModelsByBackend.openai.some(
    (option) => option.id === normalized && !option.disabled,
  );
}

// --- Model token limits ---

/** Max input token limits per model (used to dynamically size conversation history) */
export const MODEL_TOKEN_LIMITS: Readonly<Record<string, number>> = {
  "gpt-5.5": 128_000,
  "takosumi/default": 128_000,
  "deepseek/chat": 128_000,
  "zai/glm": 128_000,
  "gemini/chat": 128_000,
};

const DEFAULT_TOKEN_LIMIT = 32_768;

/** Reserved tokens: system prompt + tool definitions + completion + safety margin */
const RESERVED_TOKENS = 16_000;

export function getModelTokenLimit(model: string): number {
  return MODEL_TOKEN_LIMITS[model] ?? DEFAULT_TOKEN_LIMIT;
}

/**
 * Resolve the token budget available for conversation history.
 * `envOverrides` is a JSON string like `{"gpt-5.5":200000}` from env var MODEL_CONTEXT_WINDOWS.
 */
export function resolveHistoryTokenBudget(
  model: string,
  envOverrides?: string | null,
): number {
  let limit = MODEL_TOKEN_LIMITS[model] ?? DEFAULT_TOKEN_LIMIT;
  if (envOverrides) {
    try {
      const overrides = JSON.parse(envOverrides) as Record<string, unknown>;
      const val = overrides[model];
      if (typeof val === "number" && val > 0) limit = val;
    } catch (error) {
      logWarn("Invalid MODEL_CONTEXT_WINDOWS ignored", {
        module: "services/agent/model-catalog",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return Math.max(limit - RESERVED_TOKENS, 4_000);
}
