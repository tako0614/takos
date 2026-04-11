import { and, eq } from "drizzle-orm";

import type { AppPublication } from "../source/app-manifest-types.ts";
import {
  deleteManagedTakosTokenConfig,
  ensureManagedTakosTokenValue,
  normalizeTakosScopes,
  resolveTakosApiUrl,
  resolveTakosTokenSubject,
  upsertManagedTakosTokenConfig,
} from "../common-env/takos-builtins.ts";
import { createClient, deleteClient, updateClient } from "../oauth/client.ts";
import { validateScopes as validateOAuthScopes } from "../oauth/scopes.ts";
import { getResourceByName } from "../resources/index.ts";
import { getResourceTypeQueryValues } from "../resources/capabilities.ts";
import { getDb, resourceAccessTokens } from "../../../infra/db/index.ts";
import type { Env, ResourcePermission } from "../../../shared/types/index.ts";
import {
  decrypt,
  encrypt,
  type EncryptedData,
} from "../../../shared/utils/crypto.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import { base64UrlEncode, generateId } from "../../../shared/utils/index.ts";

export interface PublicationOutputDescriptor {
  name: string;
  defaultEnv: string;
  secret: boolean;
}

export interface PublicationProviderFieldDescriptor {
  name: string;
  required: boolean;
  type: "string" | "string[]" | "object";
}

export interface PublicationProviderDescriptor {
  provider: string;
  kind: string;
  specFields: PublicationProviderFieldDescriptor[];
  outputs: PublicationOutputDescriptor[];
}

type ProviderEnv = Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">;

type ProviderOutputValue = {
  value: string;
  secret: boolean;
};

type ConsumeState = Record<string, unknown>;

type ProviderSyncParams = {
  env: ProviderEnv;
  spaceId: string;
  serviceId: string;
  serviceName: string;
  publication: AppPublication;
  previousState: ConsumeState | null;
};

type ProviderCleanupParams = {
  env: ProviderEnv;
  spaceId: string;
  serviceId: string;
  publication: AppPublication;
  state: ConsumeState | null;
};

type ProviderResolveParams = {
  env: ProviderEnv;
  spaceId: string;
  serviceId: string;
  publication: AppPublication;
  state: ConsumeState | null;
};

type PublicationProviderDefinition = {
  descriptor: PublicationProviderDescriptor;
  normalize(publication: AppPublication): AppPublication;
  syncConsumeState(params: ProviderSyncParams): Promise<ConsumeState>;
  cleanupConsumeState(params: ProviderCleanupParams): Promise<void>;
  resolveOutputs(
    params: ProviderResolveParams,
  ): Promise<Record<string, ProviderOutputValue>>;
};

type TakosResourceRecord = NonNullable<
  Awaited<ReturnType<typeof getResourceByName>>
>;

const PUBLICATION_ENV_PLACEHOLDER = "{PUBLICATION}";
const PROVIDER_OUTPUT_ENDPOINT_ENV =
  `PUBLICATION_${PUBLICATION_ENV_PLACEHOLDER}_ENDPOINT`;
const PROVIDER_OUTPUT_API_KEY_ENV =
  `PUBLICATION_${PUBLICATION_ENV_PLACEHOLDER}_API_KEY`;
const PROVIDER_OUTPUT_CLIENT_ID_ENV =
  `PUBLICATION_${PUBLICATION_ENV_PLACEHOLDER}_CLIENT_ID`;
const PROVIDER_OUTPUT_CLIENT_SECRET_ENV =
  `PUBLICATION_${PUBLICATION_ENV_PLACEHOLDER}_CLIENT_SECRET`;
const PROVIDER_OUTPUT_ISSUER_ENV =
  `PUBLICATION_${PUBLICATION_ENV_PLACEHOLDER}_ISSUER`;

const TAKOS_RESOURCE_KINDS = [
  "analytics-engine",
  "key-value",
  "object-store",
  "queue",
  "sql",
  "vector-index",
] as const;

type TakosResourceKind = (typeof TAKOS_RESOURCE_KINDS)[number];

export const PROVIDER_PUBLICATION_FIELDS = new Set([
  "name",
  "provider",
  "kind",
  "spec",
]);

function normalizeName(name: string, field: string): string {
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function requireSpecRecord(
  publication: AppPublication,
): Record<string, unknown> {
  const spec = publication.spec;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return {};
  }
  return spec;
}

function normalizeStringList(values: unknown, field: string): string[] {
  if (!Array.isArray(values)) {
    throw new Error(`${field} must be an array`);
  }
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

function normalizeOptionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value == null) return undefined;
  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error(`${field} must not be empty`);
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

function expandDefaultEnv(template: string, publicationName: string): string {
  return template.replaceAll(
    PUBLICATION_ENV_PLACEHOLDER,
    normalizePublicationEnvSegment(publicationName),
  );
}

function withDefaultEnvTemplate(
  name: string,
  defaultEnv: string,
  secret: boolean,
): PublicationOutputDescriptor {
  return { name, defaultEnv, secret };
}

function normalizePublicationMetadata(
  metadata: unknown,
  field: string,
): Record<string, string> | undefined {
  if (metadata == null) return undefined;
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`${field} must be an object`);
  }
  const record = metadata as Record<string, unknown>;
  const normalized = {
    ...(normalizeOptionalString(record.logoUri, `${field}.logoUri`)
      ? {
        logoUri: normalizeOptionalString(record.logoUri, `${field}.logoUri`)!,
      }
      : {}),
    ...(normalizeOptionalString(record.tosUri, `${field}.tosUri`)
      ? { tosUri: normalizeOptionalString(record.tosUri, `${field}.tosUri`)! }
      : {}),
    ...(normalizeOptionalString(record.policyUri, `${field}.policyUri`)
      ? {
        policyUri: normalizeOptionalString(
          record.policyUri,
          `${field}.policyUri`,
        )!,
      }
      : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeOAuthRedirectUris(
  values: unknown,
  field: string,
): string[] {
  const normalized = normalizeStringList(values, field);
  for (const uri of normalized) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new Error(`Invalid ${field} entry: ${uri}`);
    }
    const isLocalhost = parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]" ||
      parsed.hostname.endsWith(".localhost");
    if (parsed.protocol !== "https:" && !isLocalhost) {
      throw new Error(`Invalid ${field} entry: ${uri} must use HTTPS`);
    }
    if (parsed.hash) {
      throw new Error(
        `Invalid ${field} entry: ${uri} must not include a fragment`,
      );
    }
  }
  return normalized;
}

function normalizeTakosResourceKind(kind: string): TakosResourceKind {
  const normalized = String(kind || "").trim();
  if (!TAKOS_RESOURCE_KINDS.includes(normalized as TakosResourceKind)) {
    throw new Error(
      `publication kind '${kind}' is not a supported Takos resource provider`,
    );
  }
  return normalized as TakosResourceKind;
}

function normalizeResourcePermission(
  value: unknown,
  field: string,
): ResourcePermission {
  const normalized = String(value ?? "read").trim().toLowerCase();
  if (
    normalized === "read" || normalized === "write" || normalized === "admin"
  ) {
    return normalized;
  }
  throw new Error(`${field} must be one of read, write, admin`);
}

function normalizeTakosApiPublication(
  publication: AppPublication,
): AppPublication {
  const name = normalizeName(publication.name, "publication.name");
  const spec = requireSpecRecord(publication);
  return {
    name,
    provider: "takos",
    kind: "api",
    spec: {
      scopes: normalizeTakosScopes(
        normalizeStringList(spec.scopes, `publication '${name}'.spec.scopes`),
      ),
    },
  };
}

function normalizeTakosOAuthPublication(
  publication: AppPublication,
): AppPublication {
  const name = normalizeName(publication.name, "publication.name");
  const spec = requireSpecRecord(publication);
  const redirectUris = normalizeOAuthRedirectUris(
    spec.redirectUris,
    `publication '${name}'.spec.redirectUris`,
  );
  const scopes = normalizeStringList(
    spec.scopes,
    `publication '${name}'.spec.scopes`,
  );
  const { valid, unknown } = validateOAuthScopes(scopes);
  if (!valid) {
    throw new Error(`Unknown OAuth scopes: ${unknown.join(", ")}`);
  }
  const metadata = normalizePublicationMetadata(
    spec.metadata,
    `publication '${name}'.spec.metadata`,
  );
  return {
    name,
    provider: "takos",
    kind: "oauth-client",
    spec: {
      ...(normalizeOptionalString(
          spec.clientName,
          `publication '${name}'.spec.clientName`,
        )
        ? {
          clientName: normalizeOptionalString(
            spec.clientName,
            `publication '${name}'.spec.clientName`,
          ),
        }
        : {}),
      redirectUris,
      scopes,
      ...(metadata ? { metadata } : {}),
    },
  };
}

function normalizeTakosResourcePublication(
  publication: AppPublication,
): AppPublication {
  const name = normalizeName(publication.name, "publication.name");
  const kind = normalizeTakosResourceKind(
    normalizeName(publication.kind || "", `publication '${name}'.kind`),
  );
  const spec = requireSpecRecord(publication);
  const resource = normalizeOptionalString(
    spec.resource,
    `publication '${name}'.spec.resource`,
  );
  if (!resource) {
    throw new Error(`publication '${name}'.spec.resource is required`);
  }
  return {
    name,
    provider: "takos",
    kind,
    spec: {
      resource,
      permission: normalizeResourcePermission(
        spec.permission,
        `publication '${name}'.spec.permission`,
      ),
    },
  };
}

function buildConsumeSecretSalt(
  serviceId: string,
  publicationName: string,
): string {
  return `service-consume:${serviceId}:${publicationName}`;
}

function requireEncryptionKey(env: Pick<Env, "ENCRYPTION_KEY">): string {
  const key = String(env.ENCRYPTION_KEY || "").trim();
  if (!key) {
    throw new Error("ENCRYPTION_KEY must be set");
  }
  return key;
}

async function encryptConsumeSecret(
  env: Pick<Env, "ENCRYPTION_KEY">,
  serviceId: string,
  publicationName: string,
  value: string,
): Promise<string> {
  const encrypted = await encrypt(
    value,
    requireEncryptionKey(env),
    buildConsumeSecretSalt(serviceId, publicationName),
  );
  return JSON.stringify(encrypted);
}

async function decryptConsumeSecret(
  env: Pick<Env, "ENCRYPTION_KEY">,
  serviceId: string,
  publicationName: string,
  value: string,
): Promise<string> {
  let encrypted: EncryptedData;
  try {
    encrypted = JSON.parse(value) as EncryptedData;
  } catch (err) {
    throw new Error(
      `Failed to parse encrypted consume secret for ${publicationName}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return decrypt(
    encrypted,
    requireEncryptionKey(env),
    buildConsumeSecretSalt(serviceId, publicationName),
  );
}

function takosApiStateEnv(publicationName: string): string {
  return expandDefaultEnv(PROVIDER_OUTPUT_API_KEY_ENV, publicationName);
}

function buildOAuthClientRequest(
  publication: AppPublication,
  serviceName: string,
) {
  const spec = requireSpecRecord(publication);
  const metadata = normalizePublicationMetadata(
    spec.metadata,
    `publication '${publication.name}'.spec.metadata`,
  );
  return {
    client_name: normalizeOptionalString(
      spec.clientName,
      `publication '${publication.name}'.spec.clientName`,
    ) || serviceName,
    redirect_uris: normalizeOAuthRedirectUris(
      spec.redirectUris,
      `publication '${publication.name}'.spec.redirectUris`,
    ),
    scope: normalizeStringList(
      spec.scopes,
      `publication '${publication.name}'.spec.scopes`,
    ).join(" "),
    logo_uri: metadata?.logoUri,
    policy_uri: metadata?.policyUri,
    tos_uri: metadata?.tosUri,
    token_endpoint_auth_method: "client_secret_post" as const,
  };
}

function parseTakosResourceState(state: ConsumeState | null): {
  kind: TakosResourceKind | null;
  resourceId: string | null;
  permission: ResourcePermission | null;
  tokenId: string | null;
  tokenEncrypted: string | null;
} {
  const kind = typeof state?.kind === "string" &&
      TAKOS_RESOURCE_KINDS.includes(state.kind as TakosResourceKind)
    ? state.kind as TakosResourceKind
    : null;
  return {
    kind,
    resourceId: typeof state?.resourceId === "string" ? state.resourceId : null,
    permission: typeof state?.permission === "string"
      ? normalizeResourcePermission(
        state.permission,
        "publication state permission",
      )
      : null,
    tokenId: typeof state?.tokenId === "string" ? state.tokenId : null,
    tokenEncrypted: typeof state?.tokenEncrypted === "string"
      ? state.tokenEncrypted
      : null,
  };
}

async function loadTakosResource(
  env: Pick<Env, "DB">,
  spaceId: string,
  publication: AppPublication,
  kind: TakosResourceKind,
): Promise<TakosResourceRecord> {
  const spec = requireSpecRecord(publication);
  const resource = normalizeName(
    String(spec.resource ?? ""),
    `publication '${publication.name}'.spec.resource`,
  );
  const resolvedSubject = await resolveTakosTokenSubject({
    env,
    spaceId,
  });
  const loadedResource = await getResourceByName(
    env.DB,
    resolvedSubject.subjectUserId,
    resource,
  );
  if (!loadedResource) {
    throw new Error(
      `publication references unknown Takos ${kind} resource '${resource}'`,
    );
  }
  const allowedTypes = new Set(getResourceTypeQueryValues(kind));
  if (!allowedTypes.has(loadedResource.type)) {
    throw new Error(
      `publication '${publication.name}' resource '${resource}' is not of type ${kind}`,
    );
  }
  return loadedResource;
}

function requireTakosResourceId(
  publication: AppPublication,
  resource: TakosResourceRecord,
): string {
  const resourceId = resource._internal_id ?? resource.id;
  if (!resourceId) {
    throw new Error(
      `publication '${publication.name}' resource '${resource.name}' is missing an internal id`,
    );
  }
  return resourceId;
}

function takosResourceEndpoint(
  env: Pick<Env, "ADMIN_DOMAIN">,
  kind: TakosResourceKind,
  resourceId: string,
): string {
  const baseUrl = resolveTakosApiUrl(env);
  if (!baseUrl) {
    throw new Error("ADMIN_DOMAIN must be set to use Takos publications");
  }
  switch (kind) {
    case "analytics-engine":
    case "vector-index":
      return `${baseUrl}/api/resources/${resourceId}/connection`;
    case "sql":
      return `${baseUrl}/api/resources/${resourceId}/sql/query`;
    case "object-store":
      return `${baseUrl}/api/resources/${resourceId}/objects`;
    case "key-value":
      return `${baseUrl}/api/resources/${resourceId}/kv/entries`;
    case "queue":
      return `${baseUrl}/api/resources/${resourceId}/connection`;
  }
}

async function mintResourceAccessToken(): Promise<{
  token: string;
  tokenHash: string;
  tokenPrefix: string;
}> {
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = `tak_res_${base64UrlEncode(tokenBytes)}`;
  const tokenHash = await computeSHA256(token);
  return {
    token,
    tokenHash,
    tokenPrefix: token.slice(0, 12),
  };
}

async function syncTakosResourceConsumeState(
  params: ProviderSyncParams,
  kind: TakosResourceKind,
): Promise<ConsumeState> {
  const publication = normalizeTakosResourcePublication(params.publication);
  if (publication.kind !== kind) {
    throw new Error(
      `publication '${publication.name}' kind must be '${kind}'`,
    );
  }
  const spec = requireSpecRecord(publication);
  const resource = await loadTakosResource(
    params.env,
    params.spaceId,
    publication,
    kind,
  );
  const resourceId = requireTakosResourceId(publication, resource);
  const permission = normalizeResourcePermission(
    spec.permission,
    `publication '${publication.name}'.spec.permission`,
  );
  const previousState = parseTakosResourceState(params.previousState);
  const db = getDb(params.env.DB);

  if (
    previousState.kind === kind &&
    previousState.resourceId === resourceId &&
    previousState.permission === permission &&
    previousState.tokenId &&
    previousState.tokenEncrypted
  ) {
    const existing = await db.select({ id: resourceAccessTokens.id })
      .from(resourceAccessTokens)
      .where(and(
        eq(resourceAccessTokens.id, previousState.tokenId),
        eq(resourceAccessTokens.resourceId, resourceId),
      ))
      .get();
    if (existing) {
      return {
        provider: "takos",
        kind,
        resourceId,
        permission,
        tokenId: previousState.tokenId,
        tokenEncrypted: previousState.tokenEncrypted,
      };
    }
  }

  const minted = await mintResourceAccessToken();
  const tokenId = generateId();
  const tokenEncrypted = await encryptConsumeSecret(
    params.env,
    params.serviceId,
    publication.name,
    minted.token,
  );
  const timestamp = new Date().toISOString();

  await db.insert(resourceAccessTokens).values({
    id: tokenId,
    resourceId,
    name: `publication:${publication.name}:${kind}`,
    tokenHash: minted.tokenHash,
    tokenPrefix: minted.tokenPrefix,
    permission,
    expiresAt: null,
    createdBy: params.serviceId,
    createdAt: timestamp,
  });

  if (
    previousState.tokenId &&
    previousState.tokenId !== tokenId &&
    previousState.resourceId
  ) {
    await db.delete(resourceAccessTokens).where(and(
      eq(resourceAccessTokens.id, previousState.tokenId),
      eq(resourceAccessTokens.resourceId, previousState.resourceId),
    ));
  }

  return {
    provider: "takos",
    kind,
    resourceId,
    permission,
    tokenId,
    tokenEncrypted,
  };
}

async function cleanupTakosResourceConsumeState(
  params: ProviderCleanupParams,
  kind: TakosResourceKind,
): Promise<void> {
  const state = parseTakosResourceState(params.state);
  if (!state.tokenId || state.kind !== kind) {
    return;
  }
  const db = getDb(params.env.DB);
  await db.delete(resourceAccessTokens).where(
    eq(resourceAccessTokens.id, state.tokenId),
  );
}

async function resolveTakosResourceOutputs(
  params: ProviderResolveParams,
  kind: TakosResourceKind,
): Promise<Record<string, ProviderOutputValue>> {
  const publication = normalizeTakosResourcePublication(params.publication);
  if (publication.kind !== kind) {
    throw new Error(
      `publication '${publication.name}' kind must be '${kind}'`,
    );
  }
  const resource = await loadTakosResource(
    params.env,
    params.spaceId,
    publication,
    kind,
  );
  const resourceId = requireTakosResourceId(publication, resource);
  const state = parseTakosResourceState(params.state);
  if (
    state.kind !== kind ||
    state.resourceId !== resourceId ||
    !state.tokenEncrypted
  ) {
    throw new Error(
      `publication '${publication.name}' is configured but resource credentials are unavailable`,
    );
  }
  const apiKey = await decryptConsumeSecret(
    params.env,
    params.serviceId,
    publication.name,
    state.tokenEncrypted,
  );
  return {
    endpoint: {
      value: takosResourceEndpoint(params.env, kind, resourceId),
      secret: false,
    },
    apiKey: {
      value: apiKey,
      secret: true,
    },
  };
}

function buildTakosResourceProvider(
  kind: TakosResourceKind,
): PublicationProviderDefinition {
  return {
    descriptor: {
      provider: "takos",
      kind,
      specFields: [
        { name: "resource", required: true, type: "string" },
        { name: "permission", required: false, type: "string" },
      ],
      outputs: [
        withDefaultEnvTemplate("endpoint", PROVIDER_OUTPUT_ENDPOINT_ENV, false),
        withDefaultEnvTemplate("apiKey", PROVIDER_OUTPUT_API_KEY_ENV, true),
      ],
    },
    normalize(publication) {
      const normalized = normalizeTakosResourcePublication(publication);
      if (normalized.kind !== kind) {
        throw new Error(
          `publication '${publication.name}' kind must be '${kind}'`,
        );
      }
      return normalized;
    },
    syncConsumeState(params) {
      return syncTakosResourceConsumeState(params, kind);
    },
    cleanupConsumeState(params) {
      return cleanupTakosResourceConsumeState(params, kind);
    },
    resolveOutputs(params) {
      return resolveTakosResourceOutputs(params, kind);
    },
  };
}

const takosApiProvider: PublicationProviderDefinition = {
  descriptor: {
    provider: "takos",
    kind: "api",
    specFields: [{
      name: "scopes",
      required: true,
      type: "string[]",
    }],
    outputs: [
      withDefaultEnvTemplate("endpoint", PROVIDER_OUTPUT_ENDPOINT_ENV, false),
      withDefaultEnvTemplate("apiKey", PROVIDER_OUTPUT_API_KEY_ENV, true),
    ],
  },
  normalize: normalizeTakosApiPublication,
  async syncConsumeState(params) {
    const publication = normalizeTakosApiPublication(params.publication);
    await upsertManagedTakosTokenConfig({
      env: params.env,
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      envName: takosApiStateEnv(publication.name),
      scopes: (publication.spec?.scopes as string[]) ?? [],
    });
    return { provider: "takos", kind: "api" };
  },
  async cleanupConsumeState(params) {
    await deleteManagedTakosTokenConfig({
      env: params.env,
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      envName: takosApiStateEnv(params.publication.name),
    });
  },
  async resolveOutputs(params) {
    const endpoint = resolveTakosApiUrl(params.env);
    if (!endpoint) {
      throw new Error("ADMIN_DOMAIN must be set to use Takos publications");
    }
    const token = await ensureManagedTakosTokenValue({
      env: params.env,
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      envName: takosApiStateEnv(params.publication.name),
    });
    if (!token) {
      throw new Error(
        `publication '${params.publication.name}' is configured but API credentials are unavailable`,
      );
    }
    return {
      endpoint: { value: endpoint, secret: false },
      apiKey: { value: token.value, secret: true },
    };
  },
};

const takosOAuthProvider: PublicationProviderDefinition = {
  descriptor: {
    provider: "takos",
    kind: "oauth-client",
    specFields: [
      { name: "clientName", required: false, type: "string" },
      { name: "redirectUris", required: true, type: "string[]" },
      { name: "scopes", required: true, type: "string[]" },
      { name: "metadata", required: false, type: "object" },
    ],
    outputs: [
      withDefaultEnvTemplate("clientId", PROVIDER_OUTPUT_CLIENT_ID_ENV, false),
      withDefaultEnvTemplate(
        "clientSecret",
        PROVIDER_OUTPUT_CLIENT_SECRET_ENV,
        true,
      ),
      withDefaultEnvTemplate("issuer", PROVIDER_OUTPUT_ISSUER_ENV, false),
    ],
  },
  normalize: normalizeTakosOAuthPublication,
  async syncConsumeState(params) {
    const publication = normalizeTakosOAuthPublication(params.publication);
    const previousState = params.previousState;
    const currentClientId = typeof previousState?.clientId === "string"
      ? previousState.clientId
      : null;
    const currentSecret =
      typeof previousState?.clientSecretEncrypted === "string"
        ? previousState.clientSecretEncrypted
        : null;
    const request = buildOAuthClientRequest(publication, params.serviceName);

    if (currentClientId) {
      const updated = await updateClient(
        params.env.DB,
        currentClientId,
        request,
      );
      if (updated) {
        return {
          provider: "takos",
          kind: "oauth-client",
          clientId: currentClientId,
          clientSecretEncrypted: currentSecret,
        };
      }
      await deleteClient(params.env.DB, currentClientId);
    }

    const created = await createClient(params.env.DB, request, params.spaceId);
    if (!created.client_secret) {
      throw new Error(
        "OAuth client registration did not return a client secret",
      );
    }
    return {
      provider: "takos",
      kind: "oauth-client",
      clientId: created.client_id,
      clientSecretEncrypted: await encryptConsumeSecret(
        params.env,
        params.serviceId,
        publication.name,
        created.client_secret,
      ),
    };
  },
  async cleanupConsumeState(params) {
    const clientId = typeof params.state?.clientId === "string"
      ? params.state.clientId
      : null;
    if (clientId) {
      await deleteClient(params.env.DB, clientId);
    }
  },
  async resolveOutputs(params) {
    const issuer = resolveTakosApiUrl(params.env);
    if (!issuer) {
      throw new Error("ADMIN_DOMAIN must be set to use Takos publications");
    }
    const clientId = typeof params.state?.clientId === "string"
      ? params.state.clientId
      : null;
    const clientSecretEncrypted =
      typeof params.state?.clientSecretEncrypted === "string"
        ? params.state.clientSecretEncrypted
        : null;
    if (!clientId || !clientSecretEncrypted) {
      throw new Error(
        `publication '${params.publication.name}' is configured but OAuth credentials are unavailable`,
      );
    }
    const clientSecret = await decryptConsumeSecret(
      params.env,
      params.serviceId,
      params.publication.name,
      clientSecretEncrypted,
    );
    return {
      clientId: { value: clientId, secret: false },
      clientSecret: { value: clientSecret, secret: true },
      issuer: { value: issuer, secret: false },
    };
  },
};

function providerKey(provider: string, kind: string): string {
  return `${provider}:${kind}`;
}

const PROVIDERS = new Map<string, PublicationProviderDefinition>([
  ...TAKOS_RESOURCE_KINDS.map((kind) =>
    [
      providerKey("takos", kind),
      buildTakosResourceProvider(kind),
    ] as const
  ),
  [providerKey("takos", "api"), takosApiProvider],
  [providerKey("takos", "oauth-client"), takosOAuthProvider],
]);

export function listPublicationProviders(): PublicationProviderDescriptor[] {
  return Array.from(PROVIDERS.values())
    .map((provider) => provider.descriptor)
    .sort((a, b) =>
      providerKey(a.provider, a.kind).localeCompare(
        providerKey(b.provider, b.kind),
      )
    );
}

function getPublicationProvider(
  publication: Pick<AppPublication, "provider" | "kind" | "name">,
): PublicationProviderDefinition {
  const provider = normalizeName(
    publication.provider || "",
    `publication '${publication.name}'.provider`,
  );
  const kind = normalizeName(
    publication.kind || "",
    `publication '${publication.name}'.kind`,
  );
  const definition = PROVIDERS.get(providerKey(provider, kind));
  if (!definition) {
    throw new Error(
      `publication '${publication.name}' provider/kind is unsupported: ${provider}/${kind}`,
    );
  }
  return definition;
}

export function normalizeProviderPublication(
  publication: AppPublication,
): AppPublication {
  return getPublicationProvider(publication).normalize(publication);
}

export function providerOutputContract(
  publication: AppPublication,
): PublicationOutputDescriptor[] {
  return getPublicationProvider(publication).descriptor.outputs.map((
    output,
  ) => ({
    ...output,
    defaultEnv: expandDefaultEnv(output.defaultEnv, publication.name),
  }));
}

export async function syncProviderConsumeState(
  params: ProviderSyncParams,
): Promise<ConsumeState> {
  return getPublicationProvider(params.publication).syncConsumeState(params);
}

export async function cleanupProviderConsumeState(
  params: ProviderCleanupParams,
): Promise<void> {
  await getPublicationProvider(params.publication).cleanupConsumeState(params);
}

export async function resolveProviderConsumeOutputs(
  params: ProviderResolveParams,
): Promise<Record<string, ProviderOutputValue>> {
  return getPublicationProvider(params.publication).resolveOutputs(params);
}

export function resolveTakosIssuerUrl(
  env: Pick<Env, "ADMIN_DOMAIN">,
): string | null {
  return resolveTakosApiUrl(env);
}
