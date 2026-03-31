import { describe, expect, it } from 'vitest';
import { parseResources } from '../app-manifest-validation';

describe('parseResources', () => {
  it('normalizes portable resource aliases to canonical types', () => {
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

    expect(resources.mainDb.type).toBe('d1');
    expect(resources.storage.type).toBe('r2');
    expect(resources.vectors.type).toBe('vectorize');
    expect(resources.secret.type).toBe('secretRef');
    expect(resources.analytics.type).toBe('analyticsEngine');
  });

  it('normalizes runtime resource aliases to canonical types', () => {
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

    expect(resources.workflows.type).toBe('workflow');
    expect(resources.namespaces.type).toBe('durableObject');
  });

  it('throws for unsupported aliases', () => {
    expect(() => parseResources({
      resources: {
        bad: {
          type: 'sql-engine',
        },
      },
    } as unknown as Record<string, unknown>, {})
    ).toThrow('spec.resources.bad.type');
  });
});
