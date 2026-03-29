import { disposeNodePlatformState } from '../node-platform/env-builder.ts';
import { runLocalSmoke } from './run-smoke.ts';
import { DEFAULT_LOCAL_PORTS } from './runtime-types.ts';
import { isDirectEntrypoint, logEntrypointError } from './direct-entrypoint.ts';

type ProxyUsageResponse = {
  counts?: Record<string, number>;
};

function executorHostBaseUrl(): string {
  const raw = process.env.TAKOS_LOCAL_EXECUTOR_HOST_URL?.trim();
  if (raw) {
    return raw.replace(/\/$/, '');
  }
  return `http://executor-host:${DEFAULT_LOCAL_PORTS.executorHost}`;
}

async function readProxyUsage(): Promise<Record<string, number>> {
  const response = await fetch(`${executorHostBaseUrl()}/internal/proxy-usage`);
  if (!response.ok) {
    throw new Error(`Failed to read executor-host proxy usage: ${response.status}`);
  }
  const body = await response.json() as ProxyUsageResponse;
  return body.counts ?? {};
}

function diffCounts(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const result: Record<string, number> = {};
  for (const key of keys) {
    result[key] = (after[key] ?? 0) - (before[key] ?? 0);
  }
  return result;
}

export async function runLocalSmokeProxyless() {
  const before = await readProxyUsage();
  const run = await runLocalSmoke();
  const after = await readProxyUsage();
  const delta = diffCounts(before, after);

  const forbidden = ['db', 'offload', 'do']
    .map((key) => ({ key, value: delta[key] ?? 0 }))
    .filter((entry) => entry.value !== 0);

  if (forbidden.length > 0) {
    throw new Error(`Proxyless smoke failed: forbidden proxy usage detected ${JSON.stringify(forbidden)}`);
  }

  return {
    ...run,
    proxyless: true,
    proxyUsageDelta: delta,
  };
}

export async function runLocalSmokeProxylessCommand(): Promise<void> {
  try {
    const payload = await runLocalSmokeProxyless();
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await disposeNodePlatformState();
  }
}

if (await isDirectEntrypoint(import.meta.url)) {
  runLocalSmokeProxylessCommand().catch(logEntrypointError);
}
