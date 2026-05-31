import type { WorkflowDiagnostic } from "takos-actions-engine";

// --- parsing utility helpers ---

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown, _field: string): string | undefined {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized;
}

export function asRequiredString(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

export function asStringArray(
  value: unknown,
  field: string,
): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value.map((entry, index) =>
    asRequiredString(entry, `${field}[${index}]`)
  );
}

export function asStringMap(
  value: unknown,
  field: string,
): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[asRequiredString(key, `${field} key`)] = String(entry ?? "");
  }
  return out;
}

export function asOptionalInteger(
  value: unknown,
  field: string,
  options?: { min?: number },
): number | undefined {
  if (value == null) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    throw new Error(`${field} must be an integer`);
  }
  if (options?.min != null && numeric < options.min) {
    throw new Error(`${field} must be >= ${options.min}`);
  }
  return numeric;
}

export function asOptionalBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

export function normalizeRepoPath(path: string): string {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .trim();
}

export function normalizeRepoRelativePath(path: string, field: string): string {
  const raw = String(path || "").trim();
  if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(raw)) {
    throw new Error(`${field} must be repository-relative`);
  }
  const normalized = normalizeRepoPath(raw);
  const segments = normalized.split("/");
  if (
    !normalized ||
    segments.some((segment) => segment === ".." || segment === ".")
  ) {
    throw new Error(`${field} must not contain path traversal`);
  }
  return normalized;
}

export function filterWorkflowErrors(
  diagnostics: WorkflowDiagnostic[],
): WorkflowDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}
