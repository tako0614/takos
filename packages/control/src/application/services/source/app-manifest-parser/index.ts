// ============================================================
// app-manifest-parser/index.ts
// ============================================================
//
// Flat-schema manifest parser entry point (Phase 1).
//
// Reads a YAML string, parses the top-level flat schema, and
// returns an `AppManifest`. The old envelope schema
// (`apiVersion/kind/metadata/spec`) is explicitly rejected.
//
// Top-level fields:
//   - name       (required)
//   - version    (optional — semver if present)
//   - compute    (required shape)
//   - routes     (optional)
//   - publish    (optional)
//   - env        (optional — flat Record<string, string>)
//   - overrides  (optional)
//
// This file owns orchestration only — individual sections are
// implemented in parse-compute.ts, parse-publish.ts, and parse-routes.ts.
// ============================================================

import YAML from "yaml";
import type {
  AppManifest,
  AppManifestOverride,
} from "../app-manifest-types.ts";
import {
  asRecord,
  asRequiredString,
  asString,
  asStringMap,
} from "../app-manifest-utils.ts";
import { validateSemver } from "./parse-common.ts";
import { parseCompute } from "./parse-compute.ts";
import { parsePublish } from "./parse-publish.ts";
import { parseRoutes } from "./parse-routes.ts";

const ENVELOPE_FIELDS = ["apiVersion", "kind", "metadata", "spec"] as const;

function rejectEnvelope(record: Record<string, unknown>): void {
  for (const field of ENVELOPE_FIELDS) {
    if (record[field] !== undefined) {
      throw new Error(
        "Kubernetes-style manifest envelope is no longer supported. Use flat top-level schema.",
      );
    }
  }
}

function rejectRetiredFields(
  record: Record<string, unknown>,
  prefix = "",
): void {
  const base = prefix ? `${prefix}.` : "";
  if (record.scopes != null) {
    throw new Error(
      `${base}scopes is retired. Use top-level publish + compute.<name>.consume instead.`,
    );
  }
  if (record.oauth != null) {
    throw new Error(
      `${base}oauth is retired. Use top-level publish + compute.<name>.consume instead.`,
    );
  }
  if (record.storage != null) {
    throw new Error(
      `${base}storage is retired. Publish a provider-backed resource and consume its outputs instead.`,
    );
  }
}

function parseOverrides(
  raw: unknown,
): Record<string, AppManifestOverride> | undefined {
  if (raw == null) return undefined;
  const record = asRecord(raw);
  const result: Record<string, AppManifestOverride> = {};
  for (const [envName, envOverrides] of Object.entries(record)) {
    const envRecord = asRecord(envOverrides);
    rejectRetiredFields(envRecord, `overrides.${envName}`);
    const entry: AppManifestOverride = {};
    if (envRecord.compute != null) {
      entry.compute = parseCompute({ compute: envRecord.compute });
    }
    if (envRecord.routes != null) {
      // Routes in overrides are validated against the merged compute
      // at apply time — the override parser cannot resolve compute
      // references in isolation, so we accept a thin shape here.
      entry.routes = parseRoutes(
        { routes: envRecord.routes },
        // Pass an empty compute map; `target` ref validation is deferred
        // to apply-time merge. Phase 2 hooks this up.
        {},
      );
    }
    if (envRecord.publish != null) {
      entry.publish = parsePublish({ publish: envRecord.publish });
    }
    if (envRecord.env != null) {
      const envMap = asStringMap(envRecord.env, `overrides.${envName}.env`);
      if (envMap) entry.env = envMap;
    }
    if (Object.keys(entry).length > 0) {
      result[envName] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function parseAppManifestYaml(raw: string): AppManifest {
  const parsed = YAML.parse(raw);
  const record = asRecord(parsed);

  rejectEnvelope(record);
  rejectRetiredFields(record);

  // --- Top-level scalars ---
  const name = asRequiredString(record.name, "name");
  const version = asString(record.version, "version");
  if (version) {
    validateSemver(version);
  }

  // --- Major sections ---
  const compute = parseCompute(record);
  const routes = parseRoutes(record, compute);
  const publish = parsePublish(record);

  // --- Env (flat Record<string, string>) ---
  const env = asStringMap(record.env, "env") ?? {};

  // --- Overrides ---
  const overrides = parseOverrides(record.overrides);

  // --- depends cross-ref validation ---
  const computeNames = new Set(Object.keys(compute));
  for (const [name, entry] of Object.entries(compute)) {
    if (!entry.depends) continue;
    for (const dep of entry.depends) {
      if (!computeNames.has(dep)) {
        throw new Error(
          `compute.${name}.depends references unknown compute: ${dep}`,
        );
      }
    }
  }

  return {
    name,
    ...(version ? { version } : {}),
    compute,
    routes,
    publish,
    env,
    ...(overrides ? { overrides } : {}),
  };
}

export const parseAppManifestText = parseAppManifestYaml;

// Re-export parsers for any consumers that import them directly
export { parseCompute } from "./parse-compute.ts";
export { parsePublish } from "./parse-publish.ts";
export { parseRoutes } from "./parse-routes.ts";
