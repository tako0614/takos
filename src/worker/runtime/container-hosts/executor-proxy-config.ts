import type { AgentExecutorControlConfig } from "./executor-dispatch.ts";
import { base64UrlEncode } from "../../shared/utils/encoding-utils.ts";
import { logError, logWarn } from "../../shared/utils/logger.ts";

export interface AgentExecutorProxyConfigEnv {
  TAKOS_AGENT_CONTROL_RPC_BASE_URL?: string;
  TAKOS_AGENT_START_TOKEN?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  /** Deployment environment label (e.g. "production" / "development"). */
  ENVIRONMENT?: string;
  /**
   * Opt-in escape hatch for injecting the durable provider keys directly into
   * every executor container's env. Defaults to OFF (proxy mode): the agent
   * fetches provider keys at runtime via the per-run-token-scoped `api-keys`
   * control RPC, so the durable keys never touch a pooled/reused container env.
   *
   * Set to "1" / "true" only when a deployment cannot reach the control-plane
   * `api-keys` endpoint. Accepts a single durable key leak across all tenants
   * sharing the executor pool, so it should stay disabled in production.
   */
  EXECUTOR_INJECT_PROVIDER_KEYS_DIRECT?: string;
}

export interface AgentExecutorContainerEnvVars extends Record<string, string> {
  TAKOS_AGENT_CONTROL_RPC_BASE_URL: string;
  TAKOS_AGENT_START_TOKEN?: string;
}

/**
 * Generate a cryptographically random proxy token (32 bytes, base64url-encoded).
 * Used instead of JWT for container → host proxy auth.
 */
export function generateProxyToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Build the control-RPC config injected into an executor container.
 *
 * The proxy token is an opaque random value, NOT derived from the run/service:
 * scoping to a specific run is established later by storing this token in the
 * per-run token map (executor-host.ts dispatchStart) and verifying it on each
 * control RPC. The signature therefore takes no run/service id — adding one
 * would falsely imply the token is cryptographically bound to the run.
 */
export function buildAgentExecutorProxyConfig(
  env: AgentExecutorProxyConfigEnv,
): AgentExecutorControlConfig {
  return {
    controlRpcBaseUrl: env.TAKOS_AGENT_CONTROL_RPC_BASE_URL,
    controlRpcToken: generateProxyToken(),
    startToken: env.TAKOS_AGENT_START_TOKEN,
  };
}

/**
 * Build the env injected into every (pooled / reused) executor container.
 *
 * By default the durable provider keys (OPENAI/ANTHROPIC/GOOGLE) are NOT
 * injected: containers are pooled and reused across runs and tenants, so a
 * single container compromise (or a tool reading its own env) would otherwise
 * leak every tenant's provider key. The agent instead fetches the provider key
 * at runtime over the per-run-token-scoped `api-keys` control RPC, which the
 * control plane authorizes against the active run. Only the per-run proxy
 * token + control-RPC URL are scoped into the container.
 *
 * `EXECUTOR_INJECT_PROVIDER_KEYS_DIRECT` is an opt-in escape hatch for
 * deployments that cannot reach the control-plane `api-keys` endpoint.
 */
export function buildAgentExecutorContainerEnvVars(
  env: AgentExecutorProxyConfigEnv,
): AgentExecutorContainerEnvVars {
  const vars: AgentExecutorContainerEnvVars = {
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: env.TAKOS_AGENT_CONTROL_RPC_BASE_URL ||
      "",
  };
  copyOptionalEnvVar(
    vars,
    "TAKOS_AGENT_START_TOKEN",
    env.TAKOS_AGENT_START_TOKEN,
  );
  if (
    shouldInjectProviderKeysDirect(env.EXECUTOR_INJECT_PROVIDER_KEYS_DIRECT)
  ) {
    // This durable, cross-tenant key exposure must never be silent. Log it on
    // every build; escalate to CRITICAL outside an explicit dev environment so a
    // production deploy that flips it on is loud in logs/audit.
    const environment = (env.ENVIRONMENT ?? "").trim().toLowerCase();
    const isDev = environment === "development" || environment === "dev" ||
      environment === "local" || environment === "test";
    const message =
      "EXECUTOR_INJECT_PROVIDER_KEYS_DIRECT is ON: durable provider keys are " +
      "injected into every pooled executor container env and are shared across " +
      "all tenants on the pool — use only on isolated/single-tenant deployments.";
    const ctx = {
      module: "container-hosts/executor-proxy-config",
      environment: environment || "unset",
    };
    if (isDev) logWarn(message, ctx);
    else logError(message, undefined, { ...ctx, severity: "critical" });

    copyOptionalEnvVar(vars, "OPENAI_API_KEY", env.OPENAI_API_KEY);
    copyOptionalEnvVar(vars, "ANTHROPIC_API_KEY", env.ANTHROPIC_API_KEY);
    copyOptionalEnvVar(vars, "GOOGLE_API_KEY", env.GOOGLE_API_KEY);
  }
  return vars;
}

/**
 * Resolve the direct-key-injection escape hatch. Defaults to false (proxy
 * mode) for any unset/empty/unrecognized value.
 */
export function shouldInjectProviderKeysDirect(
  value: string | undefined,
): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function copyOptionalEnvVar(
  vars: Record<string, string>,
  name: string,
  value: string | undefined,
): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  vars[name] = trimmed;
}
