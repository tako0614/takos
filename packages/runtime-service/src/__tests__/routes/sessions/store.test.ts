import * as fs from "node:fs/promises";
import * as path from "node:path";

import { sessionStore } from "../../../routes/sessions/storage.ts";

import { assert, assertEquals, assertThrows } from "jsr:@std/assert";

Deno.test("session owner binding", async () => {
  const sessionId = "a12345678901234b";
  const spaceId = "ws046owner1";
  try {
    await sessionStore.getSessionDir(sessionId, spaceId, "owner-a");
    sessionStore.getSessionWithValidation(sessionId, spaceId, "owner-a");
    assertThrows(() =>
      sessionStore.getSessionWithValidation(sessionId, spaceId, "owner-b")
    );
  } finally {
    await sessionStore.destroySession(sessionId, spaceId, "owner-a");
  }
});

Deno.test("session owner binding - rejects retroactive binding", async () => {
  const sessionId = "a12345678901234c";
  const spaceId = "ws046owner2";
  try {
    await sessionStore.getSessionDir(sessionId, spaceId);
    sessionStore.getSessionWithValidation(sessionId, spaceId);
    assertThrows(() =>
      sessionStore.getSessionWithValidation(sessionId, spaceId, "owner-a")
    );
    assertThrows(() =>
      sessionStore.getSessionWithValidation(sessionId, spaceId, "owner-b")
    );
  } finally {
    await sessionStore.destroySession(sessionId, spaceId);
  }
});

Deno.test(".takos-session metadata", async () => {
  const sessionId = "a12345678901234d";
  const spaceId = "ws046owner3";
  try {
    const workDir = await sessionStore.getSessionDir(
      sessionId,
      spaceId,
      "owner-a",
    );
    const sessionInfoPath = path.join(workDir, ".takos-session");
    const sessionInfo = JSON.parse(
      await fs.readFile(sessionInfoPath, "utf-8"),
    ) as Record<string, unknown>;

    assertEquals(sessionInfo, {
      session_id: sessionId,
      space_id: spaceId,
    });
    assert(!("api_url" in sessionInfo));
  } finally {
    await sessionStore.destroySession(sessionId, spaceId, "owner-a");
  }
});
