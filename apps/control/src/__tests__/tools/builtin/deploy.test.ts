import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

vi.mock('@/services/source/apps', () => ({
  deployFrontendFromWorkspace: vi.fn(),
}));

import { deployFrontendHandler, DEPLOY_FRONTEND, DEPLOY_TOOLS } from '@/tools/builtin/deploy';
import { deployFrontendFromWorkspace } from '@/services/source/apps';

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

describe('deploy tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DEPLOY_FRONTEND definition', () => {
    it('has the correct name and required params', () => {
      expect(DEPLOY_FRONTEND.name).toBe('deploy_frontend');
      expect(DEPLOY_FRONTEND.category).toBe('deploy');
      expect(DEPLOY_FRONTEND.parameters.required).toEqual(['app_name']);
    });
  });

  describe('DEPLOY_TOOLS', () => {
    it('exports the deploy_frontend tool', () => {
      expect(DEPLOY_TOOLS).toHaveLength(1);
      expect(DEPLOY_TOOLS[0].name).toBe('deploy_frontend');
    });
  });

  describe('deployFrontendHandler', () => {
    it('deploys from workspace with defaults', async () => {
      vi.mocked(deployFrontendFromWorkspace).mockResolvedValue({
        appName: 'my-app',
        uploaded: 5,
        url: 'https://my-app.takos.dev',
      });

      const result = await deployFrontendHandler(
        { app_name: 'my-app' },
        makeContext(),
      );

      expect(result).toContain('Frontend deployed.');
      expect(result).toContain('App: my-app');
      expect(result).toContain('Files: 5');
      expect(result).toContain('URL: https://my-app.takos.dev');

      expect(deployFrontendFromWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          spaceId: 'ws-test',
          appName: 'my-app',
          distPath: 'dist',
          clear: false,
          description: null,
          icon: null,
        }),
      );
    });

    it('uses caller spaceId even if not in args', async () => {
      vi.mocked(deployFrontendFromWorkspace).mockResolvedValue({
        appName: 'app',
        uploaded: 1,
        url: 'https://app.takos.dev',
      });

      await deployFrontendHandler(
        { app_name: 'app' },
        makeContext({ spaceId: 'enforced-space' }),
      );

      expect(deployFrontendFromWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ spaceId: 'enforced-space' }),
      );
    });

    it('passes custom dist_path, clear, description, icon', async () => {
      vi.mocked(deployFrontendFromWorkspace).mockResolvedValue({
        appName: 'app',
        uploaded: 10,
        url: 'https://app.takos.dev',
      });

      await deployFrontendHandler(
        {
          app_name: 'app',
          dist_path: 'build/out',
          clear: true,
          description: 'My desc',
          icon: '🚀',
        },
        makeContext(),
      );

      expect(deployFrontendFromWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          distPath: 'build/out',
          clear: true,
          description: 'My desc',
          icon: '🚀',
        }),
      );
    });

    it('trims app_name whitespace', async () => {
      vi.mocked(deployFrontendFromWorkspace).mockResolvedValue({
        appName: 'trimmed',
        uploaded: 1,
        url: 'https://trimmed.takos.dev',
      });

      await deployFrontendHandler(
        { app_name: '  trimmed  ' },
        makeContext(),
      );

      expect(deployFrontendFromWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ appName: 'trimmed' }),
      );
    });
  });
});
