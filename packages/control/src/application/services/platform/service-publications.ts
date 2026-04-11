import { and, eq } from "drizzle-orm";

import type {
  AppConsume,
  AppPublication,
} from "../source/app-manifest-types.ts";
import type { ObservedGroupState } from "../deployment/group-state.ts";
import {
  cleanupProviderConsumeState,
  listPublicationProviders as listPublicationProviderDefinitions,
  normalizeProviderPublication,
  PROVIDER_PUBLICATION_FIELDS,
  providerOutputContract,
  type PublicationOutputDescriptor,
  resolveProviderConsumeOutputs,
  resolveTakosIssuerUrl,
  syncProviderConsumeState,
} from "./publication-providers.ts";
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
  providerName: string | null;
  publicationType: string;
  publication: AppPublication;
  outputs: PublicationOutputDescriptor[];
  resolved: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

const ROUTE_PUBLICATION_FIELDS: Record<string, ReadonlySet<string>> = {
  McpServer: new Set([
    "name",
    "type",
    "path",
    "transport",
    "authSecretRef",
    "title",
  ]),
  FileHandler: new Set([
    "name",
    "type",
    "path",
    "mimeTypes",
    "extensions",
    "title",
  ]),
  UiSurface: new Set([
    "name",
    "type",
    "path",
    "title",
    "icon",
  ]),
};

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

function normalizeName(name: string, field: string): string {
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
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

function normalizeStringList(values: string[], field: string): string[] {
  const normalized = [
    ...new Set(
      values.map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ];
  if (normalized.length === 0) {
    throw new Error(`${field} must contain at least one value`);
  }
  return normalized;
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

export function publicationAllowedFields(
  publication: AppPublication,
): ReadonlySet<string> {
  if (publication.provider) {
    return PROVIDER_PUBLICATION_FIELDS;
  }
  return ROUTE_PUBLICATION_FIELDS[publication.type ?? ""] ??
    new Set(["name", "type", "path", "title"]);
}

function normalizeRoutePublication(
  publication: AppPublication,
): AppPublication {
  const name = normalizeName(publication.name, "publication.name");
  const type = normalizeName(publication.type || "", "publication.type");
  const path = normalizeName(publication.path || "", "publication.path");
  if (!path.startsWith("/")) {
    throw new Error(`publication '${name}'.path must start with '/'`);
  }
  const base: AppPublication = {
    name,
    type,
    path,
    ...(publication.title ? { title: String(publication.title).trim() } : {}),
  };
  switch (type) {
    case "McpServer":
      return {
        ...base,
        ...(publication.transport
          ? { transport: String(publication.transport).trim() }
          : {}),
        ...(publication.authSecretRef
          ? { authSecretRef: String(publication.authSecretRef).trim() }
          : {}),
      };
    case "FileHandler": {
      const mimeTypes = publication.mimeTypes
        ? normalizeStringList(
          publication.mimeTypes,
          `publication '${name}'.mimeTypes`,
        )
        : undefined;
      const extensions = publication.extensions
        ? normalizeStringList(
          publication.extensions,
          `publication '${name}'.extensions`,
        )
        : undefined;
      if (
        (!mimeTypes || mimeTypes.length === 0) &&
        (!extensions || extensions.length === 0)
      ) {
        throw new Error(
          `publication '${name}' requires at least one of mimeTypes or extensions`,
        );
      }
      return {
        ...base,
        ...(mimeTypes ? { mimeTypes } : {}),
        ...(extensions ? { extensions } : {}),
      };
    }
    case "UiSurface":
      return {
        ...base,
        ...(publication.icon ? { icon: String(publication.icon).trim() } : {}),
      };
    default:
      return base;
  }
}

export function normalizePublicationDefinition(
  publication: AppPublication,
): AppPublication {
  const name = normalizeName(publication.name, "publication.name");
  if (publication.provider) {
    if (publication.type || publication.path) {
      throw new Error(
        `publication '${name}' must not combine provider/kind with route fields type/path`,
      );
    }
    return normalizeProviderPublication({
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
    parseJsonRecord(row.specJson) as unknown as AppPublication,
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
    providerName: row.providerName ?? null,
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
  const provider = typeof state?.provider === "string" ? state.provider : null;
  const kind = typeof state?.kind === "string" ? state.kind : null;
  if (!provider || !kind) return null;
  return {
    name: publicationName,
    provider,
    kind,
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
    )).all();
  }
  if (opts.sourceType) {
    return db.select().from(publications).where(and(
      eq(publications.accountId, spaceId),
      eq(publications.sourceType, opts.sourceType),
    )).all();
  }
  return db.select().from(publications)
    .where(eq(publications.accountId, spaceId))
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
  await db.insert(publications)
    .values({
      id: generateId(),
      accountId: params.spaceId,
      groupId: params.groupId ?? null,
      ownerServiceId: params.ownerServiceId ?? null,
      sourceType: params.sourceType,
      name: params.publication.name,
      providerName: params.publication.provider ?? null,
      publicationType: params.publication.provider
        ? params.publication.kind ?? ""
        : params.publication.type ?? "",
      specJson: JSON.stringify(params.publication),
      resolvedJson: JSON.stringify(params.resolved ?? {}),
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [publications.accountId, publications.name],
      set: {
        groupId: params.groupId ?? null,
        ownerServiceId: params.ownerServiceId ?? null,
        sourceType: params.sourceType,
        providerName: params.publication.provider ?? null,
        publicationType: params.publication.provider
          ? params.publication.kind ?? ""
          : params.publication.type ?? "",
        specJson: JSON.stringify(params.publication),
        resolvedJson: JSON.stringify(params.resolved ?? {}),
        status: "active",
        updatedAt: now,
      },
    });
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
  if (!params.publication.provider) return;
  await cleanupProviderConsumeState({
    env,
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    publication: params.publication,
    state: params.state,
  });
}

function hasProviderCleanupEnv(
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
  if (!params.publication.provider) {
    return {};
  }
  return syncProviderConsumeState({
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
  const route = manifestRoutes.find((entry) => entry.path === publication.path);
  if (!route) {
    throw new Error(
      `publication '${publication.name}' path '${publication.path}' does not match any route`,
    );
  }
  return route.target;
}

function resolveRoutePublication(
  publication: AppPublication,
  observedState: ObservedGroupState,
  manifestRoutes: Array<{ target: string; path: string }>,
): { ownerServiceId: string; resolved: Record<string, string> } {
  const target = findRouteTargetForPublication(publication, manifestRoutes);
  const workload = observedState.workloads[target];
  if (!workload?.serviceId || !workload.hostname) {
    throw new Error(
      `publication '${publication.name}' cannot resolve route target '${target}'`,
    );
  }
  return {
    ownerServiceId: workload.serviceId,
    resolved: {
      url: `https://${workload.hostname}${publication.path}`,
    },
  };
}

export function publicationOutputContract(
  publication: AppPublication,
): PublicationOutputDescriptor[] {
  if (publication.provider) {
    return providerOutputContract(publication);
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
  if (!publication.provider) {
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

  return resolveProviderConsumeOutputs({
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

export function listPublicationProviders() {
  return listPublicationProviderDefinitions();
}

export async function listPublications(
  env: Pick<Env, "DB">,
  spaceId: string,
): Promise<PublicationRecord[]> {
  const rows = await listPublicationRows(env, spaceId);
  return rows.map(toPublicationRecord).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
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
  const publication = normalizePublicationDefinition(params.publication);
  if (!publication.provider) {
    throw new Error("Route publications must be managed by manifest deploy");
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
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
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

  for (const publication of desired) {
    const routeResolved = !publication.provider
      ? resolveRoutePublication(
        publication,
        params.observedState,
        params.manifest.routes ?? [],
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
    if (hasProviderCleanupEnv(env)) {
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
    const outputNames = new Set(contract.map((entry) => entry.name));
    for (const key of Object.keys(consume.env ?? {})) {
      if (!outputNames.has(key)) {
        throw new Error(
          `consume '${consume.publication}' maps unknown output '${key}'`,
        );
      }
    }
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
      const envName = consume.env?.[output.name] ?? output.defaultEnv;
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
