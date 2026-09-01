import { and, eq } from "drizzle-orm";

import {
  getDb,
  providerMaterializationRevisions,
  runs,
  type SqlDatabaseLike,
} from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import { stringifyCanonicalJson } from "../../../shared/utils/canonical-json.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import { accountsDelegatedAuthorization } from "../../../server/routes/auth/accounts-delegation.ts";
import {
  fetchAuthorizedRuntimeInterfaces,
  issueRuntimeInterfaceAccessToken,
  type AuthorizedRuntimeInterface,
  type RuntimeInterfaceFetch,
} from "../platform/runtime-interface-client.ts";
import {
  appendRunContextResourceReferences,
  loadRunExecutionAuthority,
  runAuthorityAttestationsEqual,
  type RunAuthorityAttestation,
  type RunExecutionAuthority,
} from "./run-authority.ts";

const MATERIALIZATION_SCHEMA_VERSION = 1 as const;
const AI_GATEWAY_INTERFACE_TYPE = "takosumi.ai.gateway";
const AI_GATEWAY_CHAT_PERMISSION = "ai.chat";
const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export type ProviderMaterializationSourceKind =
  | "local_smoke"
  | "deployment_shared_key"
  | "takosumi_interface";

type LocalSmokeMaterialization = {
  schemaVersion: typeof MATERIALIZATION_SCHEMA_VERSION;
  runId: string;
  workspaceId: string;
  modelId: "local-smoke";
  sourceKind: "local_smoke";
  protocol: "local_smoke";
};

type SharedKeyMaterialization = {
  schemaVersion: typeof MATERIALIZATION_SCHEMA_VERSION;
  runId: string;
  workspaceId: string;
  modelId: string;
  sourceKind: "deployment_shared_key";
  protocol: "openai_chat_completions";
  endpoint: string;
  credentialSource: "OPENAI_API_KEY";
};

type TakosumiInterfaceMaterialization = {
  schemaVersion: typeof MATERIALIZATION_SCHEMA_VERSION;
  runId: string;
  workspaceId: string;
  modelId: string;
  sourceKind: "takosumi_interface";
  protocol: "openai_chat_completions";
  endpoint: string;
  accountsBaseUrl: string;
  externalWorkspaceId: string;
  externalSubjectId: string;
  interfaceId: string;
  interfaceGeneration: number;
  interfaceResolvedRevision: number;
  bindingId: string;
  bindingGeneration: number;
  bindingObservedInterfaceRevision: number;
  permission: typeof AI_GATEWAY_CHAT_PERMISSION;
};

export type ProviderMaterializationSnapshot =
  | LocalSmokeMaterialization
  | SharedKeyMaterialization
  | TakosumiInterfaceMaterialization;

export type PinnedProviderMaterialization = {
  resourceId: string;
  materializationDigest: string;
  snapshot: ProviderMaterializationSnapshot;
};

export type ProviderRuntimeCredential = {
  materializationId: string;
  materializationDigest: string;
  protocol: "local_smoke" | "openai_chat_completions";
  endpoint: string | null;
  apiKey: string | null;
};

type DelegatedAuthorization = Awaited<
  ReturnType<typeof accountsDelegatedAuthorization>
>;

export type ProviderMaterializationDependencies = {
  accountsDelegatedAuthorization(
    input: Parameters<typeof accountsDelegatedAuthorization>[0],
  ): Promise<DelegatedAuthorization>;
  fetchAuthorizedRuntimeInterfaces:
    typeof fetchAuthorizedRuntimeInterfaces;
  issueRuntimeInterfaceAccessToken: typeof issueRuntimeInterfaceAccessToken;
  fetch: RuntimeInterfaceFetch;
};

const defaultDependencies: ProviderMaterializationDependencies = {
  accountsDelegatedAuthorization,
  fetchAuthorizedRuntimeInterfaces,
  issueRuntimeInterfaceAccessToken,
  fetch: (input, init) => fetch(input, init),
};

export class ProviderMaterializationUnavailableError extends Error {
  readonly code = "provider_materialization_unavailable" as const;

  constructor(message = "Provider materialization is unavailable") {
    super(message);
    this.name = "ProviderMaterializationUnavailableError";
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedOpaqueId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 512;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function canonicalJson(value: unknown): string {
  const encoded = stringifyCanonicalJson(value);
  if (encoded === undefined) {
    throw new TypeError("Provider materialization is not JSON serializable");
  }
  return encoded;
}

async function digestJson(json: string): Promise<string> {
  return `sha256:${await computeSHA256(json)}`;
}

function canonicalHttpsUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash
    ) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function openAiChatCompletionsEndpoint(
  baseUrl: string | undefined,
): string | undefined {
  const value = nonEmptyString(baseUrl);
  if (!value) return DEFAULT_OPENAI_ENDPOINT;
  const canonical = canonicalHttpsUrl(value);
  if (!canonical) return undefined;
  const url = new URL(canonical);
  const path = url.pathname.replace(/\/+$/u, "");
  if (!path.endsWith("/chat/completions")) {
    url.pathname = `${path}/chat/completions`;
  }
  return url.toString();
}

function configuredAccountsBaseUrl(env: Env): string | undefined {
  const raw = nonEmptyString(env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ??
    nonEmptyString(env.TAKOSUMI_ACCOUNTS_URL) ??
    nonEmptyString(env.OIDC_ISSUER_URL);
  return raw ? canonicalHttpsUrl(raw) : undefined;
}

function sharedProviderKeyAllowed(env: Env): boolean {
  return env.ENVIRONMENT === "development" ||
    nonEmptyString(env.TAKOS_AGENT_ALLOW_SHARED_PROVIDER_KEY)?.toLowerCase() ===
      "true";
}

function exactInterfaceSnapshot(
  params: {
    runId: string;
    workspaceId: string;
    modelId: string;
    accountsBaseUrl: string;
    authorization: DelegatedAuthorization;
  },
  selected: AuthorizedRuntimeInterface,
): TakosumiInterfaceMaterialization | null {
  const iface = selected.interface;
  const binding = selected.binding;
  const endpoint = nonEmptyString(iface.status.resolvedInputs?.endpoint);
  const resourceInput = iface.spec.access.resourceUriInput;
  const resource = resourceInput
    ? nonEmptyString(iface.status.resolvedInputs?.[resourceInput])
    : undefined;
  const canonicalEndpoint = endpoint ? canonicalHttpsUrl(endpoint) : undefined;
  if (
    !canonicalEndpoint || !resource ||
    canonicalHttpsUrl(resource) !== canonicalEndpoint ||
    !boundedOpaqueId(iface.metadata.id) ||
    !positiveInteger(iface.metadata.generation) ||
    !positiveInteger(iface.status.resolvedRevision) ||
    !boundedOpaqueId(binding.metadata.id) ||
    !positiveInteger(binding.metadata.generation) ||
    !positiveInteger(binding.status.observedInterfaceRevision)
  ) return null;
  return {
    schemaVersion: MATERIALIZATION_SCHEMA_VERSION,
    runId: params.runId,
    workspaceId: params.workspaceId,
    modelId: params.modelId,
    sourceKind: "takosumi_interface",
    protocol: "openai_chat_completions",
    endpoint: openAiChatCompletionsEndpoint(canonicalEndpoint)!,
    accountsBaseUrl: params.accountsBaseUrl,
    externalWorkspaceId: params.authorization.workspaceId,
    externalSubjectId: params.authorization.subjectId,
    interfaceId: iface.metadata.id,
    interfaceGeneration: iface.metadata.generation,
    interfaceResolvedRevision: iface.status.resolvedRevision,
    bindingId: binding.metadata.id,
    bindingGeneration: binding.metadata.generation,
    bindingObservedInterfaceRevision:
      binding.status.observedInterfaceRevision,
    permission: AI_GATEWAY_CHAT_PERMISSION,
  };
}

function parseSnapshot(value: unknown): ProviderMaterializationSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.schemaVersion !== MATERIALIZATION_SCHEMA_VERSION ||
    !boundedOpaqueId(row.runId) || !boundedOpaqueId(row.workspaceId) ||
    !boundedOpaqueId(row.modelId)
  ) return null;
  if (
    row.sourceKind === "local_smoke" && row.protocol === "local_smoke" &&
    row.modelId === "local-smoke" && Object.keys(row).length === 6
  ) return row as LocalSmokeMaterialization;
  if (
    row.sourceKind === "deployment_shared_key" &&
    row.protocol === "openai_chat_completions" &&
    row.credentialSource === "OPENAI_API_KEY" &&
    typeof row.endpoint === "string" &&
    canonicalHttpsUrl(row.endpoint) === row.endpoint &&
    Object.keys(row).length === 8
  ) return row as SharedKeyMaterialization;
  if (
    row.sourceKind === "takosumi_interface" &&
    row.protocol === "openai_chat_completions" &&
    row.permission === AI_GATEWAY_CHAT_PERMISSION &&
    typeof row.endpoint === "string" &&
    canonicalHttpsUrl(row.endpoint) === row.endpoint &&
    typeof row.accountsBaseUrl === "string" &&
    canonicalHttpsUrl(row.accountsBaseUrl) === row.accountsBaseUrl &&
    boundedOpaqueId(row.externalWorkspaceId) &&
    boundedOpaqueId(row.externalSubjectId) &&
    boundedOpaqueId(row.interfaceId) &&
    positiveInteger(row.interfaceGeneration) &&
    positiveInteger(row.interfaceResolvedRevision) &&
    boundedOpaqueId(row.bindingId) &&
    positiveInteger(row.bindingGeneration) &&
    positiveInteger(row.bindingObservedInterfaceRevision) &&
    Object.keys(row).length === 17
  ) return row as TakosumiInterfaceMaterialization;
  return null;
}

async function readStoredMaterialization(
  dbBinding: SqlDatabaseLike,
  runId: string,
): Promise<PinnedProviderMaterialization | null> {
  const row = await getDb(dbBinding).select({
    id: providerMaterializationRevisions.id,
    accountId: providerMaterializationRevisions.accountId,
    runId: providerMaterializationRevisions.runId,
    resourceId: providerMaterializationRevisions.resourceId,
    sourceKind: providerMaterializationRevisions.sourceKind,
    protocol: providerMaterializationRevisions.protocol,
    endpoint: providerMaterializationRevisions.endpoint,
    materializationDigest:
      providerMaterializationRevisions.materializationDigest,
    materializationJson: providerMaterializationRevisions.materializationJson,
  }).from(providerMaterializationRevisions).where(
    eq(providerMaterializationRevisions.runId, runId),
  ).get();
  if (!row) return null;
  let snapshot: ProviderMaterializationSnapshot | null = null;
  try {
    snapshot = parseSnapshot(JSON.parse(row.materializationJson));
  } catch {
    // handled by the exact validation below
  }
  const expectedEndpoint = snapshot && "endpoint" in snapshot
    ? snapshot.endpoint
    : null;
  if (
    !snapshot || row.id !== row.resourceId || snapshot.runId !== runId ||
    snapshot.workspaceId !== row.accountId ||
    snapshot.sourceKind !== row.sourceKind || snapshot.protocol !== row.protocol ||
    expectedEndpoint !== row.endpoint ||
    !SHA256_DIGEST_PATTERN.test(row.materializationDigest) ||
    await digestJson(row.materializationJson) !== row.materializationDigest
  ) {
    throw new ProviderMaterializationUnavailableError(
      "Stored provider materialization is invalid",
    );
  }
  return {
    resourceId: row.resourceId,
    materializationDigest: row.materializationDigest,
    snapshot,
  };
}

async function runIdentity(
  dbBinding: SqlDatabaseLike,
  authority: RunExecutionAuthority,
): Promise<{ requesterAccountId: string; modelId: string }> {
  const row = await getDb(dbBinding).select({
    requesterAccountId: runs.requesterAccountId,
    accountId: runs.accountId,
    modelId: runs.model,
  }).from(runs).where(eq(runs.id, authority.runId)).get();
  if (
    !row?.requesterAccountId || !row.modelId ||
    row.accountId !== authority.workspaceId ||
    authority.modelInput?.modelId !== row.modelId
  ) {
    throw new ProviderMaterializationUnavailableError(
      "Run provider identity is invalid",
    );
  }
  return { requesterAccountId: row.requesterAccountId, modelId: row.modelId };
}

async function delegatedAuthorization(
  env: Env,
  requesterAccountId: string,
  deps: ProviderMaterializationDependencies,
): Promise<{
  authorization: DelegatedAuthorization;
  accountsBaseUrl: string;
  request: {
    baseUrl: string;
    token: string;
    subjectId: string;
    fetch: RuntimeInterfaceFetch;
  };
}> {
  const issuer = nonEmptyString(env.OIDC_ISSUER_URL);
  const clientId = nonEmptyString(env.OIDC_CLIENT_ID);
  const encryptionKey = nonEmptyString(env.ENCRYPTION_KEY);
  const accountsBaseUrl = configuredAccountsBaseUrl(env);
  if (!issuer || !clientId || !encryptionKey || !accountsBaseUrl) {
    throw new ProviderMaterializationUnavailableError(
      "Takosumi AI Gateway integration is not configured",
    );
  }
  const authorization = await deps.accountsDelegatedAuthorization({
    db: env.DB,
    encryptionKey,
    userId: requesterAccountId,
    issuer: issuer.replace(/\/+$/u, ""),
    clientId,
    clientSecret: nonEmptyString(env.OIDC_CLIENT_SECRET),
    access: "read",
  });
  return {
    authorization,
    accountsBaseUrl,
    request: {
      baseUrl: accountsBaseUrl,
      token: authorization.accessToken,
      subjectId: authorization.subjectId,
      fetch: deps.fetch,
    },
  };
}

async function discoverSnapshot(
  env: Env,
  authority: RunExecutionAuthority,
  deps: ProviderMaterializationDependencies,
): Promise<ProviderMaterializationSnapshot> {
  const identity = await runIdentity(env.DB, authority);
  if (identity.modelId === "local-smoke") {
    return {
      schemaVersion: MATERIALIZATION_SCHEMA_VERSION,
      runId: authority.runId,
      workspaceId: authority.workspaceId,
      modelId: "local-smoke",
      sourceKind: "local_smoke",
      protocol: "local_smoke",
    };
  }
  const directKey = nonEmptyString(env.OPENAI_API_KEY);
  if (directKey && sharedProviderKeyAllowed(env)) {
    const endpoint = openAiChatCompletionsEndpoint(env.OPENAI_BASE_URL);
    if (!endpoint) {
      throw new ProviderMaterializationUnavailableError(
        "Configured OpenAI-compatible endpoint is invalid",
      );
    }
    return {
      schemaVersion: MATERIALIZATION_SCHEMA_VERSION,
      runId: authority.runId,
      workspaceId: authority.workspaceId,
      modelId: identity.modelId,
      sourceKind: "deployment_shared_key",
      protocol: "openai_chat_completions",
      endpoint,
      credentialSource: "OPENAI_API_KEY",
    };
  }
  const delegated = await delegatedAuthorization(
    env,
    identity.requesterAccountId,
    deps,
  );
  const authorized = await deps.fetchAuthorizedRuntimeInterfaces(
    {
      workspaceId: delegated.authorization.workspaceId,
      type: AI_GATEWAY_INTERFACE_TYPE,
      permission: AI_GATEWAY_CHAT_PERMISSION,
      deliveryTypes: ["oauth2"],
    },
    delegated.request,
  );
  const snapshots = authorized.map((selected) =>
    exactInterfaceSnapshot(
      {
        runId: authority.runId,
        workspaceId: authority.workspaceId,
        modelId: identity.modelId,
        accountsBaseUrl: delegated.accountsBaseUrl,
        authorization: delegated.authorization,
      },
      selected,
    )
  ).filter((snapshot): snapshot is TakosumiInterfaceMaterialization =>
    snapshot !== null
  );
  if (snapshots.length !== 1) {
    throw new ProviderMaterializationUnavailableError(
      snapshots.length === 0
        ? "No authorized AI Gateway Interface is available"
        : "AI Gateway Interface selection is ambiguous",
    );
  }
  return snapshots[0]!;
}

async function persistFirstMaterialization(
  dbBinding: SqlDatabaseLike,
  snapshot: ProviderMaterializationSnapshot,
): Promise<PinnedProviderMaterialization> {
  const materializationJson = canonicalJson(snapshot);
  const materializationDigest = await digestJson(materializationJson);
  const resourceId = `pmr_${materializationDigest.slice("sha256:".length)}`;
  const createdAt = new Date().toISOString();
  await getDb(dbBinding).insert(providerMaterializationRevisions).values({
    id: resourceId,
    accountId: snapshot.workspaceId,
    runId: snapshot.runId,
    resourceId,
    sourceKind: snapshot.sourceKind,
    protocol: snapshot.protocol,
    endpoint: "endpoint" in snapshot ? snapshot.endpoint : null,
    materializationDigest,
    materializationJson,
    createdAt,
  }).onConflictDoNothing();
  const winner = await readStoredMaterialization(dbBinding, snapshot.runId);
  if (!winner) {
    throw new ProviderMaterializationUnavailableError(
      "Provider materialization could not be persisted",
    );
  }
  return winner;
}

/**
 * Select one provider transport meaning, persist it without credentials, and
 * append its exact identity to the RunContext before the first model call.
 * The first immutable row wins across response loss and concurrent startup.
 */
export async function ensureRunProviderMaterialization(params: {
  env: Env;
  runId: string;
  expectedAuthority: RunAuthorityAttestation;
  dependencies?: ProviderMaterializationDependencies;
}): Promise<{
  sourceAuthority: RunAuthorityAttestation;
  authority: RunExecutionAuthority;
  materialization: PinnedProviderMaterialization;
}> {
  const deps = params.dependencies ?? defaultDependencies;
  const sourceAuthority = await loadRunExecutionAuthority({
    db: params.env.DB,
    runId: params.runId,
  });
  const existingReference = sourceAuthority.resourceReferences?.filter(
    (reference) =>
      reference.resourceKind === "provider_materialization_revision",
  ) ?? [];
  if (existingReference.length > 1) {
    throw new ProviderMaterializationUnavailableError(
      "Run has ambiguous provider materialization references",
    );
  }
  let materialization = await readStoredMaterialization(
    params.env.DB,
    params.runId,
  );
  if (
    !runAuthorityAttestationsEqual(
      sourceAuthority.attestation,
      params.expectedAuthority,
    )
  ) {
    const responseLossReplay =
      sourceAuthority.attestation.contextRevision ===
        params.expectedAuthority.contextRevision + 1 &&
      sourceAuthority.attestation.runGrantDigest ===
        params.expectedAuthority.runGrantDigest &&
      existingReference.length === 1 && materialization !== null &&
      existingReference[0]!.resourceId === materialization.resourceId &&
      existingReference[0]!.resourceDigest ===
        materialization.materializationDigest;
    if (!responseLossReplay) {
      throw new ProviderMaterializationUnavailableError(
        "Run authority changed before provider materialization",
      );
    }
    return {
      sourceAuthority: params.expectedAuthority,
      authority: sourceAuthority,
      materialization,
    };
  }
  if (!materialization) {
    materialization = await persistFirstMaterialization(
      params.env.DB,
      await discoverSnapshot(params.env, sourceAuthority, deps),
    );
  }
  if (
    existingReference.length === 1 &&
    (existingReference[0]!.resourceId !== materialization.resourceId ||
      existingReference[0]!.resourceDigest !==
        materialization.materializationDigest)
  ) {
    throw new ProviderMaterializationUnavailableError(
      "Pinned provider materialization does not match the immutable source",
    );
  }
  const authority = await appendRunContextResourceReferences({
    db: params.env.DB,
    runId: params.runId,
    expectedAttestation: params.expectedAuthority,
    activationEventId:
      `provider_materialization:${materialization.resourceId}:${materialization.materializationDigest}`,
    references: [{
      resourceKind: "provider_materialization_revision",
      resourceId: materialization.resourceId,
      resourceDigest: materialization.materializationDigest,
    }],
  });
  return {
    sourceAuthority: params.expectedAuthority,
    authority,
    materialization,
  };
}

function exactLiveInterface(
  snapshot: TakosumiInterfaceMaterialization,
  candidates: readonly AuthorizedRuntimeInterface[],
  authorization: DelegatedAuthorization,
  accountsBaseUrl: string,
): AuthorizedRuntimeInterface | undefined {
  if (
    authorization.workspaceId !== snapshot.externalWorkspaceId ||
    authorization.subjectId !== snapshot.externalSubjectId ||
    accountsBaseUrl !== snapshot.accountsBaseUrl
  ) return undefined;
  return candidates.find((candidate) => {
    const exact = exactInterfaceSnapshot(
      {
        runId: snapshot.runId,
        workspaceId: snapshot.workspaceId,
        modelId: snapshot.modelId,
        accountsBaseUrl,
        authorization,
      },
      candidate,
    );
    return exact !== null && canonicalJson(exact) === canonicalJson(snapshot);
  });
}

/**
 * Revalidate the exact pinned source and resolve a credential for one imminent
 * provider HTTP attempt. The returned secret is never persisted and is valid
 * only after the caller has committed the matching model-call begin record.
 */
export async function resolveRunProviderCredential(params: {
  env: Env;
  runId: string;
  authority: RunExecutionAuthority;
  dependencies?: ProviderMaterializationDependencies;
}): Promise<ProviderRuntimeCredential> {
  const deps = params.dependencies ?? defaultDependencies;
  if (
    params.authority.runId !== params.runId ||
    !params.authority.modelInput
  ) {
    throw new ProviderMaterializationUnavailableError(
      "Run provider authority is unavailable",
    );
  }
  const references = params.authority.resourceReferences?.filter(
    (reference) =>
      reference.resourceKind === "provider_materialization_revision",
  ) ?? [];
  const materialization = await readStoredMaterialization(
    params.env.DB,
    params.runId,
  );
  if (
    references.length !== 1 || !materialization ||
    references[0]!.resourceId !== materialization.resourceId ||
    references[0]!.resourceDigest !== materialization.materializationDigest ||
    materialization.snapshot.workspaceId !== params.authority.workspaceId ||
    materialization.snapshot.modelId !== params.authority.modelInput.modelId
  ) {
    throw new ProviderMaterializationUnavailableError(
      "Exact provider materialization is not pinned",
    );
  }
  const snapshot = materialization.snapshot;
  const base = {
    materializationId: materialization.resourceId,
    materializationDigest: materialization.materializationDigest,
  };
  if (snapshot.sourceKind === "local_smoke") {
    return { ...base, protocol: "local_smoke", endpoint: null, apiKey: null };
  }
  if (snapshot.sourceKind === "deployment_shared_key") {
    const apiKey = nonEmptyString(params.env.OPENAI_API_KEY);
    const endpoint = openAiChatCompletionsEndpoint(
      params.env.OPENAI_BASE_URL,
    );
    if (
      !apiKey || !sharedProviderKeyAllowed(params.env) ||
      endpoint !== snapshot.endpoint
    ) {
      throw new ProviderMaterializationUnavailableError(
        "Pinned shared provider configuration is no longer authorized",
      );
    }
    return {
      ...base,
      protocol: "openai_chat_completions",
      endpoint: snapshot.endpoint,
      apiKey,
    };
  }
  const identity = await runIdentity(params.env.DB, params.authority);
  const delegated = await delegatedAuthorization(
    params.env,
    identity.requesterAccountId,
    deps,
  );
  const candidates = await deps.fetchAuthorizedRuntimeInterfaces(
    {
      workspaceId: snapshot.externalWorkspaceId,
      type: AI_GATEWAY_INTERFACE_TYPE,
      permission: snapshot.permission,
      deliveryTypes: ["oauth2"],
    },
    delegated.request,
  );
  const selected = exactLiveInterface(
    snapshot,
    candidates,
    delegated.authorization,
    delegated.accountsBaseUrl,
  );
  if (!selected) {
    throw new ProviderMaterializationUnavailableError(
      "Pinned AI Gateway Interface or Binding is no longer authorized",
    );
  }
  const apiKey = await deps.issueRuntimeInterfaceAccessToken(
    delegated.request,
    {
      interfaceId: snapshot.interfaceId,
      permission: snapshot.permission,
      resource: canonicalHttpsUrl(
        selected.interface.status.resolvedInputs?.endpoint ?? "",
      )!,
      errorLabel: "AI Gateway Interface",
    },
  );
  return {
    ...base,
    protocol: "openai_chat_completions",
    endpoint: snapshot.endpoint,
    apiKey,
  };
}

/** Test/compatibility reader for the immutable row. */
export async function loadRunProviderMaterialization(
  db: SqlDatabaseLike,
  runId: string,
): Promise<PinnedProviderMaterialization | null> {
  return await readStoredMaterialization(db, runId);
}
