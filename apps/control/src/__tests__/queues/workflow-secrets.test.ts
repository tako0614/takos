import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

vi.mock('@/utils', () => ({
  decrypt: mocks.decrypt,
}));

import { resolveSecretValues, collectReferencedSecretNamesFromEnv } from '@/queues/workflow-secrets';

// ---------------------------------------------------------------------------
// Drizzle mock helper
// ---------------------------------------------------------------------------

function createDrizzleMock(opts: { selectAll?: ReturnType<typeof vi.fn> }) {
  const selectAll = opts.selectAll ?? vi.fn().mockResolvedValue([]);

  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = vi.fn().mockReturnValue(c);
    c.where = vi.fn().mockReturnValue(c);
    c.orderBy = vi.fn().mockReturnValue(c);
    c.all = selectAll;
    return c;
  };

  return {
    select: vi.fn().mockImplementation(() => chain()),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// collectReferencedSecretNamesFromEnv
// ---------------------------------------------------------------------------

describe('collectReferencedSecretNamesFromEnv', () => {
  it('extracts secret names from ${{ secrets.X }} references', () => {
    const env = {
      API_TOKEN: '${{ secrets.API_TOKEN }}',
      OTHER: 'static-value',
      DB_PASS: '${{ secrets.DB_PASSWORD }}',
    };

    const names = collectReferencedSecretNamesFromEnv(env);
    expect(names).toEqual(['API_TOKEN', 'DB_PASSWORD']);
  });

  it('returns empty array when no secrets are referenced', () => {
    const env = {
      CI: 'true',
      NODE_ENV: 'production',
    };

    expect(collectReferencedSecretNamesFromEnv(env)).toEqual([]);
  });

  it('handles empty env', () => {
    expect(collectReferencedSecretNamesFromEnv({})).toEqual([]);
  });

  it('handles multiple secret references in same value', () => {
    const env = {
      COMBINED: '${{ secrets.USER }}:${{ secrets.PASS }}',
    };

    const names = collectReferencedSecretNamesFromEnv(env);
    expect(names).toEqual(['PASS', 'USER']);
  });

  it('deduplicates secret names', () => {
    const env = {
      A: '${{ secrets.TOKEN }}',
      B: '${{ secrets.TOKEN }}',
    };

    const names = collectReferencedSecretNamesFromEnv(env);
    expect(names).toEqual(['TOKEN']);
  });

  it('returns sorted names', () => {
    const env = {
      Z: '${{ secrets.ZEBRA }}',
      A: '${{ secrets.ALPHA }}',
      M: '${{ secrets.MIKE }}',
    };

    const names = collectReferencedSecretNamesFromEnv(env);
    expect(names).toEqual(['ALPHA', 'MIKE', 'ZEBRA']);
  });

  it('supports spaces inside expression', () => {
    const env = {
      TOKEN: '${{  secrets.MY_TOKEN  }}',
    };

    const names = collectReferencedSecretNamesFromEnv(env);
    expect(names).toEqual(['MY_TOKEN']);
  });

  it('supports underscores and numbers in secret names', () => {
    const env = {
      KEY: '${{ secrets.API_KEY_V2 }}',
    };

    const names = collectReferencedSecretNamesFromEnv(env);
    expect(names).toEqual(['API_KEY_V2']);
  });
});

// ---------------------------------------------------------------------------
// resolveSecretValues
// ---------------------------------------------------------------------------

describe('resolveSecretValues', () => {
  it('returns empty object when no encryption key', async () => {
    const result = await resolveSecretValues({} as any, 'repo-1', ['s1'], undefined, []);
    expect(result).toEqual({});
  });

  it('throws when required secrets exist but no encryption key', async () => {
    await expect(
      resolveSecretValues({} as any, 'repo-1', ['s1'], undefined, ['SECRET_A'])
    ).rejects.toThrow('Encryption key is required to resolve referenced workflow secrets');
  });

  it('returns empty object when secretIds is empty and no required names', async () => {
    const result = await resolveSecretValues({} as any, 'repo-1', [], 'enc-key', []);
    expect(result).toEqual({});
  });

  it('throws when secretIds is empty but required names exist', async () => {
    await expect(
      resolveSecretValues({} as any, 'repo-1', [], 'enc-key', ['NEEDED_SECRET'])
    ).rejects.toThrow('Missing referenced secrets: NEEDED_SECRET');
  });

  it('decrypts secrets from DB records', async () => {
    const dbMock = createDrizzleMock({
      selectAll: vi.fn().mockResolvedValue([
        { id: 's1', name: 'API_TOKEN', encryptedValue: '{"iv":"abc","ct":"xyz"}' },
        { id: 's2', name: 'DB_PASS', encryptedValue: '{"iv":"def","ct":"uvw"}' },
      ]),
    });
    mocks.getDb.mockReturnValue(dbMock);
    mocks.decrypt
      .mockResolvedValueOnce('token-value')
      .mockResolvedValueOnce('password-value');

    const result = await resolveSecretValues({} as any, 'repo-1', ['s1', 's2'], 'enc-key');

    expect(result).toEqual({
      API_TOKEN: 'token-value',
      DB_PASS: 'password-value',
    });
    expect(mocks.decrypt).toHaveBeenCalledTimes(2);
    expect(mocks.decrypt).toHaveBeenCalledWith(
      { iv: 'abc', ct: 'xyz' },
      'enc-key',
      'secret:repo-1:API_TOKEN'
    );
  });

  it('skips secrets that fail to decrypt (logs error)', async () => {
    const dbMock = createDrizzleMock({
      selectAll: vi.fn().mockResolvedValue([
        { id: 's1', name: 'GOOD', encryptedValue: '{"iv":"a","ct":"b"}' },
        { id: 's2', name: 'BAD', encryptedValue: '{"iv":"c","ct":"d"}' },
      ]),
    });
    mocks.getDb.mockReturnValue(dbMock);
    mocks.decrypt
      .mockResolvedValueOnce('good-value')
      .mockRejectedValueOnce(new Error('decrypt failed'));

    const result = await resolveSecretValues({} as any, 'repo-1', ['s1', 's2'], 'enc-key');

    expect(result).toEqual({ GOOD: 'good-value' });
  });

  it('throws when required secrets are missing after decryption', async () => {
    const dbMock = createDrizzleMock({
      selectAll: vi.fn().mockResolvedValue([
        { id: 's1', name: 'FOUND', encryptedValue: '{"iv":"a","ct":"b"}' },
      ]),
    });
    mocks.getDb.mockReturnValue(dbMock);
    mocks.decrypt.mockResolvedValue('value');

    await expect(
      resolveSecretValues({} as any, 'repo-1', ['s1'], 'enc-key', ['FOUND', 'MISSING'])
    ).rejects.toThrow('Missing referenced secrets: MISSING');
  });

  it('throws when decrypt fails for a required secret', async () => {
    const dbMock = createDrizzleMock({
      selectAll: vi.fn().mockResolvedValue([
        { id: 's1', name: 'REQUIRED', encryptedValue: '{"iv":"a","ct":"b"}' },
      ]),
    });
    mocks.getDb.mockReturnValue(dbMock);
    mocks.decrypt.mockRejectedValue(new Error('bad key'));

    await expect(
      resolveSecretValues({} as any, 'repo-1', ['s1'], 'enc-key', ['REQUIRED'])
    ).rejects.toThrow('Missing referenced secrets: REQUIRED');
  });

  it('handles JSON parse errors in encryptedValue', async () => {
    const dbMock = createDrizzleMock({
      selectAll: vi.fn().mockResolvedValue([
        { id: 's1', name: 'BROKEN', encryptedValue: 'not-json' },
      ]),
    });
    mocks.getDb.mockReturnValue(dbMock);

    // JSON.parse will throw before decrypt is called
    const result = await resolveSecretValues({} as any, 'repo-1', ['s1'], 'enc-key');
    expect(result).toEqual({});
  });

  it('does not require secrets when requiredSecretNames is empty', async () => {
    const dbMock = createDrizzleMock({
      selectAll: vi.fn().mockResolvedValue([]),
    });
    mocks.getDb.mockReturnValue(dbMock);

    const result = await resolveSecretValues({} as any, 'repo-1', ['s1'], 'enc-key', []);
    expect(result).toEqual({});
  });
});
