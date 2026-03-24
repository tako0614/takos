import { describe, expect, it } from 'vitest';
import { buildPlatform, createPlatformConfig, createPlatformServices } from '@/platform/adapters/shared';
import { buildCloudflareWebPlatform } from '@/platform/adapters/cloudflare';
import { buildLocalWebPlatform } from '@/platform/adapters/local';

const minimalBindings = {
  ADMIN_DOMAIN: 'admin.example.test',
  TENANT_BASE_DOMAIN: 'tenant.example.test',
};

describe('platform adapters', () => {
  it('keeps the shared platform builder provider-neutral', () => {
    const platform = buildPlatform(
      'local',
      minimalBindings,
      createPlatformConfig({
        adminDomain: minimalBindings.ADMIN_DOMAIN,
        tenantBaseDomain: minimalBindings.TENANT_BASE_DOMAIN,
      }),
      createPlatformServices({
        routingBindings: {},
      }),
    );

    expect(platform.services.deploymentProviders).toBeUndefined();
  });

  it('attaches Cloudflare deploy provider config in the Cloudflare adapter only', () => {
    const platform = buildCloudflareWebPlatform({
      ...minimalBindings,
      CF_ACCOUNT_ID: 'cf-account',
      CF_API_TOKEN: 'cf-token',
      CF_ZONE_ID: 'cf-zone',
      WFP_DISPATCH_NAMESPACE: 'dispatch-ns',
      BROWSER: { connect: async () => ({ webSocketDebuggerUrl: 'ws://example.test' }) },
    } as never);

    expect(platform.services.deploymentProviders?.list()).toEqual([{
      name: 'cloudflare',
      config: {
        accountId: 'cf-account',
        apiToken: 'cf-token',
        zoneId: 'cf-zone',
        dispatchNamespace: 'dispatch-ns',
      },
    }]);
    expect(platform.services.deploymentProviders?.defaultName).toBe('cloudflare');
    expect(platform.services.documents.renderPdf).toBeTypeOf('function');
  });

  it('attaches OCI deploy provider config in the local adapter only', () => {
    const platform = buildLocalWebPlatform({
      ...minimalBindings,
      OCI_ORCHESTRATOR_URL: 'http://oci-orchestrator.internal/deploy',
      OCI_ORCHESTRATOR_TOKEN: 'oci-token',
    } as never);

    expect(platform.services.deploymentProviders?.list()).toEqual([{
      name: 'oci',
      config: {
        orchestratorUrl: 'http://oci-orchestrator.internal/deploy',
        orchestratorToken: 'oci-token',
      },
    }]);
    expect(platform.services.deploymentProviders?.defaultName).toBe('oci');
    expect(platform.services.documents.renderPdf).toBeUndefined();
  });
});
