// deno-lint-ignore-file no-import-prefix no-unversioned-import
import {
  createEnvGuard,
  validateDispatchEnv,
  validateEgressEnv,
  validateExecutorHostEnv,
  validateIndexerEnv,
  validateRunnerEnv,
  validateRuntimeHostEnv,
  validateWebEnv,
  validateWorkflowRunnerEnv,
} from "../../../../../packages/control/src/shared/utils/validate-env.ts";

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";

const fullEnv: Record<string, unknown> = {
  DB: {},
  HOSTNAME_ROUTING: {},
  SESSION_DO: {},
  RUN_NOTIFIER: {},
  RUN_QUEUE: {},
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  ADMIN_DOMAIN: "admin.test",
  TENANT_BASE_DOMAIN: "test.com",
  PLATFORM_PRIVATE_KEY: "key",
  PLATFORM_PUBLIC_KEY: "key",
  EXECUTOR_PROXY_SECRET: "executor-proxy-secret",
  ENCRYPTION_KEY: "encryption-key",
};

function expectError(value: string | null): string {
  if (value === null) {
    throw new Error("Expected validation error");
  }
  return value;
}

Deno.test("validateWebEnv - returns null when all bindings are present", () => {
  assertEquals(validateWebEnv(fullEnv), null);
});

Deno.test("validateWebEnv - reports missing bindings", () => {
  const err = expectError(validateWebEnv({}));
  assertStringIncludes(err, "takos");
  assertStringIncludes(err, "DB");
});

Deno.test("validateWebEnv - reports specific missing binding", () => {
  const partial = { ...fullEnv };
  delete partial.DB;
  const err = expectError(validateWebEnv(partial));
  assertStringIncludes(err, "DB");
});

Deno.test("validateWebEnv - reports multiple missing bindings", () => {
  const partial = { ...fullEnv };
  delete partial.DB;
  delete partial.HOSTNAME_ROUTING;
  const err = expectError(validateWebEnv(partial));
  assertStringIncludes(err, "DB");
  assertStringIncludes(err, "HOSTNAME_ROUTING");
});

Deno.test("validateDispatchEnv - returns null when all bindings present", () => {
  assertEquals(
    validateDispatchEnv({
      DISPATCHER: {},
      ADMIN_DOMAIN: "test",
      HOSTNAME_ROUTING: {},
    }),
    null,
  );
});

Deno.test("validateDispatchEnv - accepts ROUTING_STORE as alternative to HOSTNAME_ROUTING", () => {
  assertEquals(
    validateDispatchEnv({
      DISPATCHER: {},
      ADMIN_DOMAIN: "test",
      ROUTING_STORE: {},
    }),
    null,
  );
});

Deno.test("validateDispatchEnv - reports missing when neither HOSTNAME_ROUTING nor ROUTING_STORE", () => {
  const err = expectError(
    validateDispatchEnv({ DISPATCHER: {}, ADMIN_DOMAIN: "test" }),
  );
  assertStringIncludes(err, "HOSTNAME_ROUTING|ROUTING_STORE");
});

Deno.test("validateDispatchEnv - reports missing DISPATCHER", () => {
  const err = expectError(validateDispatchEnv({
    ADMIN_DOMAIN: "test",
    HOSTNAME_ROUTING: {},
  }));
  assertStringIncludes(err, "DISPATCHER");
});

Deno.test("validateRunnerEnv - returns null when all bindings present", () => {
  const env = { DB: {}, RUN_QUEUE: {}, RUN_NOTIFIER: {}, EXECUTOR_HOST: {} };
  assertEquals(validateRunnerEnv(env), null);
});

Deno.test("validateRunnerEnv - reports missing bindings", () => {
  const err = expectError(validateRunnerEnv({}));
  assertStringIncludes(err, "DB");
  assertStringIncludes(err, "RUN_QUEUE");
});

Deno.test("validateWorkflowRunnerEnv - returns null when DB is present", () => {
  assertEquals(validateWorkflowRunnerEnv({ DB: {} }), null);
});

Deno.test("validateWorkflowRunnerEnv - reports missing DB", () => {
  const err = expectError(validateWorkflowRunnerEnv({}));
  assertStringIncludes(err, "DB");
});

Deno.test("validateIndexerEnv - returns null when DB is present", () => {
  assertEquals(validateIndexerEnv({ DB: {} }), null);
});

Deno.test("validateIndexerEnv - reports missing DB", () => {
  const err = expectError(validateIndexerEnv({}));
  assertStringIncludes(err, "DB");
});

Deno.test("validateEgressEnv - always returns null (no required bindings)", () => {
  assertEquals(validateEgressEnv({}), null);
});

Deno.test("validateRuntimeHostEnv - returns null when RUNTIME_CONTAINER and PLATFORM_PUBLIC_KEY are present", () => {
  assertEquals(
    validateRuntimeHostEnv({
      RUNTIME_CONTAINER: {},
      PLATFORM_PUBLIC_KEY: "public-key",
    }),
    null,
  );
});

Deno.test("validateRuntimeHostEnv - reports missing RUNTIME_CONTAINER and PLATFORM_PUBLIC_KEY", () => {
  const err = expectError(validateRuntimeHostEnv({}));
  assertStringIncludes(err, "RUNTIME_CONTAINER");
  assertStringIncludes(err, "PLATFORM_PUBLIC_KEY");
});

Deno.test("validateRuntimeHostEnv - rejects JWT_PUBLIC_KEY without PLATFORM_PUBLIC_KEY", () => {
  const err = expectError(validateRuntimeHostEnv({
    RUNTIME_CONTAINER: {},
    JWT_PUBLIC_KEY: "public-key",
  }));
  assertStringIncludes(err, "PLATFORM_PUBLIC_KEY");
});

Deno.test("validateRuntimeHostEnv - accepts matching JWT_PUBLIC_KEY compatibility override", () => {
  assertEquals(
    validateRuntimeHostEnv({
      RUNTIME_CONTAINER: {},
      PLATFORM_PUBLIC_KEY: "public-key",
      JWT_PUBLIC_KEY: "public-key",
    }),
    null,
  );
});

Deno.test("validateRuntimeHostEnv - rejects mismatched JWT_PUBLIC_KEY override", () => {
  const err = expectError(validateRuntimeHostEnv({
    RUNTIME_CONTAINER: {},
    PLATFORM_PUBLIC_KEY: "platform-public-key",
    JWT_PUBLIC_KEY: "other-public-key",
  }));
  assertStringIncludes(err, "JWT_PUBLIC_KEY must match PLATFORM_PUBLIC_KEY");
});

Deno.test("validateExecutorHostEnv - returns null when all bindings present", () => {
  const env = {
    EXECUTOR_CONTAINER: {},
    TAKOS_CONTROL: {},
    CONTROL_RPC_BASE_URL: "http://localhost",
    EXECUTOR_PROXY_SECRET: "executor-proxy-secret",
  };
  assertEquals(validateExecutorHostEnv(env), null);
});

Deno.test("validateExecutorHostEnv - reports all missing bindings", () => {
  const err = expectError(validateExecutorHostEnv({}));
  assertStringIncludes(err, "EXECUTOR_CONTAINER");
  assertStringIncludes(err, "TAKOS_CONTROL");
  assertStringIncludes(err, "CONTROL_RPC_BASE_URL");
  assertStringIncludes(err, "EXECUTOR_PROXY_SECRET");
});

Deno.test("createEnvGuard - runs validator on first call", () => {
  const target = { validate: () => null as string | null };
  const validator = stub(target, "validate", () => null);
  const guard = createEnvGuard(target.validate);

  try {
    guard({ DB: {} });
    assertSpyCalls(validator, 1);
  } finally {
    validator.restore();
  }
});

Deno.test("createEnvGuard - caches the result on subsequent calls", () => {
  const target = { validate: () => null as string | null };
  const validator = stub(target, "validate", () => null);
  const guard = createEnvGuard(target.validate);

  try {
    guard({ DB: {} });
    guard({ DB: {} });
    guard({ DB: {} });
    assertSpyCalls(validator, 1);
  } finally {
    validator.restore();
  }
});

Deno.test("createEnvGuard - returns null when validation passes", () => {
  const guard = createEnvGuard(() => null);
  assertEquals(guard({}), null);
});

Deno.test("createEnvGuard - returns cached error when validation fails", () => {
  const guard = createEnvGuard(() => "Missing DB");
  assertEquals(guard({}), "Missing DB");
  // Second call returns same cached error
  assertEquals(guard({ DB: {} }), "Missing DB");
});

Deno.test("createEnvGuard - logs error when validation fails", () => {
  const spy = stub(console, "error", () => {});
  try {
    const guard = createEnvGuard(() => "Missing bindings");
    guard({});
    assert(spy.calls.length > 0);
  } finally {
    spy.restore();
  }
});
