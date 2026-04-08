import type { MiddlewareHandler } from 'hono';
import type { Env } from '../../shared/types/index.ts';
import { getPlatformServices } from '../../platform/accessors.ts';

// Security headers applied to every response served from the assets binding.
// Without this wrapping the assets-binding response has immutable headers, so
// the upstream security-header middleware in web.ts has no effect on JS/CSS/
// font/image responses (they would ship with no CSP, no nosniff, no XFO).
function applySecurityHeaders(response: Response, contentType: string | null): Response {
  const headers = new Headers(response.headers);
  if (!headers.has('X-Content-Type-Options')) {
    headers.set('X-Content-Type-Options', 'nosniff');
  }
  if (!headers.has('X-Frame-Options')) {
    headers.set('X-Frame-Options', 'DENY');
  }
  if (!headers.has('Referrer-Policy')) {
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  }
  if (!headers.has('Cross-Origin-Resource-Policy')) {
    headers.set('Cross-Origin-Resource-Policy', 'same-site');
  }
  // Conservative CSP for static assets — no scripts (HTML responses follow a
  // separate per-route CSP with nonces). SVG must still allow inline styles.
  if (!headers.has('Content-Security-Policy') && contentType && !contentType.includes('text/html')) {
    headers.set(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'none'; frame-ancestors 'none'",
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const staticAssetsMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: Record<string, unknown> }> = async (c, next) => {
  const path = new URL(c.req.url).pathname;

  if (path.startsWith('/api/') || path.startsWith('/auth/') || path.startsWith('/oauth/')) {
    return next();
  }

  const assets = getPlatformServices(c).assets.binding;
  if (assets) {
    try {
      const assetResponse = await assets.fetch(new Request(new URL(path, c.req.url)));
      const contentType = assetResponse.headers.get('content-type');
      if (assetResponse.ok && contentType !== 'text/html') {
        return applySecurityHeaders(assetResponse, contentType);
      }
    } catch {
      // Asset not found, fall through to next handler
    }
  }

  return next();
};
