import type { AgentExecutorControlConfig } from "./executor-dispatch.ts";
import { base64UrlEncode } from "../../shared/utils/encoding-utils.ts";

export interface AgentExecutorProxyConfigEnv {
  CONTROL_RPC_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
}

export interface AgentExecutorContainerEnvVars extends Record<string, string> {
  CONTROL_RPC_BASE_URL: string;
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

export function buildAgentExecutorProxyConfig(
  env: AgentExecutorProxyConfigEnv,
  _claims: { runId: string; serviceId: string },
): AgentExecutorControlConfig {
  return {
    controlRpcBaseUrl: env.CONTROL_RPC_BASE_URL,
    controlRpcToken: generateProxyToken(),
  };
}

export function buildAgentExecutorContainerEnvVars(
  env: AgentExecutorProxyConfigEnv,
): AgentExecutorContainerEnvVars {
  const vars: AgentExecutorContainerEnvVars = {
    CONTROL_RPC_BASE_URL: env.CONTROL_RPC_BASE_URL || "",
  };
  copyOptionalEnvVar(vars, "OPENAI_API_KEY", env.OPENAI_API_KEY);
  copyOptionalEnvVar(vars, "ANTHROPIC_API_KEY", env.ANTHROPIC_API_KEY);
  copyOptionalEnvVar(vars, "GOOGLE_API_KEY", env.GOOGLE_API_KEY);
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
