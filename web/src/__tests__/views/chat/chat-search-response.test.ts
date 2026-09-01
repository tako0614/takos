import { describe, expect, test } from "bun:test";
import {
  CHAT_SEARCH_RESULT_LIMIT,
  parseChatSearchResponse,
} from "../../../views/chat/chat-search-response.ts";

const expected = { query: "needle", type: "all" as const };

function response() {
  return {
    query: expected.query,
    type: expected.type,
    limit: CHAT_SEARCH_RESULT_LIMIT,
    offset: 0,
    semantic_available: true,
    results: [
      {
        kind: "keyword",
        thread: {
          id: "thread-1",
          title: "Conversation",
          status: "active",
          created_at: "ignored",
        },
        message: {
          id: "message-1",
          sequence: 4,
          role: "user",
          created_at: "ignored",
        },
        snippet: "a needle here",
        match: { start: 2, end: 8 },
        ignored: "not projected",
      },
    ],
  };
}

describe("chat search response boundary", () => {
  test("accepts and projects one exact search result", () => {
    expect(parseChatSearchResponse(response(), expected)).toEqual({
      semanticAvailable: true,
      results: [
        {
          kind: "keyword",
          thread: {
            id: "thread-1",
            title: "Conversation",
            status: "active",
          },
          message: { id: "message-1", sequence: 4 },
          snippet: "a needle here",
          match: { start: 2, end: 8 },
        },
      ],
    });
  });

  test("rejects query, mode, pagination, and capability drift", () => {
    for (const mutation of [
      { query: "other" },
      { type: "semantic" },
      { limit: 100 },
      { offset: 20 },
      { semantic_available: "yes" },
    ]) {
      expect(() =>
        parseChatSearchResponse({ ...response(), ...mutation }, expected)
      ).toThrow();
    }
  });

  test("rejects malformed identities, scores, ranges, and duplicates", () => {
    const valid = response();
    for (const result of [
      { ...valid.results[0], kind: "filename" },
      { ...valid.results[0], score: 0.9 },
      {
        ...valid.results[0],
        message: { ...valid.results[0]!.message, sequence: -1 },
      },
      { ...valid.results[0], match: { start: 2, end: 200 } },
      {
        ...valid.results[0],
        thread: { ...valid.results[0]!.thread, status: "deleted" },
      },
    ]) {
      expect(() =>
        parseChatSearchResponse({ ...valid, results: [result] }, expected)
      ).toThrow();
    }
    expect(() =>
      parseChatSearchResponse(
        { ...valid, results: [valid.results[0], valid.results[0]] },
        expected,
      )
    ).toThrow();
  });
});
