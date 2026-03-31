import type { RefreshableProvider } from './refresh.ts';
import { CF_API } from '../group-deploy/cloudflare-utils.ts';

function buildHeaders(apiToken: string): { Authorization: string } {
  return {
    Authorization: `Bearer ${apiToken}`,
  };
}

async function checkCloudflareEndpoint(
  accountId: string,
  apiToken: string,
  path: string,
): Promise<boolean> {
  const res = await fetch(`${CF_API}/accounts/${encodeURIComponent(accountId)}${path}`, {
    method: 'GET',
    headers: buildHeaders(apiToken),
  });

  if (res.status === 404) {
    return false;
  }

  if (res.ok) {
    return true;
  }

  const text = await res.text().catch(() => res.statusText);
  throw new Error(`Cloudflare API GET ${path} failed (${res.status}): ${text}`);
}

export class CloudflareStateRefreshProvider implements RefreshableProvider {
  constructor(
    private readonly accountId: string,
    private readonly apiToken: string,
  ) {}

  async checkResourceExists(type: string, id: string, name: string): Promise<boolean | null> {
    if (!id && type !== 'worker') {
      return null;
    }

    switch (type) {
      case 'sql':
      case 'd1':
        return checkCloudflareEndpoint(this.accountId, this.apiToken, `/d1/database/${encodeURIComponent(id)}`);
      case 'object_store':
      case 'r2':
        return checkCloudflareEndpoint(this.accountId, this.apiToken, `/r2/buckets/${encodeURIComponent(id)}`);
      case 'kv':
        return checkCloudflareEndpoint(this.accountId, this.apiToken, `/storage/kv/namespaces/${encodeURIComponent(id)}`);
      case 'queue':
        return checkCloudflareEndpoint(this.accountId, this.apiToken, `/queues/${encodeURIComponent(id)}`);
      case 'vector_index':
      case 'vectorize':
        return checkCloudflareEndpoint(this.accountId, this.apiToken, `/vectorize/v2/indexes/${encodeURIComponent(id)}`);
      case 'worker':
        return checkCloudflareEndpoint(this.accountId, this.apiToken, `/workers/scripts/${encodeURIComponent(id || name)}`);
      default:
        return null;
    }
  }
}

export class UnavailableStateRefreshProvider implements RefreshableProvider {
  async checkResourceExists(): Promise<boolean | null> {
    return null;
  }
}

export function createStateRefreshProvider(options: {
  provider: string;
  accountId?: string;
  apiToken?: string;
}): RefreshableProvider {
  if (options.provider === 'cloudflare' && options.accountId && options.apiToken) {
    return new CloudflareStateRefreshProvider(options.accountId, options.apiToken);
  }
  return new UnavailableStateRefreshProvider();
}
