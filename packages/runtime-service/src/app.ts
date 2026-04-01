import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import {
  PORT,
  JWT_PUBLIC_KEY,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_EXEC_MAX,
  RATE_LIMIT_SESSION_MAX,
  RATE_LIMIT_SNAPSHOT_MAX,
  RATE_LIMIT_ACTIONS_MAX,
  RATE_LIMIT_GIT_MAX,
  RATE_LIMIT_REPOS_MAX,
  RATE_LIMIT_CLI_PROXY_MAX,
} from './shared/config.ts';
import {
  createServiceTokenMiddleware,
  getServiceTokenFromHeader,
  createErrorHandler,
  notFoundHandler,
  forbidden,
} from 'takos-common/middleware/hono';
import { createRateLimiter } from './middleware/rate-limit.ts';
import type { RuntimeEnv } from './types/hono.d.ts';
import execRoutes from './routes/runtime/exec.ts';
import toolsRoutes from './routes/runtime/tools.ts';
import sessionExecutionRoutes from './routes/sessions/execution.ts';
import sessionFilesRoutes from './routes/sessions/files.ts';
import sessionSnapshotRoutes from './routes/sessions/snapshot.ts';
import sessionSessionsRoutes from './routes/sessions/session-routes.ts';
import repoReadRoutes from './routes/repos/read.ts';
import repoWriteRoutes from './routes/repos/write.ts';
import {
  enforceSpaceScopeMiddleware,
  getSpaceIdFromBody,
  getSpaceIdFromPath,
} from './middleware/space-scope.ts';
import gitInitRoutes from './routes/git/init.ts';
import gitHttpRoutes from './routes/git/http.ts';
import actionsRoutes from './routes/actions/index.ts';
import { jobManager } from './runtime/actions/job-manager.ts';
import cliProxyRoutes from './routes/cli/proxy.ts';
import { isR2Configured } from './storage/r2.ts';
import { sessionStore } from './routes/sessions/storage.ts';
import { createLogger } from 'takos-common/logger';

export type RuntimeServiceOptions = {
  port?: number;
  serviceName?: string;
  isProduction?: boolean;
  isContainerEnvironment?: boolean;
};

function isLoopbackAddress(addr: string): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function isLocalCliProxyBypassRequest(c: import('hono').Context<RuntimeEnv>): boolean {
  if (!c.req.path.startsWith('/cli-proxy/')) {
    return false;
  }
  if (getServiceTokenFromHeader(c)) {
    return false;
  }

  const sessionId = c.req.header('X-Takos-Session-Id');
  const addr =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || '';
  return Boolean(sessionId) && isLoopbackAddress(addr);
}

export function createRuntimeServiceApp(options: RuntimeServiceOptions = {}): Hono<RuntimeEnv> {
  const requireServiceToken = createServiceTokenMiddleware({
    jwtPublicKey: JWT_PUBLIC_KEY,
    expectedIssuer: 'takos-control',
    expectedAudience: 'takos-runtime',
    skipPaths: ['/health'],
    clockToleranceSeconds: 30,
  });

  const isProduction = options.isProduction ?? Deno.env.get('NODE_ENV') === 'production';
  const isContainerEnvironment = options.isContainerEnvironment ?? !!Deno.env.get('CF_CONTAINER');
  const logger = createLogger({ service: options.serviceName ?? 'takos-runtime' });
  const app = new Hono<RuntimeEnv>();

  app.use(async (c, next) => {
    const id = c.req.header('x-request-id') || randomUUID();
    const log = logger.child({ requestId: id });
    c.set('requestId', id);
    c.set('log', log);
    c.header('x-request-id', id);
    const start = Date.now();
    log.info('Request', { method: c.req.method, path: c.req.path });
    await next();
    log.info('Response', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration: Date.now() - start,
    });
  });

  app.use(async (c, next): Promise<Response | void> => {
    if (isProduction && !isContainerEnvironment && c.req.header('X-Forwarded-Proto') !== 'https') {
      return forbidden(c, 'HTTPS required');
    }
    await next();
  });

  app.use(async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    if (isProduction) {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    await next();
  });

  app.get('/ping', (c) => c.text('pong', 200));
  app.get('/health', (c) => c.json({ ok: true }, 200));

  app.use('/cli-proxy/*', async (c, next) => {
    if (getServiceTokenFromHeader(c)) {
      await next();
      return;
    }

    if (isLocalCliProxyBypassRequest(c)) {
      await next();
      return;
    }

    return forbidden(c, 'Authorization header required');
  });

  app.use(async (c, next) => {
    if (isLocalCliProxyBypassRequest(c)) {
      await next();
      return;
    }
    return requireServiceToken(c, next);
  });

  app.use(async (c, next) => {
    const ct = c.req.header('content-type') || '';
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && ct.includes('application/json')) {
      try {
        const body = await c.req.json();
        c.set('parsedBody', body);
      } catch {
        // Ignore malformed JSON; downstream handlers surface validation errors.
      }
    }
    await next();
  });

  const execRateLimiter = createRateLimiter({ maxRequests: RATE_LIMIT_EXEC_MAX, windowMs: RATE_LIMIT_WINDOW_MS });
  const sessionRateLimiter = createRateLimiter({ maxRequests: RATE_LIMIT_SESSION_MAX, windowMs: RATE_LIMIT_WINDOW_MS });
  const snapshotRateLimiter = createRateLimiter({ maxRequests: RATE_LIMIT_SNAPSHOT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });
  const actionsRateLimiter = createRateLimiter({ maxRequests: RATE_LIMIT_ACTIONS_MAX, windowMs: RATE_LIMIT_WINDOW_MS });
  const gitRateLimiter = createRateLimiter({ maxRequests: RATE_LIMIT_GIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });
  const reposRateLimiter = createRateLimiter({ maxRequests: RATE_LIMIT_REPOS_MAX, windowMs: RATE_LIMIT_WINDOW_MS });
  const cliProxyRateLimiter = createRateLimiter({ maxRequests: RATE_LIMIT_CLI_PROXY_MAX, windowMs: RATE_LIMIT_WINDOW_MS });

  app.use('/exec/*', execRateLimiter);
  app.use('/session/exec/*', execRateLimiter);
  app.use('/session/snapshot/*', snapshotRateLimiter);
  app.use('/session/*', sessionRateLimiter);
  app.use('/sessions/*', sessionRateLimiter);
  app.use('/actions/*', actionsRateLimiter);
  app.use('/git/*', gitRateLimiter);
  app.use('/repos/*', reposRateLimiter);
  app.use('/cli-proxy/*', cliProxyRateLimiter);

  const sessionSpaceScope = enforceSpaceScopeMiddleware((c) => [
    getSpaceIdFromBody(c, 'space_id'),
  ]);
  const repoSpaceScope = enforceSpaceScopeMiddleware((c) => [
    getSpaceIdFromBody(c, 'spaceId'),
    getSpaceIdFromPath(c),
  ]);
  app.use('/session/*', sessionSpaceScope);
  app.use('/sessions/*', sessionSpaceScope);
  app.use('/repos/*', repoSpaceScope);

  app.route('/', cliProxyRoutes);
  app.route('/', execRoutes);
  app.route('/', toolsRoutes);
  app.route('/', sessionExecutionRoutes);
  app.route('/', sessionFilesRoutes);
  app.route('/', sessionSnapshotRoutes);
  app.route('/', sessionSessionsRoutes);
  app.route('/', repoReadRoutes);
  app.route('/', repoWriteRoutes);
  app.route('/', gitInitRoutes);
  app.route('/', gitHttpRoutes);
  app.route('/', actionsRoutes);

  app.notFound(notFoundHandler);
  app.onError(createErrorHandler({ includeStack: !isProduction }));
  return app;
}

export function startRuntimeService(options: RuntimeServiceOptions = {}): void {
  const logger = createLogger({ service: options.serviceName ?? 'takos-runtime' });
  const port = options.port ?? PORT;
  const app = createRuntimeServiceApp(options);

  sessionStore.startCleanup();
  jobManager.startCleanup();

  const abortController = new AbortController();

  const server = Deno.serve({ port, signal: abortController.signal }, app.fetch);
  logger.info(`Takos runtime listening on port ${port}`);
  logger.info(`R2 configured: ${isR2Configured()}`);

  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('Shutdown signal received', { signal });
    sessionStore.stopCleanup();
    jobManager.stopCleanup();

    abortController.abort();
    server.finished.then(() => {
      Deno.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown timeout reached', { signal });
      Deno.exit(1);
    }, 10_000);
  }

  Deno.addSignalListener('SIGTERM', () => shutdown('SIGTERM'));
  Deno.addSignalListener('SIGINT', () => shutdown('SIGINT'));

  return { app, server };
}
