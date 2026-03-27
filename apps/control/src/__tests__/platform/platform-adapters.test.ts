import { describe, expect, it } from 'vitest';
import { buildPlatform, createPlatformConfig, createPlatformServices } from '@/platform/adapters/shared';
import { buildWorkersWebPlatform } from '@/platform/adapters/workers';
import { buildNodeWebPlatform } from '@/platform/adapters/node';

const minimalBindings = {
  ADMIN_DOMAIN: 'admin.example.test',
  TENANT_BASE_DOMAIN: 'tenant.example.test',
};

describe('platform adapters', () => {
  it('keeps the shared platform builder provider-neutral', () => {
    const platform = buildPlatform(
      'node',
      minimalBindings,
      createPlatformConfig({
        adminDomain: minimalBindings.ADMIN_DOMAIN,
        tenantBaseDomain: minimalBindings.TENANT_BASE_DOMAIN,
      }),
      createPlatformServices({
        routing: {
          resolveHostname: async () => ({ target: null, tombstone: false, source: 'store' }),
          selectDeploymentTarget: () => null,
          selectRouteRef: () => null,
        },
      }),
    );

    expect(platform.services.deploymentProviders).toBeUndefined();
  });

  it('attaches workers-dispatch deploy provider in the workers adapter', () => {
    const platform = buildWorkersWebPlatform({
      ...minimalBindings,
      CF_ACCOUNT_ID: 'cf-account',
      CF_API_TOKEN: 'cf-token',
      CF_ZONE_ID: 'cf-zone',
      WFP_DISPATCH_NAMESPACE: 'dispatch-ns',
      BROWSER: { connect: async () => ({ webSocketDebuggerUrl: 'ws://example.test' }) },
    } as never);

    expect(platform.services.deploymentProviders?.list()).toEqual([{
      name: 'workers-dispatch',
      config: {
        accountId: 'cf-account',
        apiToken: 'cf-token',
        zoneId: 'cf-zone',
        dispatchNamespace: 'dispatch-ns',
      },
    }]);
    expect(platform.services.deploymentProviders?.defaultName).toBe('workers-dispatch');
    expect(platform.services.documents.renderPdf).toBeTypeOf('function');
  });

  it('attaches OCI deploy provider in the node adapter', async () => {
    const platform = await buildNodeWebPlatform({
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
