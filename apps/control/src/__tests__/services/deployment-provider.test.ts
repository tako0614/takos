import { describe, expect, it, vi } from 'vitest';
import {
  createWorkersDispatchDeploymentProvider,
  createDeploymentProvider,
  createOciDeploymentProvider,
  createRuntimeHostDeploymentProvider,
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
      workers: {
        createWorker: vi.fn().mockResolvedValue(undefined),
        createWorkerWithWasm: vi.fn().mockResolvedValue(undefined),
        workerExists: vi.fn().mockResolvedValue(true),
      },
    };
    const provider = createWorkersDispatchDeploymentProvider(wfp as never);

    await provider.deploy({
      deployment: {} as never,
      artifactRef: 'artifact-ref',
      bundleContent: 'export default {}',
      wasmContent: null,
      runtime: {
        profile: 'workers',
        bindings: [],
        config: {
          compatibility_date: '2026-03-22',
          compatibility_flags: [],
        },
      },
    });

    expect(wfp.workers.createWorker).toHaveBeenCalledWith(expect.objectContaining({
      workerName: 'artifact-ref',
      workerScript: 'export default {}',
    }));
    await expect(provider.assertRollbackTarget('artifact-ref')).resolves.toBeUndefined();
  });

  it('accepts runtime-host worker deploys without a remote provider call', async () => {
    const provider = createRuntimeHostDeploymentProvider();

    await expect(provider.deploy({
      deployment: {} as never,
      artifactRef: 'artifact-ref',
      bundleContent: 'export default {}',
      wasmContent: null,
      runtime: {
        profile: 'workers',
        bindings: [],
        config: {
          compatibility_date: '2026-03-22',
          compatibility_flags: [],
        },
      },
    })).resolves.toBeUndefined();

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
      runtime: {
        profile: 'workers',
        bindings: [],
        config: {
          compatibility_date: '2026-03-22',
          compatibility_flags: [],
        },
      },
    })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://orchestrator.example.test/deploy',
      expect.any(Object),
    );
  });

  it.each([
    ['ecs', 'https://ecs-orchestrator.example.test', 'ecs-token', {
      region: 'us-east-1',
      clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/takos',
      taskDefinitionFamily: 'takos-worker',
    }],
    ['cloud-run', 'https://cloud-run-orchestrator.example.test', 'cloud-run-token', {
      projectId: 'takos-project',
      region: 'us-central1',
      serviceId: 'takos-worker',
    }],
    ['k8s', 'https://k8s-orchestrator.example.test', 'k8s-token', {
      namespace: 'takos',
      deploymentName: 'takos-worker',
    }],
  ] as const)('treats %s as an OCI-backed deployment provider and forwards provider config', async (providerName, orchestratorUrl, orchestratorToken, providerConfig) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const provider = createDeploymentProvider({
      provider_name: providerName,
      target_json: JSON.stringify({
        route_ref: 'takos-worker',
        endpoint: {
          kind: 'service-ref',
          ref: 'takos-worker',
        },
        artifact: {
          image_ref: 'ghcr.io/takos/worker:latest',
          exposed_port: 8080,
          health_path: '/ready',
        },
      }),
    }, {
      providerRegistry: {
        get(name) {
          if (name !== providerName) return undefined;
          return {
            name: providerName,
            config: {
              orchestratorUrl,
              orchestratorToken,
              ...providerConfig,
            },
          };
        },
      },
      orchestratorUrl: 'https://ignored.example.test',
      orchestratorToken: 'ignored-token',
      fetchImpl,
    });

    await provider.deploy({
      deployment: { id: 'dep-1', space_id: 'space-1' } as never,
      artifactRef: 'artifact-ref',
      bundleContent: 'export default {}',
      wasmContent: null,
      runtime: {
        profile: 'workers',
        bindings: [],
        config: {
          compatibility_date: '2026-03-22',
          compatibility_flags: ['nodejs_compat'],
        },
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      `${orchestratorUrl}/deploy`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${orchestratorToken}`,
        }),
      }),
    );
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual(expect.objectContaining({
      deployment_id: 'dep-1',
      space_id: 'space-1',
      artifact_ref: 'artifact-ref',
      provider: {
        name: providerName,
        config: providerConfig,
      },
      target: {
        route_ref: 'takos-worker',
        endpoint: {
          kind: 'service-ref',
          ref: 'takos-worker',
        },
        artifact: {
          image_ref: 'ghcr.io/takos/worker:latest',
          exposed_port: 8080,
          health_path: '/ready',
        },
      },
      runtime: {
        profile: 'workers',
        compatibility_date: '2026-03-22',
        compatibility_flags: ['nodejs_compat'],
        limits: null,
      },
    }));
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
      runtime: {
        profile: 'workers',
        bindings: [],
        config: {
          compatibility_date: '2026-03-22',
          compatibility_flags: [],
        },
      },
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
      runtime: {
        profile: 'workers',
        bindings: [],
        config: {
          compatibility_date: '2026-03-22',
          compatibility_flags: ['nodejs_compat'],
          limits: { cpu_ms: 50 },
        },
      },
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
        profile: 'workers',
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
      runtime: {
        profile: 'workers',
        bindings: [],
        config: {
          compatibility_date: '2026-03-22',
          compatibility_flags: [],
        },
      },
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
      runtime: {
        profile: 'workers',
        bindings: [],
        config: {
          compatibility_date: '2026-03-22',
          compatibility_flags: [],
        },
      },
    })).rejects.toThrow('OCI deployment target requires OCI_ORCHESTRATOR_URL');
  });
});
