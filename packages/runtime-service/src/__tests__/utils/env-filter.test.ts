import { afterEach, describe, expect, it } from 'vitest';
import { createSandboxEnv, validateRuntimeExecEnv } from '../../utils/env-filter.js';

const originalAwsSecret = process.env.AWS_SECRET_ACCESS_KEY;

afterEach(() => {
  if (originalAwsSecret === undefined) {
    delete process.env.AWS_SECRET_ACCESS_KEY;
    return;
  }
  process.env.AWS_SECRET_ACCESS_KEY = originalAwsSecret;
});

describe('validateRuntimeExecEnv', () => {
  it('accepts undefined env as empty object', () => {
    expect(validateRuntimeExecEnv(undefined)).toEqual({ ok: true, env: {} });
  });

  it('accepts valid env entries', () => {
    const result = validateRuntimeExecEnv({
      CI: 'true',
      MY_FEATURE_FLAG: '1',
    });
    expect(result).toEqual({
      ok: true,
      env: { CI: 'true', MY_FEATURE_FLAG: '1' },
    });
  });

  it('rejects invalid variable names', () => {
    const result = validateRuntimeExecEnv({
      '1INVALID': 'value',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Invalid environment variable name');
    }
  });

  it('rejects sensitive variable names', () => {
    const result = validateRuntimeExecEnv({
      TAKOS_TOKEN: 'secret',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Sensitive environment variable is not allowed');
    }
  });

  it('rejects values with newlines', () => {
    const result = validateRuntimeExecEnv({
      SAFE_NAME: 'line1\nline2',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('contains invalid characters');
    }
  });

  it('keeps explicit workflow env values for allowed prefixes and blocks host secrets', () => {
    process.env.AWS_SECRET_ACCESS_KEY = 'host-secret-value';

    const sandboxEnv = createSandboxEnv({
      GITHUB_TOKEN: 'token-from-workflow',
      INPUT_SECRET: 'secret-from-workflow',
      RUNNER_TEMP: '/tmp/runner',
    });

    expect(sandboxEnv.GITHUB_TOKEN).toBe('token-from-workflow');
    expect(sandboxEnv.INPUT_SECRET).toBe('secret-from-workflow');
    expect(sandboxEnv.RUNNER_TEMP).toBe('/tmp/runner');
    expect(sandboxEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });
});
