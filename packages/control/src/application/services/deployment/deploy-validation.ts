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
 *   1. validateBindingsWorkerOnly        — object-typed storage bind
 *      (`sql`, `object-store`, `key-value`, `queue`, `vector-index`,
 *      `workflow`, `durable-object`, `analytics-engine`) targets
 *      Service / Attached Container.
 *   2. validateAttachedNotRouteTarget    — `route.target` references an
 *      attached container instead of a top-level Worker / Service.
 *   3. validateRouteUniqueness           — multiple routes share the same
 *      `path` and have any overlapping HTTP method (full overlap or partial).
 *   4. validatePublicationEnvCollision   — multiple publications would
 *      generate the same `TAKOS_*_*_URL` env name within the same layer.
 *   5. validatePublicationKnownFields    — known publication type
 *      (`McpServer`, `FileHandler`, `UiSurface`) carries a field that is
 *      not part of its schema (typo / wrong type).
 *   6. validateAppTokenImmutable         — top-level or per-compute env
 *      tries to override the kernel-injected `TAKOS_APP_TOKEN`.
 *
 * The validators operate on the flat `AppManifest` shape produced by the
 * parser (`compute` / `storage` / `routes` / `publish` / `env` / `scopes`).
 */
import type {
  AppCompute,
  AppManifest,
  AppPublication,
  AppRoute,
  AppStorage,
  StorageType,
} from "../source/app-manifest-types.ts";

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Parsed manifest used by the deploy-time validators.
 *
 * Aliased to `AppManifest` so the validators can be called with the
 * canonical type emitted by `parseAppManifestYaml` without an extra adapter.
 */
export type ParsedManifest = AppManifest;

export type ValidationErrorCode =
  | "binding_worker_only"
  | "attached_not_route_target"
  | "route_duplicate"
  | "publication_env_collision"
  | "publication_unknown_field"
  | "app_token_immutable";

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
  for (const [workerName, compute] of Object.entries(getTopLevelCompute(manifest))) {
    if (compute.kind !== "worker") continue;
    for (
      const [childName, child] of Object.entries(compute.containers ?? {})
    ) {
      out[childName] = { ...child, parentWorker: workerName };
    }
  }
  return out;
}

function getServices(
  manifest: ParsedManifest,
): Record<string, AppCompute> {
  return Object.fromEntries(
    Object.entries(getTopLevelCompute(manifest)).filter(
      ([, compute]) => compute.kind === "service",
    ),
  );
}

function getStorage(
  manifest: ParsedManifest,
): Record<string, AppStorage> {
  return manifest.storage ?? {};
}

function getRoutes(manifest: ParsedManifest): AppRoute[] {
  return manifest.routes ?? [];
}

function getPublications(manifest: ParsedManifest): AppPublication[] {
  return manifest.publish ?? [];
}

/**
 * Normalize a name to the env-var segment used by the publication injector
 * (uppercase, hyphen → underscore).
 */
function normalizeEnvSegment(value: string): string {
  return value.replace(/-/g, "_").toUpperCase();
}

interface PublicationEntry {
  /** Path inside `manifest` for diagnostics. */
  path: string;
  type: string;
  name?: string;
  raw: Record<string, unknown>;
}

function collectPublications(manifest: ParsedManifest): PublicationEntry[] {
  const out: PublicationEntry[] = [];
  const publications = getPublications(manifest);
  for (let i = 0; i < publications.length; i++) {
    const pub = publications[i];
    out.push({
      path: `publish[${i}]`,
      type: pub.type,
      ...(pub.name ? { name: pub.name } : {}),
      raw: pub as unknown as Record<string, unknown>,
    });
  }
  return out;
}

// ── Validator 1: Storage bind "Worker only" ──────────────────────────────────

/**
 * Object-typed storage produces a non-string binding on the compute side
 * (D1 database handle, R2 bucket handle, ...). These are only supported on
 * Workers. Only `secret` storage produces a plain string env var, which is
 * legal on every compute kind.
 */
function isObjectBindingStorageType(type: StorageType): boolean {
  switch (type) {
    case "sql":
    case "object-store":
    case "key-value":
    case "queue":
    case "vector-index":
    case "workflow":
    case "durable-object":
    case "analytics-engine":
      return true;
    case "secret":
      return false;
  }
}

/**
 * In the flat schema the binding direction is flipped: storage declares
 * `bind` (the env name), and compute implicitly receives every storage bind
 * whose kind it is compatible with. For the Worker-only validator, the rule
 * we enforce is: if any Service or Attached-container compute depends on a
 * storage with an object-typed binding, flag the storage (since the storage
 * declaration is what "chose" the binding direction).
 *
 * Currently the parser does not track explicit storage-to-compute wiring,
 * so the validator walks the `env`-derived binding namespace and flags any
 * storage whose declared `bind` collides with a Service/Attached compute's
 * explicit env map (indicating the author tried to wire it manually).
 */
export function validateBindingsWorkerOnly(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const storage = getStorage(manifest);
  const services = getServices(manifest);
  const attached = getAttachedContainers(manifest);

  const violatingComputes: Array<
    { kind: "service" | "attached-container"; name: string; env?: Record<string, string> }
  > = [];
  for (const [name, service] of Object.entries(services)) {
    violatingComputes.push({ kind: "service", name, env: service.env });
  }
  for (const [name, container] of Object.entries(attached)) {
    violatingComputes.push({
      kind: "attached-container",
      name,
      env: container.env,
    });
  }

  for (const [storageName, storageEntry] of Object.entries(storage)) {
    if (!isObjectBindingStorageType(storageEntry.type)) continue;
    const bindName = storageEntry.bind;
    if (!bindName) continue;
    for (const compute of violatingComputes) {
      if (!compute.env) continue;
      if (!(bindName in compute.env)) continue;
      errors.push({
        code: "binding_worker_only",
        path: `storage.${storageName}`,
        message:
          `compute '${compute.name}' (${compute.kind}) cannot bind storage '${storageName}' (type '${storageEntry.type}'); ` +
          `object-typed bindings are Worker-only. Bind it to a Worker compute instead, ` +
          `or change the storage type to 'secret' if a string env is acceptable.`,
      });
    }
  }

  return errors;
}

// ── Validator 2: Attached container as route target ─────────────────────────

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
          `(declared via 'compute.${attached[target].parentWorker}.containers.${target}').`,
      });
    }
  }

  return errors;
}

// ── Validator 3: Same path + method route duplicates ────────────────────────

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
            `route at path '${bucket[j].path}' duplicates routes[${bucket[i].index}] ` +
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

// ── Validator 4: Publication env collision ──────────────────────────────────

function publicationEnvName(
  groupName: string,
  pub: PublicationEntry,
  needsName: boolean,
): string {
  const segments = [
    "TAKOS",
    normalizeEnvSegment(groupName),
    normalizeEnvSegment(pub.type),
  ];
  if (needsName && pub.name) {
    segments.push(normalizeEnvSegment(pub.name));
  }
  segments.push("URL");
  return segments.join("_");
}

export function validatePublicationEnvCollision(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const groupName = manifest.name ?? "GROUP";
  const publications = collectPublications(manifest);

  const countByType = new Map<string, number>();
  for (const pub of publications) {
    countByType.set(pub.type, (countByType.get(pub.type) ?? 0) + 1);
  }

  const seen = new Map<string, PublicationEntry>();
  for (const pub of publications) {
    const needsName = (countByType.get(pub.type) ?? 0) > 1;
    if (needsName && !pub.name) {
      errors.push({
        code: "publication_env_collision",
        path: pub.path,
        message:
          `publication of type '${pub.type}' is declared more than once but is missing 'name'; ` +
          `add a unique 'name' to each duplicate so the injector can build distinct ` +
          `TAKOS_${normalizeEnvSegment(groupName)}_${
            normalizeEnvSegment(pub.type)
          }_<NAME>_URL env vars.`,
      });
      continue;
    }
    const envName = publicationEnvName(groupName, pub, needsName);
    const previous = seen.get(envName);
    if (previous) {
      errors.push({
        code: "publication_env_collision",
        path: pub.path,
        message:
          `publication '${pub.type}${
            pub.name ? `:${pub.name}` : ""
          }' would inject env ` +
          `'${envName}' which already comes from ${previous.path}; pick distinct 'name' ` +
          `values for each publication of the same type within the same group.`,
      });
      continue;
    }
    seen.set(envName, pub);
  }

  return errors;
}

// ── Validator 5: Publication unknown field ──────────────────────────────────

const PUBLICATION_KNOWN_FIELDS: Record<string, ReadonlySet<string>> = {
  McpServer: new Set([
    "type",
    "name",
    "path",
    "transport",
    "authSecretRef",
    "title",
  ]),
  FileHandler: new Set([
    "type",
    "name",
    "path",
    "mimeTypes",
    "extensions",
    "title",
  ]),
  UiSurface: new Set([
    "type",
    "name",
    "path",
    "title",
    "icon",
  ]),
};

export function validatePublicationKnownFields(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const pub of collectPublications(manifest)) {
    const allowed = PUBLICATION_KNOWN_FIELDS[pub.type];
    if (!allowed) continue;
    for (const key of Object.keys(pub.raw)) {
      if (allowed.has(key)) continue;
      errors.push({
        code: "publication_unknown_field",
        path: `${pub.path}.${key}`,
        message:
          `publication of type '${pub.type}' has unknown field '${key}'. ` +
          `Known fields: ${Array.from(allowed).sort().join(", ")}. ` +
          `Remove the field or fix the typo (kernel does not interpret type semantics, ` +
          `but enforces a known schema for built-in publication types).`,
      });
    }
  }
  return errors;
}

// ── Validator 6: App token immutable ────────────────────────────────────────

const APP_TOKEN_ENV = "TAKOS_APP_TOKEN";

function checkEnvForAppToken(
  envVars: Record<string, string> | undefined,
  path: string,
): ValidationError[] {
  if (!envVars) return [];
  if (!Object.prototype.hasOwnProperty.call(envVars, APP_TOKEN_ENV)) return [];
  return [{
    code: "app_token_immutable",
    path: `${path}.${APP_TOKEN_ENV}`,
    message:
      `'${APP_TOKEN_ENV}' is reserved and injected by the kernel for every compute; ` +
      `it cannot be set via top-level env or compute env. Remove the override.`,
  }];
}

export function validateAppTokenImmutable(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Top-level `env` (flat Record<string, string>).
  errors.push(...checkEnvForAppToken(manifest.env, "env"));

  // Per-compute env (top-level compute).
  for (const [name, compute] of Object.entries(getTopLevelCompute(manifest))) {
    errors.push(
      ...checkEnvForAppToken(compute.env, `compute.${name}.env`),
    );
  }

  // Attached-container env (nested under workers).
  for (const [name, container] of Object.entries(getAttachedContainers(manifest))) {
    errors.push(
      ...checkEnvForAppToken(
        container.env,
        `compute.${container.parentWorker}.containers.${name}.env`,
      ),
    );
  }

  return errors;
}

// ── Aggregate entry points ──────────────────────────────────────────────────

export function runDeployValidations(
  manifest: ParsedManifest,
): ValidationError[] {
  return [
    ...validateBindingsWorkerOnly(manifest),
    ...validateAttachedNotRouteTarget(manifest),
    ...validateRouteUniqueness(manifest),
    ...validatePublicationEnvCollision(manifest),
    ...validatePublicationKnownFields(manifest),
    ...validateAppTokenImmutable(manifest),
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
