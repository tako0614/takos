/**
 * Type declaration for @takos/control-agent/agent-runner.
 *
 * Architecture note: executeRun lives in takos-control because it depends on
 * the full agent runtime (AgentRunner, tools, LLM clients, database layer —
 * 25+ files, ~5,900 LOC). Extracting to a shared package would require moving
 * all transitive dependencies.
 *
 * Instead, @takos/agent-core uses dependency injection: executeRunInContainer()
 * accepts executeRun as a function parameter (RunExecutorOptions.executeRun).
 * Consumer apps depend on the thin domain package @takos/control-agent,
 * keeping the runtime decoupled from takos-control's internal layout.
 */
declare module '@takos/control-agent/agent-runner' {
  export function executeRun(
    env: Record<string, unknown>,
    apiKey: string | undefined,
    runId: string,
    model: string | undefined,
    options: {
      abortSignal?: AbortSignal;
      runIo: unknown;
    }
  ): Promise<void>;
}
