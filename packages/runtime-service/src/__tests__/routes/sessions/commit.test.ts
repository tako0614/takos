import { assertEquals } from "jsr:@std/assert";

import { createTestApp, testRequest } from "../../setup.ts";

Deno.env.set("TAKOS_API_URL", "https://takos.example.test");

const sessionsRoutes =
  (await import("../../../routes/sessions/session-routes.ts")).default;
const { sessionStore } = await import("../../../routes/sessions/storage.ts");

Deno.test("session commit route - rejects cross-space commits with space wording", async () => {
  const app = createTestApp();
  app.route("/", sessionsRoutes);

  const sessionId = "a12345678901234i";
  const sessionSpaceId = "ws046commit1";
  const otherSpaceId = "ws046commit2";

  await sessionStore.getSessionDir(sessionId, sessionSpaceId);
  try {
    const response = await testRequest(app, {
      method: "POST",
      path: `/sessions/${sessionId}/commit`,
      body: {
        space_id: otherSpaceId,
      },
    });

    assertEquals(response.status, 403);
    assertEquals(response.body, {
      error: {
        code: "FORBIDDEN",
        message: "Session does not belong to the specified space",
      },
    });
  } finally {
    await sessionStore.destroySession(sessionId, sessionSpaceId);
  }
});
