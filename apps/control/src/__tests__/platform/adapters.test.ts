import { describe, expect, it, vi } from 'vitest';
import { buildPlatform, createPlatformConfig, createPlatformServices } from '@/platform/adapters/shared';
import { buildCloudflareWebPlatform } from '@/platform/adapters/cloudflare';
import { buildLocalWebPlatform } from '@/platform/adapters/local';

function createBaseBindings(overrides: Record<string, unknown> = {}) {
  return {
    ADMIN_DOMAIN: 'admin.example.test',
    TENANT_BASE_DOMAIN: 'app.example.test',
    DISPATCHER: {
      get: vi.fn(() => ({
        fetch: vi.fn(async () => new Response('ok')),
      })),
    },
    ...overrides,
  };
}

describe('platform adapters', () => {
  it('keeps deploy provider config out of the shared platform builder', () => {
    const bindings = createBaseBindings();
    const platform = buildPlatform(
      'local',
      bindings,
      createPlatformConfig({
        adminDomain: String(bindings.ADMIN_DOMAIN),
        tenantBaseDomain: String(bindings.TENANT_BASE_DOMAIN),
      }),
      createPlatformServices({
        routingBindings: {},
      }),
    );

    expect(platform.services.deploymentProviders).toBeUndefined();
    expect(platform.config).toEqual(expect.objectContaining({
      adminDomain: 'admin.example.test',
      tenantBaseDomain: 'app.example.test',
    }));
  });

  it('attaches a cloudflare deploy provider only in the cloudflare adapter', () => {
    const platform = buildCloudflareWebPlatform(createBaseBindings({
      CF_ACCOUNT_ID: 'cf-account',
      CF_API_TOKEN: 'cf-token',
      CF_ZONE_ID: 'zone-1',
      WFP_DISPATCH_NAMESPACE: 'dispatch-ns',
      BROWSER: { connect: vi.fn() },
    }) as never);

    expect(platform.services.deploymentProviders?.get('cloudflare')).toEqual({
      name: 'cloudflare',
      config: {
        accountId: 'cf-account',
        apiToken: 'cf-token',
        zoneId: 'zone-1',
        dispatchNamespace: 'dispatch-ns',
      },
    });
    expect(platform.services.deploymentProviders?.defaultName).toBe('cloudflare');
    expect(platform.services.documents.renderPdf).toBeTypeOf('function');
  });

  it('attaches an oci deploy provider only in the local adapter', () => {
    const platform = buildLocalWebPlatform(createBaseBindings({
      OCI_ORCHESTRATOR_URL: 'http://orchestrator.internal',
      OCI_ORCHESTRATOR_TOKEN: 'secret-token',
    }) as never);

    expect(platform.services.deploymentProviders?.get('oci')).toEqual({
      name: 'oci',
      config: {
        orchestratorUrl: 'http://orchestrator.internal',
        orchestratorToken: 'secret-token',
      },
    });
    expect(platform.services.deploymentProviders?.defaultName).toBe('oci');
    expect(platform.services.documents.renderPdf).toBeUndefined();
  });
});
