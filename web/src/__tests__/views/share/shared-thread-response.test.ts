import { describe, expect, test } from "bun:test";
import {
  appendSharedThreadPage,
  parseSharedThreadError,
  parseSharedThreadPayload,
} from "../../../views/share/shared-thread-response.ts";

const TOKEN = "a".repeat(32);
const NOW = "2026-08-10T00:00:00.000Z";

function payload(
  options: {
    offset?: number;
    nextOffset?: number | null;
    messageId?: string;
    sequence?: number;
  } = {},
) {
  const offset = options.offset ?? 0;
  const nextOffset =
    options.nextOffset === undefined ? null : options.nextOffset;
  return {
    token: TOKEN,
    share: {
      mode: "password",
      expires_at: null,
      created_at: NOW,
    },
    thread: {
      id: "thread_1",
      title: "Shared conversation",
      created_at: NOW,
      updated_at: NOW,
    },
    messages: [
      {
        id: options.messageId ?? "message_1",
        role: "assistant",
        content: "Bounded answer",
        content_truncated: false,
        sequence: options.sequence ?? 1,
        created_at: NOW,
      },
    ],
    page: {
      limit: 50,
      offset,
      has_more: nextOffset !== null,
      next_offset: nextOffset,
      message_data_truncated: false,
    },
  };
}

describe("shared Thread response validation", () => {
  test("accepts the exact bounded public projection", () => {
    const result = parseSharedThreadPayload(payload(), {
      token: TOKEN,
      limit: 50,
      offset: 0,
    });

    expect(result.messages).toEqual([
      {
        id: "message_1",
        role: "assistant",
        content: "Bounded answer",
        content_truncated: false,
        sequence: 1,
        created_at: NOW,
      },
    ]);
  });

  test("rejects cross-link identity, non-public roles, and surplus fields", () => {
    expect(() =>
      parseSharedThreadPayload(
        { ...payload(), token: "b".repeat(32) },
        {
          token: TOKEN,
          limit: 50,
          offset: 0,
        },
      ),
    ).toThrow(TypeError);

    const internalRole = payload();
    internalRole.messages[0].role = "tool";
    expect(() =>
      parseSharedThreadPayload(internalRole, {
        token: TOKEN,
        limit: 50,
        offset: 0,
      }),
    ).toThrow(TypeError);

    expect(() =>
      parseSharedThreadPayload(
        { ...payload(), internal: "secret" },
        {
          token: TOKEN,
          limit: 50,
          offset: 0,
        },
      ),
    ).toThrow(TypeError);
  });

  test("requires coherent pagination and explicit truncation evidence", () => {
    const ambiguousPage = payload({ nextOffset: 0 });
    expect(() =>
      parseSharedThreadPayload(ambiguousPage, {
        token: TOKEN,
        limit: 50,
        offset: 0,
      }),
    ).toThrow(TypeError);

    const hiddenTruncation = payload();
    hiddenTruncation.messages[0].content_truncated = true;
    expect(() =>
      parseSharedThreadPayload(hiddenTruncation, {
        token: TOKEN,
        limit: 50,
        offset: 0,
      }),
    ).toThrow(TypeError);
  });

  test("appends only the declared non-overlapping continuation", () => {
    const first = parseSharedThreadPayload(payload({ nextOffset: 50 }), {
      token: TOKEN,
      limit: 50,
      offset: 0,
    });
    const second = parseSharedThreadPayload(
      payload({
        offset: 50,
        messageId: "message_2",
        sequence: 2,
      }),
      {
        token: TOKEN,
        limit: 50,
        offset: 50,
      },
    );

    expect(
      appendSharedThreadPage(first, second).messages.map(
        (message) => message.id,
      ),
    ).toEqual(["message_1", "message_2"]);
    expect(() => appendSharedThreadPage(first, first)).toThrow(TypeError);
  });

  test("parses the standard nested error envelope without rendering objects", () => {
    expect(
      parseSharedThreadError({
        error: {
          code: "AUTHENTICATION_ERROR",
          message: "Password required",
          details: { requires_password: true, retryAfter: 12 },
        },
      }),
    ).toEqual({
      code: "AUTHENTICATION_ERROR",
      message: "Password required",
      requiresPassword: true,
      invalidPassword: false,
      retryAfter: 12,
    });
    expect(
      parseSharedThreadError({ error: { message: { unsafe: true } } }),
    ).toMatchObject({ message: null });
  });
});
