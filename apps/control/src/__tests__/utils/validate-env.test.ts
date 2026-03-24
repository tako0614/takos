import { describe, expect, it, vi } from 'vitest';
import {
  validateWebEnv,
  validateDispatchEnv,
  validateRunnerEnv,
  validateWorkflowRunnerEnv,
  validateIndexerEnv,
  validateEgressEnv,
  validateRuntimeHostEnv,
  validateExecutorHostEnv,
  createEnvGuard,
} from '@/utils/validate-env';

describe('validateWebEnv', () => {
  const fullEnv: Record<string, unknown> = {
    DB: {},
    HOSTNAME_ROUTING: {},
    SESSION_DO: {},
    RUN_NOTIFIER: {},
    RUN_QUEUE: {},
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    ADMIN_DOMAIN: 'admin.test',
    TENANT_BASE_DOMAIN: 'test.com',
    PLATFORM_PRIVATE_KEY: 'key',
    PLATFORM_PUBLIC_KEY: 'key',
  };

  it('returns null when all bindings are present', () => {
    expect(validateWebEnv(fullEnv)).toBeNull();
  });

  it('reports missing bindings', () => {
    const err = validateWebEnv({});
    expect(err).toBeTruthy();
    expect(err).toContain('takos-web');
    expect(err).toContain('DB');
  });

  it('reports specific missing binding', () => {
    const { DB, ...partial } = fullEnv;
    const err = validateWebEnv(partial);
    expect(err).toContain('DB');
  });

  it('reports multiple missing bindings', () => {
    const { DB, HOSTNAME_ROUTING, ...partial } = fullEnv;
    const err = validateWebEnv(partial);
    expect(err).toContain('DB');
    expect(err).toContain('HOSTNAME_ROUTING');
  });
});

describe('validateDispatchEnv', () => {
  it('returns null when all bindings present', () => {
    expect(validateDispatchEnv({ DISPATCHER: {}, ADMIN_DOMAIN: 'test', HOSTNAME_ROUTING: {} })).toBeNull();
  });

  it('accepts ROUTING_STORE as alternative to HOSTNAME_ROUTING', () => {
    expect(validateDispatchEnv({ DISPATCHER: {}, ADMIN_DOMAIN: 'test', ROUTING_STORE: {} })).toBeNull();
  });

  it('reports missing when neither HOSTNAME_ROUTING nor ROUTING_STORE', () => {
    const err = validateDispatchEnv({ DISPATCHER: {}, ADMIN_DOMAIN: 'test' });
    expect(err).toContain('HOSTNAME_ROUTING|ROUTING_STORE');
  });

  it('reports missing DISPATCHER', () => {
    const err = validateDispatchEnv({ ADMIN_DOMAIN: 'test', HOSTNAME_ROUTING: {} });
    expect(err).toContain('DISPATCHER');
  });
});

describe('validateRunnerEnv', () => {
  it('returns null when all bindings present', () => {
    const env = { DB: {}, RUN_QUEUE: {}, RUN_NOTIFIER: {}, EXECUTOR_HOST: {} };
    expect(validateRunnerEnv(env)).toBeNull();
  });

  it('reports missing bindings', () => {
    const err = validateRunnerEnv({});
    expect(err).toContain('DB');
    expect(err).toContain('RUN_QUEUE');
    expect(err).toContain('EXECUTOR_HOST');
  });
});

describe('validateWorkflowRunnerEnv', () => {
  it('returns null when DB is present', () => {
    expect(validateWorkflowRunnerEnv({ DB: {} })).toBeNull();
  });

  it('reports missing DB', () => {
    const err = validateWorkflowRunnerEnv({});
    expect(err).toContain('DB');
  });
});

describe('validateIndexerEnv', () => {
  it('returns null when DB is present', () => {
    expect(validateIndexerEnv({ DB: {} })).toBeNull();
  });

  it('reports missing DB', () => {
    const err = validateIndexerEnv({});
    expect(err).toContain('DB');
  });
});

describe('validateEgressEnv', () => {
  it('always returns null (no required bindings)', () => {
    expect(validateEgressEnv({})).toBeNull();
  });
});

describe('validateRuntimeHostEnv', () => {
  it('returns null when RUNTIME_CONTAINER is present', () => {
    expect(validateRuntimeHostEnv({ RUNTIME_CONTAINER: {} })).toBeNull();
  });

  it('reports missing RUNTIME_CONTAINER', () => {
    const err = validateRuntimeHostEnv({});
    expect(err).toContain('RUNTIME_CONTAINER');
  });
});

describe('validateExecutorHostEnv', () => {
  it('returns null when all bindings present', () => {
    const env = {
      EXECUTOR_CONTAINER: {},
      DB: {},
      RUN_NOTIFIER: {},
      TAKOS_OFFLOAD: {},
      TAKOS_EGRESS: {},
      CONTROL_RPC_BASE_URL: 'http://localhost',
    };
    expect(validateExecutorHostEnv(env)).toBeNull();
  });

  it('reports all missing bindings', () => {
    const err = validateExecutorHostEnv({});
    expect(err).toContain('EXECUTOR_CONTAINER');
    expect(err).toContain('DB');
    expect(err).toContain('CONTROL_RPC_BASE_URL');
  });
});

describe('createEnvGuard', () => {
  it('runs validator on first call', () => {
    const validator = vi.fn().mockReturnValue(null);
    const guard = createEnvGuard(validator);

    guard({ DB: {} });
    expect(validator).toHaveBeenCalledOnce();
  });

  it('caches the result on subsequent calls', () => {
    const validator = vi.fn().mockReturnValue(null);
    const guard = createEnvGuard(validator);

    guard({ DB: {} });
    guard({ DB: {} });
    guard({ DB: {} });
    expect(validator).toHaveBeenCalledOnce();
  });

  it('returns null when validation passes', () => {
    const guard = createEnvGuard(() => null);
    expect(guard({})).toBeNull();
  });

  it('returns cached error when validation fails', () => {
    const guard = createEnvGuard(() => 'Missing DB');
    expect(guard({})).toBe('Missing DB');
    // Second call returns same cached error
    expect(guard({ DB: {} })).toBe('Missing DB');
  });

  it('logs error when validation fails', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const guard = createEnvGuard(() => 'Missing bindings');
    guard({});
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
