import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/db', () => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    get: vi.fn(async () => null),
    all: vi.fn(async () => []),
  };

  return {
    getDb: () => ({
      select: vi.fn(() => chain),
    }),
    sessionRepos: { sessionId: 'session_id', repoId: 'repo_id', isPrimary: 'is_primary' },
    sessions: { id: 'id', repoId: 'repo_id' },
  };
});

vi.mock('@/services/execution/runtime', () => ({
  callRuntimeRequest: vi.fn(),
}));

vi.mock('@/services/offload/usage-client', () => ({
  emitRunUsageEvent: vi.fn().mockResolvedValue(undefined),
}));

import { runtimeExecHandler, runtimeStatusHandler, RUNTIME_EXEC, RUNTIME_STATUS, RUNTIME_TOOLS } from '@/tools/builtin/runtime';
import { callRuntimeRequest } from '@/services/execution/runtime';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    sessionId: 'session-1',
    env: { RUNTIME_HOST: 'runtime.example.internal' } as unknown as Env,
    db: {} as D1Database,
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

function mockResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runtime tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('RUNTIME_EXEC definition', () => {
    it('has correct name and required params', () => {
      expect(RUNTIME_EXEC.name).toBe('runtime_exec');
      expect(RUNTIME_EXEC.category).toBe('runtime');
      expect(RUNTIME_EXEC.parameters.required).toEqual(['commands']);
    });
  });

  describe('RUNTIME_STATUS definition', () => {
    it('has correct name and required params', () => {
      expect(RUNTIME_STATUS.name).toBe('runtime_status');
      expect(RUNTIME_STATUS.parameters.required).toEqual(['runtime_id']);
    });
  });

  describe('RUNTIME_TOOLS', () => {
    it('exports both runtime tools', () => {
      expect(RUNTIME_TOOLS).toHaveLength(2);
      expect(RUNTIME_TOOLS.map(t => t.name)).toEqual(['runtime_exec', 'runtime_status']);
    });
  });

  describe('runtimeExecHandler', () => {
    it('executes commands successfully', async () => {
      vi.mocked(callRuntimeRequest).mockResolvedValue(
        mockResponse({ success: true, exit_code: 0, output: 'hello world' }),
      );

      const result = await runtimeExecHandler(
        { commands: ['echo hello'] },
        makeContext(),
      );

      expect(result).toContain('Commands completed successfully');
      expect(result).toContain('hello world');
    });

    it('returns failure output when command fails', async () => {
      vi.mocked(callRuntimeRequest).mockResolvedValue(
        mockResponse({ success: false, exit_code: 1, output: 'error output' }),
      );

      const result = await runtimeExecHandler(
        { commands: ['false'] },
        makeContext(),
      );

      expect(result).toContain('Commands failed');
      expect(result).toContain('exit code 1');
      expect(result).toContain('error output');
    });

    it('throws when RUNTIME_HOST is not configured', async () => {
      await expect(
        runtimeExecHandler(
          { commands: ['echo hi'] },
          makeContext({ env: {} as Env }),
        ),
      ).rejects.toThrow('RUNTIME_HOST binding is required');
    });

    it('throws when no container session is active', async () => {
      await expect(
        runtimeExecHandler(
          { commands: ['echo hi'] },
          makeContext({ sessionId: undefined }),
        ),
      ).rejects.toThrow(/container/i);
    });

    it('throws on runtime error response', async () => {
      vi.mocked(callRuntimeRequest).mockResolvedValue(
        mockResponse({ error: 'Service unavailable' }, false, 503),
      );

      await expect(
        runtimeExecHandler(
          { commands: ['echo hi'] },
          makeContext(),
        ),
      ).rejects.toThrow('Service unavailable');
    });

    // Validation tests
    it('rejects empty commands array', async () => {
      await expect(
        runtimeExecHandler({ commands: [] }, makeContext()),
      ).rejects.toThrow('non-empty array');
    });

    it('rejects non-string commands', async () => {
      await expect(
        runtimeExecHandler({ commands: ['valid', ''] }, makeContext()),
      ).rejects.toThrow('non-empty string');
    });

    it('rejects path traversal in working_dir', async () => {
      await expect(
        runtimeExecHandler(
          { commands: ['ls'], working_dir: '../etc' },
          makeContext(),
        ),
      ).rejects.toThrow('path traversal');
    });

    it('rejects null bytes in working_dir', async () => {
      await expect(
        runtimeExecHandler(
          { commands: ['ls'], working_dir: 'foo\0bar' },
          makeContext(),
        ),
      ).rejects.toThrow('null bytes');
    });

    it('rejects dangerous commands like fork bombs', async () => {
      await expect(
        runtimeExecHandler(
          { commands: [':(){ :|:& }'] },
          makeContext(),
        ),
      ).rejects.toThrow('Dangerous command');
    });

    it('rejects reboot commands', async () => {
      await expect(
        runtimeExecHandler(
          { commands: ['reboot'] },
          makeContext(),
        ),
      ).rejects.toThrow('Dangerous command');
    });

    it('rejects shutdown commands', async () => {
      await expect(
        runtimeExecHandler(
          { commands: ['shutdown -h now'] },
          makeContext(),
        ),
      ).rejects.toThrow('Dangerous command');
    });

    it('clamps timeout to max of 1800', async () => {
      vi.mocked(callRuntimeRequest).mockResolvedValue(
        mockResponse({ success: true, exit_code: 0, output: 'ok' }),
      );

      await runtimeExecHandler(
        { commands: ['echo hi'], timeout: 99999 },
        makeContext(),
      );

      expect(callRuntimeRequest).toHaveBeenCalledWith(
        expect.anything(),
        '/session/exec',
        expect.objectContaining({
          body: expect.objectContaining({
            timeout: 1800,
          }),
        }),
      );
    });
  });

  describe('runtimeStatusHandler', () => {
    it('returns runtime status when found', async () => {
      vi.mocked(callRuntimeRequest).mockResolvedValue(
        mockResponse({
          runtime_id: 'rt-1',
          status: 'completed',
          exit_code: 0,
          output: 'done',
        }),
      );

      const result = await runtimeStatusHandler(
        { runtime_id: 'rt-1' },
        makeContext(),
      );

      expect(result).toContain('Runtime: rt-1');
      expect(result).toContain('Status: completed');
      expect(result).toContain('Exit Code: 0');
      expect(result).toContain('done');
    });

    it('returns not found for 404', async () => {
      vi.mocked(callRuntimeRequest).mockResolvedValue(
        mockResponse({}, false, 404),
      );

      const result = await runtimeStatusHandler(
        { runtime_id: 'missing' },
        makeContext(),
      );

      expect(result).toContain('not found: missing');
    });

    it('throws when RUNTIME_HOST is not configured', async () => {
      await expect(
        runtimeStatusHandler(
          { runtime_id: 'rt-1' },
          makeContext({ env: {} as Env }),
        ),
      ).rejects.toThrow('RUNTIME_HOST binding is required');
    });

    it('throws on error responses', async () => {
      vi.mocked(callRuntimeRequest).mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error'),
      } as unknown as Response);

      await expect(
        runtimeStatusHandler({ runtime_id: 'rt-1' }, makeContext()),
      ).rejects.toThrow('Failed to get status');
    });

    it('includes error output in status text', async () => {
      vi.mocked(callRuntimeRequest).mockResolvedValue(
        mockResponse({
          runtime_id: 'rt-1',
          status: 'failed',
          error: 'OOM killed',
        }),
      );

      const result = await runtimeStatusHandler(
        { runtime_id: 'rt-1' },
        makeContext(),
      );

      expect(result).toContain('OOM killed');
    });
  });
});
