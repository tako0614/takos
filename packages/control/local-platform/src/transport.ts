import type { LocalFetch } from '../../src/local-platform/runtime.ts';
import { serveNodeFetch } from '../../src/local-platform/fetch-server.ts';
import { logInfo } from '../../src/shared/utils/logger.ts';

export type LocalFetchServerTransport = 'node';

function resolvePort(defaultPort: number): number {
  const parsed = Number.parseInt(process.env.PORT ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPort;
}

function resolveLocalFetchTransport(): LocalFetchServerTransport {
  const raw = process.env.TAKOS_LOCAL_FETCH_TRANSPORT?.trim().toLowerCase();
  if (!raw || raw === 'node') return 'node';
  throw new Error(
    `Unsupported TAKOS_LOCAL_FETCH_TRANSPORT="${raw}". `
    + 'The canonical local runtime currently supports only the node transport.',
  );
}

function logLocalServerStart(service: string, port: number) {
  logInfo(`${service} local runtime listening on :${port}`, {
    module: 'local_platform',
    adapter: process.env.TAKOS_LOCAL_ADAPTER,
    runtime: resolveLocalFetchTransport(),
  });
}

export async function startCanonicalLocalServer(options: {
  service: string;
  defaultPort: number;
  createFetch: () => Promise<LocalFetch>;
}): Promise<void> {
  const port = resolvePort(options.defaultPort);
  const fetch = await options.createFetch();
  resolveLocalFetchTransport();
  await serveNodeFetch({
    port,
    fetch,
    onListen: () => logLocalServerStart(options.service, port),
  });
}
