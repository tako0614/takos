import type { AgentExecutorControlConfig } from './executor-dispatch';

export interface AgentExecutorProxyConfigEnv {
  CONTROL_RPC_BASE_URL?: string;
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
  // base64url encode without padding
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
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
  env: Pick<AgentExecutorProxyConfigEnv, 'CONTROL_RPC_BASE_URL'>,
): AgentExecutorContainerEnvVars {
  return {
    CONTROL_RPC_BASE_URL: env.CONTROL_RPC_BASE_URL || '',
  };
}
