import * as fs from 'fs/promises';
import * as os from 'os';
import path from 'path';
// [Deno] vi.mock removed - manually stub imports from '../../../runtime/actions/sandbox.ts'
// [Deno] vi.mock removed - manually stub imports from '../../../runtime/actions/builtin/index.ts'
// [Deno] vi.mock removed - manually stub imports from '../../../shared/config.ts'
import { StepExecutor } from '../../../runtime/actions/executor.ts';

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';

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


  Deno.test('StepExecutor composite working-directory boundary checks - fails when working-directory symlink resolves outside workspace/action boundary', async () => {
  const workspaceDir = await createTempDir('takos-executor-ws-');
    const outsideDir = await createTempDir('takos-executor-outside-');
    const actionDir = path.join(workspaceDir, 'action');
    const escapeLink = path.join(workspaceDir, 'escape-link');

    try {
      await fs.symlink(outsideDir, escapeLink);
      await writeCompositeAction(actionDir, 'escape-link');

      const executor = new StepExecutor(workspaceDir, { PATH: process.env.PATH || '' });
      const result = await executor.executeAction('./action', {});

      assertEquals(result.conclusion, 'failure');
      assertStringIncludes(result.stderr, 'Invalid working directory');
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
})
  Deno.test('StepExecutor composite working-directory boundary checks - allows symlinked working-directory when the resolved path stays inside workspace', async () => {
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

      assertEquals(result.conclusion, 'success');
      assertEquals(result.exitCode, 0);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
})

  Deno.test('StepExecutor node action script boundary checks - fails when the main script symlink resolves outside action directory', async () => {
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

      assertEquals(result.conclusion, 'failure');
      assertStringIncludes(result.stderr, 'Node action main script escapes action directory');
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
})