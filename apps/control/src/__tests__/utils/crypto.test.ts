import { describe, expect, it } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptEnvVars,
  decryptEnvVars,
  maskEnvVars,
  type EncryptedData,
} from '@/utils/crypto';

const MASTER_SECRET = 'a'.repeat(64); // 64-char hex string
const SALT = 'test-salt';

describe('encrypt / decrypt', () => {
  it('round-trips a simple string', async () => {
    const plaintext = 'hello world';
    const encrypted = await encrypt(plaintext, MASTER_SECRET, SALT);
    const decrypted = await decrypt(encrypted, MASTER_SECRET, SALT);
    expect(decrypted).toBe(plaintext);
  });

  it('round-trips an empty string', async () => {
    const encrypted = await encrypt('', MASTER_SECRET, SALT);
    const decrypted = await decrypt(encrypted, MASTER_SECRET, SALT);
    expect(decrypted).toBe('');
  });

  it('round-trips unicode content', async () => {
    const plaintext = 'こんにちは世界 🌏';
    const encrypted = await encrypt(plaintext, MASTER_SECRET, SALT);
    const decrypted = await decrypt(encrypted, MASTER_SECRET, SALT);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    const plaintext = 'deterministic?';
    const e1 = await encrypt(plaintext, MASTER_SECRET, SALT);
    const e2 = await encrypt(plaintext, MASTER_SECRET, SALT);
    // IVs should differ, making ciphertexts differ
    expect(e1.iv).not.toBe(e2.iv);
  });

  it('encrypted data has expected shape', async () => {
    const encrypted = await encrypt('test', MASTER_SECRET, SALT);
    expect(encrypted.alg).toBe('AES-256-GCM');
    expect(encrypted.v).toBe(1);
    expect(typeof encrypted.ciphertext).toBe('string');
    expect(typeof encrypted.iv).toBe('string');
  });

  it('rejects unsupported algorithm', async () => {
    const bad: EncryptedData = {
      ciphertext: 'aaa',
      iv: 'bbb',
      alg: 'AES-256-GCM',
      v: 1,
    };
    // Tamper alg
    (bad as any).alg = 'AES-128-CBC';
    await expect(decrypt(bad, MASTER_SECRET, SALT)).rejects.toThrow('Unsupported encryption format');
  });

  it('rejects unsupported version', async () => {
    const bad: EncryptedData = {
      ciphertext: 'aaa',
      iv: 'bbb',
      alg: 'AES-256-GCM',
      v: 1,
    };
    (bad as any).v = 2;
    await expect(decrypt(bad, MASTER_SECRET, SALT)).rejects.toThrow('Unsupported encryption format');
  });

  it('fails to decrypt with wrong secret', async () => {
    const encrypted = await encrypt('secret data', MASTER_SECRET, SALT);
    const wrongSecret = 'b'.repeat(64);
    await expect(decrypt(encrypted, wrongSecret, SALT)).rejects.toThrow();
  });

  it('fails to decrypt with wrong salt', async () => {
    const encrypted = await encrypt('secret data', MASTER_SECRET, SALT);
    await expect(decrypt(encrypted, MASTER_SECRET, 'wrong-salt')).rejects.toThrow();
  });

  it('handles 0x-prefixed hex secret', async () => {
    const hexSecret = '0x' + 'ab'.repeat(32);
    const encrypted = await encrypt('test', hexSecret, SALT);
    const decrypted = await decrypt(encrypted, hexSecret, SALT);
    expect(decrypted).toBe('test');
  });

  it('handles non-hex string secret (plain passphrase)', async () => {
    const passphrase = 'my-short-passphrase';
    const encrypted = await encrypt('test', passphrase, SALT);
    const decrypted = await decrypt(encrypted, passphrase, SALT);
    expect(decrypted).toBe('test');
  });
});

describe('encryptEnvVars / decryptEnvVars', () => {
  it('round-trips a record of env vars', async () => {
    const vars = { API_KEY: 'sk-123', DB_URL: 'postgres://localhost' };
    const json = await encryptEnvVars(vars, MASTER_SECRET, SALT);
    const decrypted = await decryptEnvVars(json, MASTER_SECRET, SALT);
    expect(decrypted).toEqual(vars);
  });

  it('round-trips an empty object', async () => {
    const json = await encryptEnvVars({}, MASTER_SECRET, SALT);
    const decrypted = await decryptEnvVars(json, MASTER_SECRET, SALT);
    expect(decrypted).toEqual({});
  });

  it('rejects invalid JSON input', async () => {
    await expect(decryptEnvVars('not json', MASTER_SECRET, SALT)).rejects.toThrow(
      'encryptedJson is not valid JSON'
    );
  });

  it('rejects JSON without expected EncryptedData shape', async () => {
    await expect(
      decryptEnvVars(JSON.stringify({ foo: 'bar' }), MASTER_SECRET, SALT)
    ).rejects.toThrow('does not have expected EncryptedData shape');
  });

  it('rejects null JSON value', async () => {
    await expect(
      decryptEnvVars(JSON.stringify(null), MASTER_SECRET, SALT)
    ).rejects.toThrow('does not have expected EncryptedData shape');
  });
});

describe('maskEnvVars', () => {
  it('masks short values completely', () => {
    expect(maskEnvVars({ KEY: 'short' })).toEqual({ KEY: '****' });
  });

  it('masks long values showing first and last 2 chars', () => {
    expect(maskEnvVars({ KEY: '1234567890' })).toEqual({ KEY: '12****90' });
  });

  it('masks exactly 8-char values completely', () => {
    expect(maskEnvVars({ KEY: '12345678' })).toEqual({ KEY: '****' });
  });

  it('masks exactly 9-char values with partial reveal', () => {
    expect(maskEnvVars({ KEY: '123456789' })).toEqual({ KEY: '12****89' });
  });

  it('handles empty object', () => {
    expect(maskEnvVars({})).toEqual({});
  });

  it('masks multiple keys independently', () => {
    const result = maskEnvVars({ A: 'short', B: 'a-long-secret-value' });
    expect(result.A).toBe('****');
    expect(result.B).toBe('a-****ue');
  });
});
