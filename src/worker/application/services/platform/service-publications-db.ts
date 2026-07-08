import { and, asc, eq, inArray } from "drizzle-orm";
import { BadRequestError } from "@takos/worker-platform-utils/errors";

import type {
  AppConsume,
  AppPublication,
} from "../source/app-manifest-types.ts";
import {
  getDb,
  groups,
  publications,
  serviceConsumes,
  services,
} from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { SelectOf } from "../../../shared/types/drizzle-utils.ts";
import { generateId } from "../../../shared/utils/index.ts";
import {
  consumeLocalName,
  normalizeName,
  normalizeApiPublicationDefinition,
  normalizePublicationDefinition,
  parseJsonRecord,
  parsePublicationRecord,
  type PublicationOutputDescriptor,
  publicationUrlDefaultEnv,
} from "./service-publications-normalize.ts";

export type PublicationRow = SelectOf<typeof publications>;
export type ServiceConsumeRow = SelectOf<typeof serviceConsumes>;

export const RUNTIME_PROJECTION_PUBLICATION_SOURCE_TYPE =
  "runtime_projection" as const;
export const RUNTIME_PROJECTION_PUBLICATION_SOURCE_TYPES = [
  RUNTIME_PROJECTION_PUBLICATION_SOURCE_TYPE,
] as const;
export const API_PUBLICATION_SOURCE_TYPE = "api" as const;

export type PublicationSourceType =
  | typeof RUNTIME_PROJECTION_PUBLICATION_SOURCE_TYPE
  | typeof API_PUBLICATION_SOURCE_TYPE;

export interface PublicationRecord {
  id: string;
  name: string;
  sourceType: PublicationSourceType;
  groupId: string | null;
  groupName?: string | null;
  qualifiedName?: string;
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

export function publicationOutputContract(
  publication: AppPublication,
): PublicationOutputDescriptor[] {
  return Object.keys(publication.outputs ?? {}).map((name) => ({
    name,
    defaultEnv: publicationUrlDefaultEnv(
      name === "url" ? publication.name : `${publication.name}-${name}`,
    ),
    secret: publication.outputs?.[name]?.kind === "secret",
    kind: publication.outputs?.[name]?.kind ?? "url",
  }));
}

export function isRuntimeProjectionPublicationSourceType(
  sourceType: string | null | undefined,
): boolean {
  return RUNTIME_PROJECTION_PUBLICATION_SOURCE_TYPES.includes(
    sourceType as (typeof RUNTIME_PROJECTION_PUBLICATION_SOURCE_TYPES)[number],
  );
}

export function normalizePublicationSourceType(
  sourceType: string | null | undefined,
): PublicationSourceType {
  if (sourceType === API_PUBLICATION_SOURCE_TYPE)
    return API_PUBLICATION_SOURCE_TYPE;
  if (isRuntimeProjectionPublicationSourceType(sourceType)) {
    return RUNTIME_PROJECTION_PUBLICATION_SOURCE_TYPE;
  }
  return sourceType as PublicationSourceType;
}

export function toPublicationRecord(row: PublicationRow): PublicationRecord {
  const parsedPublication = parsePublicationRecord(row.specJson);
  const publication =
    row.sourceType === "api"
      ? normalizeApiPublicationDefinition(parsedPublication)
      : normalizePublicationDefinition(parsedPublication);
  const resolvedRecord = parseJsonRecord(row.resolvedJson);
  const resolved = Object.fromEntries(
    Object.entries(resolvedRecord)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, value as string]),
  );
  return {
    id: row.id,
    name: row.name,
    sourceType: normalizePublicationSourceType(row.sourceType),
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

export function parseConsumeConfig(row: ServiceConsumeRow): AppConsume {
  const config = parseJsonRecord(row.configJson);
  const publication =
    typeof config.publication === "string" && config.publication.trim()
      ? config.publication.trim()
      : row.publicationName;
  const alias =
    typeof config.as === "string" && config.as.trim()
      ? config.as.trim()
      : publication === row.publicationName
        ? undefined
        : row.publicationName;
  const request =
    config.request &&
    typeof config.request === "object" &&
    !Array.isArray(config.request)
      ? (config.request as Record<string, unknown>)
      : undefined;
  const injectRaw =
    config.inject &&
    typeof config.inject === "object" &&
    !Array.isArray(config.inject)
      ? (config.inject as Record<string, unknown>)
      : undefined;
  const injectEnvRaw =
    injectRaw?.env &&
    typeof injectRaw.env === "object" &&
    !Array.isArray(injectRaw.env)
      ? (injectRaw.env as Record<string, unknown>)
      : undefined;
  const injectEnv = injectEnvRaw
    ? Object.fromEntries(
        Object.entries(injectEnvRaw)
          .filter(([, value]) => typeof value === "string")
          .map(([key, value]) => [key, String(value)]),
      )
    : undefined;
  const defaults =
    typeof injectRaw?.defaults === "boolean" ? injectRaw.defaults : undefined;
  const inject = {
    ...(injectEnv && Object.keys(injectEnv).length > 0
      ? { env: injectEnv }
      : {}),
    ...(defaults != null ? { defaults } : {}),
  };
  return {
    publication,
    ...(alias ? { as: alias } : {}),
    ...(request && Object.keys(request).length > 0 ? { request } : {}),
    ...(Object.keys(inject).length > 0 ? { inject } : {}),
  };
}

export function parseConsumeState(
  row: ServiceConsumeRow | undefined,
): Record<string, unknown> | null {
  if (!row) return null;
  const state = parseJsonRecord(row.stateJson);
  return Object.keys(state).length > 0 ? state : null;
}

export async function listPublicationRows(
  env: Pick<Env, "DB">,
  spaceId: string,
  opts: {
    groupId?: string;
    sourceType?: PublicationSourceType;
  } = {},
): Promise<PublicationRow[]> {
  const db = getDb(env.DB);
  if (opts.groupId) {
    return db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.accountId, spaceId),
          eq(publications.groupId, opts.groupId),
        ),
      )
      .orderBy(asc(publications.createdAt), asc(publications.id))
      .all();
  }
  if (opts.sourceType) {
    const sourceTypes = isRuntimeProjectionPublicationSourceType(
      opts.sourceType,
    )
      ? [...RUNTIME_PROJECTION_PUBLICATION_SOURCE_TYPES]
      : [opts.sourceType];
    return db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.accountId, spaceId),
          inArray(publications.sourceType, sourceTypes),
        ),
      )
      .orderBy(asc(publications.createdAt), asc(publications.id))
      .all();
  }
  return db
    .select()
    .from(publications)
    .where(eq(publications.accountId, spaceId))
    .orderBy(asc(publications.createdAt), asc(publications.id))
    .all();
}

export async function getPublicationRowByName(
  env: Pick<Env, "DB">,
  spaceId: string,
  name: string,
): Promise<PublicationRow | null> {
  const rows = await getPublicationRowsByName(env, spaceId, name);
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new BadRequestError(
      `publication '${name}' is ambiguous; use <group>/<name>`,
    );
  }
  return rows[0];
}

async function getPublicationRowsByName(
  env: Pick<Env, "DB">,
  spaceId: string,
  name: string,
): Promise<PublicationRow[]> {
  const db = getDb(env.DB);
  return await db
    .select()
    .from(publications)
    .where(
      and(eq(publications.accountId, spaceId), eq(publications.name, name)),
    )
    .all();
}

async function getGroupIdByName(
  env: Pick<Env, "DB">,
  spaceId: string,
  groupName: string,
): Promise<string | null> {
  const db = getDb(env.DB);
  const rows = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.spaceId, spaceId), eq(groups.name, groupName)))
    .all();
  return rows[0]?.id ?? null;
}

export async function getServiceGroupId(
  env: Pick<Env, "DB">,
  spaceId: string,
  serviceId: string,
): Promise<string | null> {
  const db = getDb(env.DB);
  const rows = await db
    .select({ groupId: services.groupId })
    .from(services)
    .where(and(eq(services.accountId, spaceId), eq(services.id, serviceId)))
    .all();
  return rows[0]?.groupId ?? null;
}

export async function getPublicationRowByIdentity(
  env: Pick<Env, "DB">,
  params: {
    spaceId: string;
    groupId: string | null;
    name: string;
  },
): Promise<PublicationRow | null> {
  const db = getDb(env.DB);
  const rows = await db
    .select()
    .from(publications)
    .where(
      and(
        eq(publications.accountId, params.spaceId),
        eq(publications.name, params.name),
      ),
    )
    .all();
  return rows.find((row) => (row.groupId ?? null) === params.groupId) ?? null;
}

export async function getPublicationRowByRef(
  env: Pick<Env, "DB">,
  params: {
    spaceId: string;
    ref: string;
    consumerGroupId?: string | null;
  },
): Promise<PublicationRow | null> {
  const ref = normalizeName(params.ref, "publication ref");
  const slash = ref.indexOf("/");
  if (slash > 0) {
    const groupName = ref.slice(0, slash).trim();
    const name = ref.slice(slash + 1).trim();
    if (!groupName || !name || name.includes("/")) {
      throw new BadRequestError(`invalid publication ref '${ref}'`);
    }
    const groupId = await getGroupIdByName(env, params.spaceId, groupName);
    if (!groupId) return null;
    return await getPublicationRowByIdentity(env, {
      spaceId: params.spaceId,
      groupId,
      name,
    });
  }

  if (params.consumerGroupId) {
    const local = await getPublicationRowByIdentity(env, {
      spaceId: params.spaceId,
      groupId: params.consumerGroupId,
      name: ref,
    });
    if (local) return local;
  }
  const global = await getPublicationRowByIdentity(env, {
    spaceId: params.spaceId,
    groupId: null,
    name: ref,
  });
  if (global) return global;
  return await getPublicationRowByName(env, params.spaceId, ref);
}

export async function upsertPublicationRow(
  env: Pick<Env, "DB">,
  params: {
    spaceId: string;
    groupId?: string | null;
    ownerServiceId?: string | null;
    sourceType: PublicationSourceType;
    publication: AppPublication;
    resolved?: Record<string, string>;
  },
): Promise<PublicationRow> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const groupId = params.groupId ?? null;
  const existing = await getPublicationRowByIdentity(env, {
    spaceId: params.spaceId,
    groupId,
    name: params.publication.name,
  });
  const values = {
    groupId,
    ownerServiceId: params.ownerServiceId ?? null,
    sourceType: params.sourceType,
    catalogName: null,
    publicationType: params.publication.type,
    specJson: JSON.stringify(params.publication),
    resolvedJson: JSON.stringify(params.resolved ?? {}),
    status: "active",
    updatedAt: now,
  };

  if (existing) {
    const existingGroupId = existing.groupId ?? null;
    const existingSourceType = normalizePublicationSourceType(
      existing.sourceType,
    );
    const requestedSourceType = normalizePublicationSourceType(
      params.sourceType,
    );
    if (
      existingSourceType !== requestedSourceType ||
      existingGroupId !== groupId
    ) {
      throw new BadRequestError(
        `publication '${params.publication.name}' already exists in this space and is owned by ${existing.sourceType}${
          existingGroupId ? ` group '${existingGroupId}'` : ""
        }`,
      );
    }
    await db
      .update(publications)
      .set(values)
      .where(eq(publications.id, existing.id))
      .run();
    return (await getPublicationRowByIdentity(env, {
      spaceId: params.spaceId,
      groupId,
      name: params.publication.name,
    }))!;
  }

  await db
    .insert(publications)
    .values({
      id: generateId(),
      accountId: params.spaceId,
      name: params.publication.name,
      createdAt: now,
      ...values,
    })
    .run();
  return (await getPublicationRowByIdentity(env, {
    spaceId: params.spaceId,
    groupId,
    name: params.publication.name,
  }))!;
}

export async function deletePublicationRow(
  env: Pick<Env, "DB">,
  row: PublicationRow | null | undefined,
): Promise<void> {
  if (!row) return;
  const db = getDb(env.DB);
  await db.delete(publications).where(eq(publications.id, row.id));
}

export async function assertPublicationHasNoConsumers(
  env: Pick<Env, "DB">,
  spaceId: string,
  publication: PublicationRow,
): Promise<void> {
  const db = getDb(env.DB);
  const consumers = await db
    .select()
    .from(serviceConsumes)
    .where(eq(serviceConsumes.accountId, spaceId))
    .all();
  const groupIdByService = new Map<string, string | null>();
  for (const row of consumers) {
    let consumerGroupId = groupIdByService.get(row.serviceId);
    if (!groupIdByService.has(row.serviceId)) {
      consumerGroupId = await getServiceGroupId(env, spaceId, row.serviceId);
      groupIdByService.set(row.serviceId, consumerGroupId);
    }
    const resolved = await getPublicationRowByRef(env, {
      spaceId,
      ref: parseConsumeConfig(row).publication,
      consumerGroupId,
    });
    if (resolved?.id !== publication.id) continue;
    throw new Error(
      `publication '${publication.name}' is still consumed by one or more services`,
    );
  }
}

export async function listServiceConsumeRows(
  env: Pick<Env, "DB">,
  spaceId: string,
  serviceId: string,
): Promise<ServiceConsumeRow[]> {
  const db = getDb(env.DB);
  return db
    .select()
    .from(serviceConsumes)
    .where(
      and(
        eq(serviceConsumes.accountId, spaceId),
        eq(serviceConsumes.serviceId, serviceId),
      ),
    )
    .all();
}

export async function upsertServiceConsumeRow(
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
    ...(params.consume.inject ? { inject: params.consume.inject } : {}),
  });
  await db
    .insert(serviceConsumes)
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

export async function deleteServiceConsumeRow(
  env: Pick<Env, "DB">,
  row: ServiceConsumeRow | undefined,
): Promise<void> {
  if (!row) return;
  const db = getDb(env.DB);
  await db.delete(serviceConsumes).where(eq(serviceConsumes.id, row.id));
}
