import { compileGroupDesiredState } from '@/services/deployment/group-state';

import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  replaceLocalEnvVars: ((..._args: any[]) => undefined) as any,
  replaceResourceBindings: ((..._args: any[]) => undefined) as any,
  saveRuntimeConfig: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/platform/worker-desired-state'
import { syncGroupManagedDesiredState } from '@/services/deployment/group-managed-desired-state';


  Deno.test('group managed desired state sync - syncs env, bindings, and MCP runtime config into the canonical desired-state tables', async () => {
  const desired = compileGroupDesiredState({
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'App',
      metadata: { name: 'demo-app' },
      spec: {
        version: '1.0.0',
        env: {
          inject: {
            API_URL: '{{routes.api.url}}',
          },
        },
        resources: {
          db: { type: 'sql', binding: 'DB' },
          auth: { type: 'secret', binding: 'AUTH_TOKEN', generate: true },
          jobs: { type: 'queue', binding: 'JOBS' },
          idx: { type: 'vector_index', binding: 'INDEX', vectorIndex: { dimensions: 1536, metric: 'cosine' } },
          events: { type: 'analytics_store', binding: 'EVENTS', analyticsStore: { dataset: 'tenant-events' } },
          flow: { type: 'workflow_runtime', binding: 'FLOW', workflowRuntime: { service: 'api', export: 'MainWorkflow' } },
          counter: { type: 'durable_namespace', binding: 'COUNTER', durableNamespace: { className: 'Counter', scriptName: 'edge-worker' } },
        },
        workers: {
          edge: {
            build: {
              fromWorkflow: {
                path: '.takos/workflows/deploy.yml',
                job: 'build',
                artifact: 'edge',
                artifactPath: 'dist/edge.js',
              },
            },
            env: {
              WORKER_MODE: 'edge',
            },
            bindings: {
              sql: ['db'],
              queues: ['jobs'],
              vectorIndexes: ['idx'],
              analyticsStores: ['events'],
              workflowRuntimes: ['flow'],
              durableNamespaces: ['counter'],
            },
          },
        },
        services: {
          api: {
            dockerfile: 'Dockerfile',
            port: 8080,
            env: {
              API_MODE: 'service',
            },
            bindings: {
              sql: ['db'],
            },
          },
        },
        routes: [
          { name: 'api', ingress: 'edge', target: 'api', path: '/api' },
          { name: 'mcp', ingress: 'edge', target: 'api', path: '/mcp' },
        ],
        mcpServers: [
          { name: 'tools', route: 'mcp', transport: 'streamable-http' },
        ],
      },
    } as const, {
      groupName: 'demo-app',
      provider: 'cloudflare',
      envName: 'production',
    });

    await syncGroupManagedDesiredState({} as never, {
      spaceId: 'ws-1',
      desiredState: desired,
      observedState: {
        groupId: 'group-1',
        groupName: 'demo-app',
        provider: 'cloudflare',
        env: 'production',
        version: '1.0.0',
        updatedAt: '2026-03-29T00:00:00.000Z',
        resources: {},
        workloads: {
          edge: {
            serviceId: 'svc-edge',
            name: 'edge',
            sourceKind: 'worker',
            executionProfile: 'workers',
            artifactKind: 'worker-bundle',
            status: 'deployed',
            hostname: 'edge.example.test',
            routeRef: 'worker-edge',
            updatedAt: '2026-03-29T00:00:00.000Z',
          },
          api: {
            serviceId: 'svc-api',
            name: 'api',
            sourceKind: 'service',
            executionProfile: 'oci-service',
            artifactKind: 'container-image',
            status: 'deployed',
            hostname: 'api.example.test',
            routeRef: 'svc-api',
            resolvedBaseUrl: 'http://10.0.0.2:8080',
            updatedAt: '2026-03-29T00:00:00.000Z',
          },
        },
        routes: {},
      },
      resourceRows: [
        {
          id: 'res-db',
          groupId: 'group-1',
          name: 'db',
          category: 'resource',
          providerResourceId: 'd1-id',
          providerResourceName: 'demo-db',
          config: {
            type: 'd1',
            manifestType: 'd1',
            resourceClass: 'sql',
            backing: 'd1',
            binding: 'DB',
            bindingName: 'DB',
            bindingType: 'sql',
            cfResourceId: 'd1-id',
            providerResourceName: 'demo-db',
          },
          createdAt: '2026-03-29T00:00:00.000Z',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
        {
          id: 'res-auth',
          groupId: 'group-1',
          name: 'auth',
          category: 'resource',
          providerResourceId: 'secret-value',
          providerResourceName: 'demo-auth',
          config: {
            type: 'secretRef',
            manifestType: 'secretRef',
            resourceClass: 'secret',
            backing: 'secret_ref',
            binding: 'AUTH_TOKEN',
            bindingName: 'AUTH_TOKEN',
            bindingType: 'secret_text',
            cfResourceId: 'secret-value',
            providerResourceName: 'demo-auth',
          },
          createdAt: '2026-03-29T00:00:00.000Z',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
        {
          id: 'res-jobs',
          groupId: 'group-1',
          name: 'jobs',
          category: 'resource',
          providerResourceId: 'queue-id',
          providerResourceName: 'tenant-jobs',
          config: {
            type: 'queue',
            manifestType: 'queue',
            resourceClass: 'queue',
            backing: 'queue',
            binding: 'JOBS',
            bindingName: 'JOBS',
            bindingType: 'queue',
            cfResourceId: 'queue-id',
            providerResourceName: 'tenant-jobs',
          },
          createdAt: '2026-03-29T00:00:00.000Z',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
        {
          id: 'res-idx',
          groupId: 'group-1',
          name: 'idx',
          category: 'resource',
          providerResourceId: 'idx-id',
          providerResourceName: 'tenant-idx',
          config: {
            type: 'vectorize',
            manifestType: 'vectorize',
            resourceClass: 'vector_index',
            backing: 'vectorize',
            binding: 'INDEX',
            bindingName: 'INDEX',
            bindingType: 'vector_index',
            cfResourceId: 'idx-id',
            providerResourceName: 'tenant-idx',
          },
          createdAt: '2026-03-29T00:00:00.000Z',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
        {
          id: 'res-events',
          groupId: 'group-1',
          name: 'events',
          category: 'resource',
          providerResourceId: 'events-id',
          providerResourceName: 'tenant-events',
          config: {
            type: 'analyticsEngine',
            manifestType: 'analyticsEngine',
            resourceClass: 'analytics_store',
            backing: 'analytics_engine',
            binding: 'EVENTS',
            bindingName: 'EVENTS',
            bindingType: 'analytics_store',
            cfResourceId: 'events-id',
            providerResourceName: 'tenant-events',
          },
          createdAt: '2026-03-29T00:00:00.000Z',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
        {
          id: 'res-flow',
          groupId: 'group-1',
          name: 'flow',
          category: 'resource',
          providerResourceId: 'flow-id',
          providerResourceName: 'flow',
          config: {
            type: 'workflow',
            manifestType: 'workflow',
            resourceClass: 'workflow_runtime',
            backing: 'workflow_binding',
            binding: 'FLOW',
            bindingName: 'FLOW',
            bindingType: 'workflow_runtime',
            cfResourceId: 'flow-id',
            providerResourceName: 'flow',
          },
          createdAt: '2026-03-29T00:00:00.000Z',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
        {
          id: 'res-counter',
          groupId: 'group-1',
          name: 'counter',
          category: 'resource',
          providerResourceId: 'counter-id',
          providerResourceName: 'counter',
          config: {
            type: 'durableObject',
            manifestType: 'durableObject',
            resourceClass: 'durable_namespace',
            backing: 'durable_object_namespace',
            binding: 'COUNTER',
            bindingName: 'COUNTER',
            bindingType: 'durable_namespace',
            cfResourceId: 'counter-id',
            providerResourceName: 'counter',
          },
          createdAt: '2026-03-29T00:00:00.000Z',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
      ],
    });

    assertSpyCallArgs(mocks.replaceLocalEnvVars, 0, [({
      serviceId: 'svc-edge',
      variables: ([
        ({ name: 'API_URL', value: 'http://10.0.0.2:8080/api', secret: false }),
        ({ name: 'AUTH_TOKEN', value: 'secret-value', secret: true }),
        ({ name: 'WORKER_MODE', value: 'edge', secret: false }),
      ]),
    })]);
    assertSpyCallArgs(mocks.replaceLocalEnvVars, 1, [({
      serviceId: 'svc-api',
      variables: ([
        ({ name: 'API_URL', value: 'http://10.0.0.2:8080/api', secret: false }),
        ({ name: 'AUTH_TOKEN', value: 'secret-value', secret: true }),
        ({ name: 'API_MODE', value: 'service', secret: false }),
      ]),
    })]);

    assertSpyCallArgs(mocks.replaceResourceBindings, 0, [({
      serviceId: 'svc-edge',
      bindings: ([
        ({ name: 'DB', type: 'sql', resourceId: 'res-db' }),
        ({ name: 'JOBS', type: 'queue', resourceId: 'res-jobs' }),
        ({ name: 'INDEX', type: 'vector_index', resourceId: 'res-idx' }),
        ({ name: 'EVENTS', type: 'analytics_store', resourceId: 'res-events' }),
        ({ name: 'FLOW', type: 'workflow_runtime', resourceId: 'res-flow', config: { workflow_name: 'flow', class_name: 'MainWorkflow', script_name: 'api' } }),
        ({ name: 'COUNTER', type: 'durable_namespace', resourceId: 'res-counter', config: { class_name: 'Counter', script_name: 'edge-worker' } }),
      ]),
    })]);
    assertSpyCallArgs(mocks.replaceResourceBindings, 1, [({
      serviceId: 'svc-api',
      bindings: [
        ({ name: 'DB', type: 'sql', resourceId: 'res-db' }),
      ],
    })]);

    assertSpyCallArgs(mocks.saveRuntimeConfig, 0, [({
      serviceId: 'svc-edge',
      mcpServer: { enabled: true, name: 'tools', path: '/mcp' },
    })]);
    assertSpyCallArgs(mocks.saveRuntimeConfig, 1, [({
      serviceId: 'svc-api',
      mcpServer: undefined,
    })]);
})