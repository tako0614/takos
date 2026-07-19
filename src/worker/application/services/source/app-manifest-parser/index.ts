// ============================================================
// app-manifest-parser/index.ts
// ============================================================
//
// Flat-schema desired-state projection parser entry point.
//
// Reads a YAML string or OpenTofu output value, parses the top-level flat schema, and
// returns an `AppManifest`.
//
// Top-level fields:
//   - contractVersion (optional — deploy contract version, currently 1)
//   - name       (required)
//   - version    (optional — semver if present)
//   - compute    (required shape)
//   - resources  (optional runtime bindings for the flat app contract)
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
import { TAKOS_APP_CONTRACT_VERSION } from "../app-interface-contract.ts";
import {
  asRecord,
  asRequiredString,
  asString,
  asStringMap,
} from "../app-manifest-utils.ts";
import { validateSemver } from "./parse-common.ts";
import { parseCompute, parseComputeOverride } from "./parse-compute.ts";
import { parsePublish, parsePublishOverride } from "./parse-publish.ts";
import { parseResources, parseResourcesOverride } from "./parse-resources.ts";
import { parseRoutes } from "./parse-routes.ts";

export type ParseAppManifestOptions = Record<string, never>;

const TOP_LEVEL_FIELDS = new Set([
  "contractVersion",
  "name",
  "version",
  "compute",
  "resources",
  "routes",
  "publish",
  "env",
  "overrides",
]);

function requireRecord(raw: unknown, field: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${field} must be an object`);
  }
  return raw as Record<string, unknown>;
}

function assertAllowedFields(
  record: Record<string, unknown>,
  prefix: string,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        `${prefix}.${key} is not supported by the override contract`,
      );
    }
  }
}

function parseContractVersion(
  value: unknown,
): typeof TAKOS_APP_CONTRACT_VERSION | undefined {
  if (value == null) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value !== TAKOS_APP_CONTRACT_VERSION
  ) {
    throw new Error(
      `contractVersion must be the number ${TAKOS_APP_CONTRACT_VERSION}`,
    );
  }
  return TAKOS_APP_CONTRACT_VERSION;
}

export function assertAllowedTopLevelFields(record: object): void {
  if (Object.hasOwn(record, "serviceBindings")) {
    throw new Error(
      "serviceBindings is retired; publish a Takosumi Interface and authorize its consumer with InterfaceBinding instead of injecting a control API token into workload env",
    );
  }
  const envelopeFields = ["apiVersion", "kind", "metadata", "spec"];
  const hasEnvelopeField = envelopeFields.some((field) =>
    Object.hasOwn(record, field),
  );
  if (hasEnvelopeField) {
    throw new Error(
      "Takos desired-state projections use the flat contract; remove apiVersion/kind/metadata/spec and put contractVersion, name, compute, routes, publish, env, and overrides at the top level",
    );
  }

  for (const key of Object.keys(record)) {
    if (key === "schema") {
      throw new Error(
        "schema is not supported; use contractVersion = 1 for the deploy contract",
      );
    }
    if (!TOP_LEVEL_FIELDS.has(key)) {
      throw new Error(
        `${key} is not supported by the Capsule desired-state projection contract`,
      );
    }
  }
}

// ============================================================
// Overrides
// ============================================================
//
// Each `overrides.<env>` block is a set of *deltas* layered onto the base
// projection at apply time (see `applyManifestOverrides` in group-state.ts).
// Rather than maintaining a second, weaker projection parser, override sections
// reuse the canonical section parsers in partial mode: required fields such as
// compute `kind`/`image`/`port` and publish `type`/`outputs` may be omitted as
// deltas, while canonicalization, image/build, and file-handler validation run
// uniformly. Cross-reference guards (route targets, compute kind invariants)
// re-run on the merged result, so they are deferred here.
// ============================================================

const OVERRIDE_ENV_FIELDS = new Set([
  "compute",
  "routes",
  "publish",
  "env",
  "resources",
]);

function parseOverrides(
  raw: unknown,
): Record<string, AppManifestOverride> | undefined {
  if (raw == null) return undefined;
  const record = requireRecord(raw, "overrides");
  const result: Record<string, AppManifestOverride> = {};
  for (const [envName, envOverrides] of Object.entries(record)) {
    const envRecord = requireRecord(envOverrides, `overrides.${envName}`);
    assertAllowedFields(envRecord, `overrides.${envName}`, OVERRIDE_ENV_FIELDS);
    const entry: AppManifestOverride = {};
    if (envRecord.compute != null) {
      entry.compute = parseComputeOverride(envRecord.compute);
    }
    if (envRecord.routes != null) {
      // Routes in overrides still defer compute target resolution until
      // apply time, but the parser can safely validate their shape and
      // intra-list uniqueness now.
      entry.routes = parseRoutes(
        { routes: envRecord.routes },
        {},
        { validateTargets: false },
      );
    }
    if (envRecord.publish != null) {
      entry.publish = parsePublishOverride(envRecord.publish);
    }
    if (envRecord.env != null) {
      const envMap = asStringMap(envRecord.env, `overrides.${envName}.env`);
      if (envMap) entry.env = envMap;
    }
    if (envRecord.resources != null) {
      entry.resources = parseResourcesOverride(envRecord.resources);
    }
    if (Object.keys(entry).length > 0) {
      result[envName] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function parseAppManifestRecord(
  record: Record<string, unknown>,
): AppManifest {
  assertAllowedTopLevelFields(record);

  // --- Top-level scalars ---
  const contractVersion = parseContractVersion(record.contractVersion);
  const name = asRequiredString(record.name, "name");
  const version = asString(record.version, "version");
  if (version) {
    validateSemver(version);
  }

  // --- Major sections ---
  const compute = parseCompute(record);
  const resources = parseResources(record, compute);
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
    ...(contractVersion != null ? { contractVersion } : {}),
    name,
    ...(version ? { version } : {}),
    compute,
    resources,
    routes,
    publish,
    env,
    ...(overrides ? { overrides } : {}),
  };
}

export function parseAppManifestObject(raw: unknown): AppManifest {
  return parseAppManifestRecord(asRecord(raw));
}

export function parseAppManifestYaml(
  raw: string,
  _options: ParseAppManifestOptions = {},
): AppManifest {
  return parseAppManifestObject(YAML.parse(raw));
}

export const parseAppManifestText = parseAppManifestYaml;

// Re-export parsers for any consumers that import them directly
export { parseCompute } from "./parse-compute.ts";
export { parsePublish } from "./parse-publish.ts";
export { parseRoutes } from "./parse-routes.ts";
export { assertManifestInputDoesNotUseBuildMetadata } from "./build-metadata.ts";
