import * as fs from 'fs/promises';
import * as path from 'path';
import { isPathWithinBase } from '../paths.js';
import { successResult } from './process-spawner.js';
import type { StepResult, ActionContext } from './executor.js';
import { appendOutput, buildCombinedResult } from './action-result-converter.js';
import {
  type InterpolationContext,
  type ActionOutputDefinition,
  interpolateString,
  evaluateCondition,
  resolveEnv,
  resolveWith,
  resolveCompositeOutputs,
} from './composite-expression.js';

// Re-export expression utilities so existing consumers continue to work.
export {
  type InterpolationContext,
  type ActionOutputDefinition,
  resolveExpressionValue,
  interpolateString,
  evaluateCondition,
  normalizeInputValue,
  resolveEnv,
  resolveWith,
} from './composite-expression.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionStep {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  if?: string;
  shell?: string;
  'working-directory'?: string;
  'continue-on-error'?: boolean;
  'timeout-minutes'?: number;
}

export interface ActionRuns {
  using?: string;
  main?: string;
  pre?: string;
  post?: string;
  steps?: ActionStep[];
}

// ---------------------------------------------------------------------------
// Working directory resolution
// ---------------------------------------------------------------------------

export function isPathWithin(targetPath: string, basePath: string): boolean {
  return isPathWithinBase(basePath, targetPath, { resolveInputs: true });
}

async function resolveCompositeWorkingDirectory(
  workingDirectory: string | undefined,
  actionDir: string,
  context: InterpolationContext,
  workspacePath: string
): Promise<string> {
  if (!workingDirectory) {
    return workspacePath;
  }

  const interpolated = interpolateString(workingDirectory, context);
  const resolved = path.isAbsolute(interpolated)
    ? path.resolve(interpolated)
    : path.resolve(workspacePath, interpolated);

  let realWorkspacePath: string;
  let realActionPath: string;
  let realWorkingPath: string;
  try {
    [realWorkspacePath, realActionPath, realWorkingPath] = await Promise.all([
      fs.realpath(workspacePath),
      fs.realpath(actionDir),
      fs.realpath(resolved),
    ]);
  } catch {
    throw new Error(`Invalid working directory: ${workingDirectory}`);
  }

  const workingPathStats = await fs.stat(realWorkingPath).catch(() => null);
  if (!workingPathStats?.isDirectory()) {
    throw new Error(`Invalid working directory: ${workingDirectory}`);
  }

  if (isPathWithin(realWorkingPath, realWorkspacePath) || isPathWithin(realWorkingPath, realActionPath)) {
    return realWorkingPath;
  }

  throw new Error(`Invalid working directory: ${workingDirectory}`);
}

// ---------------------------------------------------------------------------
// Composite action execution
// ---------------------------------------------------------------------------

export async function executeCompositeAction(
  runs: ActionRuns,
  actionDir: string,
  inputs: Record<string, string>,
  timeout: number,
  outputs: Record<string, ActionOutputDefinition> | undefined,
  delegate: {
    executeRun(command: string, timeoutMs?: number, options?: { shell?: string; workingDirectory?: string }): Promise<StepResult>;
    executeAction(action: string, inputs: Record<string, unknown>, timeoutMs?: number, options?: { basePath?: string }): Promise<StepResult>;
    getEnv(): Record<string, string>;
    setEnv(env: Record<string, string>): void;
    getWorkspacePath(): string;
    withTemporaryEnv<T>(tempEnv: Record<string, string>, fn: () => Promise<T>): Promise<T>;
  }
): Promise<StepResult> {
  if (!runs.steps || !Array.isArray(runs.steps)) {
    return { exitCode: 1, stdout: '', stderr: 'Composite action missing "steps"', outputs: {}, conclusion: 'failure' };
  }

  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  const stepOutputs: Record<string, Record<string, string>> = {};
  let jobStatus: 'success' | 'failure' = 'success';

  for (const step of runs.steps) {
    const context: InterpolationContext = {
      inputs,
      env: delegate.getEnv(),
      steps: stepOutputs,
      jobStatus,
    };

    if (step.if && !evaluateCondition(step.if, context)) {
      continue;
    }

    const stepEnv = resolveEnv(step.env, context);
    const stepTimeout = step['timeout-minutes']
      ? step['timeout-minutes'] * 60 * 1000
      : timeout;

    const result = await delegate.withTemporaryEnv(stepEnv, async () => {
      if (step.run) {
        const command = interpolateString(step.run, context);
        const workingDirectory = await resolveCompositeWorkingDirectory(
          step['working-directory'],
          actionDir,
          context,
          delegate.getWorkspacePath()
        );
        return delegate.executeRun(command, stepTimeout, {
          shell: step.shell,
          workingDirectory,
        });
      }

      if (step.uses) {
        const usesRef = interpolateString(step.uses, context);
        const resolvedWith = resolveWith(step.with, context);
        return delegate.executeAction(usesRef, resolvedWith, stepTimeout, { basePath: actionDir });
      }

      return successResult('', {});
    });

    appendOutput(result, stdoutParts, stderrParts);

    if (step.id) {
      stepOutputs[step.id] = result.outputs || {};
    }

    const stepSuccess = result.conclusion === 'success';
    if (!stepSuccess && !step['continue-on-error']) {
      jobStatus = 'failure';
      break;
    }
  }

  const resolvedOutputs = resolveCompositeOutputs(outputs, {
    inputs,
    env: delegate.getEnv(),
    steps: stepOutputs,
    jobStatus,
  });
  return buildCombinedResult(stdoutParts, stderrParts, resolvedOutputs, jobStatus);
}
