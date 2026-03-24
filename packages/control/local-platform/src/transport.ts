import type { LocalFetch } from '../../src/local-platform/runtime.ts';
import { serveNodeFetch } from '../../src/local-platform/fetch-server.ts';
import { logInfo } from '../../src/shared/utils/logger.ts';

function resolvePort(defaultPort: number): number {
  const parsed = Number.parseInt(process.env.PORT ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPort;
}

function logLocalServerStart(service: string, port: number) {
  logInfo(`${service} local runtime listening on :${port}`, {
    module: 'local_platform',
    adapter: process.env.TAKOS_LOCAL_ADAPTER,
    runtime: 'node',
  });
}

export async function startCanonicalLocalServer(options: {
  service: string;
  defaultPort: number;
  createFetch: () => Promise<LocalFetch>;
}): Promise<void> {
  const port = resolvePort(options.defaultPort);
  const fetch = await options.createFetch();
  await serveNodeFetch({
    port,
    fetch,
    onListen: () => logLocalServerStart(options.service, port),
  });
}
