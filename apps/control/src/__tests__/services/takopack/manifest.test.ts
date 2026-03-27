import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { parsePackage } from '@/services/takopack/manifest';

interface ManifestDoc {
  apiVersion: 'takos.dev/v1alpha1';
  kind: string;
  metadata: { name: string };
  spec: Record<string, unknown>;
}

async function createTakopack(docs: ManifestDoc[], files: Record<string, string>): Promise<ArrayBuffer> {
  const manifestYaml = `${docs.map((doc) => YAML.stringify(doc).trimEnd()).join('\n---\n')}\n`;

  const entries: Record<string, Uint8Array> = {
    'manifest.yaml': new TextEncoder().encode(manifestYaml),
  };

  for (const [filePath, content] of Object.entries(files)) {
    entries[filePath] = new TextEncoder().encode(content);
  }

  const checksums: string[] = [];
  for (const [filePath, content] of Object.entries(entries)) {
    const digestInput = new Uint8Array(content.byteLength);
    digestInput.set(content);
    const digest = await crypto.subtle.digest(
      'SHA-256',
      digestInput.buffer,
    );
    const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    checksums.push(`${hex} ${filePath}`);
  }

  entries['checksums.txt'] = new TextEncoder().encode(`${checksums.sort().join('\n')}\n`);

  const jszip = await import('jszip');
  const JSZip = 'default' in jszip ? jszip.default : jszip;
  const zip = new JSZip();
  for (const [filePath, content] of Object.entries(entries)) {
    zip.file(filePath, content);
  }

  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('takopack manifest parser (endpoint model)', () => {
  it('rejects non-cloudflare workload plugins', async () => {
    const data = await createTakopack(
      [
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Package',
          metadata: { name: 'hybrid-pack' },
          spec: { appId: 'dev.takos.hybrid-pack', version: '1.0.0' },
        },
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Workload',
          metadata: { name: 'payments-ec2' },
          spec: {
            type: 'aws.ec2',
            pluginConfig: {
              baseUrl: 'https://payments.internal.example',
            }
          }
        }
      ],
      {}
    );

    await expect(parsePackage(data)).rejects.toThrow(
      /Unsupported workload plugin type: aws\.ec2/
    );
  });

  it('resolves endpoint tools to cloudflare worker routing and normalizes routes', async () => {
    const data = await createTakopack(
      [
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Package',
          metadata: { name: 'worker-pack' },
          spec: { appId: 'dev.takos.worker-pack', version: '1.0.0' },
        },
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Workload',
          metadata: { name: 'edge-gateway' },
          spec: {
            type: 'cloudflare.worker',
            artifactRef: 'artifacts/gateway.mjs',
            pluginConfig: {
              workerName: 'edge-gateway',
              bindings: {},
              env: {},
            },
          },
        },
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Endpoint',
          metadata: { name: 'gateway-http' },
          spec: {
            protocol: 'http',
            targetRef: 'edge-gateway',
            path: '/payments',
            timeoutMs: 7000,
          },
        },
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'McpServer',
          metadata: { name: 'fetch_gateway' },
          spec: {
            endpointRef: 'gateway-http',
            name: 'fetch_gateway',
          },
        },
      ],
      {
        'artifacts/gateway.mjs': 'export default { fetch: () => new Response("ok") };',
      }
    );

    const parsed = await parsePackage(data);

    expect(parsed.manifest.meta.appId).toBe('dev.takos.worker-pack');
    expect(parsed.manifest.endpoints).toHaveLength(1);
    expect(parsed.manifest.endpoints?.[0]).toMatchObject({
      name: 'gateway-http',
      targetRef: 'edge-gateway',
      targetRuntime: 'cloudflare.worker',
      ingressRef: 'edge-gateway',
      ingressWorker: 'edge-gateway',
      routes: [{ pathPrefix: '/payments' }],
    });

    expect(parsed.manifest.mcpServers?.[0]).toMatchObject({
      name: 'fetch_gateway',
      transport: 'streamable-http',
      worker: 'edge-gateway',
      endpoint: 'gateway-http',
      path: '/payments',
    });

    // TAKOPACK_HTTP_ENDPOINTS is no longer injected into worker env — InfraService handles routing
    expect(parsed.manifest.workers?.[0]?.env?.TAKOPACK_HTTP_ENDPOINTS).toBeUndefined();
  });

  it('parses pure cloudflare.worker endpoint without ingressRef and normalizes routes', async () => {
    const data = await createTakopack(
      [
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Package',
          metadata: { name: 'cf-pack' },
          spec: { appId: 'dev.takos.cf-pack', version: '1.0.0' },
        },
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Workload',
          metadata: { name: 'api-worker' },
          spec: {
            type: 'cloudflare.worker',
            artifactRef: 'artifacts/api.mjs',
            pluginConfig: { workerName: 'api-worker', bindings: {}, env: {} },
          },
        },
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Endpoint',
          metadata: { name: 'api-http' },
          spec: {
            protocol: 'http',
            targetRef: 'api-worker',
            path: '/api',
          },
        },
      ],
      {
        'artifacts/api.mjs': 'export default { fetch: () => new Response("ok") };',
      }
    );

    const parsed = await parsePackage(data);

    expect(parsed.manifest.endpoints?.[0]).toMatchObject({
      name: 'api-http',
      targetRef: 'api-worker',
      targetRuntime: 'cloudflare.worker',
      ingressRef: 'api-worker',
      ingressWorker: 'api-worker',
      routes: [{ pathPrefix: '/api' }],
    });
    expect(parsed.manifest.workers?.[0]?.env?.TAKOPACK_HTTP_ENDPOINTS).toBeUndefined();
  });

  it('falls back to metadata.name when Package.spec.appId is omitted', async () => {
    const data = await createTakopack(
      [
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Package',
          metadata: { name: 'fallback-pack' },
          spec: { version: '1.0.0' },
        },
      ],
      {},
    );

    const parsed = await parsePackage(data);

    expect(parsed.manifest.meta.appId).toBe('fallback-pack');
    expect(parsed.applyReport).toContainEqual(expect.objectContaining({
      kind: 'Package',
      phase: 'validated',
      message: 'Package.spec.appId is missing; falling back to metadata.name.',
    }));
  });

  it('parses Package.spec.takos independently from oauth', async () => {
    const data = await createTakopack(
      [
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Package',
          metadata: { name: 'takos-builtins-pack' },
          spec: {
            appId: 'dev.takos.builtins-pack',
            version: '1.0.0',
            takos: {
              scopes: ['repos:read', 'spaces:write'],
            },
            env: {
              required: ['TAKOS_API_URL', 'TAKOS_ACCESS_TOKEN'],
            },
          },
        },
      ],
      {},
    );

    const parsed = await parsePackage(data);

    expect(parsed.manifest.takos).toEqual({
      scopes: ['repos:read', 'spaces:write'],
    });
    expect(parsed.manifest.oauth).toBeUndefined();
    expect(parsed.manifest.env).toEqual({
      required: ['TAKOS_API_URL', 'TAKOS_ACCESS_TOKEN'],
    });
  });

  it('normalizes queue, analyticsEngine, workflow resources and worker triggers', async () => {
    const data = await createTakopack(
      [
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Package',
          metadata: { name: 'runtime-pack' },
          spec: { appId: 'dev.takos.runtime-pack', version: '1.0.0' },
        },
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Resource',
          metadata: { name: 'jobs' },
          spec: {
            type: 'queue',
            binding: 'JOBS',
            queue: {
              maxRetries: 5,
              deliveryDelaySeconds: 10,
              deadLetterQueue: 'jobs-dlq',
            },
          },
        },
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Resource',
          metadata: { name: 'events' },
          spec: {
            type: 'analyticsEngine',
            binding: 'ANALYTICS',
            analyticsEngine: {
              dataset: 'tenant-events',
            },
          },
        },
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Resource',
          metadata: { name: 'onboarding' },
          spec: {
            type: 'workflow',
            binding: 'ONBOARDING_FLOW',
            workflow: {
              service: 'api',
              export: 'runOnboarding',
              timeoutMs: 60000,
              maxRetries: 3,
            },
          },
        },
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Workload',
          metadata: { name: 'api' },
          spec: {
            type: 'cloudflare.worker',
            artifactRef: 'artifacts/api.mjs',
            pluginConfig: {
              workerName: 'api-worker',
              bindings: {
                services: ['core-service'],
              },
              triggers: {
                schedules: [
                  { cron: '*/5 * * * *', export: 'handleCron' },
                ],
                queues: [
                  { queue: 'jobs', export: 'handleJob' },
                ],
              },
              env: {
                FEATURE_FLAG: 'enabled',
              },
            },
          },
        },
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Binding',
          metadata: { name: 'bind-jobs' },
          spec: {
            from: 'jobs',
            to: 'api',
            mount: { as: 'JOBS' },
          },
        },
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Binding',
          metadata: { name: 'bind-events' },
          spec: {
            from: 'events',
            to: 'api',
            mount: { as: 'ANALYTICS' },
          },
        },
        {
          apiVersion: 'takos.dev/v1alpha1',
          kind: 'Binding',
          metadata: { name: 'bind-onboarding' },
          spec: {
            from: 'onboarding',
            to: 'api',
            mount: { as: 'ONBOARDING_FLOW' },
          },
        },
      ],
      {
        'artifacts/api.mjs': 'export default { fetch: () => new Response("ok") };',
      },
    );

    const parsed = await parsePackage(data);

    expect(parsed.manifest.resources).toMatchObject({
      queue: [
        {
          binding: 'JOBS',
          maxRetries: 5,
          deliveryDelaySeconds: 10,
          deadLetterQueue: 'jobs-dlq',
        },
      ],
      analyticsEngine: [
        {
          binding: 'ANALYTICS',
          dataset: 'tenant-events',
        },
      ],
      workflow: [
        {
          binding: 'ONBOARDING_FLOW',
          service: 'api',
          export: 'runOnboarding',
          timeoutMs: 60000,
          maxRetries: 3,
        },
      ],
    });
    expect(parsed.manifest.workers).toHaveLength(1);
    expect(parsed.manifest.workers?.[0]).toMatchObject({
      name: 'api-worker',
      bindings: {
        queue: ['JOBS'],
        analytics: ['ANALYTICS'],
        workflows: ['ONBOARDING_FLOW'],
        services: ['core-service'],
      },
      triggers: {
        schedules: [{ cron: '*/5 * * * *', export: 'handleCron' }],
        queues: [{ queue: 'jobs', export: 'handleJob' }],
      },
      env: {
        FEATURE_FLAG: 'enabled',
      },
    });
  });
});
