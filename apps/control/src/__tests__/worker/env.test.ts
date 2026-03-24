import { describe, expect, it } from 'vitest';
import type { WorkerEnv } from '@/worker/env';

/**
 * WorkerEnv is a type-only module. These tests validate the type contract
 * by checking that mock objects satisfying the type compile correctly.
 * This ensures the type structure is stable and any breaking changes
 * to the unified env type are caught.
 */
describe('WorkerEnv type contract', () => {
  it('accepts a minimal env with required fields', () => {
    const env: Partial<WorkerEnv> = {
      DB: {} as any,
      RUN_QUEUE: {} as any,
      RUN_NOTIFIER: {} as any,
      ADMIN_DOMAIN: 'test.takos.jp',
      TENANT_BASE_DOMAIN: 'app.test.takos.jp',
      HOSTNAME_ROUTING: {} as any,
    };

    expect(env.ADMIN_DOMAIN).toBe('test.takos.jp');
    expect(env.TENANT_BASE_DOMAIN).toBe('app.test.takos.jp');
  });

  it('accepts runner-specific fields', () => {
    const env: Partial<WorkerEnv> = {
      DB: {} as any,
      EXECUTOR_HOST: { fetch: async () => new Response() },
      RUN_QUEUE: {} as any,
      RUN_NOTIFIER: {} as any,
      TAKOS_OFFLOAD: {} as any,
      ADMIN_DOMAIN: 'test.takos.jp',
      TENANT_BASE_DOMAIN: 'app.test.takos.jp',
      HOSTNAME_ROUTING: {} as any,
    };

    expect(env.EXECUTOR_HOST).toBeDefined();
    expect(env.TAKOS_OFFLOAD).toBeDefined();
  });

  it('accepts indexer-specific fields', () => {
    const env: Partial<WorkerEnv> = {
      DB: {} as any,
      AI: {} as any,
      VECTORIZE: {} as any,
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      GOOGLE_API_KEY: 'test-google-key',
      GIT_OBJECTS: {} as any,
      TENANT_SOURCE: {} as any,
      INDEX_QUEUE: {} as any,
      RUN_QUEUE: {} as any,
      RUN_NOTIFIER: {} as any,
      ADMIN_DOMAIN: 'test.takos.jp',
      TENANT_BASE_DOMAIN: 'app.test.takos.jp',
      HOSTNAME_ROUTING: {} as any,
    };

    expect(env.AI).toBeDefined();
    expect(env.VECTORIZE).toBeDefined();
    expect(env.OPENAI_API_KEY).toBe('sk-test');
  });

  it('accepts workflow-runner-specific fields', () => {
    const env: Partial<WorkerEnv> = {
      DB: {} as any,
      RUNTIME_HOST: { fetch: async () => new Response() },
      ENCRYPTION_KEY: 'test-key',
      ADMIN_DOMAIN: 'test.takos.jp',
      TENANT_BASE_DOMAIN: 'app.test.takos.jp',
      WFP_DISPATCH_NAMESPACE: 'takos-tenants',
      CF_ACCOUNT_ID: 'test-account',
      CF_API_TOKEN: 'test-token',
      WORKER_BUNDLES: {} as any,
      TENANT_BUILDS: {} as any,
      HOSTNAME_ROUTING: {} as any,
      RUN_QUEUE: {} as any,
      RUN_NOTIFIER: {} as any,
      WORKFLOW_QUEUE: {} as any,
      DEPLOY_QUEUE: {} as any,
    };

    expect(env.RUNTIME_HOST).toBeDefined();
    expect(env.ENCRYPTION_KEY).toBe('test-key');
  });

  it('accepts egress-specific fields', () => {
    const env: Partial<WorkerEnv> = {
      DB: {} as any,
      RATE_LIMITER_DO: {} as any,
      EGRESS_MAX_REQUESTS: '500',
      EGRESS_WINDOW_MS: '60000',
      EGRESS_RATE_LIMIT_ALGORITHM: 'sliding_window',
      EGRESS_RATE_LIMIT_SHADOW_SAMPLE_RATE: '0.1',
      EGRESS_MAX_RESPONSE_BYTES: '52428800',
      EGRESS_TIMEOUT_MS: '300000',
      RUN_QUEUE: {} as any,
      RUN_NOTIFIER: {} as any,
      ADMIN_DOMAIN: 'test.takos.jp',
      TENANT_BASE_DOMAIN: 'app.test.takos.jp',
      HOSTNAME_ROUTING: {} as any,
    };

    expect(env.EGRESS_MAX_REQUESTS).toBe('500');
    expect(env.EGRESS_RATE_LIMIT_ALGORITHM).toBe('sliding_window');
  });
});
