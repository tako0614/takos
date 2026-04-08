import type { MiddlewareHandler } from 'hono';
import { bodyLimit as honoBodyLimit } from 'hono/body-limit';

type BodySizeLimitOptions = {
  maxSize: number;
  message?: string;
  skipPaths?: RegExp[];
};

export function bodyLimit(options: BodySizeLimitOptions): MiddlewareHandler {
  const { maxSize, message, skipPaths } = options;

  // Hono's built-in bodyLimit handles both Content-Length (fast path)
  // and stream-level byte counting (for chunked/missing Content-Length).
  const honoMiddleware = honoBodyLimit({
    maxSize,
    onError: (c) => {
      // Match the documented common error envelope
      // (docs/reference/api.md "エラーレスポンスの共通形式"):
      //   { error: { code, message } }
      return c.json(
        {
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: message || 'Request body too large',
          },
          max_size: maxSize,
        },
        413,
      );
    },
  });

  return async (c, next) => {
    if (!['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
      await next();
      return;
    }

    if (skipPaths?.some((pattern) => pattern.test(c.req.path))) {
      await next();
      return;
    }

    await honoMiddleware(c, next);
  };
}

export const generalApiBodyLimit = bodyLimit({
  maxSize: 1 * 1024 * 1024, // 1MB
  message: 'Request body exceeds maximum allowed size of 1MB',
  skipPaths: [/\/api\/spaces\/[^/]+\/app-deployments(?:\/|$)/],
});

export const oauthBodyLimit = bodyLimit({
  maxSize: 64 * 1024, // 64KB
  message: 'Request body exceeds maximum allowed size of 64KB',
});

export const searchBodyLimit = bodyLimit({
  maxSize: 256 * 1024, // 256KB
  message: 'Request body exceeds maximum allowed size of 256KB',
});

