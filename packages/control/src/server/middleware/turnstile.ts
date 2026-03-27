/**
 * Cloudflare Turnstile bot protection middleware.
 * Applied to auth endpoints to prevent automated account creation.
 *
 * Requires TURNSTILE_SECRET_KEY env var.
 * If not configured, middleware is a no-op (allows development without Turnstile).
 */
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../../shared/types';
import { AuthorizationError } from '@takos/common/errors';
import { logWarn } from '../../shared/utils/logger';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function requireTurnstile(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const secretKey = c.env.TURNSTILE_SECRET_KEY;
    if (!secretKey) {
      // Turnstile not configured — skip (development mode)
      await next();
      return;
    }

    // Token can be in header or query param
    const token = c.req.header('X-Turnstile-Token') || c.req.query('turnstile_token');
    if (!token) {
      throw new AuthorizationError('Turnstile token required');
    }

    const ip = c.req.header('CF-Connecting-IP') || '';

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: secretKey,
        response: token,
        remoteip: ip,
      }),
    });

    const result = await response.json() as { success: boolean; 'error-codes'?: string[] };
    if (!result.success) {
      logWarn('Verification failed', { module: 'turnstile', detail: result['error-codes'] });
      throw new AuthorizationError('Turnstile verification failed');
    }

    await next();
  };
}
