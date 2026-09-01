import { expect, test } from "bun:test";
import type { SqlDatabaseLike } from "../../../infra/db/index.ts";
import {
  formatUserSettingsResponse,
  updateUserSettings,
  type UserSettingsRow,
} from "../../../application/services/identity/user-settings.ts";
import { userSettingsPatchSchema } from "../me/routes.ts";

test("user settings writes are strict, typed, non-empty, and normalized", () => {
  expect(userSettingsPatchSchema.parse({
    setup_completed: true,
    activity_visibility: "  PRIVATE  ",
  })).toEqual({
    setup_completed: true,
    activity_visibility: "private",
  });
  expect(userSettingsPatchSchema.safeParse({}).success).toBe(false);
  expect(userSettingsPatchSchema.safeParse({
    setup_completed: "true",
  }).success).toBe(false);
  expect(userSettingsPatchSchema.safeParse({
    auto_update_enabled: 1,
  }).success).toBe(false);
  expect(userSettingsPatchSchema.safeParse({
    activity_visibility: "friends",
  }).success).toBe(false);
  expect(userSettingsPatchSchema.safeParse({
    private_account: true,
    forged: true,
  }).success).toBe(false);
});

test("user settings service rejects invalid direct-call input", async () => {
  await expect(updateUserSettings(
    {} as SqlDatabaseLike,
    "user-1",
    { setup_completed: "true" } as unknown as { setup_completed: boolean },
  )).rejects.toThrow("Invalid user settings update");
});

test("user settings formatter cannot publish an unknown visibility", () => {
  const row: UserSettingsRow = {
    userId: "user-1",
    setupCompleted: true,
    autoUpdateEnabled: false,
    privateAccount: false,
    activityVisibility: "forged",
    aiModel: null,
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T10:00:00.000Z",
  };
  expect(formatUserSettingsResponse(row).activity_visibility).toBe("public");
});
