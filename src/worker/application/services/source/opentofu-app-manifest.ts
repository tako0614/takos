import type { AppManifest } from "./app-manifest-types.ts";
import { parseAppManifestObject } from "./app-manifest-parser/index.ts";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonRecord = Record<string, JsonValue>;

type OpenTofuOutput = {
  sensitive?: boolean;
  type?: JsonValue;
  value?: JsonValue;
};

type OpenTofuOutputs = Record<string, OpenTofuOutput>;

const APP_MANIFEST_OUTPUT_KEYS = [
  "takos_app_manifest",
  "takos_app",
] as const;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpenTofuOutput(value: unknown): value is OpenTofuOutput {
  return isJsonRecord(value) && Object.hasOwn(value, "value");
}

function isOpenTofuOutputMap(value: unknown): value is OpenTofuOutputs {
  if (!isJsonRecord(value)) return false;
  return Object.values(value).some(isOpenTofuOutput);
}

function parseJsonInput(raw: string | unknown, source: string): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `${source} must be JSON from 'tofu output -json': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function selectAppManifestOutput(
  outputs: OpenTofuOutputs,
  source: string,
): JsonValue {
  for (const key of APP_MANIFEST_OUTPUT_KEYS) {
    const output = outputs[key];
    if (!output) continue;
    if (output.sensitive) {
      throw new Error(`${source}.${key} must not be a sensitive OpenTofu output`);
    }
    if (output.value == null) {
      throw new Error(`${source}.${key}.value is required`);
    }
    return output.value;
  }

  throw new Error(
    `${source} must include an OpenTofu output named ${APP_MANIFEST_OUTPUT_KEYS.join(" or ")}`,
  );
}

export function parseOpenTofuAppManifestOutputs(
  raw: string | unknown,
  source = "OpenTofu outputs",
): AppManifest {
  const parsed = parseJsonInput(raw, source);
  const manifestValue = isOpenTofuOutputMap(parsed)
    ? selectAppManifestOutput(parsed, source)
    : parsed;

  return parseAppManifestObject(manifestValue);
}

export { APP_MANIFEST_OUTPUT_KEYS };
