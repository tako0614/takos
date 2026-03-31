import { createSandboxEnv, validateRuntimeExecEnv } from '../../utils/sandbox-env.ts';

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';

const originalAwsSecret = Deno.env.get('AWS_SECRET_ACCESS_KEY');

  Deno.test('validateRuntimeExecEnv - accepts undefined env as empty object', () => {
  try {
  assertEquals(validateRuntimeExecEnv(undefined), { ok: true, env: {} });
  } finally {
  if (originalAwsSecret === undefined) {
    Deno.env.delete('AWS_SECRET_ACCESS_KEY');
    return;
  }
  Deno.env.set('AWS_SECRET_ACCESS_KEY', originalAwsSecret);
  }
})
  Deno.test('validateRuntimeExecEnv - accepts valid env entries', () => {
  try {
  const result = validateRuntimeExecEnv({
      CI: 'true',
      MY_FEATURE_FLAG: '1',
    });
    assertEquals(result, {
      ok: true,
      env: { CI: 'true', MY_FEATURE_FLAG: '1' },
    });
  } finally {
  if (originalAwsSecret === undefined) {
    Deno.env.delete('AWS_SECRET_ACCESS_KEY');
    return;
  }
  Deno.env.set('AWS_SECRET_ACCESS_KEY', originalAwsSecret);
  }
})
  Deno.test('validateRuntimeExecEnv - rejects invalid variable names', () => {
  try {
  const result = validateRuntimeExecEnv({
      '1INVALID': 'value',
    });
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertStringIncludes(result.error, 'Invalid environment variable name');
    }
  } finally {
  if (originalAwsSecret === undefined) {
    Deno.env.delete('AWS_SECRET_ACCESS_KEY');
    return;
  }
  Deno.env.set('AWS_SECRET_ACCESS_KEY', originalAwsSecret);
  }
})
  Deno.test('validateRuntimeExecEnv - rejects sensitive variable names', () => {
  try {
  const result = validateRuntimeExecEnv({
      TAKOS_TOKEN: 'secret',
    });
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertStringIncludes(result.error, 'Sensitive environment variable is not allowed');
    }
  } finally {
  if (originalAwsSecret === undefined) {
    Deno.env.delete('AWS_SECRET_ACCESS_KEY');
    return;
  }
  Deno.env.set('AWS_SECRET_ACCESS_KEY', originalAwsSecret);
  }
})
  Deno.test('validateRuntimeExecEnv - rejects values with newlines', () => {
  try {
  const result = validateRuntimeExecEnv({
      SAFE_NAME: 'line1\nline2',
    });
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertStringIncludes(result.error, 'contains invalid characters');
    }
  } finally {
  if (originalAwsSecret === undefined) {
    Deno.env.delete('AWS_SECRET_ACCESS_KEY');
    return;
  }
  Deno.env.set('AWS_SECRET_ACCESS_KEY', originalAwsSecret);
  }
})
  Deno.test('validateRuntimeExecEnv - keeps explicit workflow env values for allowed prefixes and blocks host secrets', () => {
  try {
  Deno.env.set('AWS_SECRET_ACCESS_KEY', 'host-secret-value');

    const sandboxEnv = createSandboxEnv({
      GITHUB_TOKEN: 'token-from-workflow',
      INPUT_SECRET: 'secret-from-workflow',
      RUNNER_TEMP: '/tmp/runner',
    });

    assertEquals(sandboxEnv.GITHUB_TOKEN, 'token-from-workflow');
    assertEquals(sandboxEnv.INPUT_SECRET, 'secret-from-workflow');
    assertEquals(sandboxEnv.RUNNER_TEMP, '/tmp/runner');
    assertEquals(sandboxEnv.AWS_SECRET_ACCESS_KEY, undefined);
  } finally {
  if (originalAwsSecret === undefined) {
    Deno.env.delete('AWS_SECRET_ACCESS_KEY');
    return;
  }
  Deno.env.set('AWS_SECRET_ACCESS_KEY', originalAwsSecret);
  }
})