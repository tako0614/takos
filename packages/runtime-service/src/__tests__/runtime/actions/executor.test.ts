import * as fs from 'fs/promises';
import * as os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../runtime/actions/sandbox.js', () => ({
  validateCommand: vi.fn(() => null),
}));

vi.mock('../../../runtime/actions/builtin/index.js', () => ({
  checkout: vi.fn(),
  setupNode: vi.fn(),
  cache: vi.fn(),
  uploadArtifact: vi.fn(),
  downloadArtifact: vi.fn(),
}));

vi.mock('../../../shared/config.js', () => ({
  REPOS_BASE_DIR: '/tmp/takos-runtime-test-repos',
  WORKDIR_BASE_DIR: '/tmp',
  MAX_LOG_LINES: 100_000,
  ALLOWED_COMMANDS_SET: new Set(['node', 'npm', 'git', 'bash', 'sh', 'echo', 'ls', 'cat']),
  COMMAND_BLOCKLIST_PATTERNS: [],
  MAX_CONCURRENT_EXEC_PER_WORKSPACE: 5,
  GIT_ENDPOINT_URL: 'https://git.takos.dev',
  TAKOS_API_URL: 'https://test.takos.jp',
  HEARTBEAT_INTERVAL_MS: 30_000,
  R2_BUCKET: 'test-bucket',
  SANDBOX_LIMITS: {
    maxExecutionTime: 30_000,
    maxOutputSize: 1024 * 1024,
  },
}));

import { StepExecutor } from '../../../runtime/actions/executor.js';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeCompositeAction(actionDir: string, workingDirectory: string): Promise<void> {
  const actionContent = `name: test-action
runs:
  using: composite
  steps:
    - run: echo hello
      working-directory: ${workingDirectory}
`;
  await fs.mkdir(actionDir, { recursive: true });
  await fs.writeFile(path.join(actionDir, 'action.yml'), actionContent, 'utf-8');
}

async function writeNodeAction(actionDir: string, main: string): Promise<void> {
  const actionContent = `name: test-node-action
runs:
  using: node20
  main: ${main}
`;
  await fs.mkdir(actionDir, { recursive: true });
  await fs.writeFile(path.join(actionDir, 'action.yml'), actionContent, 'utf-8');
}

describe('StepExecutor composite working-directory boundary checks', () => {
  it('fails when working-directory symlink resolves outside workspace/action boundary', async () => {
    const workspaceDir = await createTempDir('takos-executor-ws-');
    const outsideDir = await createTempDir('takos-executor-outside-');
    const actionDir = path.join(workspaceDir, 'action');
    const escapeLink = path.join(workspaceDir, 'escape-link');

    try {
      await fs.symlink(outsideDir, escapeLink);
      await writeCompositeAction(actionDir, 'escape-link');

      const executor = new StepExecutor(workspaceDir, { PATH: process.env.PATH || '' });
      const result = await executor.executeAction('./action', {});

      expect(result.conclusion).toBe('failure');
      expect(result.stderr).toContain('Invalid working directory');
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('allows symlinked working-directory when the resolved path stays inside workspace', async () => {
    const workspaceDir = await createTempDir('takos-executor-safe-ws-');
    const actionDir = path.join(workspaceDir, 'action');
    const safeTargetDir = path.join(workspaceDir, 'safe-target');
    const safeLink = path.join(workspaceDir, 'safe-link');

    try {
      await fs.mkdir(safeTargetDir, { recursive: true });
      await fs.symlink(safeTargetDir, safeLink);
      await writeCompositeAction(actionDir, 'safe-link');

      const executor = new StepExecutor(workspaceDir, { PATH: process.env.PATH || '' });
      const result = await executor.executeAction('./action', {});

      expect(result.conclusion).toBe('success');
      expect(result.exitCode).toBe(0);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});

describe('StepExecutor node action script boundary checks', () => {
  it('fails when the main script symlink resolves outside action directory', async () => {
    const workspaceDir = await createTempDir('takos-executor-node-ws-');
    const outsideDir = await createTempDir('takos-executor-node-outside-');
    const actionDir = path.join(workspaceDir, 'action');
    const outsideScript = path.join(outsideDir, 'main.js');
    const scriptLink = path.join(actionDir, 'main.js');

    try {
      await fs.mkdir(actionDir, { recursive: true });
      await fs.writeFile(outsideScript, 'console.log("outside");\n', 'utf-8');
      await fs.symlink(outsideScript, scriptLink);
      await writeNodeAction(actionDir, 'main.js');

      const executor = new StepExecutor(workspaceDir, { PATH: process.env.PATH || '' });
      const result = await executor.executeAction('./action', {});

      expect(result.conclusion).toBe('failure');
      expect(result.stderr).toContain('Node action main script escapes action directory');
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
