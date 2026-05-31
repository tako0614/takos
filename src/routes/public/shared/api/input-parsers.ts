import type {
  ArtifactType,
  MessageRole,
} from "takos-api-contract/shared/types";
import { isArtifactType } from "../runs/artifacts.ts";
import type { CreateRunArtifactInput } from "../runs/artifacts.ts";
import type { CreateRunInput } from "../runs/create.ts";
import type {
  CreateThreadInput,
  UpdateThreadInput,
} from "../threads/mutations.ts";
import type { CreateThreadMessageInput } from "../threads/messages.ts";
import type { CreateThreadShareInput } from "../threads/shares.ts";
import {
  isRecord,
  optionalLocaleField,
  optionalStringField,
} from "./common.ts";

export type ParseCreateRunArtifactResult =
  | { ok: true; value: CreateRunArtifactInput }
  | { ok: false; message: string };

export type ParseCreateRunResult =
  | { ok: true; value: CreateRunInput }
  | { ok: false; message: string };

export type ParseCreateThreadResult =
  | { ok: true; value: CreateThreadInput }
  | { ok: false; message: string };

export type ParseUpdateThreadResult =
  | { ok: true; value: UpdateThreadInput }
  | { ok: false; message: string };

export type ParseCreateThreadMessageResult =
  | { ok: true; value: CreateThreadMessageInput }
  | { ok: false; message: string };

export type ParseCreateThreadShareResult =
  | { ok: true; value: CreateThreadShareInput }
  | { ok: false; message: string };

export function parseCreateThreadInput(
  body: unknown,
): ParseCreateThreadResult {
  if (!isRecord(body)) {
    return { ok: false, message: "request body is required" };
  }
  const title = optionalStringField(body, "title");
  if (!title.ok) return title;
  const locale = optionalLocaleField(body, "locale", false);
  if (!locale.ok) return locale;
  return {
    ok: true,
    value: {
      ...(title.value !== undefined ? { title: title.value } : {}),
      ...(locale.value !== undefined ? { locale: locale.value } : {}),
    },
  };
}

export function parseUpdateThreadInput(
  body: unknown,
): ParseUpdateThreadResult {
  if (!isRecord(body)) {
    return { ok: false, message: "request body is required" };
  }
  const title = optionalStringField(body, "title");
  if (!title.ok) return title;
  const locale = optionalLocaleField(body, "locale", true);
  if (!locale.ok) return locale;
  const statusValue = body.status;
  if (statusValue !== undefined && !isThreadStatus(statusValue)) {
    return { ok: false, message: "Invalid thread status" };
  }
  const contextWindow = body.context_window;
  if (
    contextWindow !== undefined &&
    (typeof contextWindow !== "number" ||
      !Number.isInteger(contextWindow) ||
      contextWindow < 20 ||
      contextWindow > 200)
  ) {
    return {
      ok: false,
      message: "context_window must be an integer between 20 and 200",
    };
  }

  const value: UpdateThreadInput = {};
  if (title.value !== undefined) value.title = title.value || null;
  if (locale.value !== undefined) value.locale = locale.value;
  if (isThreadStatus(statusValue)) value.status = statusValue;
  if (typeof contextWindow === "number") value.context_window = contextWindow;
  if (Object.keys(value).length === 0) {
    return { ok: false, message: "No valid updates provided" };
  }
  return { ok: true, value };
}

export function parseCreateThreadMessageInput(
  body: unknown,
): ParseCreateThreadMessageResult {
  if (!isRecord(body)) {
    return { ok: false, message: "request body is required" };
  }
  const role = body.role;
  if (typeof role !== "string" || !isMessageRole(role)) {
    return { ok: false, message: "Invalid message role" };
  }

  const contentField = optionalStringField(body, "content");
  if (!contentField.ok) return contentField;
  const content = contentField.value ?? "";
  const toolCallId = optionalStringField(body, "tool_call_id");
  if (!toolCallId.ok) return toolCallId;

  const toolCalls = body.tool_calls;
  if (toolCalls !== undefined && !Array.isArray(toolCalls)) {
    return { ok: false, message: "tool_calls must be an array" };
  }

  const metadata = body.metadata;
  if (metadata !== undefined && !isRecord(metadata)) {
    return { ok: false, message: "metadata must be an object" };
  }

  const attachmentCount = isRecord(metadata) && Array.isArray(
      metadata.attachments,
    )
    ? metadata.attachments.length
    : 0;
  if (!content && attachmentCount === 0) {
    return { ok: false, message: "Content is required" };
  }

  return {
    ok: true,
    value: {
      role,
      content,
      ...(toolCalls !== undefined ? { tool_calls: toolCalls } : {}),
      ...(toolCallId.value !== undefined
        ? { tool_call_id: toolCallId.value }
        : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    },
  };
}

export function parseCreateThreadShareInput(
  body: unknown,
): ParseCreateThreadShareResult {
  if (!isRecord(body)) {
    return { ok: false, message: "request body is required" };
  }

  const modeValue = body.mode;
  if (
    modeValue !== undefined &&
    modeValue !== "public" &&
    modeValue !== "password"
  ) {
    return { ok: false, message: "mode must be public or password" };
  }
  const mode = modeValue === "password" ? "password" : "public";

  const password = optionalStringField(body, "password");
  if (!password.ok) return password;
  const expiresAt = optionalStringField(body, "expires_at");
  if (!expiresAt.ok) return expiresAt;

  const expiresInDays = body.expires_in_days;
  if (expiresInDays !== undefined && typeof expiresInDays !== "number") {
    return { ok: false, message: "expires_in_days must be a number" };
  }
  let resolvedExpiresAt = expiresAt.value ?? null;
  if (!resolvedExpiresAt && typeof expiresInDays === "number") {
    if (
      !Number.isFinite(expiresInDays) ||
      expiresInDays <= 0 ||
      expiresInDays > 365
    ) {
      return {
        ok: false,
        message: "expires_in_days must be between 1 and 365",
      };
    }
    resolvedExpiresAt = new Date(
      Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    ).toISOString();
  }

  return {
    ok: true,
    value: {
      mode,
      password: password.value ?? null,
      expires_at: resolvedExpiresAt,
    },
  };
}

export function parseCreateRunInput(body: unknown): ParseCreateRunResult {
  if (!isRecord(body)) {
    return { ok: false, message: "request body is required" };
  }

  const agentType = optionalStringField(body, "agent_type");
  if (!agentType.ok) return agentType;
  const parentRunId = optionalStringField(body, "parent_run_id");
  if (!parentRunId.ok) return parentRunId;
  const model = optionalStringField(body, "model");
  if (!model.ok) return model;

  const input = body.input;
  if (input !== undefined && !isRecord(input)) {
    return { ok: false, message: "input must be an object" };
  }

  return {
    ok: true,
    value: {
      ...(agentType.value !== undefined ? { agent_type: agentType.value } : {}),
      ...(input !== undefined ? { input } : {}),
      ...(parentRunId.value !== undefined
        ? { parent_run_id: parentRunId.value }
        : {}),
      ...(model.value !== undefined ? { model: model.value } : {}),
    },
  };
}

function isMessageRole(value: string): value is MessageRole {
  return value === "user" ||
    value === "assistant" ||
    value === "system" ||
    value === "tool";
}

function isThreadStatus(
  value: unknown,
): value is "active" | "archived" | "deleted" {
  return value === "active" || value === "archived" || value === "deleted";
}

export function parseCreateRunArtifactInput(
  body: unknown,
): ParseCreateRunArtifactResult {
  if (!isRecord(body)) {
    return { ok: false, message: "request body is required" };
  }
  const type = body.type;
  if (typeof type !== "string" || !isArtifactType(type)) {
    return { ok: false, message: "Invalid artifact type" };
  }

  const title = optionalStringField(body, "title");
  if (!title.ok) return title;
  const content = optionalStringField(body, "content");
  if (!content.ok) return content;
  const fileId = optionalStringField(body, "file_id");
  if (!fileId.ok) return fileId;

  const metadata = body.metadata;
  if (metadata !== undefined && !isRecord(metadata)) {
    return { ok: false, message: "metadata must be an object" };
  }

  return {
    ok: true,
    value: {
      type: type as ArtifactType,
      ...(title.value !== undefined ? { title: title.value } : {}),
      ...(content.value !== undefined ? { content: content.value } : {}),
      ...(fileId.value !== undefined ? { file_id: fileId.value } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    },
  };
}
