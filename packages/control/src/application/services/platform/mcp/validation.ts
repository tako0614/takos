/**
 * MCP Service - URL Validation
 *
 * Endpoint URL validation and security checks for MCP server URLs.
 */

import type { Env } from '../../../../shared/types';
import { isLocalhost, isPrivateIP } from '@takoserver/common/validation';
import type { McpEndpointUrlOptions } from './mcp-models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeMcpEndpointHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getMcpEndpointUrlOptions(env: Pick<Env, 'ENVIRONMENT'>): McpEndpointUrlOptions {
  const isDev = env.ENVIRONMENT === 'development';
  return {
    allowHttp: isDev,
    allowLocalhost: isDev,
    allowPrivateIp: isDev,
  };
}

export function assertAllowedMcpEndpointUrl(
  rawUrl: string,
  options: McpEndpointUrlOptions,
  label: string,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} URL is invalid`);
  }

  if (parsed.protocol !== 'https:' && !(options.allowHttp && parsed.protocol === 'http:')) {
    throw new Error(`${label} URL must use ${options.allowHttp ? 'HTTP or HTTPS' : 'HTTPS'}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} URL must not include credentials`);
  }

  const normalizedHost = normalizeMcpEndpointHost(parsed.hostname);
  if (!options.allowLocalhost && isLocalhost(normalizedHost)) {
    throw new Error(`${label} URL host is not allowed`);
  }
  if (!options.allowPrivateIp && isPrivateIP(normalizedHost)) {
    throw new Error(`${label} URL host is not allowed`);
  }
  // Block bare hostnames (no dots) and IPv6 addresses without dots
  // that could bypass the isLocalhost/isPrivateIP checks above
  if (!options.allowLocalhost && !normalizedHost.includes('.') && !normalizedHost.includes(':')) {
    throw new Error(`${label} URL host must be publicly routable`);
  }
  // Explicitly check for IPv6 loopback that may bypass dot-based checks
  if (!options.allowLocalhost && (normalizedHost === '::1' || normalizedHost === '[::1]')) {
    throw new Error(`${label} URL host is not allowed`);
  }

  return parsed;
}
