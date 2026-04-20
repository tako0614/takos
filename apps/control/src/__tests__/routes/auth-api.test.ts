import { Hono } from "hono";
import { assertEquals } from "jsr:@std/assert";
import { isAppError } from "takos-common/errors";

import type { Env, User } from "@/types";
import authApi from "@/routes/auth-api";

type TestEnv = { Bindings: Env; Variables: { user?: User } };

function createApp() {
  const app = new Hono<TestEnv>();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as
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
          | 504,
      );
    }
    throw error;
  });
  app.route("/api/auth", authApi);
  return app;
}

Deno.test("/api/auth/logout rejects unauthenticated requests", async () => {
  const app = createApp();
  const response = await app.fetch(
    new Request("https://takos.jp/api/auth/logout", { method: "POST" }),
    {} as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "Authentication required",
    },
  });
});
