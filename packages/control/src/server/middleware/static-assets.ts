import type { MiddlewareHandler } from 'hono';
import type { Env } from '../../shared/types';
import { getPlatformServices } from '../../platform/accessors.ts';

export const staticAssetsMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: Record<string, unknown> }> = async (c, next) => {
  const path = new URL(c.req.url).pathname;

  if (path.startsWith('/api/') || path.startsWith('/auth/') || path.startsWith('/oauth/')) {
    return next();
  }

  const assets = getPlatformServices(c).assets.binding;
  if (assets) {
    try {
      const assetResponse = await assets.fetch(new Request(new URL(path, c.req.url)));
      if (assetResponse.ok && assetResponse.headers.get('content-type') !== 'text/html') {
        return assetResponse;
      }
    } catch {
      // Asset not found, fall through to next handler
    }
  }

  return next();
};
