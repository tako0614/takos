import { describe, expect, test } from "bun:test";
import {
  MAX_USER_NAME_CHARACTERS,
} from "takos-api-contract/shared/types";
import {
  parseCurrentUserResponse,
  parseLogoutResponse,
  parseSetupCompleteResponse,
  parseUserSettingsResponse,
} from "../../lib/auth-response.ts";

function currentUser(overrides: Record<string, unknown> = {}) {
  return {
    email: "owner@example.test",
    name: "Owner",
    username: "owner-user",
    picture: "https://images.example.test/owner.png",
    setup_completed: true,
    ...overrides,
  };
}

function settings(overrides: Record<string, unknown> = {}) {
  return {
    setup_completed: true,
    auto_update_enabled: false,
    private_account: true,
    activity_visibility: "followers" as const,
    ai_model: "gpt-5.5",
    available_models: ["gpt-5.5", "takosumi/default"],
    ...overrides,
  };
}

describe("current user response parsing", () => {
  test("accepts and projects the current public identity", () => {
    expect(parseCurrentUserResponse({
      ...currentUser(),
      internal_id: "must-not-project",
    })).toEqual(currentUser());
  });

  test("rejects malformed routing, setup, display, and picture state", () => {
    expect(() =>
      parseCurrentUserResponse(currentUser({ setup_completed: "true" }))
    ).toThrow(TypeError);
    expect(() =>
      parseCurrentUserResponse(currentUser({ username: "owner/user" }))
    ).toThrow(TypeError);
    expect(() =>
      parseCurrentUserResponse(currentUser({ name: " " }))
    ).toThrow(TypeError);
    expect(() =>
      parseCurrentUserResponse(currentUser({
        name: "x".repeat(MAX_USER_NAME_CHARACTERS + 1),
      }))
    ).toThrow(TypeError);
    expect(() =>
      parseCurrentUserResponse(currentUser({ picture: "javascript:alert(1)" }))
    ).toThrow(TypeError);
  });
});

test("setup completion requires explicit canonical acceptance", () => {
  expect(parseSetupCompleteResponse({
    success: true,
    setup_completed: true,
  })).toBeUndefined();
  expect(() => parseSetupCompleteResponse({ success: true })).toThrow(
    TypeError,
  );
  expect(() =>
    parseSetupCompleteResponse({ success: false, setup_completed: true })
  ).toThrow(TypeError);
});

test("logout requires explicit canonical acceptance", () => {
  expect(parseLogoutResponse({ success: true })).toBeUndefined();
  expect(() => parseLogoutResponse({ success: false })).toThrow(TypeError);
  expect(() => parseLogoutResponse({ ok: true })).toThrow(TypeError);
});

describe("user settings response parsing", () => {
  test("accepts exact booleans, visibility, and unique model inventory", () => {
    expect(parseUserSettingsResponse(settings())).toEqual(settings());
  });

  test("rejects malformed settings, duplicate models, and unavailable current model", () => {
    expect(() =>
      parseUserSettingsResponse(settings({ private_account: "true" }))
    ).toThrow(TypeError);
    expect(() =>
      parseUserSettingsResponse(settings({ activity_visibility: "friends" }))
    ).toThrow(TypeError);
    expect(() =>
      parseUserSettingsResponse(settings({
        available_models: ["gpt-5.5", "gpt-5.5"],
      }))
    ).toThrow(TypeError);
    expect(() =>
      parseUserSettingsResponse(settings({
        ai_model: "retired/model",
      }))
    ).toThrow(TypeError);
  });
});
