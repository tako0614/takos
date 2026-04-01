import { assertEquals } from "jsr:@std/assert";

import {
  listNotificationsQuerySchema,
  setMutedUntilSchema,
  updateNotificationPreferencesSchema,
} from "@/services/notifications/service";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
} from "@/services/notifications/types";

Deno.test("notification schemas accept valid payloads", () => {
  assertEquals(
    updateNotificationPreferencesSchema.safeParse({
      updates: [{ type: "run.completed", channel: "in_app", enabled: true }],
    }).success,
    true,
  );
  assertEquals(
    setMutedUntilSchema.safeParse({ muted_until: "2025-12-31T23:59:59Z" })
      .success,
    true,
  );
  assertEquals(
    listNotificationsQuerySchema.safeParse({
      limit: 10,
      before: "2025-01-01T00:00:00Z",
    }).success,
    true,
  );
});

Deno.test("notification schemas reject invalid payloads", () => {
  assertEquals(
    updateNotificationPreferencesSchema.safeParse({ updates: [] }).success,
    false,
  );
  assertEquals(
    updateNotificationPreferencesSchema.safeParse({
      updates: [{ type: "invalid.type", channel: "sms", enabled: true }],
    }).success,
    false,
  );
  assertEquals(
    setMutedUntilSchema.safeParse({ muted_until: "not-a-date" }).success,
    false,
  );
  assertEquals(
    listNotificationsQuerySchema.safeParse({ limit: 100 }).success,
    false,
  );
  assertEquals(
    listNotificationsQuerySchema.safeParse({ limit: 0 }).success,
    false,
  );
});

Deno.test("notification constants expose the expected catalog", () => {
  assertEquals(NOTIFICATION_CHANNELS, ["in_app", "email", "push"]);
  assertEquals(NOTIFICATION_TYPES.includes("run.completed"), true);
  assertEquals(NOTIFICATION_TYPES.includes("pr.comment"), true);
  assertEquals(DEFAULT_NOTIFICATION_PREFERENCES["run.completed"].in_app, true);
  assertEquals(DEFAULT_NOTIFICATION_PREFERENCES["run.completed"].email, false);
});

Deno.test("notification defaults cover every type and channel combination", () => {
  for (const type of NOTIFICATION_TYPES) {
    const preferenceRow = DEFAULT_NOTIFICATION_PREFERENCES[type];
    for (const channel of NOTIFICATION_CHANNELS) {
      assertEquals(typeof preferenceRow[channel], "boolean");
    }
  }
});
