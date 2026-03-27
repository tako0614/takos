import type { Step } from '@takos/actions-engine';
import type { StepExecutionContext, StepExecutionResult, RuntimeStepResponse } from './workflow-types';
import { runtimeJson } from './workflow-runtime-client';

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

export async function executeStep(
  step: Step,
  context: StepExecutionContext
): Promise<StepExecutionResult> {
  if (!step.uses && !step.run) {
    return {
      success: true,
      stdout: 'No action to perform',
      outputs: {},
    };
  }

  if (!context.env.RUNTIME_HOST) {
    return {
      success: false,
      error: 'RUNTIME_HOST binding is required',
    };
  }

  return executeViaRuntime(step, context);
}

async function executeViaRuntime(
  step: Step,
  context: StepExecutionContext
): Promise<StepExecutionResult> {
  const result = await runtimeJson<RuntimeStepResponse>(
    context.env,
    `/actions/jobs/${context.jobId}/step/${context.stepNumber}`,
    context.spaceId,
    {
      run: step.run,
      uses: step.uses,
      with: step.with,
      env: step.env,
      name: step.name,
      shell: context.shell,
      'working-directory': context.workingDirectory,
      'continue-on-error': step['continue-on-error'],
      'timeout-minutes': step['timeout-minutes'],
    }
  );

  const success = result.conclusion !== 'failure';

  return {
    success,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    error: success ? undefined : result.stderr || 'Step failed',
    outputs: result.outputs || {},
  };
}
