import type {
  AppConsume,
  AppPublication,
} from "../source/app-manifest-types.ts";
import {
  deleteManagedTakosTokenConfig,
  ensureManagedTakosTokenValue,
  normalizeTakosScopes,
  resolveTakosApiUrl,
  resolveTakosInternalApiUrl,
  upsertManagedTakosTokenConfig,
} from "../common-env/takos-managed.ts";
import {
  createClient,
  deleteClient,
  getClientById,
  updateClient,
} from "../oauth/client.ts";
import { validateScopes as validateOAuthScopes } from "../oauth/scopes.ts";
import type { Env } from "../../../shared/types/index.ts";
import {
  decrypt,
  encrypt,
  type EncryptedData,
} from "../../../shared/utils/crypto.ts";

export interface PublicationOutputDescriptor {
  name: string;
  defaultEnv: string;
  secret: boolean;
}

export interface PublicationSpecFieldDescriptor {
  name: string;
  required: boolean;
  type: "string" | "string[]" | "object";
}

export interface PublicationKindDescriptor {
  publisher: "takos";
  type: TakosPublicationType;
  specFields: PublicationSpecFieldDescriptor[];
  outputs: PublicationOutputDescriptor[];
}

type PublicationEnv = Pick<
  Env,
  "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN" | "TAKOS_INTERNAL_API_URL"
>;

type PublicationOutputValue = {
  value: string;
  secret: boolean;
};

type ConsumeState = Record<string, unknown>;

type PublicationSyncParams = {
  env: PublicationEnv;
  spaceId: string;
  serviceId: string;
  serviceName: string;
  publication: AppPublication;
  previousState: ConsumeState | null;
};

type PublicationCleanupParams = {
  env: PublicationEnv;
  spaceId: string;
  serviceId: string;
  publication: AppPublication;
  state: ConsumeState | null;
};

type PublicationResolveParams = {
  env: PublicationEnv;
  spaceId: string;
  serviceId: string;
  publication: AppPublication;
  state: ConsumeState | null;
};

type PublicationKindDefinition = {
  descriptor: PublicationKindDescriptor;
  normalize(
    publication: AppPublication,
    options?: PublicationNormalizeOptions,
  ): AppPublication;
  syncConsumeState(params: PublicationSyncParams): Promise<ConsumeState>;
  cleanupConsumeState(params: PublicationCleanupParams): Promise<void>;
  resolveOutputs(
    params: PublicationResolveParams,
  ): Promise<Record<string, PublicationOutputValue>>;
};

export type PublicationNormalizeOptions = {
  allowRelativeOAuthRedirectUris?: boolean;
};

const PUBLICATION_ENV_PLACEHOLDER = "{PUBLICATION}";
const PUBLICATION_OUTPUT_ENDPOINT_ENV =
  `PUBLICATION_${PUBLICATION_ENV_PLACEHOLDER}_ENDPOINT`;
const PUBLICATION_OUTPUT_API_KEY_ENV =
  `PUBLICATION_${PUBLICATION_ENV_PLACEHOLDER}_API_KEY`;
const PUBLICATION_OUTPUT_CLIENT_ID_ENV =
  `PUBLICATION_${PUBLICATION_ENV_PLACEHOLDER}_CLIENT_ID`;
const PUBLICATION_OUTPUT_CLIENT_SECRET_ENV =
  `PUBLICATION_${PUBLICATION_ENV_PLACEHOLDER}_CLIENT_SECRET`;
const PUBLICATION_OUTPUT_ISSUER_ENV =
  `PUBLICATION_${PUBLICATION_ENV_PLACEHOLDER}_ISSUER`;
const PUBLICATION_OUTPUT_TOKEN_ENDPOINT_ENV =
  `PUBLICATION_${PUBLICATION_ENV_PLACEHOLDER}_TOKEN_ENDPOINT`;
const PUBLICATION_OUTPUT_USERINFO_ENDPOINT_ENV =
  `PUBLICATION_${PUBLICATION_ENV_PLACEHOLDER}_USERINFO_ENDPOINT`;

type TakosPublicationType = "api-key" | "oauth-client";
export const TAKOS_API_KEY_SOURCE = "takos.api-key";
export const TAKOS_OAUTH_CLIENT_SOURCE = "takos.oauth-client";

export const GRANT_PUBLICATION_FIELDS = new Set([
  "name",
  "publisher",
  "type",
  "spec",
]);

const TAKOS_API_KEY_SPEC_FIELDS = new Set(["scopes"]);
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

function assertAllowedFields(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(`${field}.${key} is not supported`);
    }
  }
}

export function isTakosSystemPublicationSource(source: string): boolean {
  return source === TAKOS_API_KEY_SOURCE || source === TAKOS_OAUTH_CLIENT_SOURCE;
}

function takosTypeFromSource(source: string): TakosPublicationType {
  if (source === TAKOS_API_KEY_SOURCE) return "api-key";
  if (source === TAKOS_OAUTH_CLIENT_SOURCE) return "oauth-client";
  throw new Error(`Unsupported Takos publication source: ${source}`);
}

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
  if (spec == null) {
    return {};
  }
  if (typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error(`publication '${publication.name}'.spec must be an object`);
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
  assertAllowedFields(record, TAKOS_OAUTH_METADATA_FIELDS, field);
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
  options: PublicationNormalizeOptions = {},
): string[] {
  const normalized = normalizeStringList(values, field);
  for (const uri of normalized) {
    if (options.allowRelativeOAuthRedirectUris && uri.startsWith("/")) {
      if (uri.startsWith("//")) {
        throw new Error(`Invalid ${field} entry: ${uri}`);
      }
      const parsedRelative = new URL(uri, "https://takos.local");
      if (parsedRelative.hash) {
        throw new Error(
          `Invalid ${field} entry: ${uri} must not include a fragment`,
        );
      }
      continue;
    }
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

function normalizeTakosApiPublication(
  publication: AppPublication,
): AppPublication {
  const name = normalizeName(publication.name, "publication.name");
  if (publication.publisher !== "takos" || publication.type !== "api-key") {
    throw new Error(
      `publication '${name}' must use publisher 'takos' and type 'api-key'`,
    );
  }
  const spec = requireSpecRecord(publication);
  assertAllowedFields(
    spec,
    TAKOS_API_KEY_SPEC_FIELDS,
    `publication '${name}'.spec`,
  );
  return {
    name,
    publisher: "takos",
    type: "api-key",
    spec: {
      scopes: normalizeTakosScopes(
        normalizeStringList(spec.scopes, `publication '${name}'.spec.scopes`),
      ),
    },
  };
}

function normalizeTakosOAuthPublication(
  publication: AppPublication,
  options: PublicationNormalizeOptions = {},
): AppPublication {
  const name = normalizeName(publication.name, "publication.name");
  if (
    publication.publisher !== "takos" || publication.type !== "oauth-client"
  ) {
    throw new Error(
      `publication '${name}' must use publisher 'takos' and type 'oauth-client'`,
    );
  }
  const spec = requireSpecRecord(publication);
  assertAllowedFields(
    spec,
    TAKOS_OAUTH_SPEC_FIELDS,
    `publication '${name}'.spec`,
  );
  const redirectUris = normalizeOAuthRedirectUris(
    spec.redirectUris,
    `publication '${name}'.spec.redirectUris`,
    options,
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
    publisher: "takos",
    type: "oauth-client",
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
  return expandDefaultEnv(PUBLICATION_OUTPUT_API_KEY_ENV, publicationName);
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

async function resolveOAuthClientNameFallback(
  params: PublicationSyncParams,
  currentClientId: string | null,
): Promise<string> {
  const previousServiceName = typeof params.previousState?.serviceName ===
      "string"
    ? params.previousState.serviceName.trim()
    : "";
  if (previousServiceName) return previousServiceName;
  if (currentClientId) {
    const currentClient = await getClientById(params.env.DB, currentClientId);
    if (currentClient?.name?.trim()) return currentClient.name.trim();
  }
  return params.serviceName;
}

const takosApiDefinition: PublicationKindDefinition = {
  descriptor: {
    publisher: "takos",
    type: "api-key",
    specFields: [{
      name: "scopes",
      required: true,
      type: "string[]",
    }],
    outputs: [
      withDefaultEnvTemplate(
        "endpoint",
        PUBLICATION_OUTPUT_ENDPOINT_ENV,
        false,
      ),
      withDefaultEnvTemplate("apiKey", PUBLICATION_OUTPUT_API_KEY_ENV, true),
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
    return { publisher: "takos", type: "api-key" };
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
    const endpoint = resolveTakosInternalApiUrl(params.env);
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

const takosOAuthDefinition: PublicationKindDefinition = {
  descriptor: {
    publisher: "takos",
    type: "oauth-client",
    specFields: [
      { name: "clientName", required: false, type: "string" },
      { name: "redirectUris", required: true, type: "string[]" },
      { name: "scopes", required: true, type: "string[]" },
      { name: "metadata", required: false, type: "object" },
    ],
    outputs: [
      withDefaultEnvTemplate(
        "clientId",
        PUBLICATION_OUTPUT_CLIENT_ID_ENV,
        false,
      ),
      withDefaultEnvTemplate(
        "clientSecret",
        PUBLICATION_OUTPUT_CLIENT_SECRET_ENV,
        true,
      ),
      withDefaultEnvTemplate("issuer", PUBLICATION_OUTPUT_ISSUER_ENV, false),
      withDefaultEnvTemplate(
        "tokenEndpoint",
        PUBLICATION_OUTPUT_TOKEN_ENDPOINT_ENV,
        false,
      ),
      withDefaultEnvTemplate(
        "userinfoEndpoint",
        PUBLICATION_OUTPUT_USERINFO_ENDPOINT_ENV,
        false,
      ),
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
    const serviceName = await resolveOAuthClientNameFallback(
      params,
      currentClientId,
    );
    const request = buildOAuthClientRequest(publication, serviceName);

    if (currentClientId) {
      const updated = await updateClient(
        params.env.DB,
        currentClientId,
        request,
      );
      if (updated) {
        return {
          publisher: "takos",
          type: "oauth-client",
          clientId: currentClientId,
          clientSecretEncrypted: currentSecret,
          serviceName,
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
      publisher: "takos",
      type: "oauth-client",
      clientId: created.client_id,
      serviceName,
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
    const serverApiUrl = resolveTakosInternalApiUrl(params.env);
    if (!serverApiUrl) {
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
      tokenEndpoint: {
        value: `${serverApiUrl.replace(/\/$/, "")}/oauth/token`,
        secret: false,
      },
      userinfoEndpoint: {
        value: `${serverApiUrl.replace(/\/$/, "")}/oauth/userinfo`,
        secret: false,
      },
    };
  },
};

function publicationKindKey(
  publisher: string,
  type: string,
): string {
  return `${publisher}:${type}`;
}

const PUBLICATION_KINDS = new Map<string, PublicationKindDefinition>([
  [publicationKindKey("takos", "api-key"), takosApiDefinition],
  [publicationKindKey("takos", "oauth-client"), takosOAuthDefinition],
]);

export function listPublicationKindDefinitions(): PublicationKindDescriptor[] {
  return Array.from(PUBLICATION_KINDS.values())
    .map((definition) => definition.descriptor)
    .sort((a, b) =>
      publicationKindKey(a.publisher, a.type).localeCompare(
        publicationKindKey(b.publisher, b.type),
      )
    );
}

function getPublicationDefinition(
  publication: Pick<AppPublication, "publisher" | "type" | "name">,
): PublicationKindDefinition {
  const publisher = normalizeName(
    publication.publisher || "",
    `publication '${publication.name}'.publisher`,
  );
  const type = normalizeName(
    publication.type || "",
    `publication '${publication.name}'.type`,
  );
  const definition = PUBLICATION_KINDS.get(publicationKindKey(publisher, type));
  if (!definition) {
    throw new Error(
      `publication '${publication.name}' publisher/type is unsupported: ${publisher}/${type}`,
    );
  }
  return definition;
}

export function normalizeGrantPublication(
  publication: AppPublication,
  options: PublicationNormalizeOptions = {},
): AppPublication {
  return getPublicationDefinition(publication).normalize(publication, options);
}

export function normalizeTakosSystemConsumePublication(
  consume: AppConsume,
  options: PublicationNormalizeOptions = {},
): AppPublication {
  const source = normalizeName(consume.publication, "consume.publication");
  const localName = normalizeName(
    consume.as ?? consume.publication,
    "consume.as",
  );
  const type = takosTypeFromSource(source);
  return normalizeGrantPublication({
    name: localName,
    publisher: "takos",
    type,
    spec: consume.request ?? {},
  }, options);
}

export function assertGrantPublicationPrerequisites(params: {
  env: Pick<Env, "DB">;
  spaceId: string;
  publication: AppPublication;
}): void {
  if (params.publication.publisher !== "takos") return;
  normalizeGrantPublication(params.publication);
}

export function grantOutputContract(
  publication: AppPublication,
): PublicationOutputDescriptor[] {
  return getPublicationDefinition(publication).descriptor.outputs.map((
    output,
  ) => ({
    ...output,
    defaultEnv: expandDefaultEnv(output.defaultEnv, publication.name),
  }));
}

export async function syncGrantConsumeState(
  params: PublicationSyncParams,
): Promise<ConsumeState> {
  return getPublicationDefinition(params.publication).syncConsumeState(params);
}

export async function cleanupGrantConsumeState(
  params: PublicationCleanupParams,
): Promise<void> {
  await getPublicationDefinition(params.publication).cleanupConsumeState(
    params,
  );
}

export async function resolveGrantConsumeOutputs(
  params: PublicationResolveParams,
): Promise<Record<string, PublicationOutputValue>> {
  return getPublicationDefinition(params.publication).resolveOutputs(params);
}

export function resolveTakosIssuerUrl(
  env: Pick<Env, "ADMIN_DOMAIN">,
): string | null {
  return resolveTakosApiUrl(env);
}
