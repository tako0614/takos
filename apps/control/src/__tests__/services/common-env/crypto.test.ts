import { describe, it, expect, vi } from 'vitest';
import {
  normalizeEnvName,
  uniqueEnvNames,
  getCommonEnvSecret,
  isManagedCommonEnvKey,
  isReservedSpaceCommonEnvKey,
  normalizeCommonEnvName,
  MANAGED_COMMON_ENV_KEYS,
  RESERVED_SPACE_COMMON_ENV_KEYS,
  encryptCommonEnvValue,
  decryptCommonEnvValue,
  createBindingFingerprint,
  fingerprintMatches,
} from '@/services/common-env/crypto';
import type { Env } from '@/types';

describe('normalizeEnvName', () => {
  it('uppercases a valid name', () => {
    expect(normalizeEnvName('my_var')).toBe('MY_VAR');
  });

  it('trims whitespace', () => {
    expect(normalizeEnvName('  FOO  ')).toBe('FOO');
  });

  it('throws on empty string', () => {
    expect(() => normalizeEnvName('')).toThrow('Environment variable name is required');
  });

  it('throws on whitespace-only string', () => {
    expect(() => normalizeEnvName('   ')).toThrow('Environment variable name is required');
  });

  it('throws on names starting with a digit', () => {
    expect(() => normalizeEnvName('1_VAR')).toThrow('Invalid environment variable name');
  });

  it('throws on names with special characters', () => {
    expect(() => normalizeEnvName('my-var')).toThrow('Invalid environment variable name');
    expect(() => normalizeEnvName('my.var')).toThrow('Invalid environment variable name');
    expect(() => normalizeEnvName('my var')).toThrow('Invalid environment variable name');
  });

  it('allows underscore-prefixed names', () => {
    expect(normalizeEnvName('_PRIVATE')).toBe('_PRIVATE');
  });

  it('allows single character names', () => {
    expect(normalizeEnvName('X')).toBe('X');
  });
});

describe('uniqueEnvNames', () => {
  it('deduplicates and normalizes names', () => {
    const result = uniqueEnvNames(['foo', 'FOO', 'bar', 'BAR', 'baz']);
    expect(result).toEqual(['FOO', 'BAR', 'BAZ']);
  });

  it('returns empty array for empty input', () => {
    expect(uniqueEnvNames([])).toEqual([]);
  });

  it('preserves order of first occurrence', () => {
    const result = uniqueEnvNames(['b', 'a', 'c']);
    expect(result).toEqual(['B', 'A', 'C']);
  });
});

describe('getCommonEnvSecret', () => {
  it('returns the encryption key when set', () => {
    const env = { ENCRYPTION_KEY: 'my-secret-key' } as Pick<Env, 'ENCRYPTION_KEY'>;
    expect(getCommonEnvSecret(env)).toBe('my-secret-key');
  });

  it('throws when ENCRYPTION_KEY is empty', () => {
    const env = { ENCRYPTION_KEY: '' } as Pick<Env, 'ENCRYPTION_KEY'>;
    expect(() => getCommonEnvSecret(env)).toThrow('ENCRYPTION_KEY must be set');
  });

  it('throws when ENCRYPTION_KEY is undefined', () => {
    const env = {} as Pick<Env, 'ENCRYPTION_KEY'>;
    expect(() => getCommonEnvSecret(env)).toThrow('ENCRYPTION_KEY must be set');
  });
});

describe('normalizeCommonEnvName', () => {
  it('returns normalized name for valid input', () => {
    expect(normalizeCommonEnvName('my_var')).toBe('MY_VAR');
  });

  it('returns null for invalid input', () => {
    expect(normalizeCommonEnvName('123')).toBeNull();
    expect(normalizeCommonEnvName('')).toBeNull();
    expect(normalizeCommonEnvName('my-var')).toBeNull();
  });
});

describe('isManagedCommonEnvKey', () => {
  it('returns true for managed keys', () => {
    expect(isManagedCommonEnvKey('APP_BASE_URL')).toBe(true);
    expect(isManagedCommonEnvKey('TAKOS_API_URL')).toBe(true);
    expect(isManagedCommonEnvKey('TAKOS_ACCESS_TOKEN')).toBe(true);
  });

  it('returns true regardless of case', () => {
    expect(isManagedCommonEnvKey('app_base_url')).toBe(true);
    expect(isManagedCommonEnvKey('takos_api_url')).toBe(true);
  });

  it('returns false for non-managed keys', () => {
    expect(isManagedCommonEnvKey('MY_CUSTOM_KEY')).toBe(false);
    expect(isManagedCommonEnvKey('DATABASE_URL')).toBe(false);
  });

  it('returns false for invalid names', () => {
    expect(isManagedCommonEnvKey('123invalid')).toBe(false);
  });
});

describe('isReservedSpaceCommonEnvKey', () => {
  it('returns true for reserved keys', () => {
    expect(isReservedSpaceCommonEnvKey('TAKOS_API_URL')).toBe(true);
    expect(isReservedSpaceCommonEnvKey('TAKOS_ACCESS_TOKEN')).toBe(true);
  });

  it('returns false for managed but not reserved keys', () => {
    expect(isReservedSpaceCommonEnvKey('APP_BASE_URL')).toBe(false);
  });

  it('returns false for custom keys', () => {
    expect(isReservedSpaceCommonEnvKey('MY_KEY')).toBe(false);
  });
});

describe('MANAGED_COMMON_ENV_KEYS', () => {
  it('contains the expected keys', () => {
    expect(MANAGED_COMMON_ENV_KEYS.has('APP_BASE_URL')).toBe(true);
    expect(MANAGED_COMMON_ENV_KEYS.has('TAKOS_API_URL')).toBe(true);
    expect(MANAGED_COMMON_ENV_KEYS.has('TAKOS_ACCESS_TOKEN')).toBe(true);
    expect(MANAGED_COMMON_ENV_KEYS.size).toBe(3);
  });
});

describe('RESERVED_SPACE_COMMON_ENV_KEYS', () => {
  it('contains the expected keys', () => {
    expect(RESERVED_SPACE_COMMON_ENV_KEYS.has('TAKOS_API_URL')).toBe(true);
    expect(RESERVED_SPACE_COMMON_ENV_KEYS.has('TAKOS_ACCESS_TOKEN')).toBe(true);
    expect(RESERVED_SPACE_COMMON_ENV_KEYS.size).toBe(2);
  });
});

describe('encrypt and decrypt common env value round-trip', () => {
  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const env = { ENCRYPTION_KEY: testKey } as Pick<Env, 'ENCRYPTION_KEY'>;

  it('encrypts and decrypts a value correctly', async () => {
    const spaceId = 'space-1';
    const envName = 'MY_SECRET';
    const plaintext = 'super-secret-value';

    const encrypted = await encryptCommonEnvValue(env, spaceId, envName, plaintext);
    expect(typeof encrypted).toBe('string');

    // Should be valid JSON
    const parsed = JSON.parse(encrypted);
    expect(parsed.alg).toBe('AES-256-GCM');
    expect(parsed.v).toBe(1);

    const decrypted = await decryptCommonEnvValue(env, {
      space_id: spaceId,
      name: envName,
      value_encrypted: encrypted,
    });
    expect(decrypted).toBe(plaintext);
  });

  it('decryption fails with invalid encrypted data structure', async () => {
    await expect(
      decryptCommonEnvValue(env, {
        space_id: 'space-1',
        name: 'MY_VAR',
        value_encrypted: JSON.stringify({ foo: 'bar' }),
      })
    ).rejects.toThrow('Invalid encrypted data structure');
  });

  it('decryption fails with non-JSON value', async () => {
    await expect(
      decryptCommonEnvValue(env, {
        space_id: 'space-1',
        name: 'MY_VAR',
        value_encrypted: 'not-json',
      })
    ).rejects.toThrow('Failed to parse encrypted value');
  });
});

describe('createBindingFingerprint', () => {
  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const env = { ENCRYPTION_KEY: testKey } as Pick<Env, 'ENCRYPTION_KEY'>;

  it('creates a v2 fingerprint', async () => {
    const fp = await createBindingFingerprint({
      env,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
      text: 'hello',
    });
    expect(fp).toMatch(/^v2:/);
  });

  it('returns null when text is undefined', async () => {
    const fp = await createBindingFingerprint({
      env,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
    });
    expect(fp).toBeNull();
  });

  it('produces different fingerprints for different values', async () => {
    const fp1 = await createBindingFingerprint({
      env,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
      text: 'hello',
    });
    const fp2 = await createBindingFingerprint({
      env,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
      text: 'world',
    });
    expect(fp1).not.toBe(fp2);
  });

  it('produces different fingerprints for different types', async () => {
    const fp1 = await createBindingFingerprint({
      env,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
      text: 'hello',
    });
    const fp2 = await createBindingFingerprint({
      env,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'secret_text',
      text: 'hello',
    });
    expect(fp1).not.toBe(fp2);
  });
});

describe('fingerprintMatches', () => {
  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const env = { ENCRYPTION_KEY: testKey } as Pick<Env, 'ENCRYPTION_KEY'>;

  it('returns true for matching v2 fingerprint', async () => {
    const fp = await createBindingFingerprint({
      env,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
      text: 'hello',
    });

    const match = await fingerprintMatches({
      env,
      stored: fp,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
      text: 'hello',
    });
    expect(match).toBe(true);
  });

  it('returns false for non-matching v2 fingerprint', async () => {
    const fp = await createBindingFingerprint({
      env,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
      text: 'hello',
    });

    const match = await fingerprintMatches({
      env,
      stored: fp,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
      text: 'world',
    });
    expect(match).toBe(false);
  });

  it('returns false when stored is null', async () => {
    const match = await fingerprintMatches({
      env,
      stored: null,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
      text: 'hello',
    });
    expect(match).toBe(false);
  });

  it('returns false when text is undefined', async () => {
    const match = await fingerprintMatches({
      env,
      stored: 'v2:abc',
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
    });
    expect(match).toBe(false);
  });
});
