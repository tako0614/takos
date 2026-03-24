import { createLogger } from '@takos/common/logger';
import { HEARTBEAT_INTERVAL_MS, PROXY_BASE_URL } from '../shared/config.js';

const logger = createLogger({ service: 'takos-runtime' });

let heartbeatConfigWarned = false;

function getHeartbeatConfig(sessionId: string, proxyToken?: string): { url: string; headers: Record<string, string> } | null {
  if (PROXY_BASE_URL && proxyToken) {
    const base = PROXY_BASE_URL.endsWith('/') ? PROXY_BASE_URL.slice(0, -1) : PROXY_BASE_URL;
    return {
      url: `${base}/forward/heartbeat/${sessionId}`,
      headers: {
        'X-Takos-Session-Id': sessionId,
        'Authorization': `Bearer ${proxyToken}`,
      },
    };
  }

  if (!heartbeatConfigWarned) {
    const missing = [
      !PROXY_BASE_URL ? 'PROXY_BASE_URL' : null,
      !proxyToken ? 'proxy token' : null,
    ].filter(Boolean).join(', ');
    logger.warn('Heartbeat disabled', { missing });
    heartbeatConfigWarned = true;
  }
  return null;
}

async function sendHeartbeat(sessionId: string, proxyToken?: string): Promise<void> {
  const config = getHeartbeatConfig(sessionId, proxyToken);
  if (!config) return;
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: config.headers,
    });
    if (!response.ok) {
      logger.warn('Heartbeat failed', { status: response.status, statusText: response.statusText });
    }
  } catch (err) {
    logger.warn('Heartbeat error', { error: err as Error });
  }
}

export function startHeartbeat(
  sessionId: string,
  proxyToken: string | undefined,
): NodeJS.Timeout | null {
  if (!getHeartbeatConfig(sessionId, proxyToken)) return null;
  const timer = setInterval(() => {
    void sendHeartbeat(sessionId, proxyToken);
  }, HEARTBEAT_INTERVAL_MS);
  void sendHeartbeat(sessionId, proxyToken);
  return timer;
}
