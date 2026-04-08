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
//   - storage    (optional)
//   - routes     (optional)
//   - publish    (optional)
//   - env        (optional — flat Record<string, string>)
//   - scopes     (optional)
//   - oauth      (optional)
//   - overrides  (optional)
//
// This file owns orchestration only — individual sections are
// implemented in parse-compute.ts, parse-storage.ts, parse-publish.ts,
// and parse-routes.ts.
// ============================================================

import YAML from "yaml";
import type {
  AppManifest,
  AppManifestOverride,
  AppOAuthConfig,
} from "../app-manifest-types.ts";
import {
  asRecord,
  asRequiredString,
  asString,
  asStringArray,
  asStringMap,
} from "../app-manifest-utils.ts";
import { validateSemver } from "./parse-common.ts";
import { parseCompute } from "./parse-compute.ts";
import { parseStorage } from "./parse-storage.ts";
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

function parseOAuth(raw: unknown): AppOAuthConfig | undefined {
  if (raw == null) return undefined;
  const record = asRecord(raw);
  const clientName = asString(record.clientName, "oauth.clientName");
  const redirectUris = asStringArray(
    record.redirectUris,
    "oauth.redirectUris",
  );
  const scopes = asStringArray(record.scopes, "oauth.scopes");
  const autoEnv = record.autoEnv === true ? true : undefined;
  const metadataRaw = record.metadata != null
    ? asRecord(record.metadata)
    : undefined;
  const metadata = metadataRaw
    ? {
      ...((): Record<string, string> => {
        const logoUri = asString(metadataRaw.logoUri, "oauth.metadata.logoUri");
        const tosUri = asString(metadataRaw.tosUri, "oauth.metadata.tosUri");
        const policyUri = asString(
          metadataRaw.policyUri,
          "oauth.metadata.policyUri",
        );
        return {
          ...(logoUri ? { logoUri } : {}),
          ...(tosUri ? { tosUri } : {}),
          ...(policyUri ? { policyUri } : {}),
        };
      })(),
    }
    : undefined;
  const result: AppOAuthConfig = {
    ...(clientName ? { clientName } : {}),
    ...(redirectUris ? { redirectUris } : {}),
    ...(scopes ? { scopes } : {}),
    ...(autoEnv ? { autoEnv } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseOverrides(
  raw: unknown,
): Record<string, AppManifestOverride> | undefined {
  if (raw == null) return undefined;
  const record = asRecord(raw);
  const result: Record<string, AppManifestOverride> = {};
  for (const [envName, envOverrides] of Object.entries(record)) {
    const envRecord = asRecord(envOverrides);
    const entry: AppManifestOverride = {};
    if (envRecord.compute != null) {
      entry.compute = parseCompute({ compute: envRecord.compute });
    }
    if (envRecord.storage != null) {
      entry.storage = parseStorage({ storage: envRecord.storage });
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
    if (envRecord.scopes != null) {
      const scopes = asStringArray(
        envRecord.scopes,
        `overrides.${envName}.scopes`,
      );
      if (scopes) entry.scopes = scopes;
    }
    if (envRecord.oauth != null) {
      const oauth = parseOAuth(envRecord.oauth);
      if (oauth) entry.oauth = oauth;
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

  // --- Top-level scalars ---
  const name = asRequiredString(record.name, "name");
  const version = asString(record.version, "version");
  if (version) {
    validateSemver(version);
  }

  // --- Major sections ---
  const compute = parseCompute(record);
  const storage = parseStorage(record);
  const routes = parseRoutes(record, compute);
  const publish = parsePublish(record);

  // --- Env (flat Record<string, string>) ---
  const env = asStringMap(record.env, "env") ?? {};

  // --- Scopes ---
  const scopes = asStringArray(record.scopes, "scopes") ?? [];

  // --- OAuth ---
  const oauth = parseOAuth(record.oauth);

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

  // --- queue trigger → storage cross-ref validation ---
  for (const [computeName, entry] of Object.entries(compute)) {
    const queueTriggers = entry.triggers?.queues ?? [];
    for (const trigger of queueTriggers) {
      if (storage[trigger.storage]?.type !== "queue") {
        throw new Error(
          `compute.${computeName}.triggers.queues references unknown queue storage: ${trigger.storage}`,
        );
      }
    }
  }

  return {
    name,
    ...(version ? { version } : {}),
    compute,
    storage,
    routes,
    publish,
    env,
    scopes,
    ...(oauth ? { oauth } : {}),
    ...(overrides ? { overrides } : {}),
  };
}

export const parseAppManifestText = parseAppManifestYaml;

// Re-export parsers for any consumers that import them directly
export { parseCompute } from "./parse-compute.ts";
export { parseStorage } from "./parse-storage.ts";
export { parsePublish } from "./parse-publish.ts";
export { parseRoutes } from "./parse-routes.ts";
