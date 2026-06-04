/**
 * Installation / Deployment RPC for the account plane.
 * Ported from takosumi dashboard-ui/src/lib/rpc/installations.ts.
 */
import { apiFetch, qs } from "./http.ts";
import * as paths from "./paths.ts";
import { sha256Canonical } from "./digest.ts";

/** A subset of InstallationRecord that the dashboard actually displays.
 *  Mirrors the account-plane InstallationRecord. */
export interface Installation {
  readonly installationId: string;
  readonly appId: string;
  readonly accountId?: string;
  readonly spaceId?: string;
  readonly sourceGitUrl?: string;
  readonly sourceRef?: string;
  readonly sourceCommit?: string;
  readonly planDigest?: string;
  readonly artifactDigest?: string;
  readonly mode?: "shared-cell" | "dedicated" | "self-hosted";
  // Aligned with the canonical contract enum. The canonical list is
  // `installing` / `ready` / `failed` / `suspended` / `exported`.
  readonly status?:
    | "installing"
    | "ready"
    | "failed"
    | "suspended"
    | "exported";
  readonly launchUrl?: string;
  readonly deploymentOutputs?: readonly DeploymentOutput[];
  /** Present on the detail envelope (GET /v1/installations/:id), not on list. */
  readonly oidcClient?: OidcClientConfig;
  readonly createdBySubject?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface DeploymentOutput {
  readonly name: string;
  readonly kind: string;
  readonly value: unknown;
  readonly sensitive: false;
  readonly labels?: Readonly<Record<string, string>>;
}

/** Per-installation OIDC client config shown on the detail page. */
export interface OidcClientConfig {
  readonly clientId: string;
  readonly issuerUrl?: string;
  readonly servicePath?: string;
  readonly redirectUris?: readonly string[];
  readonly allowedScopes?: readonly string[];
  readonly subjectMode?: string;
  readonly tokenEndpointAuthMethod?: string;
}

/** One ledger event in the installation's hash-chained event log. */
export interface InstallationEvent {
  readonly id: string;
  readonly type: string;
  readonly createdAt?: string;
  readonly eventHash?: string;
  readonly previousEventHash?: string | null;
  readonly payload?: unknown;
}

export interface InstallationEventsResult {
  readonly events: readonly InstallationEvent[];
  readonly hashChainValid: boolean;
  readonly nextCursor?: string;
}

export type WorkloadServiceStatus =
  | "ready"
  | "not_configured"
  | "unavailable";

export interface WorkloadServiceDescriptor {
  readonly id: string;
  readonly materialKind: string;
  readonly title: string;
  readonly description: string;
  readonly secretBacked: boolean;
}

export interface WorkloadService {
  readonly id: string;
  readonly materialKind: string;
  readonly status: WorkloadServiceStatus;
  readonly endpoint?: string;
  readonly material?: Record<string, unknown>;
  readonly secretRef?: string;
  readonly tokenExpiresAt?: string;
  readonly rotateTokenUrl?: string;
}

export interface RotateWorkloadServiceTokenResult {
  readonly token: string;
  readonly tokenType: "Bearer";
  readonly expiresAt: string;
  readonly service: WorkloadService;
}

export interface ExportOperation {
  readonly operationId: string;
  readonly status: "preparing" | "exported" | "failed";
  readonly trackingUrl?: string;
  readonly downloadUrl?: string | null;
  readonly downloadExpiresAt?: string | null;
  readonly error?: string;
}

// ===== Wire shape (what the backend actually returns) =====================
// Backend serializes everything as snake_case (`installation.id`,
// `account_id`, `source: {type, url, ref, commit}`) and wraps detail/create
// responses in an envelope. We translate to the camelCase shape the SPA renders
// so component code stays idiomatic TS.

interface WireInstallation {
  readonly id?: string;
  readonly app_id?: string;
  readonly account_id?: string;
  readonly space_id?: string;
  readonly source?: {
    readonly url?: string;
    readonly ref?: string;
    readonly commit?: string;
  };
  readonly plan_digest?: string;
  readonly artifact_digest?: string | null;
  readonly mode?: Installation["mode"];
  readonly status?: Installation["status"];
  readonly launch_url?: string | null;
  readonly deployment_outputs?: readonly WireDeploymentOutput[];
  readonly deploymentOutputs?: readonly WireDeploymentOutput[];
  readonly launch?: {
    readonly url?: string | null;
  } | null;
  readonly created_by_subject?: string;
  readonly created_at?: string;
  readonly updated_at?: string;
}

interface WireDeploymentOutput {
  readonly name?: string;
  readonly kind?: string;
  readonly value?: unknown;
  readonly sensitive?: boolean;
  readonly labels?: Readonly<Record<string, string>>;
}

interface WireOidcClient {
  readonly client_id?: string;
  readonly issuer_url?: string;
  readonly servicePath?: string;
  readonly namespacePath?: string;
  readonly redirect_uris?: readonly string[];
  readonly allowed_scopes?: readonly string[];
  readonly subject_mode?: string;
  readonly token_endpoint_auth_method?: string;
}

interface InstallationEnvelope {
  readonly installation: WireInstallation;
  readonly oidc_client?: WireOidcClient | null;
}

interface WireInstallationEvent {
  readonly id?: string;
  readonly installation_id?: string;
  readonly type?: string;
  readonly payload?: unknown;
  readonly previous_event_hash?: string | null;
  readonly event_hash?: string;
  readonly created_at?: string;
}

interface WireWorkloadServiceDescriptor {
  readonly id?: string;
  readonly material_kind?: string;
  readonly title?: string;
  readonly description?: string;
  readonly secret_backed?: boolean;
}

interface WireWorkloadService {
  readonly id?: string;
  readonly material_kind?: string;
  readonly status?: WorkloadServiceStatus;
  readonly endpoint?: string;
  readonly material?: Record<string, unknown>;
  readonly secret_ref?: string;
  readonly token_expires_at?: string;
  readonly rotate_token_url?: string;
}

function deserializeInstallation(
  raw: WireInstallation | undefined,
): Installation {
  const r = raw ?? {};
  return {
    installationId: r.id ?? "",
    appId: r.app_id ?? "",
    accountId: r.account_id,
    spaceId: r.space_id,
    sourceGitUrl: r.source?.url,
    sourceRef: r.source?.ref,
    sourceCommit: r.source?.commit,
    planDigest: r.plan_digest,
    artifactDigest: r.artifact_digest ?? undefined,
    mode: r.mode,
    status: r.status,
    launchUrl: r.launch_url ?? r.launch?.url ?? undefined,
    deploymentOutputs: deserializeDeploymentOutputs(
      r.deployment_outputs ?? r.deploymentOutputs,
    ),
    createdBySubject: r.created_by_subject,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function deserializeDeploymentOutputs(
  raw: readonly WireDeploymentOutput[] | undefined,
): readonly DeploymentOutput[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((output) => {
    if (
      typeof output.name !== "string" ||
      typeof output.kind !== "string" ||
      output.sensitive !== false
    ) {
      return [];
    }
    return [{
      name: output.name,
      kind: output.kind,
      value: output.value,
      sensitive: false,
      ...(output.labels ? { labels: output.labels } : {}),
    }];
  });
}

function deserializeOidcClient(
  raw: WireOidcClient | null | undefined,
): OidcClientConfig | undefined {
  if (!raw || typeof raw.client_id !== "string") return undefined;
  return {
    clientId: raw.client_id,
    issuerUrl: raw.issuer_url,
    servicePath: raw.servicePath ?? raw.namespacePath,
    redirectUris: raw.redirect_uris,
    allowedScopes: raw.allowed_scopes,
    subjectMode: raw.subject_mode,
    tokenEndpointAuthMethod: raw.token_endpoint_auth_method,
  };
}

function deserializeEnvelope(env: InstallationEnvelope): Installation {
  const oidcClient = deserializeOidcClient(env.oidc_client);
  return {
    ...deserializeInstallation(env.installation),
    ...(oidcClient ? { oidcClient } : {}),
  };
}

function deserializeEvent(raw: WireInstallationEvent): InstallationEvent {
  return {
    id: raw.id ?? "",
    type: raw.type ?? "",
    createdAt: raw.created_at,
    eventHash: raw.event_hash,
    previousEventHash: raw.previous_event_hash ?? null,
    payload: raw.payload,
  };
}

function deserializeWorkloadServiceDescriptor(
  raw: WireWorkloadServiceDescriptor,
): WorkloadServiceDescriptor {
  return {
    id: raw.id ?? "",
    materialKind: raw.material_kind ?? "",
    title: raw.title ?? "",
    description: raw.description ?? "",
    secretBacked: raw.secret_backed ?? false,
  };
}

function deserializeWorkloadService(
  raw: WireWorkloadService,
): WorkloadService {
  return {
    id: raw.id ?? "",
    materialKind: raw.material_kind ?? "",
    status: raw.status ?? "unavailable",
    endpoint: raw.endpoint,
    material: raw.material,
    secretRef: raw.secret_ref,
    tokenExpiresAt: raw.token_expires_at,
    rotateTokenUrl: raw.rotate_token_url,
  };
}

// ===== Public API ==========================================================

interface ListResponse {
  readonly installations?: readonly WireInstallation[];
}

/** Backend requires space_id. Caller decides what to show when none is set. */
export async function listInstallationsForSpace(
  spaceId: string,
): Promise<readonly Installation[]> {
  const body = await apiFetch<ListResponse>(
    paths.INSTALLATIONS + qs({ space_id: spaceId }),
  );
  return (body.installations ?? []).map(deserializeInstallation);
}

export async function getInstallation(id: string): Promise<Installation> {
  const env = await apiFetch<InstallationEnvelope>(paths.installation(id));
  return deserializeEnvelope(env);
}

export async function listWorkloadServices(): Promise<
  readonly WorkloadServiceDescriptor[]
> {
  interface ResponseBody {
    readonly services?: readonly WireWorkloadServiceDescriptor[];
  }
  const body = await apiFetch<ResponseBody>(paths.WORKLOAD_SERVICES);
  return (body.services ?? []).map(deserializeWorkloadServiceDescriptor);
}

export async function listInstallationServices(
  id: string,
): Promise<readonly WorkloadService[]> {
  interface ResponseBody {
    readonly services?: readonly WireWorkloadService[];
  }
  const body = await apiFetch<ResponseBody>(paths.installationServices(id));
  return (body.services ?? []).map(deserializeWorkloadService);
}

export async function rotateInstallationServiceToken(
  id: string,
  serviceId: string,
  input: { readonly ttlSeconds?: number } = {},
): Promise<RotateWorkloadServiceTokenResult> {
  interface ResponseBody {
    readonly token?: string;
    readonly token_type?: "Bearer";
    readonly expires_at?: string;
    readonly service?: WireWorkloadService;
  }
  const body = await apiFetch<ResponseBody>(
    paths.installationServiceRotateToken(id, serviceId),
    {
      method: "POST",
      body: { ttlSeconds: input.ttlSeconds ?? 90 * 24 * 60 * 60 },
    },
  );
  return {
    token: body.token ?? "",
    tokenType: body.token_type ?? "Bearer",
    expiresAt: body.expires_at ?? "",
    service: deserializeWorkloadService(body.service ?? {}),
  };
}

export interface InstallationPlanRunInput {
  readonly gitUrl: string;
  readonly ref: string;
  readonly spaceId: string;
}

/** Deploy Control PlanRun shape is provider-controlled; treat as opaque JSON for display. */
export type InstallationPlanRunResponse = Record<string, unknown>;

export async function planInstallation(
  input: InstallationPlanRunInput,
): Promise<InstallationPlanRunResponse> {
  return await apiFetch<InstallationPlanRunResponse>(
    paths.INSTALLATION_PLAN_RUNS,
    {
      method: "POST",
      body: {
        spaceId: input.spaceId,
        source: { kind: "git", url: input.gitUrl, ref: input.ref },
      },
    },
  );
}

export interface CreateInstallationInput {
  readonly accountId: string;
  readonly spaceId: string;
  readonly appId: string;
  readonly source: {
    readonly gitUrl: string;
    readonly ref: string;
    readonly commit: string;
    readonly planDigest: string;
    readonly artifactDigest?: string;
  };
  readonly mode: "shared-cell" | "dedicated" | "self-hosted";
  readonly createdBySubject: string;
}

export async function createInstallation(
  input: CreateInstallationInput,
): Promise<Installation> {
  const env = await apiFetch<InstallationEnvelope>(paths.INSTALLATIONS, {
    method: "POST",
    body: input,
  });
  return deserializeEnvelope(env);
}

export async function uninstallInstallation(id: string): Promise<void> {
  await apiFetch<unknown>(paths.installation(id), { method: "DELETE" });
}

export interface MaterializeInput {
  /** Target region; defaults to "default" (matches the legacy form default). */
  readonly region?: string;
  /** Must be true — acknowledges the cost of moving to a dedicated cell. */
  readonly costAck: boolean;
}

/**
 * Promote an installation to a dedicated cell. The endpoint requires
 * `confirm.permissionDigest` to match a server-recomputed digest, so we compute
 * the same `sha256:<hex>` over canonical JSON the server expects (see digest.ts).
 */
export async function materializeInstallation(
  id: string,
  input: MaterializeInput,
): Promise<Installation> {
  const region = input.region && input.region.length > 0
    ? input.region
    : "default";
  const mode = "dedicated";
  const plan: Record<string, unknown> = {};
  const cutover: Record<string, unknown> = {};
  const permissionDigest = await sha256Canonical({
    operation: "materialize",
    installationId: id,
    mode,
    region,
    plan,
    cutover,
  });
  const env = await apiFetch<InstallationEnvelope>(
    paths.installationMaterialize(id),
    {
      method: "POST",
      body: {
        mode,
        region,
        plan,
        cutover,
        confirm: { costAck: input.costAck, permissionDigest },
      },
    },
  );
  return deserializeEnvelope(env);
}

export interface ExportInput {
  readonly includeData: boolean;
  /** Encryption method; "none" (default) emits an unencrypted bundle. */
  readonly encryptionMethod?: string;
  /** age recipients when encryptionMethod requires them. */
  readonly recipients?: readonly string[];
}

export async function requestInstallationExport(
  id: string,
  input: ExportInput,
): Promise<ExportOperation> {
  return await apiFetch<ExportOperation>(paths.installationExport(id), {
    method: "POST",
    body: {
      includeData: input.includeData,
      format: "bundle",
      encryption: {
        method: input.encryptionMethod ?? "none",
        recipients: input.recipients ?? [],
      },
      scope: {},
    },
  });
}

export async function getInstallationExportOperation(
  id: string,
  operationId: string,
): Promise<ExportOperation> {
  return await apiFetch<ExportOperation>(
    paths.installationExportOperation(id, operationId),
  );
}

/** Signed download URL for a completed export operation (same-origin GET). */
export function installationExportDownloadUrl(
  id: string,
  operationId: string,
): string {
  return paths.installationExportDownload(id, operationId);
}

export async function listInstallationEvents(
  id: string,
  opts: { readonly limit?: number } = {},
): Promise<InstallationEventsResult> {
  interface EventsResponse {
    readonly events?: readonly WireInstallationEvent[];
    readonly next_cursor?: string | null;
    readonly hash_chain_valid?: boolean;
  }
  const body = await apiFetch<EventsResponse>(
    paths.installationEvents(id) + qs({ limit: opts.limit }),
  );
  return {
    events: (body.events ?? []).map(deserializeEvent),
    hashChainValid: body.hash_chain_valid ?? false,
    ...(body.next_cursor ? { nextCursor: body.next_cursor } : {}),
  };
}
