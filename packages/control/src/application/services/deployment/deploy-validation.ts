/**
 * Deploy-time cross-resource validators (kernel-level constraints).
 *
 * This module collects validators that enforce cross-resource invariants on
 * a parsed manifest. They run at the very last moment before any DB write or
 * runtime apply, so the deploy fails fast with a clear error message and
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
 *      attached container or an unknown compute instead of a top-level
 *      Worker / Service.
 *   2. validateRouteUniqueness           — routes do not overlap by
 *      `path + method`, and do not split the same `target + path`.
 *   3. validateOnlineDeployImageSources  — service / attached container
 *      workloads have digest-pinned images for online deploy.
 *   4. validateConsumeReferences         — `compute.<name>.consume` references
 *      an unknown output alias key for a publication declared in the same
 *      manifest. External same-space catalog references are resolved by the
 *      publication prerequisite/apply path.
 *   5. validateConsumeEnvCollision       — consume env aliases collide within
 *      the same compute or with local/static env names.
 *   6. validatePublicationDefinitions    — publication normalization fails
 *      (`publisher`/`type` mismatch or type-specific field errors).
 *   7. validatePublicationKnownFields    — publication entries only use the
 *      generic route-publication or grant fields.
 * The validators operate on the flat `AppManifest` shape produced by the
 * parser (`compute` / `routes` / `publish` / `env`).
 */
import type {
  AppCompute,
  AppManifest,
  AppPublication,
  AppRoute,
} from "../source/app-manifest-types.ts";
import { BadRequestError } from "takos-common/errors";
import {
  normalizePublicationDefinition,
  publicationAllowedFields,
  publicationOutputContract,
} from "../platform/service-publications.ts";
import { isDigestPinnedImageRef } from "./image-ref.ts";

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
  | "route_unknown_target"
  | "route_duplicate"
  | "deploy_image_required"
  | "deploy_image_invalid"
  | "env_collision"
  | "consume_unknown_publication"
  | "consume_unknown_output"
  | "consume_env_collision"
  | "publication_duplicate"
  | "publication_invalid_definition"
  | "publication_unknown_field"
  | "publication_route_mismatch";

export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  /** Stable JSON path identifier (e.g. `routes[2]`). */
  path: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** All top-level compute entries. */
function getTopLevelCompute(
  manifest: ParsedManifest,
): Record<string, AppCompute> {
  return manifest.compute ?? {};
}

/**
 * Return a record of attached-container compute entries (the nested
 * `worker.containers.*` map). Attached containers are keyed by both their
 * public child name and internal `${parent}-${child}` workload name so route
 * validation catches either form.
 */
type AttachedContainerEntry = AppCompute & {
  parentWorker: string;
  childName: string;
};

function attachedWorkloadName(parentName: string, childName: string): string {
  return `${parentName}-${childName}`;
}

function getAttachedContainers(
  manifest: ParsedManifest,
): Record<string, AttachedContainerEntry> {
  const out: Record<string, AttachedContainerEntry> = {};
  for (
    const [workerName, compute] of Object.entries(getTopLevelCompute(manifest))
  ) {
    if (compute.kind !== "worker") continue;
    for (
      const [childName, child] of Object.entries(compute.containers ?? {})
    ) {
      const entry = { ...child, parentWorker: workerName, childName };
      out[childName] = entry;
      out[attachedWorkloadName(workerName, childName)] = entry;
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

const FILE_HANDLER_PUBLICATION_TYPE = "FileHandler";

const FILE_HANDLER_SPEC_FIELDS = new Set([
  "mimeTypes",
  "extensions",
]);

const TAKOS_API_KEY_SPEC_FIELDS = new Set([
  "scopes",
]);

const TAKOS_OAUTH_SPEC_FIELDS = new Set([
  "clientName",
  "redirectUris",
  "scopes",
  "metadata",
]);

const TAKOS_OAUTH_METADATA_FIELDS = new Set([
  "logoUri",
  "tosUri",
  "policyUri",
]);

const ALL_HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

type ComputeEntry = {
  name: string;
  path: string;
  compute: AppCompute;
};

function getComputeEntries(manifest: ParsedManifest): ComputeEntry[] {
  const entries: ComputeEntry[] = [];
  for (const [name, compute] of Object.entries(getTopLevelCompute(manifest))) {
    entries.push({ name, path: `compute.${name}`, compute });
    if (compute.kind !== "worker") continue;
    for (const [childName, child] of Object.entries(compute.containers ?? {})) {
      entries.push({
        name: attachedWorkloadName(name, childName),
        path: `compute.${name}.containers.${childName}`,
        compute: child,
      });
    }
  }
  return entries;
}

function isNativeCloudflareContainer(compute: AppCompute): boolean {
  return compute.kind === "attached-container" &&
    !!compute.cloudflare?.container;
}

function isCloudflareDockerfileImage(image: string): boolean {
  return /(^|\/)Dockerfile(?:\.[A-Za-z0-9._-]+)?$/.test(image);
}

type PublicationEntry = {
  path: string;
  publication: AppPublication;
  raw: Record<string, unknown>;
};

type ValidatedPublicationEntry = PublicationEntry & {
  normalized: AppPublication | null;
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
    raw: Object.fromEntries(Object.entries(pub)),
  }));
}

function collectValidatedPublications(
  manifest: ParsedManifest,
): {
  entries: ValidatedPublicationEntry[];
  errors: ValidationError[];
} {
  const entries: ValidatedPublicationEntry[] = [];
  const errors: ValidationError[] = [];
  for (const publication of collectPublications(manifest)) {
    try {
      entries.push({
        ...publication,
        normalized: normalizePublicationDefinition(publication.publication, {
          allowRelativeOAuthRedirectUris: true,
        }),
      });
    } catch (err) {
      entries.push({
        ...publication,
        normalized: null,
      });
      errors.push({
        code: "publication_invalid_definition",
        path: publication.path,
        message: `publication '${
          publication.publication.name ?? "(unnamed)"
        }' is invalid: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return { entries, errors };
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
          `(declared via 'compute.${attached[target].parentWorker}.containers.${
            attached[target].childName
          }').`,
      });
      continue;
    }
    errors.push({
      code: "route_unknown_target",
      path: `routes[${i}]`,
      message: `route target '${target}' references unknown compute. Declare ` +
        `compute.${target} or point the route at an existing top-level Worker or Service.`,
    });
  }

  return errors;
}

// ── Validator 2: Route duplicates ──────────────────────────────────────────

function expandRouteMethods(route: AppRoute): Set<string> {
  if (!route.methods || route.methods.length === 0) {
    return new Set(ALL_HTTP_METHODS);
  }
  return new Set(route.methods.map((method) => method.toUpperCase()));
}

function firstMethodOverlap(
  left: Set<string>,
  right: Set<string>,
): string | null {
  for (const method of left) {
    if (right.has(method)) return method;
  }
  return null;
}

export function validateRouteUniqueness(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const routes = getRoutes(manifest);

  const byTargetPath = new Map<
    string,
    { index: number; target: string; path: string }
  >();
  const byPath = new Map<
    string,
    { index: number; target: string; path: string; methods: Set<string> }[]
  >();
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    if (!route.target || !route.path) continue;
    const key = `${route.target}\0${route.path}`;
    const previous = byTargetPath.get(key);
    if (previous) {
      errors.push({
        code: "route_duplicate",
        path: `routes[${i}]`,
        message:
          `route target/path '${route.target} ${route.path}' duplicates routes[${previous.index}]. ` +
          `A manifest must declare at most one route for the same target + path; list multiple methods on that route instead.`,
      });
      continue;
    }
    byTargetPath.set(key, {
      index: i,
      target: route.target,
      path: route.path,
    });

    const methods = expandRouteMethods(route);
    const pathBucket = byPath.get(route.path) ?? [];
    for (const previousRoute of pathBucket) {
      const overlap = firstMethodOverlap(methods, previousRoute.methods);
      if (!overlap) continue;
      errors.push({
        code: "route_duplicate",
        path: `routes[${i}]`,
        message:
          `route path '${route.path}' overlaps routes[${previousRoute.index}] for method ${overlap}. ` +
          `Omit methods only when the route owns every method for the path, or split by non-overlapping methods.`,
      });
      break;
    }
    pathBucket.push({
      index: i,
      target: route.target,
      path: route.path,
      methods,
    });
    byPath.set(route.path, pathBucket);
  }

  return errors;
}

// ── Validator 3: Online deploy image sources ───────────────────────────────

export function validateOnlineDeployImageSources(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const entry of getComputeEntries(manifest)) {
    if (
      entry.compute.kind !== "service" &&
      entry.compute.kind !== "attached-container"
    ) {
      continue;
    }
    const image = entry.compute.image?.trim();
    if (!image) {
      errors.push({
        code: "deploy_image_required",
        path: entry.path,
        message:
          `${entry.compute.kind} '${entry.name}' requires a digest-pinned image for online deploy; dockerfile-only workloads are local/private builder manifests.`,
      });
      continue;
    }
    if (
      !isDigestPinnedImageRef(image) &&
      !(isNativeCloudflareContainer(entry.compute) &&
        isCloudflareDockerfileImage(image))
    ) {
      errors.push({
        code: "deploy_image_invalid",
        path: `${entry.path}.image`,
        message:
          `${entry.compute.kind} '${entry.name}' image must be digest-pinned with @sha256:<64 hex chars> for online deploy, except native Cloudflare containers may point at a repository-relative Dockerfile.`,
      });
    }
  }
  return errors;
}

// ── Validator 4: Env names ─────────────────────────────────────────────────

function collectNormalizedEnvNames(
  env: Record<string, string> | undefined,
  path: string,
): { names: Set<string>; errors: ValidationError[] } {
  const names = new Set<string>();
  const errors: ValidationError[] = [];
  for (const name of Object.keys(env ?? {})) {
    let normalized: string;
    try {
      normalized = normalizeEnvName(name);
    } catch (error) {
      errors.push({
        code: "env_collision",
        path: `${path}.${name}`,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (names.has(normalized)) {
      errors.push({
        code: "env_collision",
        path: `${path}.${name}`,
        message:
          `environment variable '${name}' duplicates another env entry after uppercase normalization (${normalized})`,
      });
      continue;
    }
    names.add(normalized);
  }
  return { names, errors };
}

export function validateLocalEnvNames(
  manifest: ParsedManifest,
): ValidationError[] {
  const topLevel = collectNormalizedEnvNames(manifest.env, "env");
  const errors = [...topLevel.errors];
  for (const entry of getComputeEntries(manifest)) {
    const local = collectNormalizedEnvNames(
      entry.compute.env,
      `${entry.path}.env`,
    );
    errors.push(...local.errors);
    for (const name of local.names) {
      if (!topLevel.names.has(name)) continue;
      errors.push({
        code: "env_collision",
        path: `${entry.path}.env`,
        message:
          `compute '${entry.name}' defines env '${name}' which already exists in top-level env`,
      });
    }
  }
  return errors;
}

// ── Validator 5: Consume references ─────────────────────────────────────────

export function validateConsumeReferences(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const { entries } = collectValidatedPublications(manifest);
  const publicationMap = new Map(
    entries.flatMap((entry) =>
      entry.normalized ? [[entry.normalized.name, entry.normalized]] : []
    ),
  );
  for (const entry of getComputeEntries(manifest)) {
    for (const [index, consume] of (entry.compute.consume ?? []).entries()) {
      const publication = publicationMap.get(consume.publication);
      if (!publication) {
        if (
          entries.some((entry) =>
            entry.publication.name === consume.publication && !entry.normalized
          )
        ) {
          continue;
        }
        continue;
      }
      const outputs = new Set(
        publicationOutputContract(publication).map((entry) => entry.name),
      );
      for (const key of Object.keys(consume.env ?? {})) {
        if (outputs.has(key)) continue;
        errors.push({
          code: "consume_unknown_output",
          path: `${entry.path}.consume[${index}].env.${key}`,
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

// ── Validator 6: Consume env collision ──────────────────────────────────────

export function validateConsumeEnvCollision(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const { entries } = collectValidatedPublications(manifest);
  const publicationMap = new Map(
    entries.flatMap((entry) =>
      entry.normalized ? [[entry.normalized.name, entry.normalized]] : []
    ),
  );
  const topLevelEnvNames = collectNormalizedEnvNames(manifest.env, "env").names;

  for (const entry of getComputeEntries(manifest)) {
    const localEnvNames = collectNormalizedEnvNames(
      entry.compute.env,
      `${entry.path}.env`,
    ).names;
    const seen = new Set<string>([
      ...topLevelEnvNames,
      ...localEnvNames,
    ]);
    for (const [index, consume] of (entry.compute.consume ?? []).entries()) {
      const publication = publicationMap.get(consume.publication);
      if (!publication) continue;
      for (const output of publicationOutputContract(publication)) {
        const envName = normalizeEnvName(
          consume.env?.[output.name] ?? output.defaultEnv,
        );
        if (seen.has(envName)) {
          errors.push({
            code: "consume_env_collision",
            path: `${entry.path}.consume[${index}]`,
            message:
              `consume '${consume.publication}' resolves env '${envName}' which already exists in compute '${entry.name}'. Pick a different alias or remove the conflicting env/bind.`,
          });
          continue;
        }
        seen.add(envName);
      }
    }
  }
  return errors;
}

// ── Validator 7: Publications ───────────────────────────────────────────────

export function validatePublicationUniqueness(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Map<string, number>();
  const routePublisherPaths = new Map<string, number>();
  for (const [index, publication] of getPublications(manifest).entries()) {
    const name = String(publication.name ?? "").trim();
    if (!name) continue;
    const previous = seen.get(name);
    if (previous != null) {
      errors.push({
        code: "publication_duplicate",
        path: `publish[${index}]`,
        message: `publication name '${name}' duplicates publish[${previous}]`,
      });
      continue;
    }
    seen.set(name, index);

    if (publication.publisher === "takos") continue;
    const publisher = String(publication.publisher ?? "").trim();
    const path = String(publication.path ?? "").trim();
    if (!publisher || !path) continue;
    const routeKey = `${publisher}\0${path}`;
    const previousRoutePublication = routePublisherPaths.get(routeKey);
    if (previousRoutePublication != null) {
      errors.push({
        code: "publication_duplicate",
        path: `publish[${index}]`,
        message:
          `route publication publisher/path '${publisher} ${path}' duplicates publish[${previousRoutePublication}]`,
      });
      continue;
    }
    routePublisherPaths.set(routeKey, index);
  }
  return errors;
}

export function validatePublicationRouteMatches(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const { entries } = collectValidatedPublications(manifest);
  const routes = getRoutes(manifest);
  for (const entry of entries) {
    const publication = entry.normalized;
    if (!publication || publication.publisher === "takos") continue;
    const target = publication.publisher;
    const path = publication.path;
    if (!target || !path) continue;
    const matches = routes.filter((route) =>
      route.target === target && route.path === path
    );
    if (matches.length >= 1) continue;
    errors.push({
      code: "publication_route_mismatch",
      path: entry.path,
      message:
        `route publication '${publication.name}' publisher/path '${target} ${path}' does not match any route`,
    });
  }
  return errors;
}

export function validatePublicationKnownFields(
  manifest: ParsedManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const { entries } = collectValidatedPublications(manifest);
  for (const pub of entries) {
    if (!pub.normalized) continue;
    const allowed = publicationAllowedFields(pub.normalized);
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
    errors.push(...validatePublicationSpecKnownFields(pub));
  }
  return errors;
}

function asSpecRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function specAllowedFieldsForPublication(
  publication: AppPublication,
): ReadonlySet<string> | null {
  if (publication.publisher === "takos" && publication.type === "api-key") {
    return TAKOS_API_KEY_SPEC_FIELDS;
  }
  if (
    publication.publisher === "takos" && publication.type === "oauth-client"
  ) {
    return TAKOS_OAUTH_SPEC_FIELDS;
  }
  if (publication.type === FILE_HANDLER_PUBLICATION_TYPE) {
    return FILE_HANDLER_SPEC_FIELDS;
  }
  return null;
}

function validateUnknownSpecKeys(
  params: {
    publicationName: string;
    path: string;
    spec: Record<string, unknown>;
    allowed: ReadonlySet<string>;
    label?: string;
  },
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const key of Object.keys(params.spec)) {
    if (params.allowed.has(key)) continue;
    errors.push({
      code: "publication_unknown_field",
      path: `${params.path}.${key}`,
      message:
        `publication '${params.publicationName}' has unknown ${
          params.label ?? "spec"
        } field '${key}'. ` +
        `Known fields: ${Array.from(params.allowed).sort().join(", ")}.`,
    });
  }
  return errors;
}

function validatePublicationSpecKnownFields(
  pub: ValidatedPublicationEntry,
): ValidationError[] {
  if (!pub.normalized) return [];
  const spec = asSpecRecord(pub.raw.spec);
  if (!spec) return [];
  const allowed = specAllowedFieldsForPublication(pub.normalized);
  if (!allowed) return [];

  const errors = validateUnknownSpecKeys({
    publicationName: pub.publication.name,
    path: `${pub.path}.spec`,
    spec,
    allowed,
  });

  const metadata = asSpecRecord(spec.metadata);
  if (
    pub.normalized.publisher === "takos" &&
    pub.normalized.type === "oauth-client" &&
    metadata
  ) {
    errors.push(...validateUnknownSpecKeys({
      publicationName: pub.publication.name,
      path: `${pub.path}.spec.metadata`,
      spec: metadata,
      allowed: TAKOS_OAUTH_METADATA_FIELDS,
      label: "spec.metadata",
    }));
  }
  return errors;
}

// ── Aggregate entry points ──────────────────────────────────────────────────

export function validatePublicationDefinitions(
  manifest: ParsedManifest,
): ValidationError[] {
  return collectValidatedPublications(manifest).errors;
}

export function runDeployValidations(
  manifest: ParsedManifest,
): ValidationError[] {
  return [
    ...validatePublicationDefinitions(manifest),
    ...validateAttachedNotRouteTarget(manifest),
    ...validateRouteUniqueness(manifest),
    ...validateOnlineDeployImageSources(manifest),
    ...validateLocalEnvNames(manifest),
    ...validateConsumeReferences(manifest),
    ...validateConsumeEnvCollision(manifest),
    ...validatePublicationUniqueness(manifest),
    ...validatePublicationRouteMatches(manifest),
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
  throw new BadRequestError(formatValidationErrors(errors), { errors });
}
