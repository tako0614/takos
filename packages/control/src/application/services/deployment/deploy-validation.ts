/**
 * Deploy-time cross-resource validators (kernel-level constraints).
 *
 * This module collects validators that enforce cross-resource invariants on
 * a parsed manifest. They run at the very last moment before any DB write or
 * provider apply, so the deploy fails fast with a clear error message and
 * the caller never sees a partially-applied state.
 *
 * Each validator returns a list of `ValidationError` rather than throwing,
 * so we can aggregate every issue in a single error response. The shared
 * entry point `runDeployValidations` runs them all and `assertDeployValid`
 * throws if anything failed.
 *
 * Validators implemented (per docs `reference/manifest-spec.md` and
 * `architecture/app-publications.md`):
 *
 *   1. validateAttachedNotRouteTarget    — `route.target` references an
 *      attached container instead of a top-level Worker / Service.
 *   2. validateRouteUniqueness           — multiple routes share the same
 *      `path` and have any overlapping HTTP method (full overlap or partial).
 *   3. validateConsumeReferences         — `compute.<name>.consume` references
 *      a missing publication or an unknown output alias key.
 *   4. validateConsumeEnvCollision       — consume env aliases collide within
 *      the same compute or with local/static env names.
 *   5. validatePublicationKnownFields    — known publication type
 *      (`McpServer`, `FileHandler`, `UiSurface`) carries a field that is
 *      not part of its schema (typo / wrong type).
 * The validators operate on the flat `AppManifest` shape produced by the
 * parser (`compute` / `routes` / `publish` / `env`).
 */
import type {
  AppCompute,
  AppManifest,
  AppPublication,
  AppRoute,
} from "../source/app-manifest-types.ts";
import {
  publicationAllowedFields,
  publicationOutputContract,
} from "../platform/service-publications.ts";

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Parsed manifest used by the deploy-time validators.
 *
 * Aliased to `AppManifest` so the validators can be called with the
 * canonical type emitted by `parseAppManifestYaml` without an extra adapter.
 */
export type ParsedManifest = AppManifest;

export type ValidationErrorCode =
  | "attached_not_route_target"
  | "route_duplicate"
  | "consume_unknown_publication"
  | "consume_unknown_output"
  | "consume_env_collision"
  | "publication_unknown_field";

export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  /** Stable JSON path identifier (e.g. `routes[2]`). */
  path: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ALL_HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

/** All top-level compute entries. */
function getTopLevelCompute(
  manifest: ParsedManifest,
): Record<string, AppCompute> {
  return manifest.compute ?? {};
}

/**
 * Return a record of attached-container compute entries (the nested
 * `worker.containers.*` map). Attached containers are keyed by their child
 * name — collisions across workers are still visible to validators so they
 * can flag them.
 */
function getAttachedContainers(
  manifest: ParsedManifest,
): Record<string, AppCompute & { parentWorker: string }> {
  const out: Record<string, AppCompute & { parentWorker: string }> = {};
  for (
    const [workerName, compute] of Object.entries(getTopLevelCompute(manifest))
  ) {
    if (compute.kind !== "worker") continue;
    for (
      const [childName, child] of Object.entries(compute.containers ?? {})
    ) {
      out[childName] = { ...child, parentWorker: workerName };
    }
  }
  return out;
}

function getRoutes(manifest: ParsedManifest): AppRoute[] {
  return manifest.routes ?? [];
}

function getPublications(manifest: ParsedManifest): AppPublication[] {
  return manifest.publish ?? [];
}

type PublicationEntry = {
  path: string;
  publication: AppPublication;
  raw: Record<string, unknown>;
};

function normalizeEnvName(name: string): string {
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw new Error("Environment variable name is required");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid environment variable name: ${normalized}`);
  }
  return normalized.toUpperCase();
}

function collectPublications(manifest: ParsedManifest): PublicationEntry[] {
  return getPublications(manifest).map((pub, index) => ({
    path: `publish[${index}]`,
    publication: pub,
    raw: pub as unknown as Record<string, unknown>,
  }));
}

// ── Validator 1: Attached container as route target ─────────────────────────

export function validateAttachedNotRouteTarget(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const attached = getAttachedContainers(manifest);
  const topLevel = getTopLevelCompute(manifest);
  const routes = getRoutes(manifest);

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const target = route.target;
    if (!target) continue;
    // Acceptable: top-level Worker / Service (not attached).
    const topEntry = topLevel[target];
    if (
      topEntry && (topEntry.kind === "worker" || topEntry.kind === "service")
    ) {
      continue;
    }
    if (attached[target]) {
      errors.push({
        code: "attached_not_route_target",
        path: `routes[${i}]`,
        message:
          `route target '${target}' is an attached container; routes can only target ` +
          `top-level Worker or Service compute. Point the route at the parent worker ` +
          `(declared via 'compute.${
            attached[target].parentWorker
          }.containers.${target}').`,
      });
    }
  }

  return errors;
}

// ── Validator 2: Same path + method route duplicates ────────────────────────

function expandMethods(methods: string[] | undefined): Set<string> {
  if (!methods || methods.length === 0) {
    return new Set(ALL_HTTP_METHODS);
  }
  const set = new Set<string>();
  for (const method of methods) set.add(method.toUpperCase());
  return set;
}

function methodsOverlap(a: Set<string>, b: Set<string>): string[] {
  const overlap: string[] = [];
  for (const m of a) {
    if (b.has(m)) overlap.push(m);
  }
  return overlap;
}

export function validateRouteUniqueness(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const routes = getRoutes(manifest);

  type Bucket = { index: number; path: string; methods: Set<string> };
  const byPath = new Map<string, Bucket[]>();
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    if (!route.path) continue;
    const bucket = byPath.get(route.path) ?? [];
    bucket.push({
      index: i,
      path: route.path,
      methods: expandMethods(route.methods),
    });
    byPath.set(route.path, bucket);
  }

  for (const bucket of byPath.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const overlap = methodsOverlap(bucket[i].methods, bucket[j].methods);
        if (overlap.length === 0) continue;
        errors.push({
          code: "route_duplicate",
          path: `routes[${bucket[j].index}]`,
          message:
            `route at path '${bucket[j].path}' duplicates routes[${
              bucket[i].index
            }] ` +
            `for method(s) ${
              overlap.sort().join(", ")
            }; either separate the methods ` +
            `(e.g. one route for [GET], another for [POST]) or remove the duplicate.`,
        });
      }
    }
  }

  return errors;
}

// ── Validator 3: Consume references ─────────────────────────────────────────

function collectPublicationMap(
  manifest: ParsedManifest,
): Map<string, AppPublication> {
  return new Map(
    getPublications(manifest).map((
      publication,
    ) => [publication.name, publication]),
  );
}

export function validateConsumeReferences(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const publicationMap = collectPublicationMap(manifest);
  for (
    const [computeName, compute] of Object.entries(getTopLevelCompute(manifest))
  ) {
    for (const [index, consume] of (compute.consume ?? []).entries()) {
      const publication = publicationMap.get(consume.publication);
      if (!publication) {
        errors.push({
          code: "consume_unknown_publication",
          path: `compute.${computeName}.consume[${index}]`,
          message:
            `consume references unknown publication '${consume.publication}'. Declare it in top-level publish first.`,
        });
        continue;
      }
      const outputs = new Set(
        publicationOutputContract(publication).map((entry) => entry.name),
      );
      for (const key of Object.keys(consume.env ?? {})) {
        if (outputs.has(key)) continue;
        errors.push({
          code: "consume_unknown_output",
          path: `compute.${computeName}.consume[${index}].env.${key}`,
          message:
            `publication '${consume.publication}' does not expose output '${key}'. Known outputs: ${
              Array.from(outputs).sort().join(", ")
            }.`,
        });
      }
    }
  }
  return errors;
}

// ── Validator 4: Consume env collision ──────────────────────────────────────

export function validateConsumeEnvCollision(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const publicationMap = collectPublicationMap(manifest);
  const topLevelEnvNames = new Set(
    Object.keys(manifest.env ?? {}).map((name) => normalizeEnvName(name)),
  );

  for (
    const [computeName, compute] of Object.entries(getTopLevelCompute(manifest))
  ) {
    const seen = new Set<string>([
      ...topLevelEnvNames,
      ...Object.keys(compute.env ?? {}).map((name) => normalizeEnvName(name)),
    ]);
    for (const [index, consume] of (compute.consume ?? []).entries()) {
      const publication = publicationMap.get(consume.publication);
      if (!publication) continue;
      for (const output of publicationOutputContract(publication)) {
        const envName = normalizeEnvName(
          consume.env?.[output.name] ?? output.defaultEnv,
        );
        if (seen.has(envName)) {
          errors.push({
            code: "consume_env_collision",
            path: `compute.${computeName}.consume[${index}]`,
            message:
              `consume '${consume.publication}' resolves env '${envName}' which already exists in compute '${computeName}'. Pick a different alias or remove the conflicting env/bind.`,
          });
          continue;
        }
        seen.add(envName);
      }
    }
  }
  return errors;
}

// ── Validator 5: Publication unknown field ──────────────────────────────────

export function validatePublicationKnownFields(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const pub of collectPublications(manifest)) {
    const allowed = publicationAllowedFields(pub.publication);
    for (const key of Object.keys(pub.raw)) {
      if (allowed.has(key)) continue;
      errors.push({
        code: "publication_unknown_field",
        path: `${pub.path}.${key}`,
        message:
          `publication '${pub.publication.name}' has unknown field '${key}'. ` +
          `Known fields: ${Array.from(allowed).sort().join(", ")}.`,
      });
    }
  }
  return errors;
}

// ── Aggregate entry points ──────────────────────────────────────────────────

export function runDeployValidations(
  manifest: ParsedManifest,
): ValidationError[] {
  return [
    ...validateAttachedNotRouteTarget(manifest),
    ...validateRouteUniqueness(manifest),
    ...validateConsumeReferences(manifest),
    ...validateConsumeEnvCollision(manifest),
    ...validatePublicationKnownFields(manifest),
  ];
}

export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return "";
  const header = errors.length === 1
    ? "Deploy validation failed:"
    : `Deploy validation failed (${errors.length} errors):`;
  const lines = errors.map((err) =>
    `  - [${err.code}] ${err.path}: ${err.message}`
  );
  return [header, ...lines].join("\n");
}

export function assertDeployValid(manifest: ParsedManifest): void {
  const errors = runDeployValidations(manifest);
  if (errors.length === 0) return;
  const err = new Error(formatValidationErrors(errors));
  (err as Error & { details?: { errors: ValidationError[] } }).details = {
    errors,
  };
  throw err;
}
