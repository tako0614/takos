import { expect, test } from "bun:test";
import {
  parseThreadShareCreateResponse,
  parseThreadShareRevokeResponse,
  parseThreadSharesResponse,
} from "../../../views/chat/thread-share-response.ts";

const token = "A".repeat(32);
const expected = {
  threadId: "thread-1",
  spaceId: "space-1",
  origin: "https://takos.test",
};

function rawShare(overrides: Record<string, unknown> = {}) {
  return {
    id: "share-1",
    thread_id: expected.threadId,
    space_id: expected.spaceId,
    created_by: "user-1",
    token,
    mode: "public",
    expires_at: null,
    revoked_at: null,
    last_accessed_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function linkedShare(overrides: Record<string, unknown> = {}) {
  return {
    ...rawShare(),
    share_path: `/share/${token}`,
    share_url: `${expected.origin}/share/${token}`,
    ...overrides,
  };
}

test("Thread share responses project a bounded owner-safe record", () => {
  const [share] = parseThreadSharesResponse(
    { shares: [linkedShare()] },
    expected,
  );
  expect(share).toEqual({
    id: "share-1",
    thread_id: expected.threadId,
    space_id: expected.spaceId,
    mode: "public",
    expires_at: null,
    revoked_at: null,
    last_accessed_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
    share_path: `/share/${token}`,
    share_url: `${expected.origin}/share/${token}`,
  });
  expect("token" in share).toBe(false);
  expect("created_by" in share).toBe(false);

  const created = parseThreadShareCreateResponse(
    {
      share: rawShare({ mode: "password" }),
      share_path: `/share/${token}`,
      share_url: `${expected.origin}/share/${token}`,
      password_required: true,
    },
    expected,
  );
  expect(created.mode).toBe("password");
});

test("Thread share responses reject authority and link drift", () => {
  expect(() =>
    parseThreadSharesResponse(
      { shares: [linkedShare({ thread_id: "thread-2" })] },
      expected,
    )
  ).toThrow();
  expect(() =>
    parseThreadSharesResponse(
      { shares: [linkedShare({ space_id: "space-2" })] },
      expected,
    )
  ).toThrow();
  expect(() =>
    parseThreadSharesResponse(
      {
        shares: [
          linkedShare({ share_url: `https://evil.test/share/${token}` }),
        ],
      },
      expected,
    )
  ).toThrow();
  expect(() =>
    parseThreadSharesResponse(
      { shares: [linkedShare({ share_path: `/share/${"B".repeat(32)}` })] },
      expected,
    )
  ).toThrow();
});

test("Thread share responses reject ambiguous and malformed success", () => {
  expect(() =>
    parseThreadSharesResponse(
      { shares: [linkedShare(), linkedShare()] },
      expected,
    )
  ).toThrow();
  expect(() =>
    parseThreadSharesResponse(
      { shares: [linkedShare({ unexpected: true })] },
      expected,
    )
  ).toThrow();
  expect(() =>
    parseThreadSharesResponse(
      {
        shares: [
          linkedShare({ revoked_at: "2026-08-09T00:00:00.000Z" }),
        ],
      },
      expected,
    )
  ).toThrow();
  expect(() =>
    parseThreadShareCreateResponse(
      {
        share: rawShare({ mode: "password" }),
        share_path: `/share/${token}`,
        share_url: `${expected.origin}/share/${token}`,
        password_required: false,
      },
      expected,
    )
  ).toThrow();
  expect(() => parseThreadShareRevokeResponse({ success: true })).not.toThrow();
  expect(() =>
    parseThreadShareRevokeResponse({ success: true, id: "share-1" })
  ).toThrow();
});
