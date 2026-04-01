import type { Hono } from "hono";
import { isAppError } from "takos-common/errors";

type ErrorStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 410
  | 422
  | 429
  | 500
  | 501
  | 502
  | 503
  | 504;

export function installAppErrorHandler<T extends Hono<any>>(app: T): T {
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(error.toResponse(), error.statusCode as ErrorStatus);
    }
    throw error;
  });
  return app;
}
