import type { StepResult } from './executor.js';

/**
 * Append a step result's stdout/stderr to accumulator arrays.
 */
export function appendOutput(
  result: StepResult,
  stdoutParts: string[],
  stderrParts: string[]
): void {
  if (result.stdout) stdoutParts.push(result.stdout);
  if (result.stderr) stderrParts.push(result.stderr);
}

/**
 * Build a combined StepResult from accumulated stdout/stderr parts.
 */
export function buildCombinedResult(
  stdoutParts: string[],
  stderrParts: string[],
  outputs: Record<string, string>,
  conclusion: 'success' | 'failure'
): StepResult {
  return {
    exitCode: conclusion === 'success' ? 0 : 1,
    stdout: stdoutParts.join('\n').trimEnd(),
    stderr: stderrParts.join('\n').trimEnd(),
    outputs,
    conclusion,
  };
}
