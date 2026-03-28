import { serve } from '@hono/node-server';
import { createLogger } from 'takos-common/logger';
import { parseIntEnv } from 'takos-common/env-parse';
import { executeRunInContainer as sharedExecuteRun } from 'takos-agent-core/run-executor';
import type { StartPayload } from 'takos-agent-core/run-executor';
import {
  createConcurrencyGuard,
  installGracefulShutdown,
  type ConcurrencyGuard,
} from 'takos-agent-core/executor-utils';
import { executeRun } from 'takos-control/agent/public-runner';
import {
  buildExecutorRuntimeConfig,
  createExecutorApp,
  hasControlRpcConfiguration,
} from './executor-config.js';

export type ExecutorServiceOptions = {
  port?: number;
  maxConcurrentRuns?: number;
  shutdownGraceMs?: number;
  serviceName?: string;
  concurrency?: ConcurrencyGuard;
};

export function createExecutorServiceApp(options: ExecutorServiceOptions = {}) {
  const serviceName = options.serviceName ?? 'takos-executor';
  const logger = createLogger({ service: serviceName });
  const runtimeConfig = buildExecutorRuntimeConfig(process.env as Record<string, string | undefined>);
  const concurrency = options.concurrency ?? createConcurrencyGuard(
    options.maxConcurrentRuns ?? parseIntEnv('MAX_CONCURRENT_RUNS', 5, { min: 1 }),
  );
  const shutdownController = new AbortController();

  async function executeRunInContainer(payload: StartPayload): Promise<void> {
    return sharedExecuteRun(payload, {
      serviceName,
      logger,
      executeRun,
      runtimeConfig,
    });
  }

  const app = createExecutorApp({
    executeRunInContainer,
    logger,
    concurrency,
    shutdownSignal: shutdownController.signal,
    runtimeConfig,
  });

  return { app, logger, concurrency, shutdownController, runtimeConfig };
}

export function startExecutorService(options: ExecutorServiceOptions = {}) {
  const port = options.port ?? parseIntEnv('PORT', 8080, { min: 1, max: 65535 });
  // 30 s grace period — longer than browser-service (15 s) because in-flight
  // agent runs need time to reach a safe checkpoint before forced termination.
  const gracePeriodMs = options.shutdownGraceMs ?? parseIntEnv('SHUTDOWN_GRACE_MS', 30000, { min: 0 });
  const { app, logger, concurrency, shutdownController, runtimeConfig } = createExecutorServiceApp(options);

  const server = serve({ fetch: app.fetch, port }, () => {
    logger.info(`[executor] Listening on port ${port}`);
    const controlRpcConfiguredAtStartup = hasControlRpcConfiguration(runtimeConfig);
    logger.info(`[executor] Control RPC configured at startup: ${controlRpcConfiguredAtStartup}`);
    if (!controlRpcConfiguredAtStartup) {
      logger.warn('[executor] CONTROL_RPC_BASE_URL env missing at startup; /start will return 503 until configured');
    }
  });

  installGracefulShutdown({
    serviceName: options.serviceName ?? 'takos-executor',
    logger,
    shutdownController,
    concurrency,
    server,
    gracePeriodMs,
  });

  return { app, server, logger, concurrency };
}
