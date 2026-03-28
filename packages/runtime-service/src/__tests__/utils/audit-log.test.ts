import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fs/promises and logger before importing the module under test.
// Each test uses vi.resetModules() + dynamic import to get fresh module state
// (the module caches `dirEnsured` at module scope).

const mockAppendFile = vi.fn();
const mockMkdir = vi.fn();
const mockStat = vi.fn();
const mockRename = vi.fn();
const mockUnlink = vi.fn();

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    appendFile: (...args: any[]) => mockAppendFile(...args),
    mkdir: (...args: any[]) => mockMkdir(...args),
    stat: (...args: any[]) => mockStat(...args),
    rename: (...args: any[]) => mockRename(...args),
    unlink: (...args: any[]) => mockUnlink(...args),
  };
});

vi.mock('@takoserver/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

async function freshWriteAuditLog() {
  vi.resetModules();
  const mod = await import('../../utils/audit-log.js');
  return mod.writeAuditLog;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockStat.mockRejectedValue(new Error('ENOENT'));
  mockAppendFile.mockResolvedValue(undefined);
});

describe('writeAuditLog', () => {
  it('writes audit entry as JSONL', async () => {
    const writeAuditLog = await freshWriteAuditLog();

    await writeAuditLog({
      timestamp: '2024-01-01T00:00:00Z',
      event: 'exec',
      spaceId: 'ws1',
      command: 'echo hello',
      status: 'completed',
    });

    expect(mockAppendFile).toHaveBeenCalledOnce();
    const writtenLine = mockAppendFile.mock.calls[0][1] as string;
    expect(writtenLine.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(writtenLine.trim());
    expect(parsed.event).toBe('exec');
    expect(parsed.spaceId).toBe('ws1');
    expect(parsed.command).toBe('echo hello');
  });

  it('redacts credentials in URLs', async () => {
    const writeAuditLog = await freshWriteAuditLog();

    await writeAuditLog({
      timestamp: '2024-01-01T00:00:00Z',
      event: 'exec',
      spaceId: 'ws1',
      command: 'git clone https://user:password@github.com/repo.git',
      status: 'started',
    });

    const writtenLine = mockAppendFile.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenLine.trim());
    expect(parsed.command).not.toContain('password');
    expect(parsed.command).toContain('***@');
  });

  it('redacts Authorization header values', async () => {
    const writeAuditLog = await freshWriteAuditLog();

    await writeAuditLog({
      timestamp: '2024-01-01T00:00:00Z',
      event: 'exec',
      spaceId: 'ws1',
      command: 'curl -H "Authorization: Bearer my-secret-token" https://api.com',
      status: 'started',
    });

    const writtenLine = mockAppendFile.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenLine.trim());
    expect(parsed.command).not.toContain('my-secret-token');
    expect(parsed.command).toContain('Authorization: ***');
  });

  it('redacts SECRET_KEY=value patterns', async () => {
    const writeAuditLog = await freshWriteAuditLog();

    await writeAuditLog({
      timestamp: '2024-01-01T00:00:00Z',
      event: 'exec',
      spaceId: 'ws1',
      command: 'SECRET_KEY=mysecret npm start',
      status: 'started',
    });

    const writtenLine = mockAppendFile.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenLine.trim());
    expect(parsed.command).not.toContain('mysecret');
    expect(parsed.command).toContain('SECRET_KEY=***');
  });

  it('redacts commands array', async () => {
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

    const writtenLine = mockAppendFile.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenLine.trim());
    expect(parsed.commands[0]).not.toContain('token1');
    expect(parsed.commands[1]).toContain('TOKEN=***');
  });

  it('does not throw on write failure', async () => {
    mockAppendFile.mockRejectedValue(new Error('write failed'));
    const writeAuditLog = await freshWriteAuditLog();

    await expect(writeAuditLog({
      timestamp: '2024-01-01T00:00:00Z',
      event: 'exec',
      spaceId: 'ws1',
      status: 'started',
    })).resolves.not.toThrow();
  });

  it('ensures directory is created on first call', async () => {
    const writeAuditLog = await freshWriteAuditLog();

    await writeAuditLog({
      timestamp: '2024-01-01T00:00:00Z',
      event: 'exec',
      spaceId: 'ws1',
      status: 'started',
    });

    expect(mockMkdir).toHaveBeenCalled();
  });
});
