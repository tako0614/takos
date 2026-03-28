import { Hono } from 'hono';
import type {
  RunExecutorExecutionEnv,
  RunExecutorRuntimeConfig,
  StartPayload,
} from '@takos/agent-core/run-executor';
import {
  parseStartPayload,
  createConcurrencyGuard,
  type ConcurrencyGuard,
} from '@takos/agent-core/executor-utils';

type ExecutorLogger = {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
};

function readBooleanEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function buildExecutorRuntimeConfig(
  env: Record<string, string | undefined>,
): RunExecutorRuntimeConfig {
  const executionEnv: RunExecutorExecutionEnv = {
    ADMIN_DOMAIN: env.ADMIN_DOMAIN,
    TENANT_BASE_DOMAIN: env.TENANT_BASE_DOMAIN,
    MAX_AGENT_ITERATIONS: env.MAX_AGENT_ITERATIONS,
    AGENT_TEMPERATURE: env.AGENT_TEMPERATURE,
    AGENT_RATE_LIMIT: env.AGENT_RATE_LIMIT,
    AGENT_ITERATION_TIMEOUT: env.AGENT_ITERATION_TIMEOUT,
    AGENT_TOTAL_TIMEOUT: env.AGENT_TOTAL_TIMEOUT,
    TOOL_EXECUTION_TIMEOUT: env.TOOL_EXECUTION_TIMEOUT,
    LANGGRAPH_TIMEOUT: env.LANGGRAPH_TIMEOUT,
    SERPER_API_KEY: env.SERPER_API_KEY,
  };

  const maxRunDurationMs = typeof env.AGENT_TOTAL_TIMEOUT === 'string'
    ? Number.parseInt(env.AGENT_TOTAL_TIMEOUT, 10)
    : undefined;

  return {
    controlRpcBaseUrl: env.CONTROL_RPC_BASE_URL,
    allowNoLlmFallback: readBooleanEnv(env.TAKOS_ALLOW_NO_LLM ?? env.TAKOS_LOCAL_ALLOW_NO_LLM),
    maxRunDurationMs: Number.isFinite(maxRunDurationMs) ? maxRunDurationMs : undefined,
    executionEnv,
  };
}

export function hasControlRpcConfiguration(runtimeConfig: RunExecutorRuntimeConfig): boolean {
  return Boolean(runtimeConfig.controlRpcBaseUrl);
}

export function buildRuntimeStartPayload(
  payload: StartPayload,
  runtimeConfig: RunExecutorRuntimeConfig,
  shutdownSignal?: AbortSignal,
): StartPayload {
  return {
    ...payload,
    controlRpcBaseUrl: runtimeConfig.controlRpcBaseUrl,
    shutdownSignal,
  };
}

export function createExecutorApp(options: {
  executeRunInContainer: (payload: StartPayload) => Promise<void>;
  logger: ExecutorLogger;
  concurrency?: ConcurrencyGuard;
  shutdownSignal?: AbortSignal;
  runtimeConfig?: RunExecutorRuntimeConfig;
}): Hono {
  const concurrency = options.concurrency ?? createConcurrencyGuard(5);
  const runtimeConfig = options.runtimeConfig ?? buildExecutorRuntimeConfig(process.env as Record<string, string | undefined>);
  const app = new Hono();

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      service: 'takos-executor',
      runs: {
        active: concurrency.activeRuns,
        max: concurrency.maxConcurrentRuns,
        available: concurrency.available,
      },
    });
  });

  app.post('/start', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON body' }, 400);
    }

    const parseResult = parseStartPayload(body);
    if (!parseResult.ok) {
      return c.json({ error: parseResult.error }, 400);
    }

    if (!concurrency.tryAcquire()) {
      return c.json({
        error: 'At capacity',
        active: concurrency.activeRuns,
        max: concurrency.maxConcurrentRuns,
      }, 503);
    }

    if (!hasControlRpcConfiguration(runtimeConfig)) {
      concurrency.release();
      return c.json({ error: 'CONTROL_RPC_BASE_URL not configured' }, 503);
    }

    const payload = buildRuntimeStartPayload(
      parseResult.payload,
      runtimeConfig,
      options.shutdownSignal,
    );

    options.executeRunInContainer(payload)
      .catch((err) => {
        options.logger.error(`[executor] Unhandled error for run ${payload.runId}`, { error: err });
      })
      .finally(() => {
        concurrency.release();
      });

    return c.json({ status: 'accepted', runId: payload.runId }, 202);
  });

  return app;
}
