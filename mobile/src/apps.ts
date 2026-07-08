import {
  createMobileApiClient,
  mobileRecord,
  mobileOptionalText,
  type FetchLike,
  type MobileSession,
} from "@takosjp/takosumi-mobile-kit";

export type TakosMobileAppRevisionOperation = "upgrade" | "rollback";

export interface TakosMobileAppInstallationPreview {
  readonly id: string;
  readonly spaceId: string;
  readonly appId?: string;
  readonly name: string;
  readonly status?: string;
  readonly gitUrl?: string;
  readonly ref?: string;
  readonly modulePath?: string;
  readonly sourceCommit?: string;
  readonly launchUrl?: string;
  readonly routePath: string;
}

export interface LoadTakosMobileAppInstallationsInput {
  readonly session: MobileSession;
  readonly spaceId: string;
  readonly fetch?: FetchLike;
}

export interface TakosMobileGitAppPlan {
  readonly spaceId: string;
  readonly gitUrl: string;
  readonly ref: string;
  readonly modulePath?: string;
  readonly mode?: string;
  readonly sourceCommit?: string;
  readonly expected?: Record<string, unknown>;
  readonly expectedCommit?: string;
  readonly expectedPlanDigest?: string;
  readonly expectedCurrentDeploymentId?: string | null;
  readonly title?: string;
  readonly raw: unknown;
}

export interface TakosMobileGitAppMutationResult {
  readonly installationId?: string;
  readonly status?: string;
  readonly raw: unknown;
}

export interface PlanTakosMobileGitAppInstallInput {
  readonly session: MobileSession;
  readonly spaceId: string;
  readonly gitUrl: string;
  readonly ref: string;
  readonly modulePath?: string;
  readonly variables?: Record<string, unknown>;
  readonly fetch?: FetchLike;
}

export interface ApplyTakosMobileGitAppInstallInput {
  readonly session: MobileSession;
  readonly plan: TakosMobileGitAppPlan;
  readonly mode?: string;
  readonly variables?: Record<string, unknown>;
  readonly fetch?: FetchLike;
}

export interface InstallTakosMobileGitAppInput extends PlanTakosMobileGitAppInstallInput {
  readonly mode?: string;
}

export interface PlanTakosMobileGitAppRevisionInput {
  readonly session: MobileSession;
  readonly spaceId: string;
  readonly installationId: string;
  readonly operation?: TakosMobileAppRevisionOperation;
  readonly gitUrl: string;
  readonly ref: string;
  readonly modulePath?: string;
  readonly reason?: string;
  readonly fetch?: FetchLike;
}

export interface ApplyTakosMobileGitAppRevisionInput {
  readonly session: MobileSession;
  readonly installationId: string;
  readonly operation?: TakosMobileAppRevisionOperation;
  readonly plan: TakosMobileGitAppPlan;
  readonly reason?: string;
  readonly fetch?: FetchLike;
}

export interface RemoveTakosMobileAppInstallationInput {
  readonly session: MobileSession;
  readonly spaceId: string;
  readonly installationId: string;
  readonly reason?: string;
  readonly fetch?: FetchLike;
}

export async function loadTakosMobileAppInstallations(
  input: LoadTakosMobileAppInstallationsInput,
): Promise<readonly TakosMobileAppInstallationPreview[]> {
  const spaceId = requireTrimmed(input.spaceId, "Workspace is required.");
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json<{ readonly installations?: unknown[] }>(
    `/api/spaces/${encodeURIComponent(spaceId)}/app-installations`,
  );
  return Array.isArray(response.installations)
    ? response.installations
        .map((item) => summarizeInstallation(item, spaceId))
        .filter((item): item is TakosMobileAppInstallationPreview =>
          Boolean(item),
        )
    : [];
}

export async function planTakosMobileGitAppInstall(
  input: PlanTakosMobileGitAppInstallInput,
): Promise<TakosMobileGitAppPlan> {
  const source = normalizeGitSource(input);
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json(
    `/api/spaces/${encodeURIComponent(source.spaceId)}/app-installations/git-url/plan`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        git_url: source.gitUrl,
        ref: source.ref,
        module_path: source.modulePath,
        ...(input.variables ? { variables: input.variables } : {}),
      }),
    },
  );
  return summarizePlanResponse(response, source);
}

export async function applyTakosMobileGitAppInstall(
  input: ApplyTakosMobileGitAppInstallInput,
): Promise<TakosMobileGitAppMutationResult> {
  const body = installApplyBody(input.plan, {
    mode: input.mode,
    variables: input.variables,
  });
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json(
    `/api/spaces/${encodeURIComponent(input.plan.spaceId)}/app-installations/git-url/apply`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return summarizeMutationResponse(response);
}

export async function installTakosMobileGitApp(
  input: InstallTakosMobileGitAppInput,
): Promise<TakosMobileGitAppMutationResult> {
  const plan = await planTakosMobileGitAppInstall(input);
  return await applyTakosMobileGitAppInstall({
    session: input.session,
    plan,
    mode: input.mode,
    variables: input.variables,
    fetch: input.fetch,
  });
}

export async function planTakosMobileGitAppRevision(
  input: PlanTakosMobileGitAppRevisionInput,
): Promise<TakosMobileGitAppPlan> {
  const source = normalizeGitSource(input);
  const installationId = requireTrimmed(
    input.installationId,
    "Installation id is required.",
  );
  const operation = input.operation ?? "upgrade";
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json(
    `/api/spaces/${encodeURIComponent(source.spaceId)}/app-installations/git-url/revision/plan`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation,
        installation_id: installationId,
        git_url: source.gitUrl,
        ref: source.ref,
        module_path: source.modulePath,
        ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      }),
    },
  );
  return summarizePlanResponse(response, source);
}

export async function applyTakosMobileGitAppRevision(
  input: ApplyTakosMobileGitAppRevisionInput,
): Promise<TakosMobileGitAppMutationResult> {
  const installationId = requireTrimmed(
    input.installationId,
    "Installation id is required.",
  );
  const operation = input.operation ?? "upgrade";
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json(
    `/api/spaces/${encodeURIComponent(input.plan.spaceId)}/app-installations/git-url/revision/apply`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        revisionApplyBody(input.plan, {
          installationId,
          operation,
          reason: input.reason,
        }),
      ),
    },
  );
  return summarizeMutationResponse(response);
}

export async function removeTakosMobileAppInstallation(
  input: RemoveTakosMobileAppInstallationInput,
): Promise<TakosMobileGitAppMutationResult> {
  const spaceId = requireTrimmed(input.spaceId, "Workspace is required.");
  const installationId = requireTrimmed(
    input.installationId,
    "Installation id is required.",
  );
  const reason = input.reason?.trim();
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json(
    `/api/spaces/${encodeURIComponent(spaceId)}/app-installations/${encodeURIComponent(
      installationId,
    )}`,
    {
      method: "DELETE",
      ...(reason
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reason }),
          }
        : {}),
    },
  );
  return summarizeMutationResponse(response);
}

function normalizeGitSource(input: {
  readonly spaceId: string;
  readonly gitUrl: string;
  readonly ref: string;
  readonly modulePath?: string;
}): {
  readonly spaceId: string;
  readonly gitUrl: string;
  readonly ref: string;
  readonly modulePath: string;
} {
  const spaceId = requireTrimmed(input.spaceId, "Workspace is required.");
  const gitUrl = requireTrimmed(input.gitUrl, "Git URL is required.");
  assertHttpsGitUrl(gitUrl);
  const ref = requireTrimmed(input.ref, "Git ref is required.");
  const modulePath = input.modulePath?.trim() || ".";
  assertSafeModulePath(modulePath);
  return { spaceId, gitUrl, ref, modulePath };
}

function installApplyBody(
  plan: TakosMobileGitAppPlan,
  options: {
    readonly mode?: string;
    readonly variables?: Record<string, unknown>;
  },
): Record<string, unknown> {
  const body = guardedSourceBody(plan);
  const mode = options.mode?.trim() || plan.mode;
  if (mode) body.mode = mode;
  if (options.variables) body.variables = options.variables;
  body.cost_ack = true;
  return body;
}

function revisionApplyBody(
  plan: TakosMobileGitAppPlan,
  options: {
    readonly installationId: string;
    readonly operation: TakosMobileAppRevisionOperation;
    readonly reason?: string;
  },
): Record<string, unknown> {
  const body = guardedSourceBody(plan);
  body.operation = options.operation;
  body.installation_id = options.installationId;
  if (options.reason?.trim()) body.reason = options.reason.trim();
  if (options.operation === "upgrade") {
    if (plan.expectedCurrentDeploymentId !== undefined) {
      body.expected_current_deployment_id = plan.expectedCurrentDeploymentId;
    }
  }
  return body;
}

function guardedSourceBody(
  plan: TakosMobileGitAppPlan,
): Record<string, unknown> {
  if (!plan.expected && (!plan.expectedCommit || !plan.expectedPlanDigest)) {
    throw new Error("A host plan approval guard is required.");
  }
  return {
    git_url: plan.gitUrl,
    ref: plan.ref,
    module_path: plan.modulePath ?? ".",
    ...(plan.sourceCommit ? { source_commit: plan.sourceCommit } : {}),
    ...(plan.expected ? { expected: plan.expected } : {}),
    ...(plan.expectedCommit ? { expected_commit: plan.expectedCommit } : {}),
    ...(plan.expectedPlanDigest
      ? { expected_plan_digest: plan.expectedPlanDigest }
      : {}),
  };
}

function summarizePlanResponse(
  response: unknown,
  source: {
    readonly spaceId: string;
    readonly gitUrl: string;
    readonly ref: string;
    readonly modulePath: string;
  },
): TakosMobileGitAppPlan {
  const record = mobileRecord(response) ?? {};
  const expected = mobileRecord(record.expected);
  const sourceRecord =
    mobileRecord(record.source) ??
    mobileRecord(mobileRecord(record.preview)?.next)?.source;
  const previewNextSource = mobileRecord(
    mobileRecord(mobileRecord(record.preview)?.next)?.source,
  );
  const sourceCommit =
    mobileOptionalText(previewNextSource?.commit) ??
    mobileOptionalText(mobileRecord(sourceRecord)?.commit);
  const expectedCommit =
    mobileOptionalText(expected?.commit) ??
    sourceCommit ??
    mobileOptionalText(record.commit);
  const expectedPlanDigest =
    mobileOptionalText(record.planDigest) ??
    mobileOptionalText(expected?.planDigest);
  const expectedCurrentDeploymentId = readExpectedCurrentDeploymentId(expected);
  const runtime = mobileRecord(record.runtime);
  const modes = runtime?.modes;
  const mode = Array.isArray(modes) ? mobileOptionalText(modes[0]) : undefined;
  return {
    spaceId: source.spaceId,
    gitUrl: source.gitUrl,
    ref: source.ref,
    modulePath: source.modulePath,
    mode,
    sourceCommit,
    expected,
    expectedCommit,
    expectedPlanDigest,
    ...(expectedCurrentDeploymentId.provided
      ? { expectedCurrentDeploymentId: expectedCurrentDeploymentId.value }
      : {}),
    title:
      readPathString(record, ["installPlan", "repo", "name"]) ??
      readPathString(record, ["preview", "next", "name"]) ??
      sourceDisplayNameFromUrl(source.gitUrl),
    raw: response,
  };
}

function summarizeMutationResponse(
  response: unknown,
): TakosMobileGitAppMutationResult {
  const record = mobileRecord(response) ?? {};
  const installationId =
    readPathString(record, ["accounts", "installationId"]) ??
    readPathString(record, ["accounts", "installation_id"]) ??
    readPathString(record, ["installation", "id"]) ??
    readPathString(record, ["installation", "installation_id"]) ??
    mobileOptionalText(record.installationId) ??
    mobileOptionalText(record.installation_id);
  const status =
    readPathString(record, ["accounts", "status"]) ??
    readPathString(record, ["installation", "status"]) ??
    mobileOptionalText(record.status);
  return {
    ...(installationId ? { installationId } : {}),
    ...(status ? { status } : {}),
    raw: response,
  };
}

function summarizeInstallation(
  value: unknown,
  spaceId: string,
): TakosMobileAppInstallationPreview | undefined {
  const record = mobileRecord(value);
  if (!record) return undefined;
  const id =
    mobileOptionalText(record.id) ??
    mobileOptionalText(record.installation_id) ??
    mobileOptionalText(record.installationId);
  if (!id) return undefined;
  const source = readInstallationGitSource(record);
  const appId =
    mobileOptionalText(record.app_id) ??
    mobileOptionalText(record.appId) ??
    readPathString(record, ["app", "id"]);
  const launchUrl = readInstallationLaunchUrl(record);
  const name =
    mobileOptionalText(record.display_name) ??
    mobileOptionalText(record.displayName) ??
    mobileOptionalText(record.name) ??
    mobileOptionalText(record.app_name) ??
    mobileOptionalText(record.appName) ??
    appId ??
    sourceDisplayNameFromUrl(source.gitUrl) ??
    id;
  return {
    id,
    spaceId,
    appId,
    name,
    status:
      mobileOptionalText(record.status) ??
      readPathString(record, ["installation", "status"]),
    gitUrl: source.gitUrl,
    ref: source.ref,
    modulePath: source.modulePath,
    sourceCommit: source.sourceCommit,
    launchUrl,
    routePath: `/installations/${encodeURIComponent(id)}`,
  };
}

function readInstallationGitSource(record: Record<string, unknown>): {
  readonly gitUrl?: string;
  readonly ref?: string;
  readonly modulePath?: string;
  readonly sourceCommit?: string;
} {
  const source =
    mobileRecord(record.source) ??
    mobileRecord(record.git_source) ??
    mobileRecord(record.gitSource) ??
    mobileRecord(record.current_source) ??
    mobileRecord(record.currentSource) ??
    mobileRecord(mobileRecord(record.current_deployment)?.source) ??
    mobileRecord(mobileRecord(record.currentDeployment)?.source) ??
    mobileRecord(mobileRecord(record.latest_deployment)?.source) ??
    mobileRecord(mobileRecord(record.latestDeployment)?.source);
  const gitUrl =
    mobileOptionalText(source?.url) ??
    mobileOptionalText(source?.git_url) ??
    mobileOptionalText(source?.gitUrl) ??
    mobileOptionalText(record.git_url) ??
    mobileOptionalText(record.gitUrl) ??
    mobileOptionalText(record.repository_url) ??
    mobileOptionalText(record.repositoryUrl);
  const ref =
    mobileOptionalText(source?.ref) ??
    mobileOptionalText(source?.branch) ??
    mobileOptionalText(source?.tag) ??
    mobileOptionalText(record.ref) ??
    mobileOptionalText(record.source_ref) ??
    mobileOptionalText(record.sourceRef) ??
    mobileOptionalText(record.installed_version) ??
    mobileOptionalText(record.installedVersion);
  const modulePath =
    mobileOptionalText(source?.modulePath) ??
    mobileOptionalText(source?.module_path) ??
    mobileOptionalText(source?.path) ??
    mobileOptionalText(record.module_path) ??
    mobileOptionalText(record.modulePath);
  const sourceCommit =
    mobileOptionalText(source?.commit) ??
    mobileOptionalText(record.source_commit) ??
    mobileOptionalText(record.sourceCommit) ??
    mobileOptionalText(record.installed_commit) ??
    mobileOptionalText(record.installedCommit);
  return { gitUrl, ref, modulePath, sourceCommit };
}

function readInstallationLaunchUrl(
  record: Record<string, unknown>,
): string | undefined {
  const direct =
    mobileOptionalText(record.launch_url) ??
    mobileOptionalText(record.launchUrl) ??
    readPathString(record, ["installation", "launch_url"]) ??
    readPathString(record, ["installation", "launchUrl"]);
  if (direct) return direct;
  const services = record.services;
  if (Array.isArray(services)) {
    for (const service of services) {
      const endpoint = mobileOptionalText(mobileRecord(service)?.endpoint);
      if (endpoint) return endpoint;
    }
  }
  const outputs = record.deployment_outputs;
  if (Array.isArray(outputs)) {
    for (const output of outputs) {
      const outputRecord = mobileRecord(output);
      const value = mobileOptionalText(outputRecord?.value);
      if (value) return value;
    }
  }
  return undefined;
}

function readExpectedCurrentDeploymentId(
  expected: Record<string, unknown> | undefined,
): { readonly provided: boolean; readonly value: string | null } {
  if (
    !expected ||
    !Object.prototype.hasOwnProperty.call(expected, "currentDeploymentId")
  ) {
    return { provided: false, value: null };
  }
  const value = expected.currentDeploymentId;
  if (value === null) return { provided: true, value: null };
  return { provided: true, value: mobileOptionalText(value) ?? null };
}

function readPathString(
  value: unknown,
  path: readonly string[],
): string | undefined {
  let current: unknown = value;
  for (const segment of path) {
    const record = mobileRecord(current);
    if (!record) return undefined;
    current = record[segment];
  }
  return mobileOptionalText(current);
}

function sourceDisplayNameFromUrl(
  gitUrl: string | undefined,
): string | undefined {
  if (!gitUrl) return undefined;
  try {
    const parsed = new URL(gitUrl);
    const last = parsed.pathname.split("/").filter(Boolean).at(-1);
    return last?.replace(/\.git$/i, "") || undefined;
  } catch {
    return undefined;
  }
}

function requireTrimmed(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function assertHttpsGitUrl(gitUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(gitUrl);
  } catch {
    throw new Error("Git URL must be an HTTPS URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Git URL must be an HTTPS URL without credentials.");
  }
}

function assertSafeModulePath(modulePath: string): void {
  if (
    modulePath.startsWith("/") ||
    modulePath.split("/").some((part) => part === "..")
  ) {
    throw new Error("Module path must be repository-relative.");
  }
}
