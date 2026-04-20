import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert";

Deno.env.set("TAKOS_API_URL", "https://takos.example.test");

const { sessionStore } = await import("../../../routes/sessions/storage.ts");

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

Deno.test("session validation - uses space wording for mismatched session scope", async () => {
  const sessionId = "a12345678901234e";
  const spaceId = "ws046scope1";
  const otherSpaceId = "ws046scope2";
  try {
    await sessionStore.getSessionDir(sessionId, spaceId);
    assertThrows(
      () => sessionStore.getSessionWithValidation(sessionId, otherSpaceId),
      Error,
      "Session does not belong to the specified space",
    );
  } finally {
    await sessionStore.destroySession(sessionId, spaceId);
  }
});

Deno.test("session validation - reports the per-space session cap with space wording", async () => {
  const sessionIds = [
    "a12345678901234f",
    "a12345678901234g",
    "a12345678901234h",
  ];
  const spaceId = "ws046scope3";
  try {
    await sessionStore.getSessionDir(sessionIds[0], spaceId);
    await sessionStore.getSessionDir(sessionIds[1], spaceId);
    await assertRejects(
      () => sessionStore.getSessionDir(sessionIds[2], spaceId),
      Error,
      "Maximum sessions per space reached",
    );
  } finally {
    for (const sessionId of sessionIds) {
      await sessionStore.destroySession(sessionId, spaceId);
    }
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
