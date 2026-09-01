import type { ModelSelectOption } from "./modelCatalog.ts";

export type ModelBackend = "openai" | "anthropic" | "google";
export type ModelCatalogStatus =
  | "fresh"
  | "cached"
  | "fallback"
  | "unconfigured";

export interface ModelSettingsResponse {
  model: string;
  modelBackend: ModelBackend;
  availableModels: Record<ModelBackend, ModelSelectOption[]>;
  catalogStatus: ModelCatalogStatus;
  tokenLimit: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Invalid model settings ${field}`);
  }
  return value.trim();
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`Invalid model settings ${field}`);
  }
  return value;
}

function readModelOption(value: unknown): ModelSelectOption {
  if (typeof value === "string") {
    const id = readNonEmptyString(value, "model id");
    return { id, label: id };
  }
  if (!isRecord(value)) {
    throw new TypeError("Invalid model settings option");
  }

  const id = readNonEmptyString(value.id, "model id");
  const name = readOptionalString(value.name, "model name")?.trim();
  const description = readOptionalString(
    value.description,
    "model description",
  );
  const source = value.source;
  if (
    source !== undefined && source !== "models_api" && source !== "gateway" &&
    source !== "fallback"
  ) {
    throw new TypeError("Invalid model settings source");
  }
  if (value.disabled !== undefined && typeof value.disabled !== "boolean") {
    throw new TypeError("Invalid model settings disabled flag");
  }

  return {
    id,
    label: name || id,
    description,
    source,
    disabled: value.disabled,
  };
}

function readModelOptions(
  value: unknown,
  backend: ModelBackend,
): ModelSelectOption[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Invalid model settings ${backend} catalog`);
  }
  const options = value.map(readModelOption);
  if (new Set(options.map((option) => option.id)).size !== options.length) {
    throw new TypeError(`Duplicate model settings ${backend} model`);
  }
  return options;
}

/**
 * Fail-closed projection for the Workspace model endpoint. The endpoint is an
 * operator policy surface, so malformed or stale-shaped data must never fall
 * back to a client-authored list that the runtime may reject.
 */
export function readModelSettingsResponse(
  value: unknown,
): ModelSettingsResponse {
  if (!isRecord(value)) {
    throw new TypeError("Invalid model settings response");
  }

  const aiModel = value.ai_model === undefined
    ? undefined
    : readNonEmptyString(value.ai_model, "ai_model");
  const modelAlias = value.model === undefined
    ? undefined
    : readNonEmptyString(value.model, "model");
  if (!aiModel && !modelAlias) {
    throw new TypeError("Invalid model settings model");
  }
  if (aiModel && modelAlias && aiModel !== modelAlias) {
    throw new TypeError("Conflicting model settings model aliases");
  }
  const model = aiModel ?? modelAlias!;

  const modelBackend = value.model_backend;
  if (
    modelBackend !== "openai" && modelBackend !== "anthropic" &&
    modelBackend !== "google"
  ) {
    throw new TypeError("Invalid model settings backend");
  }
  if (!isRecord(value.available_models)) {
    throw new TypeError("Invalid model settings catalog");
  }
  const availableModels = {
    openai: readModelOptions(value.available_models.openai, "openai"),
    anthropic: readModelOptions(
      value.available_models.anthropic,
      "anthropic",
    ),
    google: readModelOptions(value.available_models.google, "google"),
  };
  const selected = availableModels[modelBackend].find((option) =>
    option.id === model
  );
  if (!selected || selected.disabled) {
    throw new TypeError("Selected model is not available");
  }

  const catalogStatus = value.catalog_status;
  if (
    catalogStatus !== "fresh" && catalogStatus !== "cached" &&
    catalogStatus !== "fallback" && catalogStatus !== "unconfigured"
  ) {
    throw new TypeError("Invalid model settings catalog status");
  }
  const tokenLimit = value.token_limit;
  if (
    typeof tokenLimit !== "number" || !Number.isSafeInteger(tokenLimit) ||
    tokenLimit <= 0
  ) {
    throw new TypeError("Invalid model settings token limit");
  }

  return {
    model,
    modelBackend,
    availableModels,
    catalogStatus,
    tokenLimit,
  };
}
