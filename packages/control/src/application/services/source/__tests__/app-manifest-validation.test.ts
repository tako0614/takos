import { parseResources } from '../app-manifest-validation.ts';


import { assertEquals, assertThrows } from 'jsr:@std/assert';

  Deno.test('parseResources - normalizes portable resource aliases to canonical types', () => {
  const resources = parseResources({
      resources: {
        mainDb: {
          type: 'sql',
          binding: 'DB',
        },
        storage: {
          type: 'object_store',
          binding: 'STORAGE',
        },
        vectors: {
          type: 'vector_index',
          vectorize: {
            dimensions: 768,
            metric: 'euclidean',
          },
        },
        secret: {
          type: 'secret',
          binding: 'SECRET',
        },
        analytics: {
          type: 'analytics_store',
          binding: 'ANALYTICS',
        },
      },
    } as unknown as Record<string, unknown>, {
      worker: {
        type: 'worker',
        bindings: {},
      },
    });

    assertEquals(resources.mainDb.type, 'd1');
    assertEquals(resources.storage.type, 'r2');
    assertEquals(resources.vectors.type, 'vectorize');
    assertEquals(resources.secret.type, 'secretRef');
    assertEquals(resources.analytics.type, 'analyticsEngine');
})
  Deno.test('parseResources - normalizes runtime resource aliases to canonical types', () => {
  const resources = parseResources({
      resources: {
        workflows: {
          type: 'workflow_runtime',
          workflow: {
            service: 'api',
            export: 'handle',
          },
        },
        namespaces: {
          type: 'durable_namespace',
          durableNamespace: {
            className: 'Durable',
          },
        },
      },
    } as unknown as Record<string, unknown>, {
      api: {
        type: 'worker',
        bindings: {
          d1: ['mainDb'],
        },
      },
    });

    assertEquals(resources.workflows.type, 'workflow');
    assertEquals(resources.namespaces.type, 'durableObject');
})
  Deno.test('parseResources - throws for unsupported aliases', () => {
  assertThrows(() => { () => parseResources({
      resources: {
        bad: {
          type: 'sql-engine',
        },
      },
    } as unknown as Record<string, unknown>, {})
    ; }, 'spec.resources.bad.type');
})