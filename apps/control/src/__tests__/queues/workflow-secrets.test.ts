import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  decrypt: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
import { resolveSecretValues, collectReferencedSecretNamesFromEnv } from '@/queues/workflow-secrets';

// ---------------------------------------------------------------------------
// Drizzle mock helper
// ---------------------------------------------------------------------------

function createDrizzleMock(opts: { selectAll?: ReturnType<typeof vi.fn> }) {
  const selectAll = opts.selectAll ?? (async () => []);

  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = (() => c);
    c.where = (() => c);
    c.orderBy = (() => c);
    c.all = selectAll;
    return c;
  };

  return {
    select: () => chain(),
  };
}
// ---------------------------------------------------------------------------
// collectReferencedSecretNamesFromEnv
// ---------------------------------------------------------------------------


  Deno.test('collectReferencedSecretNamesFromEnv - extracts secret names from ${{ secrets.X }} references', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
      API_TOKEN: '${{ secrets.API_TOKEN }}',
      OTHER: 'static-value',
      DB_PASS: '${{ secrets.DB_PASSWORD }}',
    };

    const names = collectReferencedSecretNamesFromEnv(env);
    assertEquals(names, ['API_TOKEN', 'DB_PASSWORD']);
})
  Deno.test('collectReferencedSecretNamesFromEnv - returns empty array when no secrets are referenced', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
      CI: 'true',
      NODE_ENV: 'production',
    };

    assertEquals(collectReferencedSecretNamesFromEnv(env), []);
})
  Deno.test('collectReferencedSecretNamesFromEnv - handles empty env', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(collectReferencedSecretNamesFromEnv({}), []);
})
  Deno.test('collectReferencedSecretNamesFromEnv - handles multiple secret references in same value', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
      COMBINED: '${{ secrets.USER }}:${{ secrets.PASS }}',
    };

    const names = collectReferencedSecretNamesFromEnv(env);
    assertEquals(names, ['PASS', 'USER']);
})
  Deno.test('collectReferencedSecretNamesFromEnv - deduplicates secret names', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
      A: '${{ secrets.TOKEN }}',
      B: '${{ secrets.TOKEN }}',
    };

    const names = collectReferencedSecretNamesFromEnv(env);
    assertEquals(names, ['TOKEN']);
})
  Deno.test('collectReferencedSecretNamesFromEnv - returns sorted names', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
      Z: '${{ secrets.ZEBRA }}',
      A: '${{ secrets.ALPHA }}',
      M: '${{ secrets.MIKE }}',
    };

    const names = collectReferencedSecretNamesFromEnv(env);
    assertEquals(names, ['ALPHA', 'MIKE', 'ZEBRA']);
})
  Deno.test('collectReferencedSecretNamesFromEnv - supports spaces inside expression', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
      TOKEN: '${{  secrets.MY_TOKEN  }}',
    };

    const names = collectReferencedSecretNamesFromEnv(env);
    assertEquals(names, ['MY_TOKEN']);
})
  Deno.test('collectReferencedSecretNamesFromEnv - supports underscores and numbers in secret names', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
      KEY: '${{ secrets.API_KEY_V2 }}',
    };

    const names = collectReferencedSecretNamesFromEnv(env);
    assertEquals(names, ['API_KEY_V2']);
})
// ---------------------------------------------------------------------------
// resolveSecretValues
// ---------------------------------------------------------------------------


  Deno.test('resolveSecretValues - returns empty object when no encryption key', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await resolveSecretValues({} as any, 'repo-1', ['s1'], undefined, []);
    assertEquals(result, {});
})
  Deno.test('resolveSecretValues - throws when required secrets exist but no encryption key', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await await assertRejects(async () => { await 
      resolveSecretValues({} as any, 'repo-1', ['s1'], undefined, ['SECRET_A'])
    ; }, 'Encryption key is required to resolve referenced workflow secrets');
})
  Deno.test('resolveSecretValues - returns empty object when secretIds is empty and no required names', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await resolveSecretValues({} as any, 'repo-1', [], 'enc-key', []);
    assertEquals(result, {});
})
  Deno.test('resolveSecretValues - throws when secretIds is empty but required names exist', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await await assertRejects(async () => { await 
      resolveSecretValues({} as any, 'repo-1', [], 'enc-key', ['NEEDED_SECRET'])
    ; }, 'Missing referenced secrets: NEEDED_SECRET');
})
  Deno.test('resolveSecretValues - decrypts secrets from DB records', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectAll: (async () => [
        { id: 's1', name: 'API_TOKEN', encryptedValue: '{"iv":"abc","ct":"xyz"}' },
        { id: 's2', name: 'DB_PASS', encryptedValue: '{"iv":"def","ct":"uvw"}' },
      ]),
    });
    mocks.getDb = (() => dbMock) as any;
    mocks.decrypt
       = (async () => 'token-value') as any
       = (async () => 'password-value') as any;

    const result = await resolveSecretValues({} as any, 'repo-1', ['s1', 's2'], 'enc-key');

    assertEquals(result, {
      API_TOKEN: 'token-value',
      DB_PASS: 'password-value',
    });
    assertSpyCalls(mocks.decrypt, 2);
    assertSpyCallArgs(mocks.decrypt, 0, [
      { iv: 'abc', ct: 'xyz' },
      'enc-key',
      'secret:repo-1:API_TOKEN'
    ]);
})
  Deno.test('resolveSecretValues - skips secrets that fail to decrypt (logs error)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectAll: (async () => [
        { id: 's1', name: 'GOOD', encryptedValue: '{"iv":"a","ct":"b"}' },
        { id: 's2', name: 'BAD', encryptedValue: '{"iv":"c","ct":"d"}' },
      ]),
    });
    mocks.getDb = (() => dbMock) as any;
    mocks.decrypt
       = (async () => 'good-value') as any
       = (async () => { throw new Error('decrypt failed'); }) as any;

    const result = await resolveSecretValues({} as any, 'repo-1', ['s1', 's2'], 'enc-key');

    assertEquals(result, { GOOD: 'good-value' });
})
  Deno.test('resolveSecretValues - throws when required secrets are missing after decryption', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectAll: (async () => [
        { id: 's1', name: 'FOUND', encryptedValue: '{"iv":"a","ct":"b"}' },
      ]),
    });
    mocks.getDb = (() => dbMock) as any;
    mocks.decrypt = (async () => 'value') as any;

    await await assertRejects(async () => { await 
      resolveSecretValues({} as any, 'repo-1', ['s1'], 'enc-key', ['FOUND', 'MISSING'])
    ; }, 'Missing referenced secrets: MISSING');
})
  Deno.test('resolveSecretValues - throws when decrypt fails for a required secret', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectAll: (async () => [
        { id: 's1', name: 'REQUIRED', encryptedValue: '{"iv":"a","ct":"b"}' },
      ]),
    });
    mocks.getDb = (() => dbMock) as any;
    mocks.decrypt = (async () => { throw new Error('bad key'); }) as any;

    await await assertRejects(async () => { await 
      resolveSecretValues({} as any, 'repo-1', ['s1'], 'enc-key', ['REQUIRED'])
    ; }, 'Missing referenced secrets: REQUIRED');
})
  Deno.test('resolveSecretValues - handles JSON parse errors in encryptedValue', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectAll: (async () => [
        { id: 's1', name: 'BROKEN', encryptedValue: 'not-json' },
      ]),
    });
    mocks.getDb = (() => dbMock) as any;

    // JSON.parse will throw before decrypt is called
    const result = await resolveSecretValues({} as any, 'repo-1', ['s1'], 'enc-key');
    assertEquals(result, {});
})
  Deno.test('resolveSecretValues - does not require secrets when requiredSecretNames is empty', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectAll: (async () => []),
    });
    mocks.getDb = (() => dbMock) as any;

    const result = await resolveSecretValues({} as any, 'repo-1', ['s1'], 'enc-key', []);
    assertEquals(result, {});
})