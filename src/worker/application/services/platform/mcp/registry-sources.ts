/**
 * Workspace-scoped MCP Registry source management and bounded live search.
 *
 * This is intentionally a live-search foundation, not a catalog or trust
 * service. The Registry v0.1 `search` parameter is a server-name substring
 * match; cached full-text aggregation across title/description/provider is a
 * separate future concern. Registry provenance never implies connector safety.
 */

import { z } from "zod";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { Env } from "../../../../shared/types/index.ts";
import type { SqlDatabaseLike } from "../../../../infra/db/client.ts";
import type {
  InsertOf,
  SelectOf,
} from "../../../../shared/types/drizzle-utils.ts";
import { getDb, mcpRegistrySources } from "../../../../infra/db/index.ts";
import { generateId } from "../../../../shared/utils/index.ts";
import {
  BadRequestError,
  ConflictError,
} from "@takos/worker-platform-utils/errors";
import {
  assertAllowedMcpEndpointUrl,
  getMcpEndpointUrlOptions,
} from "./validation.ts";
import { decryptToken, encryptToken } from "./crypto.ts";

export const OFFICIAL_MCP_REGISTRY_SOURCE_ID = "official-mcp-registry";
export const OFFICIAL_MCP_REGISTRY_BASE_URL =
  "https://registry.modelcontextprotocol.io";

const MAX_CUSTOM_SOURCES_PER_WORKSPACE = 16;
const REGISTRY_SEARCH_TIMEOUT_MS = 8_000;
const REGISTRY_SEARCH_MAX_RESPONSE_BYTES = 1024 * 1024;
const REGISTRY_SEARCH_RESULT_LIMIT = 50;
const REGISTRY_SEARCH_MAX_CONCURRENCY = 4;

export const CUSTOM_MCP_REGISTRY_SOURCE_KINDS = [
  "organization",
  "community",
  "custom",
] as const;

export type CustomMcpRegistrySourceKind =
  (typeof CUSTOM_MCP_REGISTRY_SOURCE_KINDS)[number];
export type McpRegistrySourceKind = "official" | CustomMcpRegistrySourceKind;
export const MCP_REGISTRY_AUTH_TYPES = ["none", "bearer", "header"] as const;
export type McpRegistryAuthType = (typeof MCP_REGISTRY_AUTH_TYPES)[number];

export interface McpRegistrySourceRecord {
  id: string;
  spaceId: string | null;
  name: string;
  baseUrl: string;
  sourceKind: McpRegistrySourceKind;
  authType: McpRegistryAuthType;
  authHeaderName: string | null;
  credentialConfigured: boolean;
  /** Encrypted at rest and deliberately omitted by every route serializer. */
  authSecretCiphertext: string | null;
  enabled: boolean;
  priority: number;
  readOnly: boolean;
  preview: boolean;
  bestEffort: boolean;
  verificationStatus: "not_assessed";
  securityStatus: "not_assessed";
  createdAt: string | null;
  updatedAt: string | null;
}

export interface McpRegistrySourceInput {
  name: string;
  baseUrl: string;
  sourceKind?: CustomMcpRegistrySourceKind;
  enabled?: boolean;
  priority?: number;
  authType?: McpRegistryAuthType;
  authHeaderName?: string;
  authSecret?: string;
  /** Internal import-only escape hatch. Missing credentials force disabled. */
  allowMissingCredential?: boolean;
}

export interface McpRegistrySourcePatch {
  name?: string;
  baseUrl?: string;
  sourceKind?: CustomMcpRegistrySourceKind;
  enabled?: boolean;
  priority?: number;
  authType?: McpRegistryAuthType;
  authHeaderName?: string | null;
  authSecret?: string;
  /** Internal import-only escape hatch. Missing credentials force disabled. */
  allowMissingCredential?: boolean;
}

export interface McpRegistryCandidateProvenance {
  sourceId: string;
  sourceName: string;
  sourceKind: McpRegistrySourceKind | "server_card";
  baseUrl: string;
  priority: number;
  preview: boolean;
  bestEffort: boolean;
  serverName: string;
  serverVersion: string;
  cardUrl?: string;
}

export interface McpRegistrySearchCandidate {
  name: string;
  title: string | null;
  description: string | null;
  version: string;
  url: string | null;
  transport: "streamable-http" | "package";
  repositoryUrl: string | null;
  repositorySubfolder: string | null;
  requiresConfiguration: boolean;
  packages: McpRegistryPackage[];
  provenance: McpRegistryCandidateProvenance[];
}

export interface McpRegistryPackage {
  registryType: "npm" | "oci";
  registryBaseUrl: string | null;
  identifier: string;
  version: string | null;
  fileSha256: string | null;
  transportType: string;
  transportUrl: string | null;
  runtimeHint: string | null;
  requiresConfiguration: boolean;
}

export interface McpRegistrySearchFailure {
  sourceId: string;
  sourceName: string;
  sourceKind: McpRegistrySourceKind;
  code:
    | "egress_unavailable"
    | "timeout"
    | "redirect"
    | "http_error"
    | "response_too_large"
    | "invalid_response"
    | "credentials_required"
    | "network_error";
  message: string;
  status: number | null;
}

export interface McpRegistrySearchResult {
  query: string;
  candidates: McpRegistrySearchCandidate[];
  sourceResults: Array<{
    sourceId: string;
    sourceName: string;
    matchedServers: number;
    candidateCount: number;
    skippedRemoteCount: number;
  }>;
  sourceFailures: McpRegistrySearchFailure[];
  limitations: {
    mode: "live_best_effort";
    upstreamSearch: "server_name_substring_only";
    cachedFullTextAggregation: false;
    credentialsSupported: true;
  };
}

const registryRemoteSchema = z.object({
  type: z.string().min(1).max(64),
  url: z.string().min(1).max(4096),
  headers: z
    .array(
      z.object({
        name: z.string().max(256).optional(),
        isRequired: z.boolean().optional(),
      }),
    )
    .max(32)
    .optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
});

const registryInputSchema = z.object({
  name: z.string().max(256).optional(),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
});

const registryPackageSchema = z.object({
  registryType: z.string().min(1).max(64),
  registryBaseUrl: z.string().max(4096).optional(),
  identifier: z.string().min(1).max(4096),
  version: z.string().max(256).optional(),
  fileSha256: z.string().max(128).optional(),
  runtimeHint: z.string().max(128).optional(),
  transport: z.object({
    type: z.string().min(1).max(64),
    url: z.string().max(4096).optional(),
  }),
  environmentVariables: z.array(registryInputSchema).max(128).optional(),
  packageArguments: z.array(registryInputSchema).max(128).optional(),
  runtimeArguments: z.array(registryInputSchema).max(128).optional(),
});

const registryServerSchema = z.object({
  name: z.string().min(1).max(512),
  title: z.string().max(512).optional(),
  description: z.string().max(8192).optional(),
  version: z.string().min(1).max(256),
  remotes: z.array(registryRemoteSchema).max(32).optional(),
  packages: z.array(registryPackageSchema).max(32).optional(),
  repository: z
    .object({
      url: z.string().max(4096).optional(),
      subfolder: z.string().max(1024).optional(),
    })
    .optional(),
});

const registrySearchResponseSchema = z.object({
  servers: z.array(z.object({ server: registryServerSchema })).max(100),
  metadata: z
    .object({
      count: z.number().int().nonnegative().optional(),
      nextCursor: z.string().max(2048).optional(),
    })
    .optional(),
});

class RegistrySearchError extends Error {
  constructor(
    readonly code: McpRegistrySearchFailure["code"],
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

function officialSource(
  spaceId: string,
  preference?: SelectOf<typeof mcpRegistrySources>,
): McpRegistrySourceRecord {
  return {
    id: OFFICIAL_MCP_REGISTRY_SOURCE_ID,
    spaceId,
    name: "Official MCP Registry",
    baseUrl: OFFICIAL_MCP_REGISTRY_BASE_URL,
    sourceKind: "official",
    authType: "none",
    authHeaderName: null,
    credentialConfigured: false,
    authSecretCiphertext: null,
    enabled: preference?.enabled ?? true,
    priority: 100,
    readOnly: true,
    // The Official MCP Registry currently describes itself as preview and
    // provides no availability/durability guarantee. This label is not a
    // connector verification or security assertion.
    preview: true,
    bestEffort: true,
    verificationStatus: "not_assessed",
    securityStatus: "not_assessed",
    createdAt: preference?.createdAt ?? null,
    updatedAt: preference?.updatedAt ?? null,
  };
}

function mapCustomSource(
  row: SelectOf<typeof mcpRegistrySources>,
): McpRegistrySourceRecord {
  const sourceKind = CUSTOM_MCP_REGISTRY_SOURCE_KINDS.includes(
    row.sourceKind as CustomMcpRegistrySourceKind,
  )
    ? (row.sourceKind as CustomMcpRegistrySourceKind)
    : "custom";
  return {
    id: row.id,
    spaceId: row.accountId,
    name: row.name,
    baseUrl: row.baseUrl,
    sourceKind,
    authType: MCP_REGISTRY_AUTH_TYPES.includes(
      row.authType as McpRegistryAuthType,
    )
      ? (row.authType as McpRegistryAuthType)
      : "none",
    authHeaderName: row.authHeaderName ?? null,
    credentialConfigured: Boolean(row.authSecret),
    authSecretCiphertext: row.authSecret ?? null,
    enabled: row.enabled,
    priority: row.priority,
    readOnly: false,
    preview: false,
    bestEffort: true,
    verificationStatus: "not_assessed",
    securityStatus: "not_assessed",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validateName(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 120) {
    throw new BadRequestError("name must be between 1 and 120 characters");
  }
  return normalized;
}

function validatePriority(value: number): number {
  if (!Number.isInteger(value) || value < -1000 || value > 1000) {
    throw new BadRequestError(
      "priority must be an integer between -1000 and 1000",
    );
  }
  return value;
}

function validateCustomSourceKind(value: string): CustomMcpRegistrySourceKind {
  if (
    !CUSTOM_MCP_REGISTRY_SOURCE_KINDS.includes(
      value as CustomMcpRegistrySourceKind,
    )
  ) {
    throw new BadRequestError(
      "source_kind must be organization, community, or custom",
    );
  }
  return value as CustomMcpRegistrySourceKind;
}

function validateAuthType(value: string): McpRegistryAuthType {
  if (!MCP_REGISTRY_AUTH_TYPES.includes(value as McpRegistryAuthType)) {
    throw new BadRequestError("auth_type must be none, bearer, or header");
  }
  return value as McpRegistryAuthType;
}

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const FORBIDDEN_REGISTRY_AUTH_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function validateAuthHeaderName(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  if (
    !HEADER_NAME_PATTERN.test(normalized) ||
    FORBIDDEN_REGISTRY_AUTH_HEADERS.has(normalized.toLowerCase()) ||
    normalized.toLowerCase().startsWith("x-takos-")
  ) {
    throw new BadRequestError(
      "auth_header_name must be a safe HTTP header name; use bearer auth for Authorization",
    );
  }
  return normalized;
}

function validateAuthSecret(value: string): string {
  if (value.length < 1 || value.length > 4096 || /[\r\n]/.test(value)) {
    throw new BadRequestError(
      "auth_secret must be between 1 and 4096 characters without line breaks",
    );
  }
  return value;
}

function registryAuthSalt(sourceId: string): string {
  return `mcp:registry-source:auth:${sourceId}`;
}

async function encryptRegistryAuthSecret(
  env: Env,
  sourceId: string,
  secret: string,
): Promise<string> {
  const masterSecret = env.ENCRYPTION_KEY?.trim();
  if (!masterSecret) {
    throw new BadRequestError(
      "Registry credentials require ENCRYPTION_KEY to be configured",
    );
  }
  return await encryptToken(
    validateAuthSecret(secret),
    masterSecret,
    registryAuthSalt(sourceId),
  );
}

export function normalizeMcpRegistryBaseUrl(rawUrl: string, env: Env): string {
  if (rawUrl.length > 2048) {
    throw new BadRequestError("base_url is too long");
  }
  let parsed: URL;
  try {
    parsed = assertAllowedMcpEndpointUrl(
      rawUrl,
      getMcpEndpointUrlOptions(env),
      "MCP Registry source",
    );
  } catch (error) {
    throw new BadRequestError(
      error instanceof Error ? error.message : "base_url is invalid",
    );
  }
  if (parsed.search || parsed.hash) {
    throw new BadRequestError("base_url must not include a query or fragment");
  }
  if (env.ENVIRONMENT !== "development" && parsed.port) {
    throw new BadRequestError(
      "base_url must use the default HTTPS port in production",
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString().replace(/\/$/, "");
}

export async function listMcpRegistrySources(
  dbBinding: SqlDatabaseLike,
  spaceId: string,
): Promise<McpRegistrySourceRecord[]> {
  const db = getDb(dbBinding);
  const rows = await db
    .select()
    .from(mcpRegistrySources)
    .where(eq(mcpRegistrySources.accountId, spaceId))
    .orderBy(desc(mcpRegistrySources.priority), asc(mcpRegistrySources.name))
    .all();
  const officialPreference = rows.find(
    (row) => row.baseUrl === OFFICIAL_MCP_REGISTRY_BASE_URL,
  );
  const customRows = rows.filter(
    (row) => row.baseUrl !== OFFICIAL_MCP_REGISTRY_BASE_URL,
  );
  return [
    officialSource(spaceId, officialPreference),
    ...customRows.map(mapCustomSource),
  ].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

export async function createMcpRegistrySource(
  dbBinding: SqlDatabaseLike,
  env: Env,
  spaceId: string,
  input: McpRegistrySourceInput,
): Promise<McpRegistrySourceRecord> {
  const db = getDb(dbBinding);
  const name = validateName(input.name);
  const baseUrl = normalizeMcpRegistryBaseUrl(input.baseUrl, env);
  if (baseUrl === OFFICIAL_MCP_REGISTRY_BASE_URL) {
    throw new ConflictError(
      "The Official MCP Registry is already available as a read-only source",
    );
  }
  const sourceKind = validateCustomSourceKind(input.sourceKind ?? "custom");
  const priority = validatePriority(input.priority ?? 0);
  const authType = validateAuthType(input.authType ?? "none");
  const authHeaderName =
    authType === "header" ? validateAuthHeaderName(input.authHeaderName) : null;
  if (
    authType !== "none" &&
    !input.authSecret &&
    !(input.allowMissingCredential && input.enabled === false)
  ) {
    throw new BadRequestError(
      "auth_secret is required when Registry authentication is enabled",
    );
  }

  const existingRows = await db
    .select({ id: mcpRegistrySources.id })
    .from(mcpRegistrySources)
    .where(
      and(
        eq(mcpRegistrySources.accountId, spaceId),
        ne(mcpRegistrySources.sourceKind, "official"),
      ),
    )
    .all();
  if (existingRows.length >= MAX_CUSTOM_SOURCES_PER_WORKSPACE) {
    throw new BadRequestError(
      `A Workspace can configure at most ${MAX_CUSTOM_SOURCES_PER_WORKSPACE} custom MCP Registry sources`,
    );
  }
  const duplicate = await db
    .select({ id: mcpRegistrySources.id })
    .from(mcpRegistrySources)
    .where(
      and(
        eq(mcpRegistrySources.accountId, spaceId),
        eq(mcpRegistrySources.baseUrl, baseUrl),
      ),
    )
    .get();
  if (duplicate) {
    throw new ConflictError("MCP Registry source already exists");
  }

  const now = new Date().toISOString();
  const id = generateId(16);
  const authSecret = input.authSecret
    ? await encryptRegistryAuthSecret(env, id, input.authSecret)
    : null;
  await db.insert(mcpRegistrySources).values({
    id,
    accountId: spaceId,
    name,
    baseUrl,
    sourceKind,
    authType,
    authHeaderName,
    authSecret,
    enabled: input.enabled ?? true,
    priority,
    createdAt: now,
    updatedAt: now,
  });
  const created = await db
    .select()
    .from(mcpRegistrySources)
    .where(eq(mcpRegistrySources.id, id))
    .get();
  if (!created) {
    throw new Error("MCP Registry source insert invariant violated");
  }
  return mapCustomSource(created);
}

export async function updateMcpRegistrySource(
  dbBinding: SqlDatabaseLike,
  env: Env,
  spaceId: string,
  sourceId: string,
  patch: McpRegistrySourcePatch,
): Promise<McpRegistrySourceRecord | null> {
  if (sourceId === OFFICIAL_MCP_REGISTRY_SOURCE_ID) {
    if (
      patch.enabled === undefined ||
      patch.name !== undefined ||
      patch.baseUrl !== undefined ||
      patch.sourceKind !== undefined ||
      patch.priority !== undefined ||
      patch.authType !== undefined ||
      patch.authHeaderName !== undefined ||
      patch.authSecret !== undefined
    ) {
      throw new BadRequestError(
        "Only the enabled preference can be changed for the Official MCP Registry source",
      );
    }
    const db = getDb(dbBinding);
    const now = new Date().toISOString();
    await db
      .insert(mcpRegistrySources)
      .values({
        id: generateId(16),
        accountId: spaceId,
        name: "Official MCP Registry",
        baseUrl: OFFICIAL_MCP_REGISTRY_BASE_URL,
        sourceKind: "official",
        enabled: patch.enabled,
        priority: 100,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [mcpRegistrySources.accountId, mcpRegistrySources.baseUrl],
        set: {
          enabled: patch.enabled,
          updatedAt: now,
        },
      });
    const preference = await db
      .select()
      .from(mcpRegistrySources)
      .where(
        and(
          eq(mcpRegistrySources.accountId, spaceId),
          eq(mcpRegistrySources.baseUrl, OFFICIAL_MCP_REGISTRY_BASE_URL),
        ),
      )
      .get();
    return officialSource(spaceId, preference);
  }
  const db = getDb(dbBinding);
  const existing = await db
    .select()
    .from(mcpRegistrySources)
    .where(
      and(
        eq(mcpRegistrySources.id, sourceId),
        eq(mcpRegistrySources.accountId, spaceId),
      ),
    )
    .get();
  if (!existing) return null;

  const update: Partial<InsertOf<typeof mcpRegistrySources>> = {
    updatedAt: new Date().toISOString(),
  };
  if (patch.name !== undefined) update.name = validateName(patch.name);
  if (patch.sourceKind !== undefined) {
    update.sourceKind = validateCustomSourceKind(patch.sourceKind);
  }
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.priority !== undefined) {
    update.priority = validatePriority(patch.priority);
  }
  if (patch.baseUrl !== undefined) {
    const baseUrl = normalizeMcpRegistryBaseUrl(patch.baseUrl, env);
    if (baseUrl === OFFICIAL_MCP_REGISTRY_BASE_URL) {
      throw new ConflictError(
        "The Official MCP Registry is already available as a read-only source",
      );
    }
    const duplicate = await db
      .select({ id: mcpRegistrySources.id })
      .from(mcpRegistrySources)
      .where(
        and(
          eq(mcpRegistrySources.accountId, spaceId),
          eq(mcpRegistrySources.baseUrl, baseUrl),
        ),
      )
      .get();
    if (duplicate && duplicate.id !== sourceId) {
      throw new ConflictError("MCP Registry source already exists");
    }
    update.baseUrl = baseUrl;
  }

  const currentAuthType = validateAuthType(existing.authType ?? "none");
  const nextAuthType = validateAuthType(patch.authType ?? currentAuthType);
  const baseUrlChanged =
    update.baseUrl !== undefined && update.baseUrl !== existing.baseUrl;
  if (
    baseUrlChanged &&
    existing.authSecret &&
    nextAuthType !== "none" &&
    !patch.authSecret
  ) {
    throw new BadRequestError(
      "Changing an authenticated Registry host requires entering the credential again",
    );
  }
  if (
    patch.authType !== undefined &&
    nextAuthType !== "none" &&
    nextAuthType !== currentAuthType &&
    !patch.authSecret
  ) {
    throw new BadRequestError(
      "Changing Registry authentication type requires entering the credential again",
    );
  }
  update.authType = nextAuthType;
  update.authHeaderName =
    nextAuthType === "header"
      ? validateAuthHeaderName(patch.authHeaderName ?? existing.authHeaderName)
      : null;
  if (nextAuthType === "none") {
    update.authSecret = null;
  } else if (patch.authSecret !== undefined) {
    update.authSecret = await encryptRegistryAuthSecret(
      env,
      existing.id,
      patch.authSecret,
    );
  } else if (!existing.authSecret && !patch.allowMissingCredential) {
    throw new BadRequestError(
      "auth_secret is required when Registry authentication is enabled",
    );
  } else if (!existing.authSecret) {
    update.enabled = false;
  }

  await db
    .update(mcpRegistrySources)
    .set(update)
    .where(
      and(
        eq(mcpRegistrySources.id, sourceId),
        eq(mcpRegistrySources.accountId, spaceId),
      ),
    );
  const updated = await db
    .select()
    .from(mcpRegistrySources)
    .where(
      and(
        eq(mcpRegistrySources.id, sourceId),
        eq(mcpRegistrySources.accountId, spaceId),
      ),
    )
    .get();
  return updated ? mapCustomSource(updated) : null;
}

export async function deleteMcpRegistrySource(
  dbBinding: SqlDatabaseLike,
  spaceId: string,
  sourceId: string,
): Promise<boolean> {
  if (sourceId === OFFICIAL_MCP_REGISTRY_SOURCE_ID) {
    throw new BadRequestError(
      "The Official MCP Registry source is virtual and read-only",
    );
  }
  const db = getDb(dbBinding);
  const existing = await db
    .select({ id: mcpRegistrySources.id })
    .from(mcpRegistrySources)
    .where(
      and(
        eq(mcpRegistrySources.id, sourceId),
        eq(mcpRegistrySources.accountId, spaceId),
      ),
    )
    .get();
  if (!existing) return false;
  await db
    .delete(mcpRegistrySources)
    .where(
      and(
        eq(mcpRegistrySources.id, sourceId),
        eq(mcpRegistrySources.accountId, spaceId),
      ),
    );
  return true;
}

function registrySearchUrl(
  source: McpRegistrySourceRecord,
  query: string,
): URL {
  const base = source.baseUrl.endsWith("/")
    ? source.baseUrl
    : `${source.baseUrl}/`;
  const url = new URL("v0.1/servers", base);
  url.searchParams.set("search", query);
  url.searchParams.set("version", "latest");
  url.searchParams.set("limit", String(REGISTRY_SEARCH_RESULT_LIMIT));
  return url;
}

async function boundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > maxBytes
  ) {
    throw new RegistrySearchError(
      "response_too_large",
      "MCP Registry response exceeded the size limit",
    );
  }
  if (!response.body) {
    throw new RegistrySearchError(
      "invalid_response",
      "MCP Registry returned an empty response",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RegistrySearchError(
          "response_too_large",
          "MCP Registry response exceeded the size limit",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

async function fetchRegistrySearch(
  env: Env,
  spaceId: string,
  source: McpRegistrySourceRecord,
  query: string,
): Promise<z.infer<typeof registrySearchResponseSchema>> {
  const urlOptions = getMcpEndpointUrlOptions(env);
  const url = registrySearchUrl(source, query);
  assertAllowedMcpEndpointUrl(url.toString(), urlOptions, "MCP Registry");

  const signal = AbortSignal.timeout(REGISTRY_SEARCH_TIMEOUT_MS);
  const publicHeaders = new Headers({ Accept: "application/json" });
  if (source.authType !== "none") {
    const masterSecret = env.ENCRYPTION_KEY?.trim();
    if (!masterSecret || !source.authSecretCiphertext) {
      throw new RegistrySearchError(
        "credentials_required",
        "MCP Registry credential is not configured",
      );
    }
    let secret: string;
    try {
      secret = await decryptToken(
        source.authSecretCiphertext,
        masterSecret,
        registryAuthSalt(source.id),
      );
    } catch {
      throw new RegistrySearchError(
        "credentials_required",
        "MCP Registry credential could not be decrypted",
      );
    }
    if (source.authType === "bearer") {
      publicHeaders.set("Authorization", `Bearer ${secret}`);
    } else {
      publicHeaders.set(validateAuthHeaderName(source.authHeaderName), secret);
    }
  }
  let response: Response;
  try {
    if (env.TAKOS_EGRESS) {
      const egressHeaders = new Headers(publicHeaders);
      egressHeaders.set("X-Takos-Space-Id", spaceId);
      egressHeaders.set("X-Takos-Egress-Mode", "mcp-registry-search");
      response = await env.TAKOS_EGRESS.fetch(url, {
        method: "GET",
        headers: egressHeaders,
        redirect: "manual",
        credentials: "omit",
        signal,
      });
    } else {
      if (env.ENVIRONMENT !== "development") {
        throw new RegistrySearchError(
          "egress_unavailable",
          "Safe MCP Registry egress is unavailable",
        );
      }
      response = await fetch(url, {
        method: "GET",
        headers: publicHeaders,
        redirect: "manual",
        credentials: "omit",
        signal,
      });
    }
  } catch (error) {
    if (error instanceof RegistrySearchError) throw error;
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new RegistrySearchError(
        "timeout",
        "MCP Registry request timed out",
      );
    }
    throw new RegistrySearchError(
      "network_error",
      "MCP Registry request failed",
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw new RegistrySearchError(
      "redirect",
      "MCP Registry redirects are not followed",
      response.status,
    );
  }
  if (!response.ok) {
    throw new RegistrySearchError(
      "http_error",
      `MCP Registry returned HTTP ${response.status}`,
      response.status,
    );
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    !contentType.includes("application/json") &&
    !contentType.includes("+json")
  ) {
    throw new RegistrySearchError(
      "invalid_response",
      "MCP Registry response is not JSON",
      response.status,
    );
  }

  const body = await boundedResponseText(
    response,
    REGISTRY_SEARCH_MAX_RESPONSE_BYTES,
  );
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new RegistrySearchError(
      "invalid_response",
      "MCP Registry returned invalid JSON",
      response.status,
    );
  }
  const parsed = registrySearchResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new RegistrySearchError(
      "invalid_response",
      "MCP Registry response does not match the v0.1 server-list shape",
      response.status,
    );
  }
  return parsed.data;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return [];
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!, index);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), values.length) },
      () => worker(),
    ),
  );
  return results;
}

function safeRepositoryUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    )
      return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function candidateFromRemote(
  env: Env,
  source: McpRegistrySourceRecord,
  server: z.infer<typeof registryServerSchema>,
  remote: z.infer<typeof registryRemoteSchema>,
): McpRegistrySearchCandidate | null {
  if (remote.type !== "streamable-http") return null;
  // Template expansion requires user input and is intentionally outside this
  // direct, credential-free live-search foundation.
  if (remote.url.includes("{") || remote.url.includes("}")) return null;
  let url: URL;
  try {
    url = assertAllowedMcpEndpointUrl(
      remote.url,
      getMcpEndpointUrlOptions(env),
      "MCP server",
    );
  } catch {
    return null;
  }
  if (url.hash) return null;
  const provenance: McpRegistryCandidateProvenance = {
    sourceId: source.id,
    sourceName: source.name,
    sourceKind: source.sourceKind,
    baseUrl: source.baseUrl,
    priority: source.priority,
    preview: source.preview,
    bestEffort: source.bestEffort,
    serverName: server.name,
    serverVersion: server.version,
  };
  return {
    name: server.name,
    title: server.title ?? null,
    description: server.description ?? null,
    version: server.version,
    url: url.toString(),
    transport: "streamable-http",
    repositoryUrl: safeRepositoryUrl(server.repository?.url),
    repositorySubfolder: server.repository?.subfolder ?? null,
    requiresConfiguration:
      (remote.headers?.some((header) => header.isRequired !== false) ??
        false) ||
      Object.keys(remote.variables ?? {}).length > 0,
    packages: packageRecords(server),
    provenance: [provenance],
  };
}

function packageRecords(
  server: z.infer<typeof registryServerSchema>,
): McpRegistryPackage[] {
  return (server.packages ?? []).flatMap((entry) => {
    if (entry.registryType !== "npm" && entry.registryType !== "oci") {
      return [];
    }
    return [
      {
        registryType: entry.registryType,
        registryBaseUrl: safeRepositoryUrl(entry.registryBaseUrl),
        identifier: entry.identifier,
        version: entry.version ?? null,
        fileSha256: entry.fileSha256 ?? null,
        transportType: entry.transport.type,
        transportUrl: entry.transport.url ?? null,
        runtimeHint: entry.runtimeHint ?? null,
        requiresConfiguration: [
          ...(entry.environmentVariables ?? []),
          ...(entry.packageArguments ?? []),
          ...(entry.runtimeArguments ?? []),
        ].some((input) => input.isRequired !== false),
      },
    ];
  });
}

function candidateFromPackages(
  source: McpRegistrySourceRecord,
  server: z.infer<typeof registryServerSchema>,
): McpRegistrySearchCandidate | null {
  const packages = packageRecords(server);
  if (packages.length === 0) return null;
  return {
    name: server.name,
    title: server.title ?? null,
    description: server.description ?? null,
    version: server.version,
    url: null,
    transport: "package",
    repositoryUrl: safeRepositoryUrl(server.repository?.url),
    repositorySubfolder: server.repository?.subfolder ?? null,
    requiresConfiguration: packages.some(
      (entry) => entry.requiresConfiguration,
    ),
    packages,
    provenance: [
      {
        sourceId: source.id,
        sourceName: source.name,
        sourceKind: source.sourceKind,
        baseUrl: source.baseUrl,
        priority: source.priority,
        preview: source.preview,
        bestEffort: source.bestEffort,
        serverName: server.name,
        serverVersion: server.version,
      },
    ],
  };
}

export async function searchMcpRegistrySources(
  dbBinding: SqlDatabaseLike,
  env: Env,
  params: { spaceId: string; query: string },
): Promise<McpRegistrySearchResult> {
  const query = params.query.trim();
  if (query.length < 1 || query.length > 256) {
    throw new BadRequestError("q must be between 1 and 256 characters");
  }

  const sources = (
    await listMcpRegistrySources(dbBinding, params.spaceId)
  ).filter((source) => source.enabled);
  const outcomes = await mapWithConcurrency(
    sources,
    REGISTRY_SEARCH_MAX_CONCURRENCY,
    async (source) => {
      try {
        const response = await fetchRegistrySearch(
          env,
          params.spaceId,
          source,
          query,
        );
        const candidates: McpRegistrySearchCandidate[] = [];
        let remoteCount = 0;
        for (const entry of response.servers) {
          for (const remote of entry.server.remotes ?? []) {
            remoteCount += 1;
            const candidate = candidateFromRemote(
              env,
              source,
              entry.server,
              remote,
            );
            if (candidate) candidates.push(candidate);
          }
          const packageCandidate = candidateFromPackages(source, entry.server);
          if (packageCandidate) candidates.push(packageCandidate);
        }
        return {
          source,
          response,
          candidates,
          remoteCount,
          failure: null,
        };
      } catch (error) {
        const failure =
          error instanceof RegistrySearchError
            ? error
            : new RegistrySearchError(
                "network_error",
                "MCP Registry request failed",
              );
        return {
          source,
          response: null,
          candidates: [] as McpRegistrySearchCandidate[],
          remoteCount: 0,
          failure,
        };
      }
    },
  );

  const candidateMap = new Map<string, McpRegistrySearchCandidate>();
  const sourceResults: McpRegistrySearchResult["sourceResults"] = [];
  const sourceFailures: McpRegistrySearchFailure[] = [];
  for (const outcome of outcomes) {
    if (outcome.failure) {
      sourceFailures.push({
        sourceId: outcome.source.id,
        sourceName: outcome.source.name,
        sourceKind: outcome.source.sourceKind,
        code: outcome.failure.code,
        message: outcome.failure.message,
        status: outcome.failure.status,
      });
      continue;
    }
    sourceResults.push({
      sourceId: outcome.source.id,
      sourceName: outcome.source.name,
      matchedServers: outcome.response?.servers.length ?? 0,
      candidateCount: outcome.candidates.length,
      skippedRemoteCount: Math.max(
        0,
        outcome.remoteCount -
          outcome.candidates.filter(
            (candidate) => candidate.transport === "streamable-http",
          ).length,
      ),
    });
    for (const candidate of outcome.candidates) {
      const candidateKey =
        candidate.url ?? `package:${candidate.name}@${candidate.version}`;
      const existing = candidateMap.get(candidateKey);
      if (!existing) {
        candidateMap.set(candidateKey, candidate);
        continue;
      }
      for (const provenance of candidate.provenance) {
        if (
          !existing.provenance.some(
            (item) =>
              item.sourceId === provenance.sourceId &&
              item.serverName === provenance.serverName &&
              item.serverVersion === provenance.serverVersion,
          )
        ) {
          existing.provenance.push(provenance);
        }
      }
      existing.requiresConfiguration ||= candidate.requiresConfiguration;
      for (const packageEntry of candidate.packages) {
        if (
          !existing.packages.some(
            (entry) =>
              entry.registryType === packageEntry.registryType &&
              entry.identifier === packageEntry.identifier &&
              entry.version === packageEntry.version,
          )
        ) {
          existing.packages.push(packageEntry);
        }
      }
    }
  }

  const candidates = [...candidateMap.values()];
  for (const candidate of candidates) {
    candidate.provenance.sort(
      (a, b) =>
        b.priority - a.priority || a.sourceName.localeCompare(b.sourceName),
    );
  }
  candidates.sort((a, b) => {
    const aPriority = a.provenance[0]?.priority ?? 0;
    const bPriority = b.provenance[0]?.priority ?? 0;
    return (
      bPriority - aPriority ||
      (a.title ?? a.name).localeCompare(b.title ?? b.name)
    );
  });

  return {
    query,
    candidates,
    sourceResults,
    sourceFailures,
    limitations: {
      mode: "live_best_effort",
      upstreamSearch: "server_name_substring_only",
      cachedFullTextAggregation: false,
      credentialsSupported: true,
    },
  };
}
