import { describe, expect, test } from "bun:test";
import {
  getNotificationTargetPath,
  mergeNotificationPages,
  notificationPageCursor,
  parseNotificationMutation,
  parseNotificationPage,
  parseUnreadCount,
} from "../../../views/notifications/notification-response.ts";

const runNotification = {
  id: "notification-1",
  user_id: "principal-1",
  space_id: "space-1",
  type: "run.completed",
  title: "Agent response is ready",
  body: "Open the conversation.",
  data: {
    run_id: "run-1",
    thread_id: "thread-1",
    route: "/chat/space-1/thread-1",
  },
  read_at: null,
  created_at: "2026-08-09T20:00:00.000Z",
};

describe("notification response validation", () => {
  test("accepts a bounded notification page and projects only display fields", () => {
    const [notification] = parseNotificationPage({
      notifications: [{ ...runNotification, secret: "not projected" }],
    });
    expect(notification).toEqual({
      id: "notification-1",
      spaceId: "space-1",
      type: "run.completed",
      title: "Agent response is ready",
      body: "Open the conversation.",
      data: runNotification.data,
      readAt: null,
      createdAt: "2026-08-09T20:00:00.000Z",
    });
  });

  test("rejects malformed success, unknown types, timestamps, and duplicate ids", () => {
    expect(() => parseNotificationPage({})).toThrow(TypeError);
    expect(() =>
      parseNotificationPage({
        notifications: [{ ...runNotification, type: "unknown" }],
      })
    ).toThrow(TypeError);
    expect(() =>
      parseNotificationPage({
        notifications: [{ ...runNotification, created_at: "not-a-date" }],
      })
    ).toThrow(TypeError);
    expect(() =>
      parseNotificationPage({
        notifications: [runNotification, runNotification],
      })
    ).toThrow(TypeError);
  });

  test("validates mutation and unread-count responses", () => {
    expect(parseNotificationMutation({ success: true })).toBe(true);
    expect(() => parseNotificationMutation({ success: false })).toThrow(
      TypeError,
    );
    expect(parseUnreadCount({ unread_count: 3 })).toBe(3);
    expect(() => parseUnreadCount({ unread_count: -1 })).toThrow(TypeError);
    expect(() => parseUnreadCount({ unread_count: 1.5 })).toThrow(TypeError);
  });
});

test("notification pagination uses the composite cursor and de-duplicates overlaps", () => {
  const first = parseNotificationPage({ notifications: [runNotification] });
  const second = parseNotificationPage({
    notifications: [
      runNotification,
      {
        ...runNotification,
        id: "notification-2",
        created_at: "2026-08-09T19:00:00.000Z",
      },
    ],
  });
  expect(notificationPageCursor(first)).toEqual({
    before: "2026-08-09T20:00:00.000Z",
    beforeId: "notification-1",
  });
  expect(mergeNotificationPages(first, second).map((item) => item.id)).toEqual([
    "notification-1",
    "notification-2",
  ]);
});

test("notification targets are derived only from same-record authority", () => {
  const [run] = parseNotificationPage({ notifications: [runNotification] });
  expect(getNotificationTargetPath(run)).toBe("/chat/space-1/thread-1");

  const [crossSpace] = parseNotificationPage({
    notifications: [{
      ...runNotification,
      data: { ...runNotification.data, route: "/chat/space-2/thread-1" },
    }],
  });
  expect(getNotificationTargetPath(crossSpace)).toBeNull();

  const [external] = parseNotificationPage({
    notifications: [{
      ...runNotification,
      data: { ...runNotification.data, route: "//evil.example/thread" },
    }],
  });
  expect(getNotificationTargetPath(external)).toBeNull();

  const [invite] = parseNotificationPage({
    notifications: [{
      ...runNotification,
      id: "notification-invite",
      type: "workspace.invite",
      data: { space_id: "space-1", workspace_name: "Team", role: "editor" },
    }],
  });
  expect(getNotificationTargetPath(invite)).toBeNull();
});
