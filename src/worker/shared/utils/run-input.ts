import { stringifyCanonicalJson } from "./canonical-json.ts";

export const MAX_RUN_INPUT_BYTES = 64 * 1024;

export type RunInputCapsuleContext = {
  capsuleId?: string;
  runtimeNamespace?: string;
};

export function stringifyBoundedRunInput(
  input: Record<string, unknown> | undefined,
): string | null {
  try {
    const serialized = stringifyCanonicalJson(input || {});
    if (serialized === undefined) return null;
    return new TextEncoder().encode(serialized).byteLength <=
        MAX_RUN_INPUT_BYTES
      ? serialized
      : null;
  } catch {
    return null;
  }
}

export function readRunInputCapsuleContext(
  input: string | null | undefined,
): RunInputCapsuleContext {
  if (!input) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return {};
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
  ) {
    return {};
  }
  const source = parsed as Record<string, unknown>;
  const readString = (keys: readonly string[]): string | undefined => {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
  };
  const readNestedString = (path: readonly string[]): string | undefined => {
    let current: unknown = source;
    for (const segment of path) {
      if (
        typeof current !== "object" || current === null ||
        Array.isArray(current)
      ) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return typeof current === "string" && current.trim()
      ? current.trim()
      : undefined;
  };

  const capsuleId = readString(["capsule_id"]);
  const runtimeNamespace = readString([
    "runtimeNamespace",
    "runtime_namespace",
    "runtimeTargetId",
    "runtime_target_id",
  ]) ??
    readNestedString(["runtime", "namespace"]) ??
    readNestedString(["runtime", "targetId"]) ??
    readNestedString(["runtimeBinding", "targetId"]) ??
    readNestedString(["runtimeBinding", "target_id"]);

  return {
    ...(capsuleId ? { capsuleId } : {}),
    ...(runtimeNamespace ? { runtimeNamespace } : {}),
  };
}
