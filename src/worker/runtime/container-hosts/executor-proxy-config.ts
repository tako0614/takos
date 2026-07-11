import type { AgentExecutorControlConfig } from "./executor-dispatch.ts";
import { base64UrlEncode } from "../../shared/utils/encoding-utils.ts";

/**
 * Default remote-tool allowlist for the bundled Takos distribution. The agent
 * container fails closed when `TAKOS_AGENT_TOOL_ALLOWLIST` is unset (no remote
 * tool runs), so the product default is the current policy-filtered catalog
 * (`*`). That catalog can include Takos core tools, installed Capsule MCP
 * tools, and registered external MCP tools; role/capability checks still apply.
 * Operators can narrow it to explicit tool names.
 */
export const DEFAULT_AGENT_TOOL_ALLOWLIST = "*";

export interface AgentExecutorProxyConfigEnv {
  TAKOS_AGENT_CONTROL_RPC_BASE_URL?: string;
  TAKOS_AGENT_START_TOKEN?: string;
  /**
   * Comma-separated remote-tool allowlist forwarded to the agent container as
   * `TAKOS_AGENT_TOOL_ALLOWLIST`. `*` allows every tool already admitted to the
   * run catalog by policy. When unset the bundled distribution falls back to
   * {@link DEFAULT_AGENT_TOOL_ALLOWLIST}.
   */
  TAKOS_AGENT_TOOL_ALLOWLIST?: string;
}

export interface AgentExecutorContainerEnvVars extends Record<string, string> {
  TAKOS_AGENT_BIND_HOST: string;
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
 * Durable provider keys are never injected: containers are pooled and reused
 * across runs and tenants. The agent obtains one OpenAI-compatible runtime
 * credential through the active-run-scoped `api-keys` control RPC.
 */
export function buildAgentExecutorContainerEnvVars(
  env: AgentExecutorProxyConfigEnv,
): AgentExecutorContainerEnvVars {
  const vars: AgentExecutorContainerEnvVars = {
    // Cloudflare and OCI container ingress reaches the process over the
    // container's private network, not the loopback interface.
    TAKOS_AGENT_BIND_HOST: "0.0.0.0",
    TAKOS_AGENT_CONTROL_RPC_BASE_URL:
      env.TAKOS_AGENT_CONTROL_RPC_BASE_URL || "",
    // Operator-configured allowlist wins; otherwise the bundled distribution
    // ships with the policy-filtered run catalog enabled. The container still
    // fails closed if this resolves to empty.
    TAKOS_AGENT_TOOL_ALLOWLIST:
      (env.TAKOS_AGENT_TOOL_ALLOWLIST ?? "").trim() ||
      DEFAULT_AGENT_TOOL_ALLOWLIST,
  };
  copyOptionalEnvVar(
    vars,
    "TAKOS_AGENT_START_TOKEN",
    env.TAKOS_AGENT_START_TOKEN,
  );
  return vars;
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
