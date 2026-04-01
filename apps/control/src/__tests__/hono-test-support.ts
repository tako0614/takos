import type { Hono } from "hono";
import { isAppError } from "takos-common/errors";

export function installAppErrorHandler(app: Hono<any>) {
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as
          | 400
          | 401
          | 402
          | 403
          | 404
          | 409
          | 410
          | 422
          | 426
          | 429
          | 500
          | 501
          | 502
          | 503
          | 504,
      );
    }
    throw error;
  });
}
