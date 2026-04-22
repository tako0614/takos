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
  groups,
  publications,
  serviceConsumes,
  services,
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

const ROUTE_PUBLICATION_FIELDS = new Set([
  "name",
  "publisher",
  "type",
  "outputs",
  "display",
  "auth",
  "title",
  "spec",
]);

const STANDARD_PUBLICATION_TYPES: Record<string, string> = {
  McpServer: "takos.mcp-server.v1",
  FileHandler: "takos.file-handler.v1",
  UiSurface: "takos.ui-surface.v1",
};

export function canonicalPublicationType(type: string): string {
  return STANDARD_PUBLICATION_TYPES[type] ?? type;
}

export function isPublicationType(
  type: string,
  canonicalType: string,
): boolean {
  return canonicalPublicationType(type) === canonicalType;
}

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
    ...(typeof record.publisher === "string"
      ? { publisher: record.publisher }
      : {}),
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
    record.display &&
    typeof record.display === "object" &&
    !Array.isArray(record.display)
  ) {
    publication.display = record.display as AppPublication["display"];
  }
  if (
    record.auth &&
    typeof record.auth === "object" &&
    !Array.isArray(record.auth)
  ) {
    publication.auth = record.auth as AppPublication["auth"];
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

function consumeLocalName(
  consume: Pick<AppConsume, "publication" | "as">,
): string {
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
  for (const key of Object.keys(consume.inject?.env ?? consume.env ?? {})) {
    if (outputNames.has(key)) continue;
    throw new Error(
      `consume '${consume.publication}' maps unknown output '${key}'. Known outputs: ${
        Array.from(outputNames).sort().join(", ")
      }`,
    );
  }
}

function selectedConsumeOutputs(
  consume: AppConsume,
  outputs: PublicationOutputDescriptor[],
): PublicationOutputDescriptor[] {
  if (consume.inject?.defaults) return outputs;
  const aliases = consume.inject?.env ?? consume.env ?? {};
  const selected = new Set(Object.keys(aliases));
  return outputs.filter((output) => selected.has(output.name));
}

export function resolveConsumeOutputEnvName(
  consume: Pick<AppConsume, "env" | "inject">,
  output: Pick<PublicationOutputDescriptor, "name" | "defaultEnv">,
): string {
  return normalizeEnvName(
    consume.inject?.env?.[output.name] ??
      consume.env?.[output.name] ??
      output.defaultEnv,
  );
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
  const publisher = publication.publisher
    ? normalizeName(publication.publisher, "publication.publisher")
    : undefined;
  const type = canonicalPublicationType(
    normalizeName(publication.type || "", "publication.type"),
  );
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
    const kind = output.kind ?? "url";
    if (!["url", "string", "secret"].includes(kind)) {
      throw new Error(
        `publication '${name}'.outputs.${outputName}.kind must be url, string, or secret`,
      );
    }
    if (kind !== "url") {
      throw new Error(
        `publication '${name}'.outputs.${outputName}.kind must be url for route outputs`,
      );
    }
    const routeRef = output.routeRef?.trim();
    const route = output.route?.trim();
    if (route && routeRef) {
      throw new Error(
        `publication '${name}'.outputs.${outputName} must not combine route and routeRef`,
      );
    }
    if (!route && !routeRef) {
      throw new Error(
        `publication '${name}'.outputs.${outputName}.routeRef is required`,
      );
    }
    if (route && !route.startsWith("/")) {
      throw new Error(
        `publication '${name}'.outputs.${outputName}.route must start with '/'`,
      );
    }
    if (route && !publisher) {
      throw new Error(
        `publication '${name}'.publisher is required when outputs.${outputName}.route is used`,
      );
    }
    outputs[outputName] = {
      kind,
      ...(routeRef ? { routeRef } : {}),
      ...(route ? { route } : {}),
    };
  }
  if (
    publication.spec != null &&
    (typeof publication.spec !== "object" || Array.isArray(publication.spec))
  ) {
    throw new Error(`publication '${name}'.spec must be an object`);
  }
  return {
    name,
    ...(publisher ? { publisher } : {}),
    type,
    outputs,
    ...(publication.display ? { display: publication.display } : {}),
    ...(publication.title ? { title: String(publication.title).trim() } : {}),
    ...(publication.auth ? { auth: publication.auth } : {}),
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
    if (consume.env && consume.inject) {
      throw new Error(`consume '${localName}' must not combine env and inject`);
    }
    const rawInject = consume.inject ??
      (consume.env ? { env: consume.env } : undefined);
    const injectEnv = rawInject?.env
      ? Object.fromEntries(
        Object.entries(rawInject.env).map(([outputName, envName]) => [
          normalizeName(outputName, `consume '${localName}'.inject.env output`),
          normalizeEnvName(envName),
        ]),
      )
      : undefined;
    const inject = rawInject
      ? {
        ...(injectEnv && Object.keys(injectEnv).length > 0
          ? { env: injectEnv }
          : {}),
        ...(rawInject.defaults != null
          ? { defaults: Boolean(rawInject.defaults) }
          : {}),
      }
      : undefined;
    return {
      publication,
      ...(alias ? { as: alias } : {}),
      ...(request ? { request } : {}),
      ...(inject && Object.keys(inject).length > 0 ? { inject } : {}),
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
  const injectRaw = config.inject && typeof config.inject === "object" &&
      !Array.isArray(config.inject)
    ? config.inject as Record<string, unknown>
    : undefined;
  const injectEnvRaw = injectRaw?.env && typeof injectRaw.env === "object" &&
      !Array.isArray(injectRaw.env)
    ? injectRaw.env as Record<string, unknown>
    : envRaw;
  const injectEnv = injectEnvRaw
    ? Object.fromEntries(
      Object.entries(injectEnvRaw)
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, String(value)]),
    )
    : undefined;
  const defaults = typeof injectRaw?.defaults === "boolean"
    ? injectRaw.defaults
    : undefined;
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
  return await db.select()
    .from(publications)
    .where(and(
      eq(publications.accountId, spaceId),
      eq(publications.name, name),
    ))
    .all();
}

async function getGroupIdByName(
  env: Pick<Env, "DB">,
  spaceId: string,
  groupName: string,
): Promise<string | null> {
  const db = getDb(env.DB);
  const rows = await db.select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.spaceId, spaceId), eq(groups.name, groupName)))
    .all();
  return rows[0]?.id ?? null;
}

async function getServiceGroupId(
  env: Pick<Env, "DB">,
  spaceId: string,
  serviceId: string,
): Promise<string | null> {
  const db = getDb(env.DB);
  const rows = await db.select({ groupId: services.groupId })
    .from(services)
    .where(and(eq(services.accountId, spaceId), eq(services.id, serviceId)))
    .all();
  return rows[0]?.groupId ?? null;
}

async function getPublicationRowByIdentity(
  env: Pick<Env, "DB">,
  params: {
    spaceId: string;
    groupId: string | null;
    name: string;
  },
): Promise<PublicationRow | null> {
  const db = getDb(env.DB);
  const rows = await db.select()
    .from(publications)
    .where(and(
      eq(publications.accountId, params.spaceId),
      eq(publications.name, params.name),
    ))
    .all();
  return rows.find((row) => (row.groupId ?? null) === params.groupId) ?? null;
}

async function getPublicationRowByRef(
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
): Promise<PublicationRow> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const grantPublication = isGrantPublication(params.publication);
  const groupId = grantPublication ? null : params.groupId ?? null;
  const existing = await getPublicationRowByIdentity(env, {
    spaceId: params.spaceId,
    groupId,
    name: params.publication.name,
  });
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
      return (await getPublicationRowByIdentity(env, {
        spaceId: params.spaceId,
        groupId,
        name: params.publication.name,
      }))!;
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
    return (await getPublicationRowByIdentity(env, {
      spaceId: params.spaceId,
      groupId,
      name: params.publication.name,
    }))!;
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
  return (await getPublicationRowByIdentity(env, {
    spaceId: params.spaceId,
    groupId,
    name: params.publication.name,
  }))!;
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
  publication: PublicationRow,
): Promise<void> {
  const db = getDb(env.DB);
  const consumers = await db.select()
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
    ...(params.consume.inject ? { inject: params.consume.inject } : {}),
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
  manifestRoutes: Array<{ id?: string; target: string; path: string }>,
  output: { route?: string; routeRef?: string },
): { target: string; path: string } {
  const routeRef = output.routeRef?.trim();
  if (routeRef) {
    const route = manifestRoutes.find((entry) => entry.id === routeRef);
    if (!route) {
      throw new Error(
        `publication '${publication.name}' routeRef '${routeRef}' does not match any route id`,
      );
    }
    if (publication.publisher && publication.publisher !== route.target) {
      throw new Error(
        `publication '${publication.name}' publisher '${publication.publisher}' does not match routeRef '${routeRef}' target '${route.target}'`,
      );
    }
    return { target: route.target, path: route.path };
  }
  const routePath = output.route;
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
  return { target: routes[0].target, path: routes[0].path };
}

export function resolveRoutePublication(
  publication: AppPublication,
  observedState: ObservedGroupState,
  manifestRoutes: Array<{ id?: string; target: string; path: string }>,
  options: { groupHostname?: string | null } = {},
): { ownerServiceId: string; resolved: Record<string, string> } {
  const outputs = publication.outputs ?? {};
  const resolved: Record<string, string> = {};
  let ownerServiceId: string | null = null;
  let ownerTarget: string | null = null;
  for (const [outputName, output] of Object.entries(outputs)) {
    const route = findRouteTargetForPublication(
      publication,
      manifestRoutes,
      output,
    );
    if (ownerTarget && ownerTarget !== route.target) {
      throw new Error(
        `publication '${publication.name}' route outputs must resolve to the same target`,
      );
    }
    ownerTarget ??= route.target;
    const target = route.target;
    const workload = observedState.workloads[target];
    const hostname = options.groupHostname ?? workload?.hostname;
    if (!workload?.serviceId || !hostname) {
      throw new Error(
        `publication '${publication.name}' cannot resolve route target '${target}'`,
      );
    }
    ownerServiceId ??= workload.serviceId;
    resolved[outputName] = buildPublicUrl(hostname, route.path);
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
    secret: publication.outputs?.[name]?.kind === "secret",
    kind: publication.outputs?.[name]?.kind ?? "url",
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
    publication: PublicationRow;
  },
): Promise<void> {
  const db = getDb(env.DB);
  const publication = toPublicationRecord(params.publication);
  const rows = await db.select()
    .from(serviceConsumes)
    .where(eq(serviceConsumes.accountId, params.spaceId))
    .all();
  for (const row of rows) {
    const consume = parseConsumeConfig(row);
    const consumerGroupId = await getServiceGroupId(
      env,
      params.spaceId,
      row.serviceId,
    );
    const resolved = await getPublicationRowByRef(env, {
      spaceId: params.spaceId,
      ref: consume.publication,
      consumerGroupId,
    });
    if (resolved?.id !== params.publication.id) continue;
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
      consume,
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
  opts: { consumerGroupId?: string | null } = {},
): Promise<PublicationRecord | null> {
  const row = await getPublicationRowByRef(env, {
    spaceId,
    ref: name,
    consumerGroupId: opts.consumerGroupId,
  });
  return row ? toPublicationRecord(row) : null;
}

export async function resolvePublicationRef(
  env: Pick<Env, "DB">,
  params: {
    spaceId: string;
    ref: string;
    consumerGroupId?: string | null;
  },
): Promise<PublicationRecord | null> {
  const row = await getPublicationRowByRef(env, params);
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
    consumerGroupId?: string | null;
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
    { consumerGroupId: params.consumerGroupId },
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
  const previousRow = await getPublicationRowByIdentity(env, {
    spaceId: params.spaceId,
    groupId: null,
    name: publication.name,
  });
  const row = await upsertPublicationRow(env, {
    spaceId: params.spaceId,
    sourceType: "api",
    publication,
  });
  try {
    await syncConsumersForPublication(env, {
      spaceId: params.spaceId,
      publication: row,
    });
  } catch (error) {
    if (previousRow) {
      await restorePublicationRow(env, previousRow);
    } else {
      await deletePublicationRow(
        env,
        await getPublicationRowByIdentity(env, {
          spaceId: params.spaceId,
          groupId: null,
          name: publication.name,
        }),
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
  const row = await getPublicationRowByIdentity(env, {
    spaceId: params.spaceId,
    groupId: null,
    name: params.name,
  });
  if (row) await assertPublicationHasNoConsumers(env, params.spaceId, row);
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
      routes?: Array<{ id?: string; target: string; path: string }>;
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
    await assertPublicationHasNoConsumers(env, params.spaceId, row);
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
    const row = await upsertPublicationRow(env, {
      spaceId: params.spaceId,
      groupId: params.groupId,
      ownerServiceId: routeResolved.ownerServiceId,
      sourceType: "manifest",
      publication,
      resolved: routeResolved.resolved,
    });
    await syncConsumersForPublication(env, {
      spaceId: params.spaceId,
      publication: row,
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
        await getPublicationByName(env, params.spaceId, name, {
          consumerGroupId: params.groupId,
        }),
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
    for (
      const output of selectedConsumeOutputs(entry.consume, publication.outputs)
    ) {
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
    consumerGroupId?: string | null;
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
        consumerGroupId: params.consumerGroupId,
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
        consumerGroupId: params.consumerGroupId,
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
    consumerGroupId?: string | null;
    consumes?: AppConsume[];
  },
): Promise<Array<{ name: string; secret: boolean }>> {
  const consumes = normalizeServiceConsumes(params.consumes);
  const publicationDefinitions = await Promise.all(
    consumes.map((consume) =>
      resolveConsumePublicationDefinition(env, {
        spaceId: params.spaceId,
        consume,
        consumerGroupId: params.consumerGroupId,
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
    for (const output of selectedConsumeOutputs(consume, publication.outputs)) {
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
  const consumerGroupId = await getServiceGroupId(
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
        consumerGroupId,
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
  const consumerGroupId = await getServiceGroupId(
    env,
    params.spaceId,
    params.serviceId,
  );
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
      consumerGroupId,
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
        groupId: publication.record?.groupId ?? null,
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
    for (const output of selectedConsumeOutputs(consume, contract)) {
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
