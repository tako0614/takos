import type { Hono } from "hono";
import { env as processEnv } from "node:process";
import type {
  RunExecutorRuntimeConfig,
  StartPayload,
} from "../agent-core/run-executor.ts";
import {
  type ConcurrencyGuard,
  createConcurrencyGuard,
  installGracefulShutdown,
} from "../agent-core/executor-utils.ts";
import { parseIntEnv } from "../common/env-parse.ts";
import { createLogger } from "../common/logger.ts";
import {
  buildExecutorRuntimeConfig,
  createExecutorApp,
  hasControlRpcConfiguration,
} from "./executor-config.ts";
import { executeRunInContainer as sharedExecuteRun } from "../agent-core/run-executor.ts";
import type { ExecuteRunFn } from "../agent-core/run-executor.ts";
import { executeRun as controlAgentExecuteRun } from "../control-agent-runner.ts";

function loadExecuteRun(): ExecuteRunFn {
  // The control-agent runner is the agent-execution closure that actually
  // drives a run. control-agent-runner.ts ships a placeholder that rejects;
  // self-hosters point it at their own agent runner implementation.
  return controlAgentExecuteRun as ExecuteRunFn;
}

export type ExecutorServiceOptions = {
  port?: number;
  maxConcurrentRuns?: number;
  shutdownGraceMs?: number;
  serviceName?: string;
  concurrency?: ConcurrencyGuard;
};

type ExecutorLogger = {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
};

export interface ExecutorServiceApp {
  app: Hono;
  logger: ExecutorLogger;
  concurrency: ConcurrencyGuard;
  shutdownController: AbortController;
  runtimeConfig: RunExecutorRuntimeConfig;
}

export interface ExecutorServiceHandle {
  app: Hono;
  server: BunServer;
  logger: ExecutorLogger;
  concurrency: ConcurrencyGuard;
}

type BunServer = {
  stop(closeActiveConnections?: boolean): void;
};

type BunLike = {
  serve(options: {
    port: number;
    fetch: (request: Request) => Response | Promise<Response>;
  }): BunServer;
};

function bunLike(): BunLike {
  const bun = (globalThis as { Bun?: BunLike }).Bun;
  if (!bun) throw new Error("Bun runtime is required to start takos-executor");
  return bun;
}

function buildExecuteRunAdapter(): ExecuteRunFn {
  return async (env, apiKey, runId, model, runOptions) => {
    const executeRun = await loadExecuteRun();
    return executeRun(
      env,
      apiKey,
      runId,
      model,
      {
        abortSignal: runOptions.abortSignal,
        runIo: runOptions.runIo,
      },
    );
  };
}

export function createExecutorServiceApp(
  options: ExecutorServiceOptions = {},
): ExecutorServiceApp {
  const serviceName = options.serviceName ?? "takos-executor";
  const logger = createLogger({ service: serviceName });
  const runtimeConfig = buildExecutorRuntimeConfig(processEnv);
  const concurrency = options.concurrency ?? createConcurrencyGuard(
    options.maxConcurrentRuns ??
      parseIntEnv("MAX_CONCURRENT_RUNS", 5, { min: 1 }),
  );
  const shutdownController = new AbortController();
  const executeRunAdapter = buildExecuteRunAdapter();

  function executeRunInContainer(payload: StartPayload): Promise<void> {
    return sharedExecuteRun(payload, {
      serviceName,
      logger,
      executeRun: executeRunAdapter,
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

export function startExecutorService(
  options: ExecutorServiceOptions = {},
): ExecutorServiceHandle {
  const port = options.port ??
    parseIntEnv("PORT", 8080, { min: 1, max: 65535 });
  const gracePeriodMs = options.shutdownGraceMs ??
    parseIntEnv("SHUTDOWN_GRACE_MS", 30000, { min: 0 });
  const { app, logger, concurrency, shutdownController, runtimeConfig } =
    createExecutorServiceApp(options);

  const server = bunLike().serve({
    port,
    fetch: (request) => app.fetch(request),
  });
  logger.info(`[executor] Listening on port ${port}`);
  const controlRpcConfiguredAtStartup = hasControlRpcConfiguration(
    runtimeConfig,
  );
  logger.info(
    `[executor] Control RPC configured at startup: ${controlRpcConfiguredAtStartup}`,
  );
  if (!controlRpcConfiguredAtStartup) {
    logger.warn(
      "[executor] Control RPC base URL env missing at startup; /start will return 503 until configured",
    );
  }

  installGracefulShutdown({
    serviceName: options.serviceName ?? "takos-executor",
    logger,
    shutdownController,
    concurrency,
    server: {
      close: (cb?: () => void) => {
        server.stop(false);
        cb?.();
      },
    },
    gracePeriodMs,
  });

  return { app, server, logger, concurrency };
}
