/**
 * Placeholder control-agent runner for the executor container image.
 *
 * The executor service injects this `executeRun` as the agent-execution entry
 * point for a run. This default implementation rejects: self-hosters that want
 * in-container agent execution replace this module with their own runner that
 * matches the `ExecuteRunFn` signature in agent-core/run-executor.ts.
 */
export function executeRun(
  _env: Record<string, unknown>,
  _apiKey: string | undefined,
  _runId: string,
  _model: string | undefined,
  _options: { abortSignal?: AbortSignal; runIo: unknown },
): Promise<void> {
  return Promise.reject(
    new Error(
      "No control-agent runner is wired into this executor container. " +
        "Provide your own agent runner in containers/executor/control-agent-runner.ts " +
        "to enable in-container agent execution.",
    ),
  );
}
