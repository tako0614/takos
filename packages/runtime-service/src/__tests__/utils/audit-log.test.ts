// Mock fs/promises and logger before importing the module under test.
// Each test uses /* modules reset (no-op in Deno) */ void 0 + dynamic import to get fresh module state
// (the module caches `dirEnsured` at module scope).

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mockAppendFile = ((..._args: any[]) => undefined) as any;
const mockMkdir = ((..._args: any[]) => undefined) as any;
const mockStat = ((..._args: any[]) => undefined) as any;
const mockRename = ((..._args: any[]) => undefined) as any;
const mockUnlink = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from 'node:fs/promises'
// [Deno] vi.mock removed - manually stub imports from 'takos-common/logger'
async function freshWriteAuditLog() {
  /* modules reset (no-op in Deno) */ void 0;
  const mod = await import('../../utils/audit-log.ts');
  return mod.writeAuditLog;
}

  Deno.test('writeAuditLog - writes audit entry as JSONL', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockMkdir = (async () => undefined) as any;
  mockStat = (async () => { throw new Error('ENOENT'); }) as any;
  mockAppendFile = (async () => undefined) as any;
  const writeAuditLog = await freshWriteAuditLog();

    await writeAuditLog({
      timestamp: '2024-01-01T00:00:00Z',
      event: 'exec',
      spaceId: 'ws1',
      command: 'echo hello',
      status: 'completed',
    });

    assertSpyCalls(mockAppendFile, 1);
    const writtenLine = mockAppendFile.calls[0][1] as string;
    assertEquals(writtenLine.endsWith('\n'), true);
    const parsed = JSON.parse(writtenLine.trim());
    assertEquals(parsed.event, 'exec');
    assertEquals(parsed.spaceId, 'ws1');
    assertEquals(parsed.command, 'echo hello');
})
  Deno.test('writeAuditLog - redacts credentials in URLs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockMkdir = (async () => undefined) as any;
  mockStat = (async () => { throw new Error('ENOENT'); }) as any;
  mockAppendFile = (async () => undefined) as any;
  const writeAuditLog = await freshWriteAuditLog();

    await writeAuditLog({
      timestamp: '2024-01-01T00:00:00Z',
      event: 'exec',
      spaceId: 'ws1',
      command: 'git clone https://user:password@github.com/repo.git',
      status: 'started',
    });

    const writtenLine = mockAppendFile.calls[0][1] as string;
    const parsed = JSON.parse(writtenLine.trim());
    assert(!(parsed.command).includes('password'));
    assertStringIncludes(parsed.command, '***@');
})
  Deno.test('writeAuditLog - redacts Authorization header values', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockMkdir = (async () => undefined) as any;
  mockStat = (async () => { throw new Error('ENOENT'); }) as any;
  mockAppendFile = (async () => undefined) as any;
  const writeAuditLog = await freshWriteAuditLog();

    await writeAuditLog({
      timestamp: '2024-01-01T00:00:00Z',
      event: 'exec',
      spaceId: 'ws1',
      command: 'curl -H "Authorization: Bearer my-secret-token" https://api.com',
      status: 'started',
    });

    const writtenLine = mockAppendFile.calls[0][1] as string;
    const parsed = JSON.parse(writtenLine.trim());
    assert(!(parsed.command).includes('my-secret-token'));
    assertStringIncludes(parsed.command, 'Authorization: ***');
})
  Deno.test('writeAuditLog - redacts SECRET_KEY=value patterns', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockMkdir = (async () => undefined) as any;
  mockStat = (async () => { throw new Error('ENOENT'); }) as any;
  mockAppendFile = (async () => undefined) as any;
  const writeAuditLog = await freshWriteAuditLog();

    await writeAuditLog({
      timestamp: '2024-01-01T00:00:00Z',
      event: 'exec',
      spaceId: 'ws1',
      command: 'SECRET_KEY=mysecret npm start',
      status: 'started',
    });

    const writtenLine = mockAppendFile.calls[0][1] as string;
    const parsed = JSON.parse(writtenLine.trim());
    assert(!(parsed.command).includes('mysecret'));
    assertStringIncludes(parsed.command, 'SECRET_KEY=***');
})
  Deno.test('writeAuditLog - redacts commands array', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockMkdir = (async () => undefined) as any;
  mockStat = (async () => { throw new Error('ENOENT'); }) as any;
  mockAppendFile = (async () => undefined) as any;
  const writeAuditLog = await freshWriteAuditLog();

    await writeAuditLog({
      timestamp: '2024-01-01T00:00:00Z',
      event: 'exec',
      spaceId: 'ws1',
      commands: [
        'curl -H "Authorization: Bearer token1"',
        'echo TOKEN=secret123',
      ],
      status: 'started',
    });

    const writtenLine = mockAppendFile.calls[0][1] as string;
    const parsed = JSON.parse(writtenLine.trim());
    assert(!(parsed.commands[0]).includes('token1'));
    assertStringIncludes(parsed.commands[1], 'TOKEN=***');
})
  Deno.test('writeAuditLog - does not throw on write failure', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockMkdir = (async () => undefined) as any;
  mockStat = (async () => { throw new Error('ENOENT'); }) as any;
  mockAppendFile = (async () => undefined) as any;
  mockAppendFile = (async () => { throw new Error('write failed'); }) as any;
    const writeAuditLog = await freshWriteAuditLog();

    await await writeAuditLog({
      timestamp: '2024-01-01T00:00:00Z',
      event: 'exec',
      spaceId: 'ws1',
      status: 'started',
    });
})
  Deno.test('writeAuditLog - ensures directory is created on first call', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockMkdir = (async () => undefined) as any;
  mockStat = (async () => { throw new Error('ENOENT'); }) as any;
  mockAppendFile = (async () => undefined) as any;
  const writeAuditLog = await freshWriteAuditLog();

    await writeAuditLog({
      timestamp: '2024-01-01T00:00:00Z',
      event: 'exec',
      spaceId: 'ws1',
      status: 'started',
    });

    assert(mockMkdir.calls.length > 0);
})