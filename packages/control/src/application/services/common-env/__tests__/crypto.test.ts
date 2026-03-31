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


import { assertEquals, assertNotEquals, assert, assertThrows, assertRejects } from 'jsr:@std/assert';

  Deno.test('normalizeEnvName - uppercases a valid name', () => {
  assertEquals(normalizeEnvName('my_var'), 'MY_VAR');
})
  Deno.test('normalizeEnvName - trims whitespace', () => {
  assertEquals(normalizeEnvName('  FOO  '), 'FOO');
})
  Deno.test('normalizeEnvName - throws on empty string', () => {
  assertThrows(() => { () => normalizeEnvName(''); }, 'Environment variable name is required');
})
  Deno.test('normalizeEnvName - throws on whitespace-only string', () => {
  assertThrows(() => { () => normalizeEnvName('   '); }, 'Environment variable name is required');
})
  Deno.test('normalizeEnvName - throws on names starting with a digit', () => {
  assertThrows(() => { () => normalizeEnvName('1_VAR'); }, 'Invalid environment variable name');
})
  Deno.test('normalizeEnvName - throws on names with special characters', () => {
  assertThrows(() => { () => normalizeEnvName('my-var'); }, 'Invalid environment variable name');
    assertThrows(() => { () => normalizeEnvName('my.var'); }, 'Invalid environment variable name');
    assertThrows(() => { () => normalizeEnvName('my var'); }, 'Invalid environment variable name');
})
  Deno.test('normalizeEnvName - allows underscore-prefixed names', () => {
  assertEquals(normalizeEnvName('_PRIVATE'), '_PRIVATE');
})
  Deno.test('normalizeEnvName - allows single character names', () => {
  assertEquals(normalizeEnvName('X'), 'X');
})

  Deno.test('uniqueEnvNames - deduplicates and normalizes names', () => {
  const result = uniqueEnvNames(['foo', 'FOO', 'bar', 'BAR', 'baz']);
    assertEquals(result, ['FOO', 'BAR', 'BAZ']);
})
  Deno.test('uniqueEnvNames - returns empty array for empty input', () => {
  assertEquals(uniqueEnvNames([]), []);
})
  Deno.test('uniqueEnvNames - preserves order of first occurrence', () => {
  const result = uniqueEnvNames(['b', 'a', 'c']);
    assertEquals(result, ['B', 'A', 'C']);
})

  Deno.test('getCommonEnvSecret - returns the encryption key when set', () => {
  const env = { ENCRYPTION_KEY: 'my-secret-key' } as Pick<Env, 'ENCRYPTION_KEY'>;
    assertEquals(getCommonEnvSecret(env), 'my-secret-key');
})
  Deno.test('getCommonEnvSecret - throws when ENCRYPTION_KEY is empty', () => {
  const env = { ENCRYPTION_KEY: '' } as Pick<Env, 'ENCRYPTION_KEY'>;
    assertThrows(() => { () => getCommonEnvSecret(env); }, 'ENCRYPTION_KEY must be set');
})
  Deno.test('getCommonEnvSecret - throws when ENCRYPTION_KEY is undefined', () => {
  const env = {} as Pick<Env, 'ENCRYPTION_KEY'>;
    assertThrows(() => { () => getCommonEnvSecret(env); }, 'ENCRYPTION_KEY must be set');
})

  Deno.test('normalizeCommonEnvName - returns normalized name for valid input', () => {
  assertEquals(normalizeCommonEnvName('my_var'), 'MY_VAR');
})
  Deno.test('normalizeCommonEnvName - returns null for invalid input', () => {
  assertEquals(normalizeCommonEnvName('123'), null);
    assertEquals(normalizeCommonEnvName(''), null);
    assertEquals(normalizeCommonEnvName('my-var'), null);
})

  Deno.test('isManagedCommonEnvKey - returns true for managed keys', () => {
  assertEquals(isManagedCommonEnvKey('APP_BASE_URL'), true);
    assertEquals(isManagedCommonEnvKey('TAKOS_API_URL'), true);
    assertEquals(isManagedCommonEnvKey('TAKOS_ACCESS_TOKEN'), true);
})
  Deno.test('isManagedCommonEnvKey - returns true regardless of case', () => {
  assertEquals(isManagedCommonEnvKey('app_base_url'), true);
    assertEquals(isManagedCommonEnvKey('takos_api_url'), true);
})
  Deno.test('isManagedCommonEnvKey - returns false for non-managed keys', () => {
  assertEquals(isManagedCommonEnvKey('MY_CUSTOM_KEY'), false);
    assertEquals(isManagedCommonEnvKey('DATABASE_URL'), false);
})
  Deno.test('isManagedCommonEnvKey - returns false for invalid names', () => {
  assertEquals(isManagedCommonEnvKey('123invalid'), false);
})

  Deno.test('isReservedSpaceCommonEnvKey - returns true for reserved keys', () => {
  assertEquals(isReservedSpaceCommonEnvKey('TAKOS_API_URL'), true);
    assertEquals(isReservedSpaceCommonEnvKey('TAKOS_ACCESS_TOKEN'), true);
})
  Deno.test('isReservedSpaceCommonEnvKey - returns false for managed but not reserved keys', () => {
  assertEquals(isReservedSpaceCommonEnvKey('APP_BASE_URL'), false);
})
  Deno.test('isReservedSpaceCommonEnvKey - returns false for custom keys', () => {
  assertEquals(isReservedSpaceCommonEnvKey('MY_KEY'), false);
})

  Deno.test('MANAGED_COMMON_ENV_KEYS - contains the expected keys', () => {
  assertEquals(MANAGED_COMMON_ENV_KEYS.has('APP_BASE_URL'), true);
    assertEquals(MANAGED_COMMON_ENV_KEYS.has('TAKOS_API_URL'), true);
    assertEquals(MANAGED_COMMON_ENV_KEYS.has('TAKOS_ACCESS_TOKEN'), true);
    assertEquals(MANAGED_COMMON_ENV_KEYS.size, 3);
})

  Deno.test('RESERVED_SPACE_COMMON_ENV_KEYS - contains the expected keys', () => {
  assertEquals(RESERVED_SPACE_COMMON_ENV_KEYS.has('TAKOS_API_URL'), true);
    assertEquals(RESERVED_SPACE_COMMON_ENV_KEYS.has('TAKOS_ACCESS_TOKEN'), true);
    assertEquals(RESERVED_SPACE_COMMON_ENV_KEYS.size, 2);
})

  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const env = { ENCRYPTION_KEY: testKey } as Pick<Env, 'ENCRYPTION_KEY'>;

  Deno.test('encrypt and decrypt common env value round-trip - encrypts and decrypts a value correctly', async () => {
  const spaceId = 'space-1';
    const envName = 'MY_SECRET';
    const plaintext = 'super-secret-value';

    const encrypted = await encryptCommonEnvValue(env, spaceId, envName, plaintext);
    assertEquals(typeof encrypted, 'string');

    // Should be valid JSON
    const parsed = JSON.parse(encrypted);
    assertEquals(parsed.alg, 'AES-256-GCM');
    assertEquals(parsed.v, 1);

    const decrypted = await decryptCommonEnvValue(env, {
      space_id: spaceId,
      name: envName,
      value_encrypted: encrypted,
    });
    assertEquals(decrypted, plaintext);
})
  Deno.test('encrypt and decrypt common env value round-trip - decryption fails with invalid encrypted data structure', async () => {
  await await assertRejects(async () => { await 
      decryptCommonEnvValue(env, {
        space_id: 'space-1',
        name: 'MY_VAR',
        value_encrypted: JSON.stringify({ foo: 'bar' }),
      })
    ; }, 'Invalid encrypted data structure');
})
  Deno.test('encrypt and decrypt common env value round-trip - decryption fails with non-JSON value', async () => {
  await await assertRejects(async () => { await 
      decryptCommonEnvValue(env, {
        space_id: 'space-1',
        name: 'MY_VAR',
        value_encrypted: 'not-json',
      })
    ; }, 'Failed to parse encrypted value');
})

  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const env = { ENCRYPTION_KEY: testKey } as Pick<Env, 'ENCRYPTION_KEY'>;

  Deno.test('createBindingFingerprint - creates a v2 fingerprint', async () => {
  const fp = await createBindingFingerprint({
      env,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
      text: 'hello',
    });
    assert(/^v2:/.test(fp));
})
  Deno.test('createBindingFingerprint - returns null when text is undefined', async () => {
  const fp = await createBindingFingerprint({
      env,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
    });
    assertEquals(fp, null);
})
  Deno.test('createBindingFingerprint - produces different fingerprints for different values', async () => {
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
    assertNotEquals(fp1, fp2);
})
  Deno.test('createBindingFingerprint - produces different fingerprints for different types', async () => {
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
    assertNotEquals(fp1, fp2);
})

  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const env = { ENCRYPTION_KEY: testKey } as Pick<Env, 'ENCRYPTION_KEY'>;

  Deno.test('fingerprintMatches - returns true for matching v2 fingerprint', async () => {
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
    assertEquals(match, true);
})
  Deno.test('fingerprintMatches - returns false for non-matching v2 fingerprint', async () => {
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
    assertEquals(match, false);
})
  Deno.test('fingerprintMatches - returns false when stored is null', async () => {
  const match = await fingerprintMatches({
      env,
      stored: null,
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
      text: 'hello',
    });
    assertEquals(match, false);
})
  Deno.test('fingerprintMatches - returns false when text is undefined', async () => {
  const match = await fingerprintMatches({
      env,
      stored: 'v2:abc',
      spaceId: 'space-1',
      envName: 'MY_VAR',
      type: 'plain_text',
    });
    assertEquals(match, false);
})