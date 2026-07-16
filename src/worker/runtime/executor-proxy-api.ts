/**
 * Executor RPC dispatch
 *
 * The executor-host verifies the per-run proxy token + scope, then dispatches
 * each container Control RPC into the matching handler IN-PROCESS via
 * `dispatchControlRpc` below. The Takos agent handlers and executor-host live
 * in the same Takos Worker isolate, so there is no service-binding hop: the request body
 * is already a parsed record, the run is already token-bound, and the handlers
 * read DB / services directly. All handlers keep their original behavior; only
 * the redundant self-HTTP round-trip + internal-token recheck are gone.
 */

import type { Env } from "../shared/types/index.ts";
import { logError } from "../shared/utils/logger.ts";

// Handler imports from the existing executor subsystem — these contain the
// actual business logic (DB queries, tool execution, memory retrieval, billing, etc.)
import {
  getRunBootstrap,
  handleHeartbeat,
  handleIsCancelled,
  handleRunBootstrap,
  handleRunFail,
  handleRunRecord,
  handleRunReset,
  handleRunStatus,
} from "./container-hosts/executor-run-state.ts";

import { accountsDelegatedAuthorization } from "../server/routes/auth/accounts-delegation.ts";
import {
  fetchAuthorizedRuntimeInterfaces,
  issueRuntimeInterfaceAccessToken,
  type RuntimeInterfaceFetch,
} from "../application/services/platform/runtime-interface-client.ts";

import {
  handleAddMessage,
  handleCompleteRun,
  handleConversationHistory,
  handleEngineCheckpointLoad,
  handleEngineCheckpointSave,
  handleRunConfig,
  handleRunEvent,
  handleSkillCatalog,
  handleSkillPlan,
  handleSkillRuntimeContext,
  handleToolCatalog,
  handleToolCleanup,
  handleToolExecute,
  handleUpdateRunStatus,
  ensureRunLease,
} from "./container-hosts/executor-control-rpc.ts";

import { recordRunUsageBatch } from "../application/services/app-usage/usage-recorder.ts";
import {
  agentControlRpcPath,
  CONTROL_RPC_ENDPOINTS,
  err,
  ok,
} from "./container-hosts/executor-utils.ts";
import { getDb } from "../infra/db/index.ts";
import { runs } from "../infra/db/schema.ts";
import { eq } from "drizzle-orm";

// Terminal run statuses: a run in any of these states must not be handed
// deployment-global provider keys. Mirrors isTerminalRunStatus in
// container-hosts/executor-host.ts (the proxy-token revocation gate).
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const AI_GATEWAY_INTERFACE_TYPE = "takosumi.ai.gateway";
const AI_GATEWAY_CHAT_PERMISSION = "ai.chat";

type OpenAiRuntimeCredential = {
  readonly apiKey: string;
  readonly endpoint: string;
};

type RuntimeCredentialDeps = {
  readonly getRunBootstrap: typeof getRunBootstrap;
  readonly accountsDelegatedAuthorization: typeof accountsDelegatedAuthorization;
  readonly fetch: RuntimeInterfaceFetch;
};

const runtimeCredentialDeps: RuntimeCredentialDeps = {
  getRunBootstrap,
  accountsDelegatedAuthorization,
  fetch: (input, init) => fetch(input, init),
};

/**
 * Least-privilege gate for the deployment-global provider key handout.
 *
 * The caller is already authenticated as the run bound to `body.runId`: the
 * executor-host overwrites this field from the verified proxy token before
 * dispatching here in-process. This check adds a freshness requirement: the
 * token-bound run must still be active. A run that has gone terminal (or no
 * longer exists) must not be able to keep pulling shared provider credentials,
 * even though its proxy token may not yet have been revoked.
 *
 * Returns `null` when the run is active (caller may proceed), otherwise the
 * rejection Response. Identity stays token-bound: we read the run by the
 * `runId` the token authorized, never by an attacker-chosen target.
 */
async function rejectApiKeysIfRunInactive(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response | null> {
  const runId =
    typeof body.runId === "string" && body.runId.length > 0 ? body.runId : null;
  if (!runId) {
    return err("Missing runId", 400);
  }
  let status: string | null;
  try {
    const db = getDb(env.DB);
    const row = await db
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();
    status = row?.status ?? null;
  } catch (e) {
    logError("api-keys run-active check failed", e, {
      module: "executor-proxy-api",
    });
    return err("Run lookup failed", 503);
  }
  // Missing run or terminal run: deny. Only an in-flight run (queued / running)
  // may receive the shared provider keys.
  if (status === null || TERMINAL_RUN_STATUSES.has(status)) {
    return err("Run is not active", 403);
  }
  return null;
}

// ---------------------------------------------------------------------------
// In-process control-RPC dispatch
// ---------------------------------------------------------------------------

/**
 * Generic control-RPC handlers, keyed by endpoint slug. Every handler takes the
 * parsed body and env and returns a Response; tool-cleanup is normalized to the
 * same shape (it ignores env). The two bespoke endpoints (run-usage, api-keys)
 * are NOT here — they carry extra metering / least-privilege logic and are
 * dispatched directly below.
 */
const CONTROL_RPC_HANDLERS: Record<
  string,
  (body: Record<string, unknown>, env: Env) => Response | Promise<Response>
> = {
  // run lifecycle / status
  heartbeat: handleHeartbeat,
  "run-status": handleRunStatus,
  "run-record": handleRunRecord,
  "run-bootstrap": handleRunBootstrap,
  "run-fail": handleRunFail,
  "run-reset": handleRunReset,
  "run-config": handleRunConfig,
  "is-cancelled": handleIsCancelled,
  "update-run-status": handleUpdateRunStatus,
  "complete-run": handleCompleteRun,
  "engine-checkpoint-load": handleEngineCheckpointLoad,
  "engine-checkpoint-save": handleEngineCheckpointSave,
  "run-event": handleRunEvent,
  // conversation / session / messages
  "conversation-history": handleConversationHistory,
  "add-message": handleAddMessage,
  // memory
  // skills
  "skill-runtime-context": handleSkillRuntimeContext,
  "skill-catalog": handleSkillCatalog,
  "skill-plan": handleSkillPlan,
  // tools
  "tool-catalog": handleToolCatalog,
  "tool-execute": handleToolExecute,
  "tool-cleanup": (body) => handleToolCleanup(body),
};

// --- Bespoke endpoint handlers (run-usage, api-keys) ---
//
// These two carry extra metering / least-privilege logic and so are not in the
// generic CONTROL_RPC_HANDLERS map. Each takes the already-parsed body + env
// and returns a Response, matching the generic handler shape.

async function handleRunUsage(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : undefined;
  if (!runId) return err("Missing runId", 400);
  try {
    await recordRunUsageBatch(env, runId);
    return ok({ recorded: true });
  } catch (usageErr) {
    logError(`Usage recording failed for run ${runId}`, usageErr, {
      module: "executor-proxy-api",
    });
    return ok({ recorded: false, error: "usage_recording_failed" });
  }
}

async function handleApiKeys(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  // Only hand out the deployment-global provider keys while the token-bound
  // run is still active; a missing/terminal run is rejected.
  const inactive = await rejectApiKeysIfRunInactive(body, env);
  if (inactive) return inactive;

  const configuredDirectOpenAiKey = nonEmptyString(env.OPENAI_API_KEY);
  const allowSharedProviderKey =
    env.ENVIRONMENT === "development" ||
    nonEmptyString(env.TAKOS_AGENT_ALLOW_SHARED_PROVIDER_KEY)?.toLowerCase() ===
      "true";
  const directOpenAiKey = allowSharedProviderKey
    ? configuredDirectOpenAiKey
    : undefined;
  if (directOpenAiKey) {
    return ok({
      openai: directOpenAiKey,
      openaiEndpoint:
        openAiChatCompletionsEndpoint(env.OPENAI_BASE_URL) ?? null,
    });
  }
  if (configuredDirectOpenAiKey) {
    logError(
      "Refusing to hand a deployment-global provider key to the agent container; configure short-lived Takosumi AI Gateway credentials or explicitly opt into the self-host security downgrade",
      undefined,
      { module: "executor-proxy-api" },
    );
  }
  const runId = nonEmptyString(body.runId)!;
  let openAiCredential: OpenAiRuntimeCredential | undefined;
  try {
    openAiCredential = await resolveRunOpenAiRuntimeCredential(
      { runId, env },
      runtimeCredentialDeps,
    );
  } catch (error) {
    logError("Takosumi AI Gateway runtime credential mint failed", error, {
      module: "executor-proxy-api",
      runId,
    });
    return err(
      configuredDirectOpenAiKey
        ? "Shared provider-key handout is disabled; configure short-lived AI Gateway credentials"
        : "Takosumi AI Gateway authorization is unavailable",
      503,
    );
  }

  if (!openAiCredential) {
    return err(
      configuredDirectOpenAiKey
        ? "Shared provider-key handout is disabled; configure short-lived AI Gateway credentials"
        : "No short-lived AI runtime credential is available",
      503,
    );
  }

  return ok({
    openai: openAiCredential.apiKey,
    openaiEndpoint: openAiCredential.endpoint,
  });
}

/**
 * Mint a short-lived AI Gateway token for one active run.
 *
 * The triggering user's delegated Accounts token reads one exact authorized
 * `takosumi.ai.gateway` Interface and Ready Principal InterfaceBinding. Core
 * revalidates that evidence before issuing the invocation-only token. Reserved
 * lifecycle side channels, operator credentials, and provider keys never enter
 * the Takos worker or pooled agent container.
 */
export async function resolveRunOpenAiRuntimeCredential(
  input: { readonly runId: string; readonly env: Env },
  deps: RuntimeCredentialDeps = runtimeCredentialDeps,
): Promise<OpenAiRuntimeCredential | undefined> {
  const issuer = nonEmptyString(input.env.OIDC_ISSUER_URL);
  const clientId = nonEmptyString(input.env.OIDC_CLIENT_ID);
  const clientSecret = nonEmptyString(input.env.OIDC_CLIENT_SECRET);
  const encryptionKey = nonEmptyString(input.env.ENCRYPTION_KEY);
  const internalAccountsUrl =
    nonEmptyString(input.env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ??
    nonEmptyString(input.env.TAKOSUMI_ACCOUNTS_URL) ??
    issuer;
  if (!issuer || !clientId || !encryptionKey || !internalAccountsUrl) {
    return undefined;
  }

  const bootstrap = await deps.getRunBootstrap(input.env, input.runId);
  if (
    bootstrap.status === null ||
    TERMINAL_RUN_STATUSES.has(bootstrap.status)
  ) {
    throw new Error("run is not active");
  }
  const authorization = await deps.accountsDelegatedAuthorization({
    db: input.env.DB,
    encryptionKey,
    userId: bootstrap.userId,
    issuer: issuer.replace(/\/+$/u, ""),
    clientId,
    clientSecret,
    access: "read",
  });
  const request = {
    baseUrl: internalAccountsUrl,
    token: authorization.accessToken,
    subjectId: authorization.subjectId,
    fetch: deps.fetch,
  };
  const authorized = await fetchAuthorizedRuntimeInterfaces(
    {
      workspaceId: authorization.workspaceId,
      type: AI_GATEWAY_INTERFACE_TYPE,
      permission: AI_GATEWAY_CHAT_PERMISSION,
      deliveryTypes: ["oauth2"],
    },
    request,
  );
  if (authorized.length === 0) return undefined;
  if (authorized.length !== 1) {
    throw new Error("AI Gateway Interface selection is ambiguous");
  }
  const selected = authorized[0]!;
  const endpoint = aiGatewayInterfaceEndpoint(selected.interface);
  if (!endpoint) throw new Error("AI Gateway Interface endpoint is invalid");
  const resourceInput = selected.interface.spec.access.resourceUriInput;
  const resource = resourceInput
    ? nonEmptyString(selected.interface.status.resolvedInputs?.[resourceInput])
    : undefined;
  if (!resource || canonicalRuntimeResource(resource) !== endpoint) {
    throw new Error("AI Gateway Interface audience is invalid");
  }
  const token = await issueRuntimeInterfaceAccessToken(request, {
    interfaceId: selected.interface.metadata.id,
    permission: AI_GATEWAY_CHAT_PERMISSION,
    resource: endpoint,
    errorLabel: "AI Gateway Interface",
  });
  return {
    apiKey: token,
    endpoint: openAiChatCompletionsEndpoint(endpoint)!,
  };
}

function aiGatewayInterfaceEndpoint(
  iface: Awaited<
    ReturnType<typeof fetchAuthorizedRuntimeInterfaces>
  >[number]["interface"],
): string | undefined {
  const raw = nonEmptyString(iface.status.resolvedInputs?.endpoint);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function canonicalRuntimeResource(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function openAiChatCompletionsEndpoint(
  baseUrl: string | undefined,
): string | undefined {
  const value = nonEmptyString(baseUrl);
  if (!value) return undefined;
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/u, "");
  if (!path.endsWith("/chat/completions")) {
    url.pathname = `${path}/chat/completions`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Lookup from the agent-control RPC path the executor-host already verified
 * (`/api/internal/v1/agent-control/<name>`) to the in-process handler. Derived
 * from the single CONTROL_RPC_ENDPOINTS registry so route / scope / dispatch
 * coverage stays in lockstep: every registry entry resolves either to a generic
 * handler or to one of the two bespoke handlers, and a registry entry that
 * resolves to neither is a build/boot bug.
 */
const CONTROL_RPC_DISPATCH: ReadonlyMap<
  string,
  (body: Record<string, unknown>, env: Env) => Response | Promise<Response>
> = new Map(
  CONTROL_RPC_ENDPOINTS.map(({ name }) => {
    const handler =
      CONTROL_RPC_HANDLERS[name] ??
      (name === "run-usage"
        ? handleRunUsage
        : name === "api-keys"
          ? handleApiKeys
          : undefined);
    if (!handler) {
      throw new Error(`No control-RPC handler registered for "${name}"`);
    }
    return [agentControlRpcPath(name), handler] as const;
  }),
);

const TOOL_CLEANUP_PATH = agentControlRpcPath("tool-cleanup");

/**
 * Dispatch a verified container Control RPC to its handler IN-PROCESS.
 *
 * The executor-host has already verified the per-run proxy token, overwritten
 * runId/serviceId from the token, and checked endpoint scope, so `body` is a
 * parsed, token-bound record. We map the agent-control path to its handler and
 * invoke it directly — no service-binding hop, no internal-token recheck.
 *
 * Returns `null` only when `path` is not a mapped control-RPC path, so the
 * caller can surface a 404 for an unknown endpoint.
 */
export function dispatchControlRpc(
  path: string,
  body: Record<string, unknown>,
  env: Env,
): Response | Promise<Response> | null {
  const handler = CONTROL_RPC_DISPATCH.get(path);
  if (!handler) return null;
  return (async () => {
    // One central request-boundary fence covers both read and write RPCs. A
    // proxy token is an authentication credential, but the DB run lease is the
    // live authorization decision; stale-recovery and user cancellation can
    // revoke that authority while the token still exists in Durable Object
    // storage. Local/in-process callers omit serviceId and retain the legacy
    // single-process behavior because ensureRunLease deliberately skips them.
    //
    // tool-cleanup is the sole exception: it only releases the cache entry
    // keyed by this exact run/service/lease identity. Letting a superseded
    // lease clean up its own resources is safe and prevents an hour-long TTL
    // leak; it cannot touch the replacement lease's executor.
    if (path !== TOOL_CLEANUP_PATH && typeof body.runId === "string") {
      const leaseError = await ensureRunLease(env, body.runId, body);
      if (leaseError) return leaseError;
    }
    return await handler(body, env);
  })();
}
