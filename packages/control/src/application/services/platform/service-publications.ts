import { and, asc, eq } from "drizzle-orm";
import { BadRequestError } from "takos-common/errors";

import type {
  AppCompute,
  AppConsume,
  AppPublication,
} from "../source/app-manifest-types.ts";
import type { ObservedGroupState } from "../deployment/group-state.ts";
import { getGroupAutoHostname } from "../routing/group-hostnames.ts";
import {
  cleanupGrantConsumeState,
  GRANT_PUBLICATION_FIELDS,
  grantOutputContract,
  isTakosSystemPublicationSource,
  listPublicationKindDefinitions,
  normalizeGrantPublication,
  normalizeTakosSystemConsumePublication,
  type PublicationNormalizeOptions,
  type PublicationOutputDescriptor,
  resolveGrantConsumeOutputs,
  resolveTakosIssuerUrl,
  syncGrantConsumeState,
} from "./publication-catalog.ts";
import {
  getDb,
  publications,
  serviceConsumes,
} from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { SelectOf } from "../../../shared/types/drizzle-utils.ts";
import { generateId } from "../../../shared/utils/index.ts";

type PublicationRow = SelectOf<typeof publications>;
type ServiceConsumeRow = SelectOf<typeof serviceConsumes>;

export interface PublicationRecord {
  id: string;
  name: string;
  sourceType: "manifest" | "api";
  groupId: string | null;
  ownerServiceId: string | null;
  catalogName: string | null;
  publicationType: string;
  publication: AppPublication;
  outputs: PublicationOutputDescriptor[];
  resolved: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export function publicationResolvedUrl(
  record: PublicationRecord,
): string | null {
  const url = record.resolved.url?.trim();
  return url && url.length > 0 ? url : null;
}

const ROUTE_PUBLICATION_FIELDS = new Set([
  "name",
  "publisher",
  "type",
  "outputs",
  "title",
  "spec",
]);

function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parsePublicationRecord(raw: string): AppPublication {
  const record = parseJsonRecord(raw);
  const publication: AppPublication = {
    name: typeof record.name === "string" ? record.name : "",
    publisher: typeof record.publisher === "string" ? record.publisher : "",
    type: typeof record.type === "string" ? record.type : "",
  };
  if (typeof record.path === "string") {
    publication.path = record.path;
  }
  if (
    record.outputs &&
    typeof record.outputs === "object" &&
    !Array.isArray(record.outputs)
  ) {
    publication.outputs = record.outputs as AppPublication["outputs"];
  } else if (typeof record.path === "string") {
    publication.outputs = { url: { route: record.path } };
  }
  if (typeof record.title === "string") {
    publication.title = record.title;
  }
  if (
    record.spec &&
    typeof record.spec === "object" &&
    !Array.isArray(record.spec)
  ) {
    publication.spec = record.spec as Record<string, unknown>;
  }
  return publication;
}

function normalizeName(name: string, field: string): string {
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function isGrantPublication(publication: AppPublication): boolean {
  return publication.publisher === "takos";
}

function consumeLocalName(consume: Pick<AppConsume, "publication" | "as">): string {
  return normalizeName(
    consume.as ?? consume.publication,
    "consume.as",
  );
}

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

type ConsumeEntry = {
  computeName: string;
  path: string;
  compute: AppCompute;
  consume: AppConsume;
};

function attachedWorkloadName(parentName: string, childName: string): string {
  return `${parentName}-${childName}`;
}

function collectManifestConsumeEntries(manifest: {
  compute?: Record<string, AppCompute>;
}): ConsumeEntry[] {
  const entries: ConsumeEntry[] = [];
  for (const [name, compute] of Object.entries(manifest.compute ?? {})) {
    for (const [index, consume] of (compute.consume ?? []).entries()) {
      entries.push({
        computeName: name,
        path: `compute.${name}.consume[${index}]`,
        compute,
        consume,
      });
    }
    if (compute.kind !== "worker") continue;
    for (const [childName, child] of Object.entries(compute.containers ?? {})) {
      const workloadName = attachedWorkloadName(name, childName);
      for (const [index, consume] of (child.consume ?? []).entries()) {
        entries.push({
          computeName: workloadName,
          path: `compute.${name}.containers.${childName}.consume[${index}]`,
          compute: child,
          consume,
        });
      }
    }
  }
  return entries;
}

function assertConsumeOutputAliases(
  consume: AppConsume,
  outputs: PublicationOutputDescriptor[],
): void {
  const outputNames = new Set(outputs.map((entry) => entry.name));
  for (const key of Object.keys(consume.env ?? {})) {
    if (outputNames.has(key)) continue;
    throw new Error(
      `consume '${consume.publication}' maps unknown output '${key}'. Known outputs: ${
        Array.from(outputNames).sort().join(", ")
      }`,
    );
  }
}

export function resolveConsumeOutputEnvName(
  consume: Pick<AppConsume, "env">,
  output: Pick<PublicationOutputDescriptor, "name" | "defaultEnv">,
): string {
  return normalizeEnvName(consume.env?.[output.name] ?? output.defaultEnv);
}

function normalizePublicationEnvSegment(value: string): string {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return normalized || "PUBLICATION";
}

function publicationUrlDefaultEnv(name: string): string {
  return `PUBLICATION_${normalizePublicationEnvSegment(name)}_URL`;
}

function routePublicationApiWriteError(): Error {
  return new Error(
    "Route publications cannot be written through PUT /api/publications/:name. Manage route publications by deploying a manifest with publish[].",
  );
}

export function buildPublicUrl(
  hostname: string,
  path: string,
  pathParams: Record<string, string> = {},
): string {
  const normalizedHostname = String(hostname || "").trim();
  if (!normalizedHostname) {
    throw new Error("hostname is required");
  }
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) {
    throw new Error("path is required");
  }
  const resolvedPath = Object.entries(pathParams).reduce(
    (current, [name, value]) =>
      current.replaceAll(`:${name}`, encodeURIComponent(String(value))),
    normalizedPath,
  );
  if (
    normalizedHostname.startsWith("http://") ||
    normalizedHostname.startsWith("https://")
  ) {
    return `${normalizedHostname}${resolvedPath}`;
  }
  return `https://${normalizedHostname}${resolvedPath}`;
}

export function publicationAllowedFields(
  publication: AppPublication,
): ReadonlySet<string> {
  if (isGrantPublication(publication)) {
    return GRANT_PUBLICATION_FIELDS;
  }
  return ROUTE_PUBLICATION_FIELDS;
}

function normalizeRoutePublication(
  publication: AppPublication,
): AppPublication {
  const name = normalizeName(publication.name, "publication.name");
  const publisher = normalizeName(
    publication.publisher || "",
    "publication.publisher",
  );
  const type = normalizeName(publication.type || "", "publication.type");
  if (publisher === "takos") {
    throw new Error(
      `publication '${name}' uses reserved publisher 'takos'; use Takos built-in provider publications from consume[] instead`,
    );
  }
  if (!publication.outputs || Object.keys(publication.outputs).length === 0) {
    throw new Error(`publication '${name}'.outputs is required`);
  }
  const outputs: AppPublication["outputs"] = {};
  for (const [outputName, output] of Object.entries(publication.outputs)) {
    const route = output.route?.trim();
    if (!route) {
      throw new Error(`publication '${name}'.outputs.${outputName}.route is required`);
    }
    if (!route.startsWith("/")) {
      throw new Error(
        `publication '${name}'.outputs.${outputName}.route must start with '/'`,
      );
    }
    outputs[outputName] = { route };
  }
  if (
    publication.spec != null &&
    (typeof publication.spec !== "object" || Array.isArray(publication.spec))
  ) {
    throw new Error(`publication '${name}'.spec must be an object`);
  }
  return {
    name,
    publisher,
    type,
    outputs,
    ...(publication.title ? { title: String(publication.title).trim() } : {}),
    ...(publication.spec ? { spec: publication.spec } : {}),
  };
}

export function normalizePublicationDefinition(
  publication: AppPublication,
  options: PublicationNormalizeOptions = {},
): AppPublication {
  const name = normalizeName(publication.name, "publication.name");
  if (isGrantPublication(publication)) {
    if (publication.path || publication.title || publication.outputs) {
      throw new Error(
        `publication '${name}' must not combine publisher 'takos' with route fields outputs/path/title`,
      );
    }
    return normalizeGrantPublication({
      ...publication,
      name,
    }, options);
  }
  return normalizeRoutePublication({
    ...publication,
    name,
  });
}

function hasRelativeOAuthRedirectUris(publication: AppPublication): boolean {
  if (
    publication.publisher !== "takos" || publication.type !== "oauth-client"
  ) {
    return false;
  }
  const spec = publication.spec;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return false;
  const redirectUris = (spec as Record<string, unknown>).redirectUris;
  return Array.isArray(redirectUris) &&
    redirectUris.some((uri) => typeof uri === "string" && uri.startsWith("/"));
}

function resolveManifestOAuthRedirectUris(
  publication: AppPublication,
  groupHostname: string | null,
): AppPublication {
  if (!hasRelativeOAuthRedirectUris(publication)) return publication;
  if (!groupHostname) {
    throw new Error(
      `publication '${publication.name}' has relative OAuth redirect URI entries but the group hostname is unavailable`,
    );
  }
  const spec = publication.spec as Record<string, unknown>;
  const redirectUris = spec.redirectUris as unknown[];
  return {
    ...publication,
    spec: {
      ...spec,
      redirectUris: redirectUris.map((uri) =>
        typeof uri === "string" && uri.startsWith("/")
          ? buildPublicUrl(groupHostname, uri)
          : uri
      ),
    },
  };
}

export function normalizeServiceConsumes(
  consumes: AppConsume[] | undefined,
): AppConsume[] {
  if (!consumes) return [];
  const seen = new Set<string>();
  return consumes.map((consume) => {
    const publication = normalizeName(
      consume.publication,
      "consume.publication",
    );
    const alias = consume.as
      ? normalizeName(consume.as, `consume '${publication}'.as`)
      : undefined;
    const localName = alias ?? publication;
    if (seen.has(localName)) {
      throw new Error(
        `consume contains duplicate local consume name: ${localName}`,
      );
    }
    seen.add(localName);
    const request = consume.request
      ? (() => {
        if (
          typeof consume.request !== "object" ||
          Array.isArray(consume.request)
        ) {
          throw new Error(`consume '${localName}'.request must be an object`);
        }
        return consume.request;
      })()
      : undefined;
    const env = consume.env
      ? Object.fromEntries(
        Object.entries(consume.env).map(([outputName, envName]) => [
          normalizeName(outputName, `consume '${localName}'.env output`),
          normalizeEnvName(envName),
        ]),
      )
      : undefined;
    return {
      publication,
      ...(alias ? { as: alias } : {}),
      ...(request ? { request } : {}),
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
    };
  });
}

function toPublicationRecord(row: PublicationRow): PublicationRecord {
  const publication = normalizePublicationDefinition(
    parsePublicationRecord(row.specJson),
  );
  const resolvedRecord = parseJsonRecord(row.resolvedJson);
  const resolved = Object.fromEntries(
    Object.entries(resolvedRecord)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, value as string]),
  );
  return {
    id: row.id,
    name: row.name,
    sourceType: row.sourceType as "manifest" | "api",
    groupId: row.groupId ?? null,
    ownerServiceId: row.ownerServiceId ?? null,
    catalogName: row.catalogName ?? null,
    publicationType: row.publicationType,
    publication,
    outputs: publicationOutputContract(publication),
    resolved,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function publicationsHaveSameDefinition(
  left: AppPublication,
  right: AppPublication,
): boolean {
  return JSON.stringify(normalizePublicationDefinition(left)) ===
    JSON.stringify(normalizePublicationDefinition(right));
}

function parseConsumeConfig(
  row: ServiceConsumeRow,
): AppConsume {
  const config = parseJsonRecord(row.configJson);
  const publication = typeof config.publication === "string" &&
      config.publication.trim()
    ? config.publication.trim()
    : row.publicationName;
  const alias = typeof config.as === "string" && config.as.trim()
    ? config.as.trim()
    : (publication === row.publicationName ? undefined : row.publicationName);
  const request = config.request && typeof config.request === "object" &&
      !Array.isArray(config.request)
    ? config.request as Record<string, unknown>
    : undefined;
  const envRaw = config.env && typeof config.env === "object" &&
      !Array.isArray(config.env)
    ? config.env as Record<string, unknown>
    : undefined;
  const env = envRaw
    ? Object.fromEntries(
      Object.entries(envRaw)
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, String(value)]),
    )
    : undefined;
  return {
    publication,
    ...(alias ? { as: alias } : {}),
    ...(request && Object.keys(request).length > 0 ? { request } : {}),
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
  };
}

function parseConsumeState(
  row: ServiceConsumeRow | undefined,
): Record<string, unknown> | null {
  if (!row) return null;
  const state = parseJsonRecord(row.stateJson);
  return Object.keys(state).length > 0 ? state : null;
}

function publicationFromStoredState(
  publicationName: string,
  state: Record<string, unknown> | null,
): AppPublication | null {
  const publisher = typeof state?.publisher === "string"
    ? state.publisher
    : null;
  const type = typeof state?.type === "string" ? state.type : null;
  if (!publisher || !type) return null;
  return {
    name: publicationName,
    publisher,
    type,
    spec: {},
  };
}

async function listPublicationRows(
  env: Pick<Env, "DB">,
  spaceId: string,
  opts: {
    groupId?: string;
    sourceType?: "manifest" | "api";
  } = {},
): Promise<PublicationRow[]> {
  const db = getDb(env.DB);
  if (opts.groupId) {
    return db.select().from(publications).where(and(
      eq(publications.accountId, spaceId),
      eq(publications.groupId, opts.groupId),
    )).orderBy(asc(publications.createdAt), asc(publications.id)).all();
  }
  if (opts.sourceType) {
    return db.select().from(publications).where(and(
      eq(publications.accountId, spaceId),
      eq(publications.sourceType, opts.sourceType),
    )).orderBy(asc(publications.createdAt), asc(publications.id)).all();
  }
  return db.select().from(publications)
    .where(eq(publications.accountId, spaceId))
    .orderBy(asc(publications.createdAt), asc(publications.id))
    .all();
}

async function getPublicationRowByName(
  env: Pick<Env, "DB">,
  spaceId: string,
  name: string,
): Promise<PublicationRow | null> {
  const db = getDb(env.DB);
  const row = await db.select()
    .from(publications)
    .where(and(
      eq(publications.accountId, spaceId),
      eq(publications.name, name),
    ))
    .get();
  return row ?? null;
}

async function upsertPublicationRow(
  env: Pick<Env, "DB">,
  params: {
    spaceId: string;
    groupId?: string | null;
    ownerServiceId?: string | null;
    sourceType: "manifest" | "api";
    publication: AppPublication;
    resolved?: Record<string, string>;
  },
): Promise<void> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const existing = await getPublicationRowByName(
    env,
    params.spaceId,
    params.publication.name,
  );
  const grantPublication = isGrantPublication(params.publication);
  const groupId = grantPublication ? null : params.groupId ?? null;
  const catalogName = grantPublication ? "takos" : null;
  const values = {
    groupId,
    ownerServiceId: grantPublication ? null : params.ownerServiceId ?? null,
    sourceType: params.sourceType,
    catalogName,
    publicationType: params.publication.type,
    specJson: JSON.stringify(params.publication),
    resolvedJson: JSON.stringify(params.resolved ?? {}),
    status: "active",
    updatedAt: now,
  };

  if (existing) {
    const existingGroupId = existing.groupId ?? null;
    if (
      grantPublication &&
      existing.sourceType === params.sourceType &&
      isGrantPublication(parsePublicationRecord(existing.specJson)) &&
      publicationsHaveSameDefinition(
        parsePublicationRecord(existing.specJson),
        params.publication,
      )
    ) {
      await db.update(publications)
        .set(values)
        .where(eq(publications.id, existing.id))
        .run();
      return;
    }
    if (
      existing.sourceType !== params.sourceType || existingGroupId !== groupId
    ) {
      throw new BadRequestError(
        `publication '${params.publication.name}' already exists in this space and is owned by ${existing.sourceType}${
          existingGroupId ? ` group '${existingGroupId}'` : ""
        }`,
      );
    }
    await db.update(publications)
      .set(values)
      .where(eq(publications.id, existing.id))
      .run();
    return;
  }

  await db.insert(publications)
    .values({
      id: generateId(),
      accountId: params.spaceId,
      name: params.publication.name,
      createdAt: now,
      ...values,
    })
    .run();
}

async function deletePublicationRow(
  env: Pick<Env, "DB">,
  row: PublicationRow | null | undefined,
): Promise<void> {
  if (!row) return;
  const db = getDb(env.DB);
  await db.delete(publications).where(eq(publications.id, row.id));
}

async function restorePublicationRow(
  env: Pick<Env, "DB">,
  row: PublicationRow,
): Promise<void> {
  const db = getDb(env.DB);
  await db.update(publications)
    .set({
      groupId: row.groupId,
      ownerServiceId: row.ownerServiceId,
      sourceType: row.sourceType,
      catalogName: row.catalogName,
      publicationType: row.publicationType,
      specJson: row.specJson,
      resolvedJson: row.resolvedJson,
      status: row.status,
      updatedAt: row.updatedAt,
    })
    .where(eq(publications.id, row.id))
    .run();
}

async function assertPublicationHasNoConsumers(
  env: Pick<Env, "DB">,
  spaceId: string,
  name: string,
): Promise<void> {
  const db = getDb(env.DB);
  const consumers = await db.select()
    .from(serviceConsumes)
    .where(eq(serviceConsumes.accountId, spaceId))
    .all();
  if (consumers.some((row) => parseConsumeConfig(row).publication === name)) {
    throw new Error(
      `publication '${name}' is still consumed by one or more services`,
    );
  }
}

async function listServiceConsumeRows(
  env: Pick<Env, "DB">,
  spaceId: string,
  serviceId: string,
): Promise<ServiceConsumeRow[]> {
  const db = getDb(env.DB);
  return db.select()
    .from(serviceConsumes)
    .where(and(
      eq(serviceConsumes.accountId, spaceId),
      eq(serviceConsumes.serviceId, serviceId),
    ))
    .all();
}

async function upsertServiceConsumeRow(
  env: Pick<Env, "DB">,
  params: {
    spaceId: string;
    serviceId: string;
    consume: AppConsume;
    state?: Record<string, unknown>;
  },
): Promise<void> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const localName = consumeLocalName(params.consume);
  const configJson = JSON.stringify({
    publication: params.consume.publication,
    ...(params.consume.as ? { as: params.consume.as } : {}),
    ...(params.consume.request ? { request: params.consume.request } : {}),
    ...(params.consume.env ? { env: params.consume.env } : {}),
  });
  await db.insert(serviceConsumes)
    .values({
      id: generateId(),
      accountId: params.spaceId,
      serviceId: params.serviceId,
      publicationName: localName,
      configJson,
      stateJson: JSON.stringify(params.state ?? {}),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [serviceConsumes.serviceId, serviceConsumes.publicationName],
      set: {
        configJson,
        stateJson: JSON.stringify(params.state ?? {}),
        updatedAt: now,
      },
    });
}

async function deleteServiceConsumeRow(
  env: Pick<Env, "DB">,
  row: ServiceConsumeRow | undefined,
): Promise<void> {
  if (!row) return;
  const db = getDb(env.DB);
  await db.delete(serviceConsumes).where(eq(serviceConsumes.id, row.id));
}

async function cleanupConsumeState(
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    serviceId: string;
    publication: AppPublication;
    state: Record<string, unknown> | null;
  },
): Promise<void> {
  if (!isGrantPublication(params.publication)) return;
  await cleanupGrantConsumeState({
    env,
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    publication: params.publication,
    state: params.state,
  });
}

function hasGrantCleanupEnv(
  env: Pick<Env, "DB"> | Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
): env is Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN"> {
  return typeof (env as Env).ENCRYPTION_KEY === "string" &&
    typeof (env as Env).ADMIN_DOMAIN === "string";
}

async function syncConsumeState(
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    serviceId: string;
    serviceName: string;
    publication: AppPublication;
    consumeRow?: ServiceConsumeRow;
  },
): Promise<Record<string, unknown>> {
  if (!isGrantPublication(params.publication)) {
    return {};
  }
  return syncGrantConsumeState({
    env,
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    serviceName: params.serviceName,
    publication: params.publication,
    previousState: parseConsumeState(params.consumeRow),
  });
}

function findRouteTargetForPublication(
  publication: AppPublication,
  manifestRoutes: Array<{ target: string; path: string }>,
  routePath: string,
): string {
  const target = publication.publisher;
  if (!target || !routePath) {
    throw new Error(
      `publication '${publication.name}' is missing publisher/route output`,
    );
  }
  const routes = manifestRoutes.filter((entry) =>
    entry.target === target && entry.path === routePath
  );
  if (routes.length === 0) {
    throw new Error(
      `publication '${publication.name}' publisher/route '${target} ${routePath}' does not match any route`,
    );
  }
  return routes[0].target;
}

export function resolveRoutePublication(
  publication: AppPublication,
  observedState: ObservedGroupState,
  manifestRoutes: Array<{ target: string; path: string }>,
  options: { groupHostname?: string | null } = {},
): { ownerServiceId: string; resolved: Record<string, string> } {
  const outputs = publication.outputs ?? {};
  const resolved: Record<string, string> = {};
  let ownerServiceId: string | null = null;
  for (const [outputName, output] of Object.entries(outputs)) {
    const routePath = output.route;
    if (!routePath) continue;
    const target = findRouteTargetForPublication(
      publication,
      manifestRoutes,
      routePath,
    );
    const workload = observedState.workloads[target];
    const hostname = options.groupHostname ?? workload?.hostname;
    if (!workload?.serviceId || !hostname) {
      throw new Error(
        `publication '${publication.name}' cannot resolve route target '${target}'`,
      );
    }
    ownerServiceId ??= workload.serviceId;
    resolved[outputName] = buildPublicUrl(hostname, routePath);
  }
  if (!ownerServiceId || Object.keys(resolved).length === 0) {
    throw new Error(
      `publication '${publication.name}' does not declare any route outputs`,
    );
  }
  return {
    ownerServiceId,
    resolved,
  };
}

export function publicationOutputContract(
  publication: AppPublication,
): PublicationOutputDescriptor[] {
  if (isGrantPublication(publication)) {
    return grantOutputContract(publication);
  }
  return Object.keys(publication.outputs ?? {}).map((name) => ({
    name,
    defaultEnv: publicationUrlDefaultEnv(
      name === "url" ? publication.name : `${publication.name}-${name}`,
    ),
    secret: false,
  }));
}

async function resolvePublicationOutputValues(
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    serviceId: string;
    publication: PublicationRecord;
    consumeRow?: ServiceConsumeRow;
  },
): Promise<Record<string, { value: string; secret: boolean }>> {
  const publication = params.publication.publication;
  if (!isGrantPublication(publication)) {
    return Object.fromEntries(
      publicationOutputContract(publication).map((output) => {
        const value = params.publication.resolved[output.name];
        if (!value) {
          throw new Error(
            `publication '${publication.name}' does not have resolved output '${output.name}'`,
          );
        }
        return [output.name, { value, secret: output.secret }];
      }),
    );
  }

  return resolveGrantConsumeOutputs({
    env,
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    publication,
    state: parseConsumeState(params.consumeRow),
  });
}

async function syncConsumersForPublication(
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    publicationName: string;
  },
): Promise<void> {
  const db = getDb(env.DB);
  const publicationRow = await getPublicationRowByName(
    env,
    params.spaceId,
    params.publicationName,
  );
  if (!publicationRow) return;
  const publication = toPublicationRecord(publicationRow);
  const rows = await db.select()
    .from(serviceConsumes)
    .where(eq(serviceConsumes.accountId, params.spaceId))
    .all();
  for (const row of rows) {
    if (parseConsumeConfig(row).publication !== params.publicationName) {
      continue;
    }
    const state = await syncConsumeState(env, {
      spaceId: params.spaceId,
      serviceId: row.serviceId,
      serviceName: row.serviceId,
      publication: publication.publication,
      consumeRow: row,
    });
    await upsertServiceConsumeRow(env, {
      spaceId: params.spaceId,
      serviceId: row.serviceId,
      consume: parseConsumeConfig(row),
      state,
    });
  }
}

export function listPublicationKinds() {
  return listPublicationKindDefinitions().map(
    ({ publisher, type, specFields, outputs }) => ({
      publisher,
      type,
      specFields,
      outputs,
    }),
  );
}

export async function listPublications(
  env: Pick<Env, "DB">,
  spaceId: string,
): Promise<PublicationRecord[]> {
  const rows = await listPublicationRows(env, spaceId);
  return rows.map(toPublicationRecord);
}

export async function getPublicationByName(
  env: Pick<Env, "DB">,
  spaceId: string,
  name: string,
): Promise<PublicationRecord | null> {
  const row = await getPublicationRowByName(env, spaceId, name);
  return row ? toPublicationRecord(row) : null;
}

type ConsumePublicationDefinition = {
  publication: AppPublication;
  outputs: PublicationOutputDescriptor[];
  record?: PublicationRecord;
};

function resolveTakosSystemConsumeDefinition(
  consume: AppConsume,
  options: { groupHostname?: string | null } = {},
): ConsumePublicationDefinition {
  const normalized = normalizeTakosSystemConsumePublication(consume, {
    allowRelativeOAuthRedirectUris: true,
  });
  const publication = options.groupHostname === undefined
    ? normalized
    : resolveManifestOAuthRedirectUris(normalized, options.groupHostname);
  return {
    publication,
    outputs: publicationOutputContract(publication),
  };
}

async function resolveConsumePublicationDefinition(
  env: Pick<Env, "DB">,
  params: {
    spaceId: string;
    consume: AppConsume;
    groupHostname?: string | null;
  },
): Promise<ConsumePublicationDefinition | null> {
  if (isTakosSystemPublicationSource(params.consume.publication)) {
    return resolveTakosSystemConsumeDefinition(params.consume, {
      groupHostname: params.groupHostname,
    });
  }
  const record = await getPublicationByName(
    env,
    params.spaceId,
    params.consume.publication,
  );
  return record
    ? { publication: record.publication, outputs: record.outputs, record }
    : null;
}

export async function upsertApiPublication(
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    publication: AppPublication;
  },
): Promise<PublicationRecord> {
  if (params.publication.publisher !== "takos") {
    throw routePublicationApiWriteError();
  }
  const publication = normalizePublicationDefinition(params.publication);
  if (!isGrantPublication(publication)) {
    throw routePublicationApiWriteError();
  }
  const previousRow = await getPublicationRowByName(
    env,
    params.spaceId,
    publication.name,
  );
  await upsertPublicationRow(env, {
    spaceId: params.spaceId,
    sourceType: "api",
    publication,
  });
  try {
    await syncConsumersForPublication(env, {
      spaceId: params.spaceId,
      publicationName: publication.name,
    });
  } catch (error) {
    if (previousRow) {
      await restorePublicationRow(env, previousRow);
    } else {
      await deletePublicationRow(
        env,
        await getPublicationRowByName(env, params.spaceId, publication.name),
      );
    }
    throw error;
  }
  const stored = await getPublicationByName(
    env,
    params.spaceId,
    publication.name,
  );
  if (!stored) {
    throw new Error(`Failed to store publication '${publication.name}'`);
  }
  return stored;
}

export async function deletePublicationByName(
  env: Pick<Env, "DB">,
  params: {
    spaceId: string;
    name: string;
  },
): Promise<void> {
  await assertPublicationHasNoConsumers(env, params.spaceId, params.name);
  const row = await getPublicationRowByName(env, params.spaceId, params.name);
  await deletePublicationRow(env, row);
}

export async function replaceManifestPublications(
  env: Pick<
    Env,
    "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN" | "TENANT_BASE_DOMAIN"
  >,
  params: {
    spaceId: string;
    groupId: string;
    manifest: {
      publish?: AppPublication[];
      routes?: Array<{ target: string; path: string }>;
    };
    observedState: ObservedGroupState;
  },
): Promise<void> {
  const groupHostname = await getGroupAutoHostname(env, {
    groupId: params.groupId,
    spaceId: params.spaceId,
  });
  const desired = (params.manifest.publish ?? [])
    .map((publication) =>
      normalizePublicationDefinition(
        resolveManifestOAuthRedirectUris(publication, groupHostname),
      )
    );
  const desiredByName = new Map(
    desired.map((publication) => [publication.name, publication]),
  );
  const existingRows = await listPublicationRows(env, params.spaceId, {
    groupId: params.groupId,
  });
  const staleRows = existingRows.filter((row) =>
    row.groupId === params.groupId &&
    row.sourceType === "manifest" &&
    !desiredByName.has(row.name)
  );
  for (const row of staleRows) {
    await assertPublicationHasNoConsumers(env, params.spaceId, row.name);
  }
  for (const publication of desired) {
    const routeResolved = !isGrantPublication(publication)
      ? resolveRoutePublication(
        publication,
        params.observedState,
        params.manifest.routes ?? [],
        { groupHostname },
      )
      : { ownerServiceId: null, resolved: {} };
    await upsertPublicationRow(env, {
      spaceId: params.spaceId,
      groupId: params.groupId,
      ownerServiceId: routeResolved.ownerServiceId,
      sourceType: "manifest",
      publication,
      resolved: routeResolved.resolved,
    });
    await syncConsumersForPublication(env, {
      spaceId: params.spaceId,
      publicationName: publication.name,
    });
  }

  for (const row of staleRows) {
    await deletePublicationRow(env, row);
  }
}

export async function assertManifestPublicationPrerequisites(
  env: Pick<Env, "DB"> & Partial<Pick<Env, "TENANT_BASE_DOMAIN">>,
  params: {
    spaceId: string;
    groupId?: string;
    manifest: {
      compute?: Record<string, AppCompute>;
      env?: Record<string, string>;
      publish?: AppPublication[];
    };
  },
): Promise<void> {
  const errors: string[] = [];
  const desiredByName = new Map<string, AppPublication>();
  let groupHostname: string | null | undefined;
  async function resolveGroupHostname(): Promise<string | null> {
    if (!params.groupId) return null;
    if (groupHostname !== undefined) return groupHostname;
    groupHostname = await getGroupAutoHostname({
      DB: env.DB,
      TENANT_BASE_DOMAIN: env.TENANT_BASE_DOMAIN ?? "",
    }, {
      groupId: params.groupId,
      spaceId: params.spaceId,
    });
    return groupHostname;
  }

  for (const publication of params.manifest.publish ?? []) {
    let normalized: AppPublication;
    try {
      normalized = normalizePublicationDefinition(publication, {
        allowRelativeOAuthRedirectUris: true,
      });
      if (
        hasRelativeOAuthRedirectUris(normalized) &&
        params.groupId &&
        !(await resolveGroupHostname())
      ) {
        throw new Error(
          "relative OAuth redirect URI entries require a resolvable group hostname",
        );
      }
      desiredByName.set(normalized.name, normalized);
    } catch (error) {
      const name = publication.name || "(unnamed)";
      errors.push(
        `publication '${name}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
    if (!isGrantPublication(normalized)) continue;
  }

  const publicationRecordCache = new Map<string, PublicationRecord | null>();
  async function resolveConsumePublication(
    consume: AppConsume,
  ): Promise<
    | { publication: AppPublication; outputs: PublicationOutputDescriptor[] }
    | null
  > {
    const name = consume.publication;
    if (isTakosSystemPublicationSource(name)) {
      const normalized = normalizeTakosSystemConsumePublication(consume, {
        allowRelativeOAuthRedirectUris: true,
      });
      if (
        hasRelativeOAuthRedirectUris(normalized) &&
        params.groupId &&
        !(await resolveGroupHostname())
      ) {
        throw new Error(
          "relative OAuth redirect URI entries require a resolvable group hostname",
        );
      }
      return {
        publication: normalized,
        outputs: publicationOutputContract(normalized),
      };
    }
    const manifestPublication = desiredByName.get(name);
    if (manifestPublication) {
      return {
        publication: manifestPublication,
        outputs: publicationOutputContract(manifestPublication),
      };
    }
    if (!publicationRecordCache.has(name)) {
      publicationRecordCache.set(
        name,
        await getPublicationByName(env, params.spaceId, name),
      );
    }
    const record = publicationRecordCache.get(name) ?? null;
    return record
      ? { publication: record.publication, outputs: record.outputs }
      : null;
  }

  const topLevelEnvNames = new Set<string>();
  for (const name of Object.keys(params.manifest.env ?? {})) {
    try {
      topLevelEnvNames.add(normalizeEnvName(name));
    } catch {
      // Static deploy validation reports invalid env names with a precise path.
    }
  }
  const seenByCompute = new Map<string, Set<string>>();
  function seenEnvForCompute(entry: ConsumeEntry): Set<string> {
    const existing = seenByCompute.get(entry.computeName);
    if (existing) return existing;
    const seen = new Set(topLevelEnvNames);
    for (const name of Object.keys(entry.compute.env ?? {})) {
      try {
        seen.add(normalizeEnvName(name));
      } catch {
        // Static deploy validation reports invalid env names with a precise path.
      }
    }
    seenByCompute.set(entry.computeName, seen);
    return seen;
  }

  for (const entry of collectManifestConsumeEntries(params.manifest)) {
    let publication:
      | { publication: AppPublication; outputs: PublicationOutputDescriptor[] }
      | null;
    try {
      publication = await resolveConsumePublication(entry.consume);
    } catch (error) {
      errors.push(
        `${entry.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
    if (!publication) {
      errors.push(
        `${entry.path}: consume references unknown publication '${entry.consume.publication}' in this space`,
      );
      continue;
    }
    const manifestPublication = desiredByName.get(entry.consume.publication);
    if (
      manifestPublication && !isGrantPublication(manifestPublication) &&
      params.groupId && !(await resolveGroupHostname())
    ) {
      errors.push(
        `${entry.path}: consume references same-manifest route publication '${entry.consume.publication}' but the group hostname is unavailable`,
      );
      continue;
    }
    try {
      assertConsumeOutputAliases(entry.consume, publication.outputs);
    } catch (error) {
      errors.push(
        `${entry.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
    const seen = seenEnvForCompute(entry);
    for (const output of publication.outputs) {
      let envName: string;
      try {
        envName = resolveConsumeOutputEnvName(entry.consume, output);
      } catch (error) {
        errors.push(
          `${entry.path}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }
      if (seen.has(envName)) {
        errors.push(
          `${entry.path}: consume '${entry.consume.publication}' resolves env '${envName}' which already exists in compute '${entry.computeName}'`,
        );
        continue;
      }
      seen.add(envName);
    }
  }

  if (errors.length === 0) return;
  const header = errors.length === 1
    ? "Publication prerequisite validation failed:"
    : `Publication prerequisite validation failed (${errors.length} errors):`;
  throw new BadRequestError(
    [header, ...errors.map((error) => `  - ${error}`)].join("\n"),
    { errors },
  );
}

export async function listServiceConsumes(
  env: Pick<Env, "DB">,
  spaceId: string,
  serviceId: string,
): Promise<AppConsume[]> {
  const rows = await listServiceConsumeRows(env, spaceId, serviceId);
  return rows.map(parseConsumeConfig).sort((a, b) =>
    consumeLocalName(a).localeCompare(consumeLocalName(b))
  );
}

export async function replaceServiceConsumes(
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    serviceId: string;
    serviceName: string;
    groupHostname?: string | null;
    consumes?: AppConsume[];
  },
): Promise<AppConsume[]> {
  const consumes = normalizeServiceConsumes(params.consumes);
  const consumeByName = new Map(
    consumes.map((consume) => [consumeLocalName(consume), consume]),
  );
  const existingRows = await listServiceConsumeRows(
    env,
    params.spaceId,
    params.serviceId,
  );
  const publicationDefinitions = await Promise.all(
    consumes.map((consume) =>
      resolveConsumePublicationDefinition(env, {
        spaceId: params.spaceId,
        consume,
        groupHostname: params.groupHostname,
      })
    ),
  );
  const publicationMap = new Map<string, ConsumePublicationDefinition>();
  publicationDefinitions.forEach((definition, index) => {
    if (!definition) {
      throw new Error(
        `consume references unknown publication: ${
          consumes[index].publication
        }`,
      );
    }
    publicationMap.set(consumeLocalName(consumes[index]), definition);
  });

  for (const row of existingRows) {
    if (consumeByName.has(row.publicationName)) continue;
    const existingConsume = parseConsumeConfig(row);
    const publication = publicationMap.get(row.publicationName) ??
      await resolveConsumePublicationDefinition(env, {
        spaceId: params.spaceId,
        consume: existingConsume,
        groupHostname: params.groupHostname,
      });
    const state = parseConsumeState(row);
    if (publication) {
      await cleanupConsumeState(env, {
        spaceId: params.spaceId,
        serviceId: params.serviceId,
        publication: publication.publication,
        state,
      });
    } else {
      const fallbackPublication = publicationFromStoredState(
        row.publicationName,
        state,
      );
      if (fallbackPublication) {
        await cleanupConsumeState(env, {
          spaceId: params.spaceId,
          serviceId: params.serviceId,
          publication: fallbackPublication,
          state,
        });
      }
    }
    await deleteServiceConsumeRow(env, row);
  }

  for (const consume of consumes) {
    const localName = consumeLocalName(consume);
    const existing = existingRows.find((row) =>
      row.publicationName === localName
    );
    const publication = publicationMap.get(localName);
    if (!publication) {
      throw new Error(
        `consume references unknown publication: ${consume.publication}`,
      );
    }
    assertConsumeOutputAliases(consume, publication.outputs);
    const state = await syncConsumeState(env, {
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      serviceName: params.serviceName,
      publication: publication.publication,
      consumeRow: existing,
    });
    await upsertServiceConsumeRow(env, {
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      consume,
      state,
    });
  }

  return listServiceConsumes(env, params.spaceId, params.serviceId);
}

export async function previewServiceConsumeEnvVars(
  env: Pick<Env, "DB">,
  params: {
    spaceId: string;
    consumes?: AppConsume[];
  },
): Promise<Array<{ name: string; secret: boolean }>> {
  const consumes = normalizeServiceConsumes(params.consumes);
  const publicationDefinitions = await Promise.all(
    consumes.map((consume) =>
      resolveConsumePublicationDefinition(env, {
        spaceId: params.spaceId,
        consume,
      })
    ),
  );
  const out = new Map<string, { secret: boolean }>();

  publicationDefinitions.forEach((publication, index) => {
    const consume = consumes[index];
    if (!publication) {
      throw new Error(
        `consume references unknown publication: ${consume.publication}`,
      );
    }
    assertConsumeOutputAliases(consume, publication.outputs);
    for (const output of publication.outputs) {
      const envName = resolveConsumeOutputEnvName(consume, output);
      if (out.has(envName)) {
        throw new Error(
          `multiple consumes resolve to the same environment variable: ${envName}`,
        );
      }
      out.set(envName, { secret: output.secret });
    }
  });

  return Array.from(out.entries()).map(([name, value]) => ({
    name,
    secret: value.secret,
  }));
}

export async function deleteServiceConsumes(
  env: Pick<Env, "DB"> | Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    serviceId: string;
  },
): Promise<void> {
  const rows = await listServiceConsumeRows(
    env,
    params.spaceId,
    params.serviceId,
  );
  for (const row of rows) {
    const state = parseConsumeState(row);
    if (hasGrantCleanupEnv(env)) {
      const consume = parseConsumeConfig(row);
      const publication = await resolveConsumePublicationDefinition(env, {
        spaceId: params.spaceId,
        consume,
      });
      if (publication) {
        await cleanupConsumeState(env, {
          spaceId: params.spaceId,
          serviceId: params.serviceId,
          publication: publication.publication,
          state,
        });
      } else {
        const fallbackPublication = publicationFromStoredState(
          row.publicationName,
          state,
        );
        if (fallbackPublication) {
          await cleanupConsumeState(env, {
            spaceId: params.spaceId,
            serviceId: params.serviceId,
            publication: fallbackPublication,
            state,
          });
        }
      }
    }
    await deleteServiceConsumeRow(env, row);
  }
}

export async function resolveServiceConsumeEnvVars(
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    serviceId: string;
  },
): Promise<Array<{ name: string; value: string; secret: boolean }>> {
  const rows = await listServiceConsumeRows(
    env,
    params.spaceId,
    params.serviceId,
  );
  const out = new Map<string, { value: string; secret: boolean }>();

  for (const row of rows) {
    const consume = parseConsumeConfig(row);
    const publication = await resolveConsumePublicationDefinition(env, {
      spaceId: params.spaceId,
      consume,
    });
    if (!publication) {
      throw new Error(
        `consume references unknown publication: ${consume.publication}`,
      );
    }
    const contract = publication.outputs;
    assertConsumeOutputAliases(consume, contract);
    const values = await resolvePublicationOutputValues(env, {
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      publication: {
        id: "",
        name: publication.publication.name,
        sourceType: "api",
        groupId: null,
        ownerServiceId: null,
        catalogName: null,
        publicationType: publication.publication.type,
        publication: publication.publication,
        outputs: publication.outputs,
        resolved: publication.record?.resolved ?? {},
        createdAt: "",
        updatedAt: "",
      },
      consumeRow: row,
    });
    for (const output of contract) {
      const resolved = values[output.name];
      if (!resolved) {
        throw new Error(
          `publication '${consume.publication}' did not resolve output '${output.name}'`,
        );
      }
      const envName = resolveConsumeOutputEnvName(consume, output);
      if (out.has(envName)) {
        throw new Error(
          `multiple consumes resolve to the same environment variable: ${envName}`,
        );
      }
      out.set(envName, resolved);
    }
  }

  return Array.from(out.entries()).map(([name, value]) => ({
    name,
    value: value.value,
    secret: value.secret,
  }));
}

export function resolveOAuthIssuerUrl(
  env: Pick<Env, "ADMIN_DOMAIN">,
): string | null {
  return resolveTakosIssuerUrl(env);
}
