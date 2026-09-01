import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import { clearSessionCookie } from "../../../application/services/identity/session.ts";
import { authSessionRouter } from "../auth/session.ts";

test("logout replay clears the browser cookie and returns canonical success", async () => {
  const deletedSessions: string[] = [];
  const sessionStore = {
    idFromName: (name: string) => name,
    get: (_id: string) => ({
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname === "/session/delete") {
          const body = await request.json() as { sessionId?: unknown };
          if (typeof body.sessionId === "string") {
            deletedSessions.push(body.sessionId);
          }
        }
        return Response.json({ success: true });
      },
    }),
  };
  const env = {
    PLATFORM: {
      config: { adminDomain: "takos.test" },
      services: {
        notifications: { sessionStore },
      },
    },
  } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  app.route("/auth", authSessionRouter);
  const sessionId = "session_1234567890";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await app.fetch(
      new Request("https://takos.test/auth/logout", {
        method: "POST",
        headers: { Cookie: `__Host-tp_session=${sessionId}` },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBe(clearSessionCookie());
    expect(await response.json()).toEqual({ success: true });
  }

  expect(deletedSessions).toEqual([sessionId, sessionId]);
});
