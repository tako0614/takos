import * as fs from 'fs/promises';
import * as path from 'path';
import { pushLog } from '../logging.js';
import { validateCommand } from '../validation.js';
import { SANDBOX_LIMITS } from '../../shared/config.js';
import * as builtinActions from './builtin/index.js';
import { getErrorMessage } from '@takos/common/errors';
import { resolvePathWithin } from '../paths.js';
import {
  failureResult,
  successResult,
  spawnWithTimeout,
} from './process-spawner.js';
import {
  executeCompositeAction,
  type ActionRuns,
  type ActionOutputDefinition,
} from './composite-executor.js';
import { appendOutput, buildCombinedResult } from './action-result-helpers.js';
import { parseKeyValueFile, parsePathFile } from './file-parsers.js';
import {
  fetchMarketplaceRepo,
  type ActionRefInfo,
  loadActionMetadata,
  parseActionRef,
  validateActionComponent,
  resolveInputs,
  buildInputEnv,
} from './action-registry.js';

export interface StepResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  outputs: Record<string, string>;
  conclusion: 'success' | 'failure' | 'skipped';
}

export interface ActionContext {
  workspacePath: string;
  env: Record<string, string>;
  logs: string[];
  setOutput: (name: string, value: string) => void;
  setEnv: (name: string, value: string) => void;
  addPath: (path: string) => void;
}

const ACTION_SCRIPT_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
type NodeActionPhase = 'pre' | 'main' | 'post';

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

function isPathWithin(targetPath: string, basePath: string): boolean {
  const normalizedBase = process.platform === 'win32'
    ? path.resolve(basePath).toLowerCase()
    : path.resolve(basePath);
  const normalizedTarget = process.platform === 'win32'
    ? path.resolve(targetPath).toLowerCase()
    : path.resolve(targetPath);
  const relativePath = path.relative(normalizedBase, normalizedTarget);
  return relativePath === '' || relativePath === '.' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

// ---------------------------------------------------------------------------
// StepExecutor
// ---------------------------------------------------------------------------

export class StepExecutor {
  private workspacePath: string;
  private env: Record<string, string>;
  private logs: string[] = [];
  private outputs: Record<string, string> = {};

  constructor(workspacePath: string, env: Record<string, string>) {
    this.workspacePath = workspacePath;
    this.env = { ...env };
  }

  async executeRun(
    command: string,
    timeoutMs?: number,
    options?: { shell?: string; workingDirectory?: string }
  ): Promise<StepResult> {
    this.outputs = {};
    this.logs = [];

    const validationError = validateCommand(command);
    if (validationError) {
      return failureResult(`Command validation failed: ${validationError}`);
    }

    const { shell, shellArgs } = this.resolveShell(command, options?.shell);
    return spawnWithTimeout(shell, shellArgs, {
      timeout: timeoutMs || SANDBOX_LIMITS.maxExecutionTime,
      cwd: options?.workingDirectory || this.workspacePath,
    }, {
      env: this.env,
      logs: this.logs,
      outputs: this.outputs,
      workspacePath: this.workspacePath,
      parseWorkflowCommands: (text: string) => this.parseWorkflowCommands(text),
      parseKeyValueFile: (content: string) => parseKeyValueFile(content),
      parsePathFile: (content: string) => parsePathFile(content),
    });
  }

  async executeAction(
    action: string,
    inputs: Record<string, unknown>,
    timeoutMs?: number,
    options?: { basePath?: string }
  ): Promise<StepResult> {
    const timeout = timeoutMs || SANDBOX_LIMITS.maxExecutionTime;
    this.outputs = {};
    this.logs = [];
    const basePath = options?.basePath || this.workspacePath;

    try {
      const context = this.createActionContext();

      if (action.startsWith('docker://')) {
        return failureResult('Docker-based actions are not supported in takos-runtime.');
      }

      if (action.startsWith('./') || action.startsWith('.\\')) {
        return await this.executeLocalAction(action, inputs, context, timeout, basePath);
      }

      const actionRef = parseActionRef(action);

      if (actionRef.owner === 'actions') {
        const builtinResult = await this.executeBuiltinAction(actionRef.repo, inputs, context, timeout);
        if (builtinResult) {
          return builtinResult;
        }
      }

      if (!actionRef.owner || !actionRef.repo) {
        return failureResult(`Invalid action reference: ${action}`);
      }

      return await this.executeMarketplaceAction(actionRef, inputs, context, timeout);
    } catch (err) {
      return failureResult(`Action execution failed: ${getErrorMessage(err)}`, this.outputs);
    }
  }

  // -------------------------------------------------------------------------
  // Action context
  // -------------------------------------------------------------------------

  private createActionContext(): ActionContext {
    return {
      workspacePath: this.workspacePath,
      env: this.env,
      logs: this.logs,
      setOutput: (name: string, value: string) => {
        this.outputs[name] = value;
      },
      setEnv: (name: string, value: string) => {
        this.env[name] = value;
      },
      addPath: (pathToAdd: string) => {
        this.env.PATH = pathToAdd + path.delimiter + (this.env.PATH || process.env.PATH || '');
      },
    };
  }

  // -------------------------------------------------------------------------
  // Workflow command parsing
  // -------------------------------------------------------------------------

  private static readonly WORKFLOW_LOG_COMMANDS: Array<{ pattern: RegExp; format: string }> = [
    { pattern: /^::error(?:\s+[^:]*)?::(.*)$/, format: '[ERROR] ' },
    { pattern: /^::warning(?:\s+[^:]*)?::(.*)$/, format: '[WARNING] ' },
    { pattern: /^::debug::(.*)$/, format: '[DEBUG] ' },
    { pattern: /^::group::(.*)$/, format: '\n>>> ' },
  ];

  private parseWorkflowCommands(text: string): void {
    for (const line of text.split('\n')) {
      const setOutputMatch = line.match(/^::set-output\s+name=([^:]+)::(.*)$/);
      if (setOutputMatch) {
        this.outputs[setOutputMatch[1]] = setOutputMatch[2];
        continue;
      }

      // ::set-env and ::add-path are disabled (deprecated in GitHub Actions due to security issues)
      // Use file-based GITHUB_ENV / GITHUB_PATH mechanism instead

      let matched = false;
      for (const { pattern, format } of StepExecutor.WORKFLOW_LOG_COMMANDS) {
        const m = line.match(pattern);
        if (m) {
          pushLog(this.logs, `${format}${m[1]}`);
          matched = true;
          break;
        }
      }
      if (matched) continue;

      if (line === '::endgroup::') {
        pushLog(this.logs, '<<<\n');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Built-in action dispatch
  // -------------------------------------------------------------------------

  private static readonly BUILTIN_ACTIONS: Record<
    string,
    (inputs: Record<string, unknown>, context: ActionContext) => Promise<unknown>
  > = {
    'checkout': (inputs, ctx) =>
      builtinActions.checkout(inputs as { ref?: string; path?: string; repository?: string }, ctx),
    'setup-node': (inputs, ctx) =>
      builtinActions.setupNode(inputs as { 'node-version': string; cache?: 'npm' | 'pnpm' | 'yarn' }, ctx),
    'cache': (inputs, ctx) =>
      builtinActions.cache(inputs as { path: string | string[]; key: string; 'restore-keys'?: string[] }, ctx),
    'upload-artifact': (inputs, ctx) =>
      builtinActions.uploadArtifact(inputs as { name: string; path: string | string[]; 'retention-days'?: number }, ctx),
    'download-artifact': (inputs, ctx) =>
      builtinActions.downloadArtifact(inputs as { name: string; path?: string }, ctx),
  };

  private async executeBuiltinAction(
    actionName: string,
    inputs: Record<string, unknown>,
    context: ActionContext,
    _timeout: number
  ): Promise<StepResult | null> {
    const handler = StepExecutor.BUILTIN_ACTIONS[actionName];
    if (!handler) return null;

    try {
      const result = await handler(inputs, context);
      if (actionName === 'cache' && result && typeof result === 'object' && 'cacheHit' in result) {
        this.outputs['cache-hit'] = (result as { cacheHit: boolean }).cacheHit ? 'true' : 'false';
      }
      return successResult(context.logs.join('\n'), this.outputs);
    } catch (err) {
      return {
        exitCode: 1,
        stdout: context.logs.join('\n'),
        stderr: `Built-in action failed: ${getErrorMessage(err)}`,
        outputs: this.outputs,
        conclusion: 'failure',
      };
    }
  }

  // -------------------------------------------------------------------------
  // Local action execution
  // -------------------------------------------------------------------------

  private async executeLocalAction(
    actionPath: string,
    inputs: Record<string, unknown>,
    context: ActionContext,
    timeout: number,
    basePath: string
  ): Promise<StepResult> {
    const fullActionPath = resolvePathWithin(basePath, actionPath, 'action path', true);

    try {
      const realActionPath = await fs.realpath(fullActionPath);
      const realBasePath = await fs.realpath(basePath);
      if (realActionPath !== realBasePath && !realActionPath.startsWith(realBasePath + path.sep)) {
        return failureResult('Local action path escapes workspace boundary via symlink');
      }
    } catch {
      return failureResult(`Local action path not found: ${actionPath}`);
    }

    return this.executeActionFromPath(fullActionPath, inputs, context, timeout, {
      owner: '', repo: '', actionPath, ref: '',
    });
  }

  // -------------------------------------------------------------------------
  // Marketplace action execution
  // -------------------------------------------------------------------------

  private async executeMarketplaceAction(
    actionRef: ActionRefInfo,
    inputs: Record<string, unknown>,
    context: ActionContext,
    timeout: number
  ): Promise<StepResult> {
    validateActionComponent(actionRef.owner, 'owner');
    validateActionComponent(actionRef.repo, 'repo');

    const repoDir = await fetchMarketplaceRepo(actionRef, this.env);
    const actionDir = actionRef.actionPath
      ? resolvePathWithin(repoDir, actionRef.actionPath, 'action path', true)
      : repoDir;

    return this.executeActionFromPath(actionDir, inputs, context, timeout, actionRef);
  }

  // -------------------------------------------------------------------------
  // Action execution from path (dispatches by runs.using)
  // -------------------------------------------------------------------------

  private async executeActionFromPath(
    actionDir: string,
    inputs: Record<string, unknown>,
    context: ActionContext,
    timeout: number,
    actionRef?: ActionRefInfo
  ): Promise<StepResult> {
    const metadata = await loadActionMetadata(actionDir);
    const runs = metadata.runs;
    if (!runs || !runs.using) {
      return failureResult('Action metadata missing "runs.using"');
    }

    const { resolvedInputs, missing } = resolveInputs(metadata.inputs, inputs);
    if (missing.length > 0) {
      return failureResult(`Missing required inputs: ${missing.join(', ')}`);
    }

    const inputEnv = buildInputEnv(resolvedInputs);
    const previousActionEnv = this.snapshotActionEnv();

    this.env.GITHUB_ACTION_PATH = actionDir;
    if (actionRef?.owner && actionRef?.repo) {
      this.env.GITHUB_ACTION_REPOSITORY = `${actionRef.owner}/${actionRef.repo}`;
      this.env.GITHUB_ACTION_REF = actionRef.ref;
    }

    try {
      return await this.withTemporaryEnv(inputEnv, async () => {
        switch (runs.using?.toLowerCase()) {
          case 'node12':
          case 'node16':
          case 'node20':
            return this.executeNodeAction(runs, actionDir, timeout);
          case 'composite':
            return this.executeCompositeActionWrapper(runs, actionDir, resolvedInputs, timeout, metadata.outputs);
          case 'docker':
            return failureResult('Docker actions are not supported in takos-runtime.');
          default:
            return failureResult(`Unsupported action type: ${runs.using}`);
        }
      });
    } finally {
      this.restoreActionEnv(previousActionEnv);
    }
  }

  // -------------------------------------------------------------------------
  // Node action execution
  // -------------------------------------------------------------------------

  private async executeNodeAction(
    runs: ActionRuns,
    actionDir: string,
    timeout: number
  ): Promise<StepResult> {
    if (!runs.main) {
      return failureResult('JavaScript action missing "main" entry point');
    }

    const runScript = async (phase: NodeActionPhase, relativePath: string): Promise<StepResult> => {
      let scriptPath: string;
      try {
        scriptPath = await this.resolveNodeActionScriptPath(actionDir, relativePath, phase);
      } catch (err) {
        return failureResult(getErrorMessage(err));
      }
      return spawnWithTimeout('node', [scriptPath], {
        timeout,
        cwd: actionDir,
        shell: false,
      }, {
        env: this.env,
        logs: this.logs,
        outputs: this.outputs,
        workspacePath: this.workspacePath,
        parseWorkflowCommands: (text: string) => this.parseWorkflowCommands(text),
        parseKeyValueFile: (content: string) => parseKeyValueFile(content),
        parsePathFile: (content: string) => parsePathFile(content),
      });
    };

    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    const phases: Array<{ phase: NodeActionPhase; script: string | undefined }> = [
      { phase: 'pre', script: runs.pre },
      { phase: 'main', script: runs.main },
      { phase: 'post', script: runs.post },
    ];

    let mainOutputs: Record<string, string> = {};

    for (const { phase, script } of phases) {
      if (!script) continue;

      const result = await runScript(phase, script);
      appendOutput(result, stdoutParts, stderrParts);

      if (phase === 'main') {
        mainOutputs = { ...result.outputs };
      }

      if (result.exitCode !== 0) {
        return {
          exitCode: result.exitCode,
          stdout: stdoutParts.join('\n').trimEnd(),
          stderr: stderrParts.join('\n').trimEnd(),
          outputs: phase === 'pre' ? result.outputs : mainOutputs,
          conclusion: 'failure',
        };
      }
    }

    this.outputs = mainOutputs;
    return buildCombinedResult(stdoutParts, stderrParts, mainOutputs, 'success');
  }

  // -------------------------------------------------------------------------
  // Node action script path validation
  // -------------------------------------------------------------------------

  private async resolveNodeActionScriptPath(
    actionDir: string,
    scriptPath: string,
    phase: NodeActionPhase
  ): Promise<string> {
    this.validateNodeActionScriptPath(scriptPath, phase);

    const normalizedPath = path.posix.normalize(scriptPath);
    const resolvedScriptPath = resolvePathWithin(actionDir, normalizedPath, `${phase} script`);

    let realActionDir: string;
    let realScriptPath: string;
    try {
      [realActionDir, realScriptPath] = await Promise.all([
        fs.realpath(actionDir),
        fs.realpath(resolvedScriptPath),
      ]);
    } catch {
      throw new Error(`Node action ${phase} script not found: ${scriptPath}`);
    }

    if (!isPathWithin(realScriptPath, realActionDir)) {
      throw new Error(`Node action ${phase} script escapes action directory`);
    }

    const stats = await fs.stat(realScriptPath).catch(() => null);
    if (!stats?.isFile()) {
      throw new Error(`Node action ${phase} script must reference a file`);
    }

    return realScriptPath;
  }

  private static readonly SCRIPT_PATH_VALIDATORS: Array<[(p: string) => boolean, string]> = [
    [(p) => typeof p !== 'string' || p.length === 0, 'path is required'],
    [(p) => p.trim() !== p, 'path must not include leading/trailing whitespace'],
    // eslint-disable-next-line no-control-regex
    [(p) => /[\x00-\x1f\x7f]/.test(p), 'path contains control characters'],
    [(p) => /["'`]/.test(p), 'path contains disallowed quote characters'],
    [(p) => p.includes('\\'), 'path must use "/" separators'],
    [(p) => path.isAbsolute(p) || /^[A-Za-z]:/.test(p), 'path must be relative'],
    [(p) => !ACTION_SCRIPT_PATH_PATTERN.test(p), 'path contains invalid characters'],
    [(p) => { const n = path.posix.normalize(p); return n === '.' || n === '..' || n.startsWith('../') || n.includes('/../'); }, 'path traversal is not allowed'],
  ];

  private validateNodeActionScriptPath(scriptPath: string, phase: NodeActionPhase): void {
    for (const [test, message] of StepExecutor.SCRIPT_PATH_VALIDATORS) {
      if (test(scriptPath)) {
        throw new Error(`Node action ${phase} script ${message}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Shell resolution
  // -------------------------------------------------------------------------

  private static readonly ALLOWED_SHELLS = new Set([
    '/bin/bash', '/bin/sh', 'bash', 'sh',
    'cmd.exe', 'pwsh', 'powershell',
    '/usr/bin/bash', '/usr/bin/sh',
    '/usr/local/bin/bash',
  ]);

  private resolveShell(
    command: string,
    shellOverride?: string
  ): { shell: string; shellArgs: string[] } {
    if (shellOverride) {
      const shellLower = shellOverride.toLowerCase();
      const base = shellLower.split('/').pop() ?? shellLower;
      if (!StepExecutor.ALLOWED_SHELLS.has(shellLower) && !StepExecutor.ALLOWED_SHELLS.has(base)) {
        throw new Error(`Unsupported shell: ${shellOverride}. Allowed: bash, sh, pwsh`);
      }
      if (shellLower.includes('pwsh') || shellLower.includes('powershell')) {
        return { shell: shellOverride, shellArgs: ['-Command', command] };
      }
      if (shellLower.includes('cmd')) {
        return { shell: shellOverride, shellArgs: ['/c', command] };
      }
      return { shell: shellOverride, shellArgs: ['-e', '-c', command] };
    }

    const isWindows = process.platform === 'win32';
    return isWindows
      ? { shell: 'cmd.exe', shellArgs: ['/c', command] }
      : { shell: '/bin/bash', shellArgs: ['-e', '-c', command] };
  }

  // -------------------------------------------------------------------------
  // Composite action delegation
  // -------------------------------------------------------------------------

  private async executeCompositeActionWrapper(
    runs: ActionRuns,
    actionDir: string,
    inputs: Record<string, string>,
    timeout: number,
    outputs?: Record<string, ActionOutputDefinition>
  ): Promise<StepResult> {
    const delegate = {
      executeRun: (cmd: string, t?: number, opts?: { shell?: string; workingDirectory?: string }) => this.executeRun(cmd, t, opts),
      executeAction: (act: string, inp: Record<string, unknown>, t?: number, opts?: { basePath?: string }) => this.executeAction(act, inp, t, opts),
      getEnv: () => this.env,
      setEnv: (env: Record<string, string>) => { this.env = env; },
      getWorkspacePath: () => this.workspacePath,
      withTemporaryEnv: <T>(tempEnv: Record<string, string>, fn: () => Promise<T>) => this.withTemporaryEnv(tempEnv, fn),
    };

    const result = await executeCompositeAction(runs, actionDir, inputs, timeout, outputs, delegate);
    this.outputs = result.outputs;
    return result;
  }

  // -------------------------------------------------------------------------
  // Environment management
  // -------------------------------------------------------------------------

  private withTemporaryEnv<T>(tempEnv: Record<string, string>, fn: () => Promise<T>): Promise<T> {
    if (!tempEnv || Object.keys(tempEnv).length === 0) {
      return fn();
    }

    const baseEnv = { ...this.env };
    this.env = { ...this.env, ...tempEnv };

    return fn().finally(() => {
      for (const key of Object.keys(tempEnv)) {
        if (this.env[key] !== tempEnv[key]) continue;
        if (key in baseEnv) {
          this.env[key] = baseEnv[key];
        } else {
          delete this.env[key];
        }
      }
    });
  }

  private static readonly ACTION_ENV_KEYS = [
    'GITHUB_ACTION_PATH',
    'GITHUB_ACTION_REPOSITORY',
    'GITHUB_ACTION_REF',
  ] as const;

  private snapshotActionEnv(): Record<string, string | undefined> {
    const snapshot: Record<string, string | undefined> = {};
    for (const key of StepExecutor.ACTION_ENV_KEYS) {
      snapshot[key] = this.env[key];
    }
    return snapshot;
  }

  private restoreActionEnv(previous: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete this.env[key];
      } else {
        this.env[key] = value;
      }
    }
  }

}
