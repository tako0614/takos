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
  assertGrantPublicationPrerequisites,
  cleanupGrantConsumeState,
  GRANT_PUBLICATION_FIELDS,
  grantOutputContract,
  listPublicationKindDefinitions,
  normalizeGrantPublication,
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
  "path",
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
  const path = normalizeName(publication.path || "", "publication.path");
  if (!path.startsWith("/")) {
    throw new Error(`publication '${name}'.path must start with '/'`);
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
    path,
    ...(publication.title ? { title: String(publication.title).trim() } : {}),
    ...(publication.spec ? { spec: publication.spec } : {}),
  };
}

export function normalizePublicationDefinition(
  publication: AppPublication,
): AppPublication {
  const name = normalizeName(publication.name, "publication.name");
  if (isGrantPublication(publication)) {
    if (publication.path || publication.title) {
      throw new Error(
        `publication '${name}' must not combine publisher 'takos' with route fields path/title`,
      );
    }
    return normalizeGrantPublication({
      ...publication,
      name,
    });
  }
  return normalizeRoutePublication({
    ...publication,
    name,
  });
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
    if (seen.has(publication)) {
      throw new Error(
        `consume contains duplicate publication reference: ${publication}`,
      );
    }
    seen.add(publication);
    const env = consume.env
      ? Object.fromEntries(
        Object.entries(consume.env).map(([outputName, envName]) => [
          normalizeName(outputName, `consume '${publication}'.env output`),
          normalizeEnvName(envName),
        ]),
      )
      : undefined;
    return {
      publication,
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

function parseConsumeConfig(
  row: ServiceConsumeRow,
): AppConsume {
  const config = parseJsonRecord(row.configJson);
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
    publication: row.publicationName,
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
  const groupId = params.groupId ?? null;
  const catalogName = isGrantPublication(params.publication) ? "takos" : null;
  const values = {
    groupId,
    ownerServiceId: params.ownerServiceId ?? null,
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
  await db.insert(serviceConsumes)
    .values({
      id: generateId(),
      accountId: params.spaceId,
      serviceId: params.serviceId,
      publicationName: params.consume.publication,
      configJson: JSON.stringify({
        ...(params.consume.env ? { env: params.consume.env } : {}),
      }),
      stateJson: JSON.stringify(params.state ?? {}),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [serviceConsumes.serviceId, serviceConsumes.publicationName],
      set: {
        configJson: JSON.stringify({
          ...(params.consume.env ? { env: params.consume.env } : {}),
        }),
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
): string {
  const target = publication.publisher;
  const path = publication.path;
  if (!target || !path) {
    throw new Error(
      `publication '${publication.name}' is missing publisher/path`,
    );
  }
  const routes = manifestRoutes.filter((entry) =>
    entry.target === target && entry.path === path
  );
  if (routes.length === 0) {
    throw new Error(
      `publication '${publication.name}' publisher/path '${target} ${path}' does not match any route`,
    );
  }
  if (routes.length > 1) {
    throw new Error(
      `publication '${publication.name}' publisher/path '${target} ${path}' matches multiple routes`,
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
  const path = publication.path;
  if (!path) {
    throw new Error(`publication '${publication.name}' is missing a path`);
  }
  const target = findRouteTargetForPublication(publication, manifestRoutes);
  const workload = observedState.workloads[target];
  const hostname = options.groupHostname ?? workload?.hostname;
  if (!workload?.serviceId || !hostname) {
    throw new Error(
      `publication '${publication.name}' cannot resolve route target '${target}'`,
    );
  }
  return {
    ownerServiceId: workload.serviceId,
    resolved: {
      url: buildPublicUrl(hostname, path),
    },
  };
}

export function publicationOutputContract(
  publication: AppPublication,
): PublicationOutputDescriptor[] {
  if (isGrantPublication(publication)) {
    return grantOutputContract(publication);
  }
  return [{
    name: "url",
    defaultEnv: publicationUrlDefaultEnv(publication.name),
    secret: false,
  }];
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
    if (!params.publication.resolved.url) {
      throw new Error(
        `publication '${publication.name}' does not have a resolved URL`,
      );
    }
    return {
      url: {
        value: params.publication.resolved.url,
        secret: false,
      },
    };
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
    .where(and(
      eq(serviceConsumes.accountId, params.spaceId),
      eq(serviceConsumes.publicationName, params.publicationName),
    ))
    .all();
  for (const row of rows) {
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
  await upsertPublicationRow(env, {
    spaceId: params.spaceId,
    sourceType: "api",
    publication,
  });
  await syncConsumersForPublication(env, {
    spaceId: params.spaceId,
    publicationName: publication.name,
  });
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
  const db = getDb(env.DB);
  const consumer = await db.select({ id: serviceConsumes.id })
    .from(serviceConsumes)
    .where(and(
      eq(serviceConsumes.accountId, params.spaceId),
      eq(serviceConsumes.publicationName, params.name),
    ))
    .limit(1)
    .get();
  if (consumer) {
    throw new Error(
      `publication '${params.name}' is still consumed by one or more services`,
    );
  }
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
  const desired = (params.manifest.publish ?? [])
    .map(normalizePublicationDefinition);
  const desiredByName = new Map(
    desired.map((publication) => [publication.name, publication]),
  );
  const existingRows = await listPublicationRows(env, params.spaceId, {
    groupId: params.groupId,
  });
  const groupHostname = await getGroupAutoHostname(env, {
    groupId: params.groupId,
    spaceId: params.spaceId,
  });

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

  for (const row of existingRows) {
    if (row.groupId !== params.groupId) continue;
    if (row.sourceType !== "manifest") continue;
    if (desiredByName.has(row.name)) continue;
    await deletePublicationRow(env, row);
  }
}

export async function assertManifestPublicationPrerequisites(
  env: Pick<Env, "DB">,
  params: {
    spaceId: string;
    manifest: {
      compute?: Record<string, AppCompute>;
      env?: Record<string, string>;
      publish?: AppPublication[];
    };
  },
): Promise<void> {
  const errors: string[] = [];
  const desiredByName = new Map<string, AppPublication>();
  for (const publication of params.manifest.publish ?? []) {
    let normalized: AppPublication;
    try {
      normalized = normalizePublicationDefinition(publication);
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
    try {
      await assertGrantPublicationPrerequisites({
        env,
        spaceId: params.spaceId,
        publication: normalized,
      });
    } catch (error) {
      const name = publication.name || "(unnamed)";
      errors.push(
        `publication '${name}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const publicationRecordCache = new Map<string, PublicationRecord | null>();
  async function resolveConsumePublication(
    name: string,
  ): Promise<
    | { publication: AppPublication; outputs: PublicationOutputDescriptor[] }
    | null
  > {
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
      publication = await resolveConsumePublication(entry.consume.publication);
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
    a.publication.localeCompare(b.publication)
  );
}

export async function replaceServiceConsumes(
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    serviceId: string;
    serviceName: string;
    consumes?: AppConsume[];
  },
): Promise<AppConsume[]> {
  const consumes = normalizeServiceConsumes(params.consumes);
  const consumeByName = new Map(
    consumes.map((consume) => [consume.publication, consume]),
  );
  const existingRows = await listServiceConsumeRows(
    env,
    params.spaceId,
    params.serviceId,
  );
  const publicationRows = await Promise.all(
    consumes.map((consume) =>
      getPublicationRowByName(env, params.spaceId, consume.publication)
    ),
  );
  const publicationMap = new Map<string, PublicationRecord>();
  publicationRows.forEach((row, index) => {
    if (!row) {
      throw new Error(
        `consume references unknown publication: ${
          consumes[index].publication
        }`,
      );
    }
    publicationMap.set(consumes[index].publication, toPublicationRecord(row));
  });

  for (const row of existingRows) {
    if (consumeByName.has(row.publicationName)) continue;
    const publication = publicationMap.get(row.publicationName) ??
      await getPublicationByName(env, params.spaceId, row.publicationName);
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
    const existing = existingRows.find((row) =>
      row.publicationName === consume.publication
    );
    const publication = publicationMap.get(consume.publication);
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
  const publicationRows = await Promise.all(
    consumes.map((consume) =>
      getPublicationRowByName(env, params.spaceId, consume.publication)
    ),
  );
  const out = new Map<string, { secret: boolean }>();

  publicationRows.forEach((row, index) => {
    const consume = consumes[index];
    if (!row) {
      throw new Error(
        `consume references unknown publication: ${consume.publication}`,
      );
    }
    const publication = toPublicationRecord(row);
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
      const publication = await getPublicationByName(
        env,
        params.spaceId,
        row.publicationName,
      );
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
    const publication = await getPublicationByName(
      env,
      params.spaceId,
      consume.publication,
    );
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
      publication,
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
