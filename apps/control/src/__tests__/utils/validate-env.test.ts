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


import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { stub, assertSpyCalls } from 'jsr:@std/testing/mock';

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

  Deno.test('validateWebEnv - returns null when all bindings are present', () => {
  assertEquals(validateWebEnv(fullEnv), null);
})
  Deno.test('validateWebEnv - reports missing bindings', () => {
  const err = validateWebEnv({});
    assert(err);
    assertStringIncludes(err, 'takos-web');
    assertStringIncludes(err, 'DB');
})
  Deno.test('validateWebEnv - reports specific missing binding', () => {
  const { DB, ...partial } = fullEnv;
    const err = validateWebEnv(partial);
    assertStringIncludes(err, 'DB');
})
  Deno.test('validateWebEnv - reports multiple missing bindings', () => {
  const { DB, HOSTNAME_ROUTING, ...partial } = fullEnv;
    const err = validateWebEnv(partial);
    assertStringIncludes(err, 'DB');
    assertStringIncludes(err, 'HOSTNAME_ROUTING');
})

  Deno.test('validateDispatchEnv - returns null when all bindings present', () => {
  assertEquals(validateDispatchEnv({ DISPATCHER: {}, ADMIN_DOMAIN: 'test', HOSTNAME_ROUTING: {} }), null);
})
  Deno.test('validateDispatchEnv - accepts ROUTING_STORE as alternative to HOSTNAME_ROUTING', () => {
  assertEquals(validateDispatchEnv({ DISPATCHER: {}, ADMIN_DOMAIN: 'test', ROUTING_STORE: {} }), null);
})
  Deno.test('validateDispatchEnv - reports missing when neither HOSTNAME_ROUTING nor ROUTING_STORE', () => {
  const err = validateDispatchEnv({ DISPATCHER: {}, ADMIN_DOMAIN: 'test' });
    assertStringIncludes(err, 'HOSTNAME_ROUTING|ROUTING_STORE');
})
  Deno.test('validateDispatchEnv - reports missing DISPATCHER', () => {
  const err = validateDispatchEnv({ ADMIN_DOMAIN: 'test', HOSTNAME_ROUTING: {} });
    assertStringIncludes(err, 'DISPATCHER');
})

  Deno.test('validateRunnerEnv - returns null when all bindings present', () => {
  const env = { DB: {}, RUN_QUEUE: {}, RUN_NOTIFIER: {}, EXECUTOR_HOST: {} };
    assertEquals(validateRunnerEnv(env), null);
})
  Deno.test('validateRunnerEnv - reports missing bindings', () => {
  const err = validateRunnerEnv({});
    assertStringIncludes(err, 'DB');
    assertStringIncludes(err, 'RUN_QUEUE');
    assertStringIncludes(err, 'EXECUTOR_HOST');
})

  Deno.test('validateWorkflowRunnerEnv - returns null when DB is present', () => {
  assertEquals(validateWorkflowRunnerEnv({ DB: {} }), null);
})
  Deno.test('validateWorkflowRunnerEnv - reports missing DB', () => {
  const err = validateWorkflowRunnerEnv({});
    assertStringIncludes(err, 'DB');
})

  Deno.test('validateIndexerEnv - returns null when DB is present', () => {
  assertEquals(validateIndexerEnv({ DB: {} }), null);
})
  Deno.test('validateIndexerEnv - reports missing DB', () => {
  const err = validateIndexerEnv({});
    assertStringIncludes(err, 'DB');
})

  Deno.test('validateEgressEnv - always returns null (no required bindings)', () => {
  assertEquals(validateEgressEnv({}), null);
})

  Deno.test('validateRuntimeHostEnv - returns null when RUNTIME_CONTAINER is present', () => {
  assertEquals(validateRuntimeHostEnv({ RUNTIME_CONTAINER: {} }), null);
})
  Deno.test('validateRuntimeHostEnv - reports missing RUNTIME_CONTAINER', () => {
  const err = validateRuntimeHostEnv({});
    assertStringIncludes(err, 'RUNTIME_CONTAINER');
})

  Deno.test('validateExecutorHostEnv - returns null when all bindings present', () => {
  const env = {
      EXECUTOR_CONTAINER: {},
      DB: {},
      RUN_NOTIFIER: {},
      TAKOS_OFFLOAD: {},
      TAKOS_EGRESS: {},
      CONTROL_RPC_BASE_URL: 'http://localhost',
    };
    assertEquals(validateExecutorHostEnv(env), null);
})
  Deno.test('validateExecutorHostEnv - reports all missing bindings', () => {
  const err = validateExecutorHostEnv({});
    assertStringIncludes(err, 'EXECUTOR_CONTAINER');
    assertStringIncludes(err, 'DB');
    assertStringIncludes(err, 'CONTROL_RPC_BASE_URL');
})

  Deno.test('createEnvGuard - runs validator on first call', () => {
  const validator = (() => null);
    const guard = createEnvGuard(validator);

    guard({ DB: {} });
    assertSpyCalls(validator, 1);
})
  Deno.test('createEnvGuard - caches the result on subsequent calls', () => {
  const validator = (() => null);
    const guard = createEnvGuard(validator);

    guard({ DB: {} });
    guard({ DB: {} });
    guard({ DB: {} });
    assertSpyCalls(validator, 1);
})
  Deno.test('createEnvGuard - returns null when validation passes', () => {
  const guard = createEnvGuard(() => null);
    assertEquals(guard({}), null);
})
  Deno.test('createEnvGuard - returns cached error when validation fails', () => {
  const guard = createEnvGuard(() => 'Missing DB');
    assertEquals(guard({}), 'Missing DB');
    // Second call returns same cached error
    assertEquals(guard({ DB: {} }), 'Missing DB');
})
  Deno.test('createEnvGuard - logs error when validation fails', () => {
  const spy = stub(console, 'error') = () => {} as any;
    const guard = createEnvGuard(() => 'Missing bindings');
    guard({});
    assert(spy.calls.length > 0);
    spy.restore();
})