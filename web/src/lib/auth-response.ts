import {
  MAX_USER_EMAIL_CHARACTERS,
  MAX_USER_MODEL_ID_CHARACTERS,
  MAX_USER_NAME_CHARACTERS,
  MAX_USER_PICTURE_URL_CHARACTERS,
  MAX_USER_SETTINGS_MODELS,
  MAX_USER_USERNAME_CHARACTERS,
} from "takos-api-contract/shared/types";
import type { User, UserSettings } from "../types/index.ts";

const ACTIVITY_VISIBILITIES = new Set([
  "public",
  "followers",
  "private",
]);
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]*$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(
  value: unknown,
  field: string,
  maxCharacters: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" || value.length > maxCharacters ||
    (!allowEmpty && !value.trim())
  ) {
    throw new TypeError(`Invalid ${field}`);
  }
  return value;
}

export function parseProfilePictureUrl(
  value: unknown,
  field = "profile picture",
): string | null {
  if (value === null || value === "") return null;
  const text = boundedString(
    value,
    field,
    MAX_USER_PICTURE_URL_CHARACTERS,
  );
  let parsed: URL;
  try {
    parsed = new URL(
      text,
      globalThis.location?.origin ?? "https://takos.invalid",
    );
  } catch {
    throw new TypeError(`Invalid ${field}`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) || parsed.username ||
    parsed.password
  ) {
    throw new TypeError(`Invalid ${field}`);
  }
  return text;
}

export function parseCurrentUserResponse(value: unknown): User {
  const candidate = record(value);
  if (
    !candidate || typeof candidate.setup_completed !== "boolean" ||
    typeof candidate.username !== "string" ||
    !USERNAME_PATTERN.test(candidate.username) ||
    candidate.username.length > MAX_USER_USERNAME_CHARACTERS
  ) {
    throw new TypeError("Invalid current user response");
  }

  return {
    email: boundedString(
      candidate.email,
      "current user email",
      MAX_USER_EMAIL_CHARACTERS,
      true,
    ),
    name: boundedString(
      candidate.name,
      "current user name",
      MAX_USER_NAME_CHARACTERS,
    ),
    username: candidate.username,
    picture: parseProfilePictureUrl(candidate.picture, "current user picture"),
    setup_completed: candidate.setup_completed,
  };
}

function parseModelIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_USER_SETTINGS_MODELS) {
    throw new TypeError("Invalid user settings model inventory");
  }
  const models = value.map((model) => {
    const text = boundedString(
      model,
      "user settings model id",
      MAX_USER_MODEL_ID_CHARACTERS,
    );
    if (!MODEL_ID_PATTERN.test(text)) {
      throw new TypeError("Invalid user settings model id");
    }
    return text;
  });
  if (new Set(models).size !== models.length) {
    throw new TypeError("Duplicate user settings model id");
  }
  return models;
}

export function parseUserSettingsResponse(value: unknown): UserSettings {
  const candidate = record(value);
  if (
    !candidate || typeof candidate.setup_completed !== "boolean" ||
    typeof candidate.auto_update_enabled !== "boolean" ||
    typeof candidate.private_account !== "boolean" ||
    !ACTIVITY_VISIBILITIES.has(candidate.activity_visibility as string)
  ) {
    throw new TypeError("Invalid user settings response");
  }

  const aiModel = boundedString(
    candidate.ai_model,
    "user settings ai_model",
    MAX_USER_MODEL_ID_CHARACTERS,
  );
  if (!MODEL_ID_PATTERN.test(aiModel)) {
    throw new TypeError("Invalid user settings ai_model");
  }
  const availableModels = parseModelIds(candidate.available_models);
  if (!availableModels.includes(aiModel)) {
    throw new TypeError("Current user settings model is unavailable");
  }

  return {
    setup_completed: candidate.setup_completed,
    auto_update_enabled: candidate.auto_update_enabled,
    private_account: candidate.private_account,
    activity_visibility: candidate.activity_visibility as UserSettings["activity_visibility"],
    ai_model: aiModel,
    available_models: availableModels,
  };
}

export function parseSetupCompleteResponse(value: unknown): void {
  const candidate = record(value);
  if (
    !candidate || candidate.success !== true ||
    candidate.setup_completed !== true
  ) {
    throw new TypeError("Invalid setup completion response");
  }
}

export function parseLogoutResponse(value: unknown): void {
  const candidate = record(value);
  if (!candidate || candidate.success !== true) {
    throw new TypeError("Invalid logout response");
  }
}
