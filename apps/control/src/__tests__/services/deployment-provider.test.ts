import { describe, expect, it, vi } from 'vitest';
import {
  createWorkersDispatchDeploymentProvider,
  createDeploymentProvider,
  createOciDeploymentProvider,
  parseDeploymentTargetConfig,
  serializeDeploymentTarget,
} from '@/services/deployment/provider';

describe('deployment provider helpers', () => {
  it('serializes and parses an OCI deployment target', () => {
    const serialized = serializeDeploymentTarget({
      provider: { name: 'oci' },
      target: {
        route_ref: 'takos-worker',
        endpoint: {
          kind: 'http-url',
          base_url: 'https://worker.example.test',
        },
        artifact: {
          image_ref: 'ghcr.io/takos/worker:latest',
          exposed_port: 8080,
        },
      },
    });

    expect(serialized.providerName).toBe('oci');
    expect(parseDeploymentTargetConfig({
      provider_name: 'oci',
      target_json: serialized.targetJson,
    })).toEqual({
      route_ref: 'takos-worker',
      endpoint: {
        kind: 'http-url',
        base_url: 'https://worker.example.test',
      },
      artifact: {
        image_ref: 'ghcr.io/takos/worker:latest',
        exposed_port: 8080,
      },
    });
  });

  it('returns a cloudflare default provider when config is absent', () => {
    expect(serializeDeploymentTarget(undefined)).toEqual({
      providerName: 'workers-dispatch',
      targetJson: '{}',
      providerStateJson: '{}',
    });
    expect(parseDeploymentTargetConfig({
      provider_name: 'workers-dispatch',
      target_json: '{}',
    })).toEqual({});
  });

  it('delegates cloudflare deploys to WFP', async () => {
    const wfp = {
      createWorker: vi.fn().mockResolvedValue(undefined),
      createWorkerWithWasm: vi.fn().mockResolvedValue(undefined),
      workerExists: vi.fn().mockResolvedValue(true),
    };
    const provider = createWorkersDispatchDeploymentProvider(wfp as never);

    await provider.deploy({
      deployment: {} as never,
      artifactRef: 'artifact-ref',
      bundleContent: 'export default {}',
      wasmContent: null,
      bindings: [],
      compatibilityDate: '2026-03-22',
      compatibilityFlags: [],
    });

    expect(wfp.createWorker).toHaveBeenCalledWith(expect.objectContaining({
      workerName: 'artifact-ref',
      workerScript: 'export default {}',
    }));
    await expect(provider.assertRollbackTarget('artifact-ref')).resolves.toBeUndefined();
  });

  it('resolves provider config from the attached registry before falling back to env config', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const provider = createDeploymentProvider({
      provider_name: 'oci',
      target_json: JSON.stringify({
        route_ref: 'takos-worker',
        artifact: {
          image_ref: 'ghcr.io/takos/worker:latest',
        },
      }),
    }, {
      providerRegistry: {
        get(name) {
          if (name !== 'oci') return undefined;
          return {
            name: 'oci',
            config: {
              orchestratorUrl: 'https://orchestrator.example.test',
              orchestratorToken: 'registry-token',
            },
          };
        },
      },
      orchestratorUrl: 'https://ignored.example.test/deploy',
      fetchImpl,
    });

    await expect(provider.deploy({
      deployment: { id: 'dep-1', space_id: 'space-1' } as never,
      artifactRef: 'artifact-ref',
      bundleContent: 'export default {}',
      wasmContent: null,
      bindings: [],
      compatibilityDate: '2026-03-22',
      compatibilityFlags: [],
    })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://orchestrator.example.test/deploy',
      expect.any(Object),
    );
  });

  it('validates OCI deployment target configuration', async () => {
    const provider = createOciDeploymentProvider({
      provider_name: 'oci',
      target_json: JSON.stringify({
        route_ref: 'takos-worker',
        artifact: {
          exposed_port: 0,
        },
      }),
    });

    await expect(provider.deploy({
      deployment: {} as never,
      artifactRef: 'artifact-ref',
      bundleContent: 'export default {}',
      wasmContent: null,
      bindings: [],
      compatibilityDate: '2026-03-22',
      compatibilityFlags: [],
    })).rejects.toThrow('OCI deployment target exposed_port must be a positive integer');
  });

  it('posts OCI image targets to the configured orchestrator endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const provider = createOciDeploymentProvider({
      provider_name: 'oci',
      target_json: JSON.stringify({
        route_ref: 'takos-worker',
        endpoint: {
          kind: 'http-url',
          base_url: 'https://worker.example.test',
        },
        artifact: {
          image_ref: 'ghcr.io/takos/worker:latest',
          exposed_port: 8080,
        },
      }),
    }, {
      orchestratorUrl: 'https://orchestrator.example.test',
      orchestratorToken: 'secret-token',
      fetchImpl,
    });

    await provider.deploy({
      deployment: { id: 'dep-1', space_id: 'space-1' } as never,
      artifactRef: 'artifact-ref',
      bundleContent: 'export default {}',
      wasmContent: null,
      bindings: [],
      compatibilityDate: '2026-03-22',
      compatibilityFlags: ['nodejs_compat'],
      limits: { cpu_ms: 50 },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://orchestrator.example.test/deploy',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-token',
        }),
      }),
    );
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual(expect.objectContaining({
      deployment_id: 'dep-1',
      space_id: 'space-1',
      artifact_ref: 'artifact-ref',
      target: {
        route_ref: 'takos-worker',
        endpoint: {
          kind: 'http-url',
          base_url: 'https://worker.example.test',
        },
        artifact: {
          image_ref: 'ghcr.io/takos/worker:latest',
          exposed_port: 8080,
          health_path: '/health',
        },
      },
      runtime: {
        compatibility_date: '2026-03-22',
        compatibility_flags: ['nodejs_compat'],
        limits: { cpu_ms: 50 },
      },
    }));
  });

  it('does not call the OCI orchestrator for routing-only public targets', async () => {
    const fetchImpl = vi.fn();
    const provider = createOciDeploymentProvider({
      provider_name: 'oci',
      target_json: JSON.stringify({
        endpoint: {
          kind: 'http-url',
          base_url: 'https://worker.example.test',
        },
      }),
    }, {
      orchestratorUrl: 'https://orchestrator.example.test',
      fetchImpl,
    });

    await provider.deploy({
      deployment: { id: 'dep-1' } as never,
      artifactRef: 'artifact-ref',
      bundleContent: 'export default {}',
      wasmContent: null,
      bindings: [],
      compatibilityDate: '2026-03-22',
      compatibilityFlags: [],
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires an orchestrator URL for OCI image deployments', async () => {
    const provider = createOciDeploymentProvider({
      provider_name: 'oci',
      target_json: JSON.stringify({
        route_ref: 'takos-worker',
        endpoint: {
          kind: 'service-ref',
          ref: 'takos-worker',
        },
        artifact: {
          image_ref: 'ghcr.io/takos/worker:latest',
        },
      }),
    });

    await expect(provider.deploy({
      deployment: { id: 'dep-1', space_id: 'space-1' } as never,
      artifactRef: 'artifact-ref',
      bundleContent: 'export default {}',
      wasmContent: null,
      bindings: [],
      compatibilityDate: '2026-03-22',
      compatibilityFlags: [],
    })).rejects.toThrow('OCI deployment target requires OCI_ORCHESTRATOR_URL');
  });
});
