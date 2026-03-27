import type { AgentExecutorControlConfig } from './executor-dispatch';
import { base64UrlEncode } from '../../shared/utils/encoding-utils';

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
  env: Pick<AgentExecutorProxyConfigEnv, 'CONTROL_RPC_BASE_URL'>,
): AgentExecutorContainerEnvVars {
  return {
    CONTROL_RPC_BASE_URL: env.CONTROL_RPC_BASE_URL || '',
  };
}
