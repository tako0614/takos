import { Hono } from 'hono';
import { createLogger } from 'takos-common/logger';
import { parseIntEnv } from 'takos-common/env-parse';
import { isPrivateIP, isLocalhost } from 'takos-common/validation';
import { BrowserManager } from './browser-manager.ts';
import type {
  BrowserAction,
  BootstrapPayload,
  GotoPayload,
  ExtractPayload,
} from './browser-manager.ts';

export type BrowserServiceOptions = {
  port?: number;
  shutdownGraceMs?: number;
  serviceName?: string;
};

function validateNavigationUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP/HTTPS URLs are allowed');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }

  if (isLocalhost(parsed.hostname)) {
    throw new Error('Navigation to localhost is not allowed');
  }

  if (isPrivateIP(parsed.hostname)) {
    throw new Error('Navigation to private/internal IPs is not allowed');
  }
}

export function createBrowserServiceApp(options: BrowserServiceOptions = {}) {
  const logger = createLogger({ service: options.serviceName ?? 'browserd' });
  const browser = new BrowserManager();
  const app = new Hono();

  app.get('/internal/healthz', (c) => c.json({
    status: 'ok',
    service: options.serviceName ?? 'browserd',
    browser_alive: browser.isAlive(),
  }));

  app.post('/internal/bootstrap', async (c) => {
    const payload = (await c.req.json()) as BootstrapPayload;
    if (payload.url) {
      validateNavigationUrl(payload.url);
    }
    const result = await browser.bootstrap(payload);
    return c.json(result);
  });

  app.post('/internal/goto', async (c) => {
    const payload = (await c.req.json()) as GotoPayload;
    validateNavigationUrl(payload.url);
    const result = await browser.goto(payload);
    return c.json(result);
  });

  app.post('/internal/action', async (c) => {
    const action = (await c.req.json()) as BrowserAction;
    if (!action.type) {
      return c.json({ error: 'Missing action type' }, 400);
    }
    const result = await browser.action(action);
    return c.json(result);
  });

  app.post('/internal/extract', async (c) => {
    const payload = (await c.req.json()) as ExtractPayload;
    const result = await browser.extract(payload);
    return c.json(result);
  });

  app.get('/internal/html', async (c) => {
    const result = await browser.html();
    return c.json(result);
  });

  app.get('/internal/screenshot', async () => {
    const png = await browser.screenshot();
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': png.length.toString(),
      },
    });
  });

  app.post('/internal/pdf', async () => {
    const pdf = await browser.pdf();
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': pdf.length.toString(),
      },
    });
  });

  app.get('/internal/tabs', async (c) => c.json({ tabs: await browser.tabs() }));

  app.post('/internal/tab/new', async (c) => {
    const { url } = (await c.req.json()) as { url?: string };
    if (url) validateNavigationUrl(url);
    const result = await browser.newTab(url);
    return c.json(result);
  });

  app.post('/internal/tab/close', async (c) => {
    const { index } = (await c.req.json()) as { index: number };
    if (typeof index !== 'number') {
      return c.json({ error: 'Missing tab index' }, 400);
    }
    const result = await browser.closeTab(index);
    return c.json(result);
  });

  app.post('/internal/tab/switch', async (c) => {
    const { index } = (await c.req.json()) as { index: number };
    if (typeof index !== 'number') {
      return c.json({ error: 'Missing tab index' }, 400);
    }
    const result = await browser.switchTab(index);
    return c.json(result);
  });

  app.onError((err, c) => {
    logger.error('Request error', { error: err });
    return c.json({ error: err.message }, 500);
  });

  return { app, browser, logger };
}

export function startBrowserService(options: BrowserServiceOptions = {}) {
  const port = options.port ?? parseIntEnv('PORT', 8080, { min: 1, max: 65535 });
  const shutdownGraceMs = options.shutdownGraceMs ?? parseIntEnv('SHUTDOWN_GRACE_MS', 15000, { min: 0 });
  const { app, browser, logger } = createBrowserServiceApp(options);

  const abortController = new AbortController();
  const server = Deno.serve({ port, signal: abortController.signal }, app.fetch);
  logger.info(`[browserd] Listening on port ${port}`);

  async function shutdown(signal: string): Promise<void> {
    logger.info(`[browserd] Received ${signal}, shutting down`);
    await browser.close();
    abortController.abort();
    await server.finished;
    logger.info('[browserd] Server closed');
    Deno.exit(0);
  }

  const forceExit = () => {
    setTimeout(() => {
      logger.warn(`[browserd] Force exit after ${shutdownGraceMs}ms`);
      Deno.exit(1);
    }, shutdownGraceMs);
  };

  Deno.addSignalListener('SIGTERM', () => { forceExit(); void shutdown('SIGTERM'); });
  Deno.addSignalListener('SIGINT', () => { forceExit(); void shutdown('SIGINT'); });

  return { app, browser, server, logger };
}
