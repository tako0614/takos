import type { Env } from '../../../../shared/types';
import { createCloudflareApiClient } from '../../../../platform/providers/cloudflare/api-client.ts';
import { logError } from '../../../../shared/utils/logger';

export async function createCloudflareCustomHostname(
  env: Env,
  domain: string
): Promise<{ success: boolean; customHostnameId?: string; error?: string }> {
  const cfClient = createCloudflareApiClient(env);
  if (!cfClient?.zoneId) {
    return { success: true };
  }

  try {
    const result = await cfClient.zonePost<{ id: string }>('/custom_hostnames', {
      hostname: domain,
      ssl: {
        method: 'http',
        type: 'dv',
        settings: { min_tls_version: '1.2' },
      },
    });
    return { success: true, customHostnameId: result.id };
  } catch (err) {
    logError('Cloudflare API error', err, { module: 'services/platform/custom-domains' });
    const message = err instanceof Error ? err.message : 'Failed to create custom hostname';
    return { success: false, error: message };
  }
}

export async function deleteCloudflareCustomHostname(
  env: Env,
  customHostnameId: string
): Promise<void> {
  const cfClient = createCloudflareApiClient(env);
  if (!cfClient?.zoneId || !customHostnameId) return;

  try {
    await cfClient.zoneDelete(`/custom_hostnames/${customHostnameId}`);
  } catch (err) {
    logError('Failed to delete custom hostname', err, { module: 'services/platform/custom-domains' });
  }
}

export async function getCloudflareCustomHostnameStatus(
  env: Env,
  customHostnameId: string
): Promise<{ status: string; sslStatus: string } | null> {
  const cfClient = createCloudflareApiClient(env);
  if (!cfClient?.zoneId || !customHostnameId) return null;

  try {
    const result = await cfClient.zoneGet<{ status: string; ssl?: { status: string } }>(
      `/custom_hostnames/${customHostnameId}`
    );
    return {
      status: result.status,
      sslStatus: result.ssl?.status || 'pending',
    };
  } catch (err) {
    logError('Failed to get custom hostname status', err, { module: 'services/platform/custom-domains' });
    return null;
  }
}
