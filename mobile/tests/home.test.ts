import { expect, test } from "bun:test";

import type { MobileSession } from "@takosjp/takosumi-mobile-kit";
import {
  createTakosMobileAgentTask,
  updateTakosMobileAgentTaskStatus,
} from "../src/agent-tasks.ts";
import {
  applyTakosMobileGitAppRevision,
  installTakosMobileGitApp,
  planTakosMobileGitAppRevision,
  removeTakosMobileAppInstallation,
} from "../src/apps.ts";
import {
  cancelTakosMobileRun,
  createTakosMobileChatMessage,
  isTakosMobileRunTerminalStatus,
  loadTakosMobileRunEvents,
  loadTakosMobileThreadMessages,
  loadTakosMobileThreadTranscript,
  loadTakosMobileRunStatus,
  watchTakosMobileRunEventStream,
} from "../src/chat.ts";
import { loadTakosMobileHome } from "../src/home.ts";
import {
  createTakosMobileMemory,
  deleteTakosMobileMemory,
} from "../src/memory.ts";
import {
  loadTakosMobileNotificationsPage,
  loadTakosMobileNotificationSettings,
  markAllTakosMobileNotificationsRead,
  markTakosMobileNotificationRead,
  setTakosMobileNotificationsMutedUntil,
  updateTakosMobileNotificationPreference,
} from "../src/notifications.ts";
import {
  registerTakosMobilePush,
  unregisterTakosMobilePush,
} from "../src/push.ts";

const session: MobileSession = {
  hostUrl: "https://takos.test",
  product: "takos",
  oidcIssuer: "https://takos.test",
  accessToken: "mobile-token",
  tokenType: "Bearer",
  createdAt: "2026-06-30T00:00:00.000Z",
};

test("loadTakosMobileHome reads workspace summary APIs with bearer auth", async () => {
  const seen: Array<{ url: string; method: string; authorization?: string }> =
    [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = init?.headers as Record<string, string>;
    seen.push({ url, method, authorization: headers.authorization });

    if (url.endsWith("/api/auth/me")) {
      return json({
        user: {
          display_name: "Alice",
          username: "alice",
          email: "alice@example.com",
        },
      });
    }
    if (url.endsWith("/api/spaces")) {
      return json({
        spaces: [
          { id: "space-1", kind: "user", name: "Personal" },
          { id: "space-2", kind: "team", name: "Team", slug: "team" },
        ],
      });
    }
    if (url.endsWith("/api/spaces/me/threads?status=active")) {
      return json({
        threads: [
          {
            id: "thread-1",
            title: "Plan mobile",
            updated_at: "2026-06-30T09:30:00.000Z",
          },
          {
            id: "thread-2",
            title: "Agent work",
            updated_at: "2026-06-30T08:30:00.000Z",
          },
          {
            id: "thread-3",
            title: "Memory notes",
            updated_at: "2026-06-30T07:30:00.000Z",
          },
          {
            id: "thread-4",
            title: "Older chat",
            updated_at: "2026-06-30T06:30:00.000Z",
          },
        ],
      });
    }
    if (url.endsWith("/api/spaces/me/agent-tasks?limit=4")) {
      return json({
        tasks: [
          {
            id: "task-1",
            title: "Deploy mobile host",
            description: "Finish the app-host handoff.",
            status: "in_progress",
            priority: "high",
            thread_id: "thread-2",
            thread_title: "Agent work",
            latest_run: { status: "running" },
            updated_at: "2026-06-30T08:45:00.000Z",
          },
          {
            id: "task-2",
            title: "Review memory",
            status: "planned",
            priority: "medium",
            resume_target: { thread_id: "thread-3" },
            updated_at: "2026-06-30T07:45:00.000Z",
          },
        ],
      });
    }
    if (url.endsWith("/api/spaces/me/memories?limit=4")) {
      return json({
        memories: [
          {
            id: "memory-1",
            type: "semantic",
            summary: "Mobile clients stay host-backed.",
            content: "The full note is longer than the summary.",
            category: "architecture",
            importance: 0.8,
            created_at: "2026-06-30T07:00:00.000Z",
          },
          {
            id: "memory-2",
            type: "procedural",
            content: "Use Host Center for new hosts.",
            importance: 0.5,
            created_at: "2026-06-30T06:00:00.000Z",
          },
        ],
      });
    }
    if (url.endsWith("/api/spaces/me/app-installations")) {
      return json({
        installations: [
          {
            id: "inst-1",
            app_id: "jp.takos.office",
            status: "ready",
            source: {
              kind: "git",
              url: "https://github.com/tako0614/takos-office.git",
              ref: "main",
              modulePath: "deploy/opentofu",
              commit: "1111111111111111111111111111111111111111",
            },
            services: [
              {
                id: "launch_url",
                endpoint: "https://office.takos.test/",
              },
            ],
          },
        ],
      });
    }
    if (url.endsWith("/api/threads/thread-1/messages?limit=5&offset=0")) {
      return json({
        messages: [
          {
            id: "message-1",
            role: "user",
            content: "Can we plan the mobile app?",
            created_at: "2026-06-30T09:31:00.000Z",
          },
          {
            id: "message-2",
            role: "assistant",
            content: "Yes. We should keep the native client focused.",
            created_at: "2026-06-30T09:32:00.000Z",
          },
        ],
      });
    }
    if (
      url.endsWith("/api/threads/thread-2/messages?limit=5&offset=0") ||
      url.endsWith("/api/threads/thread-3/messages?limit=5&offset=0")
    ) {
      return json({ messages: [] });
    }
    if (url.endsWith("/api/apps")) {
      return json({
        apps: [
          {
            id: "app-1",
            name: "Docs",
            description: "Workspace documents",
            app_type: "custom",
            space_id: "space-1",
            space_name: "Personal",
            service_status: "deployed",
            service_hostname: "docs.takos.test",
            url: "/apps/docs/",
          },
          {
            id: "app-2",
            name: "External",
            url: "https://external.example/app?token=redacted",
          },
          {
            id: "app-3",
            name: "Unsafe",
            url: "javascript:alert(1)",
          },
          {
            id: "app-4",
            name: "Same Origin",
            url: "https://takos.test/apps/same-origin?x=1#open",
          },
          {
            id: "app-5",
            name: "No URL",
          },
        ],
      });
    }
    if (url.endsWith("/api/notifications/unread-count")) {
      return json({ unread_count: 3 });
    }
    if (url.endsWith("/api/notifications?limit=3")) {
      return json({
        notifications: [
          {
            id: "notification-1",
            title: "Agent finished",
            body: "Your workspace agent completed the run.",
            data: { path: "/runs/run-1" },
            created_at: "2026-06-30T10:00:00.000Z",
            read_at: null,
          },
        ],
      });
    }
    return Promise.resolve(new Response("", { status: 404 }));
  }) as typeof fetch;

  try {
    const home = await loadTakosMobileHome(session);

    expect(home).toEqual({
      userName: "Alice",
      workspaceCount: 2,
      appCount: 5,
      unreadNotifications: 3,
      chatTarget: {
        spaceId: "me",
        spaceName: "Personal",
      },
      threadList: [
        {
          id: "thread-1",
          title: "Plan mobile",
          updatedAt: "2026-06-30T09:30:00.000Z",
          routePath: "/chat/me/thread-1",
        },
        {
          id: "thread-2",
          title: "Agent work",
          updatedAt: "2026-06-30T08:30:00.000Z",
          routePath: "/chat/me/thread-2",
        },
        {
          id: "thread-3",
          title: "Memory notes",
          updatedAt: "2026-06-30T07:30:00.000Z",
          routePath: "/chat/me/thread-3",
        },
        {
          id: "thread-4",
          title: "Older chat",
          updatedAt: "2026-06-30T06:30:00.000Z",
          routePath: "/chat/me/thread-4",
        },
      ],
      recentThreads: [
        {
          id: "thread-1",
          title: "Plan mobile",
          updatedAt: "2026-06-30T09:30:00.000Z",
          routePath: "/chat/me/thread-1",
          recentMessages: [
            {
              id: "message-1",
              role: "user",
              text: "Can we plan the mobile app?",
              createdAt: "2026-06-30T09:31:00.000Z",
            },
            {
              id: "message-2",
              role: "assistant",
              text: "Yes. We should keep the native client focused.",
              createdAt: "2026-06-30T09:32:00.000Z",
            },
          ],
          lastMessage: {
            id: "message-2",
            role: "assistant",
            text: "Yes. We should keep the native client focused.",
            createdAt: "2026-06-30T09:32:00.000Z",
          },
        },
        {
          id: "thread-2",
          title: "Agent work",
          updatedAt: "2026-06-30T08:30:00.000Z",
          routePath: "/chat/me/thread-2",
        },
        {
          id: "thread-3",
          title: "Memory notes",
          updatedAt: "2026-06-30T07:30:00.000Z",
          routePath: "/chat/me/thread-3",
        },
      ],
      agentTasks: [
        {
          id: "task-1",
          title: "Deploy mobile host",
          description: "Finish the app-host handoff.",
          status: "in_progress",
          priority: "high",
          threadTitle: "Agent work",
          latestRunStatus: "running",
          updatedAt: "2026-06-30T08:45:00.000Z",
          routePath: "/chat/me/thread-2",
        },
        {
          id: "task-2",
          title: "Review memory",
          status: "planned",
          priority: "medium",
          updatedAt: "2026-06-30T07:45:00.000Z",
          routePath: "/chat/me/thread-3",
        },
      ],
      memories: [
        {
          id: "memory-1",
          type: "semantic",
          text: "Mobile clients stay host-backed.",
          category: "architecture",
          importance: 0.8,
          createdAt: "2026-06-30T07:00:00.000Z",
          routePath: "/memory",
        },
        {
          id: "memory-2",
          type: "procedural",
          text: "Use Host Center for new hosts.",
          importance: 0.5,
          createdAt: "2026-06-30T06:00:00.000Z",
          routePath: "/memory",
        },
      ],
      appInstallations: [
        {
          id: "inst-1",
          spaceId: "me",
          appId: "jp.takos.office",
          name: "jp.takos.office",
          status: "ready",
          gitUrl: "https://github.com/tako0614/takos-office.git",
          ref: "main",
          modulePath: "deploy/opentofu",
          sourceCommit: "1111111111111111111111111111111111111111",
          launchUrl: "https://office.takos.test/",
          routePath: "/installations/inst-1",
        },
      ],
      apps: [
        {
          id: "app-1",
          name: "Docs",
          description: "Workspace documents",
          appType: "custom",
          spaceId: "space-1",
          spaceName: "Personal",
          status: "deployed",
          serviceHostname: "docs.takos.test",
          launcherPath: "/apps/space-1",
          launchTarget: {
            kind: "host",
            path: "/apps/docs/",
          },
        },
        {
          id: "app-2",
          name: "External",
          launcherPath: "/apps",
          launchTarget: {
            kind: "external",
            url: "https://external.example/app?token=redacted",
          },
        },
        {
          id: "app-3",
          name: "Unsafe",
          launcherPath: "/apps",
          launchTarget: {
            kind: "unavailable",
          },
        },
        {
          id: "app-4",
          name: "Same Origin",
          launcherPath: "/apps",
          launchTarget: {
            kind: "host",
            path: "/apps/same-origin?x=1#open",
          },
        },
        {
          id: "app-5",
          name: "No URL",
          launcherPath: "/apps",
          launchTarget: {
            kind: "unavailable",
          },
        },
      ],
      recentNotifications: [
        {
          id: "notification-1",
          title: "Agent finished",
          body: "Your workspace agent completed the run.",
          createdAt: "2026-06-30T10:00:00.000Z",
          routePath: "/runs/run-1",
          unread: true,
        },
      ],
    });
    expect(seen.map((item) => `${item.method} ${item.url}`)).toEqual([
      "GET https://takos.test/api/auth/me",
      "GET https://takos.test/api/spaces",
      "GET https://takos.test/api/apps",
      "GET https://takos.test/api/notifications/unread-count",
      "GET https://takos.test/api/notifications?limit=3",
      "GET https://takos.test/api/spaces/me/threads?status=active",
      "GET https://takos.test/api/spaces/me/agent-tasks?limit=4",
      "GET https://takos.test/api/spaces/me/memories?limit=4",
      "GET https://takos.test/api/spaces/me/app-installations",
      "GET https://takos.test/api/threads/thread-1/messages?limit=5&offset=0",
      "GET https://takos.test/api/threads/thread-2/messages?limit=5&offset=0",
      "GET https://takos.test/api/threads/thread-3/messages?limit=5&offset=0",
    ]);
    for (const item of seen) {
      expect(item.authorization).toBe("Bearer mobile-token");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadTakosMobileThreadMessages reads the latest message window from the thread timeline", async () => {
  const requests: Request[] = [];

  await expect(
    loadTakosMobileThreadMessages({
      session,
      threadId: "thread-1",
      limit: 3,
      latest: true,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const url = new URL(request.url);
        if (url.searchParams.get("offset") === "0") {
          return json({
            messages: [
              {
                id: "message-1",
                role: "user",
                content: "first message",
                sequence: 0,
                created_at: "2026-06-30T09:00:00.000Z",
              },
              {
                id: "message-2",
                role: "assistant",
                content: "second message",
                sequence: 1,
                created_at: "2026-06-30T09:01:00.000Z",
              },
              {
                id: "message-3",
                role: "user",
                content: "third message",
                sequence: 2,
                created_at: "2026-06-30T09:02:00.000Z",
              },
            ],
            total: 7,
            limit: 3,
            offset: 0,
          });
        }
        return json({
          messages: [
            {
              id: "message-5",
              role: "user",
              content: "fifth message",
              sequence: 4,
              created_at: "2026-06-30T09:04:00.000Z",
            },
            {
              id: "message-6",
              role: "assistant",
              content: "sixth message",
              sequence: 5,
              created_at: "2026-06-30T09:05:00.000Z",
            },
            {
              id: "message-7",
              role: "user",
              content: "seventh message",
              sequence: 6,
              created_at: "2026-06-30T09:06:00.000Z",
            },
          ],
          total: 7,
          limit: 3,
          offset: 4,
        });
      },
    }),
  ).resolves.toEqual({
    messages: [
      {
        id: "message-5",
        sequence: 4,
        role: "user",
        text: "fifth message",
        createdAt: "2026-06-30T09:04:00.000Z",
      },
      {
        id: "message-6",
        sequence: 5,
        role: "assistant",
        text: "sixth message",
        createdAt: "2026-06-30T09:05:00.000Z",
      },
      {
        id: "message-7",
        sequence: 6,
        role: "user",
        text: "seventh message",
        createdAt: "2026-06-30T09:06:00.000Z",
      },
    ],
    total: 7,
    limit: 3,
    offset: 4,
    hasOlder: true,
    nextOlderOffset: 1,
  });

  expect(requests.map((request) => request.url)).toEqual([
    "https://takos.test/api/threads/thread-1/messages?limit=3&offset=0",
    "https://takos.test/api/threads/thread-1/messages?limit=3&offset=4",
  ]);
  for (const request of requests) {
    expect(request.headers.get("authorization")).toBe("Bearer mobile-token");
  }
});

test("loadTakosMobileThreadMessages reads an older page by offset", async () => {
  const requests: Request[] = [];

  await expect(
    loadTakosMobileThreadMessages({
      session,
      threadId: "thread-1",
      limit: 3,
      offset: 1,
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return json({
          messages: [
            {
              id: "message-2",
              role: "assistant",
              content: "second message",
              sequence: 1,
              created_at: "2026-06-30T09:01:00.000Z",
            },
          ],
          total: 7,
          limit: 3,
          offset: 1,
        });
      },
    }),
  ).resolves.toMatchObject({
    total: 7,
    limit: 3,
    offset: 1,
    hasOlder: true,
    nextOlderOffset: 0,
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe(
    "https://takos.test/api/threads/thread-1/messages?limit=3&offset=1",
  );
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
});

test("loadTakosMobileThreadTranscript reads the latest transcript window", async () => {
  const requests: Request[] = [];

  await expect(
    loadTakosMobileThreadTranscript({
      session,
      threadId: "thread-1",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const url = new URL(request.url);
        if (url.searchParams.get("offset") === "0") {
          return json({
            messages: [{ id: "message-1", role: "user", content: "old" }],
            total: 24,
            limit: 20,
            offset: 0,
          });
        }
        return json({
          messages: [
            {
              id: "message-5",
              role: "assistant",
              content: "latest assistant answer",
              sequence: 4,
            },
          ],
          total: 24,
          limit: 20,
          offset: 4,
        });
      },
    }),
  ).resolves.toMatchObject({
    messages: [
      {
        id: "message-5",
        sequence: 4,
        role: "assistant",
        text: "latest assistant answer",
      },
    ],
    total: 24,
    limit: 20,
    offset: 4,
    hasOlder: true,
    nextOlderOffset: 0,
  });

  expect(requests.map((request) => request.url)).toEqual([
    "https://takos.test/api/threads/thread-1/messages?limit=20&offset=0",
    "https://takos.test/api/threads/thread-1/messages?limit=20&offset=4",
  ]);
  for (const request of requests) {
    expect(request.headers.get("authorization")).toBe("Bearer mobile-token");
  }
});

test("createTakosMobileChatMessage creates a thread, message, and run", async () => {
  const requests: Request[] = [];

  const result = await createTakosMobileChatMessage({
    session,
    content: "Hello mobile",
    locale: "en",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      const url = request.url;
      if (url.endsWith("/api/spaces")) {
        return json({
          spaces: [{ id: "space-1", kind: "user", name: "Personal" }],
        });
      }
      if (url.endsWith("/api/spaces/me/model")) {
        return json({ model: "takosumi/default" });
      }
      if (url.endsWith("/api/spaces/me/threads")) {
        return json({ thread: { id: "thread-1" } });
      }
      if (url.endsWith("/api/threads/thread-1/messages")) {
        return json({ message: { id: "message-1" } });
      }
      if (url.endsWith("/api/threads/thread-1/runs")) {
        return json({ run: { id: "run-1" } });
      }
      return new Response("", { status: 404 });
    },
  });

  expect(result).toEqual({
    spaceId: "me",
    threadId: "thread-1",
    routePath: "/chat/me/thread-1",
    messageId: "message-1",
    runId: "run-1",
  });
  expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual(
    [
      "GET https://takos.test/api/spaces",
      "GET https://takos.test/api/spaces/me/model",
      "POST https://takos.test/api/spaces/me/threads",
      "POST https://takos.test/api/threads/thread-1/messages",
      "POST https://takos.test/api/threads/thread-1/runs",
    ],
  );
  for (const request of requests) {
    expect(request.headers.get("authorization")).toBe("Bearer mobile-token");
  }
  expect(await requests[2].json()).toEqual({
    title: "Hello mobile",
    locale: "en",
  });
  expect(await requests[3].json()).toEqual({
    role: "user",
    content: "Hello mobile",
  });
  expect(await requests[4].json()).toEqual({
    agent_type: "default",
    model: "takosumi/default",
    input: { locale: "en" },
  });
});

test("createTakosMobileChatMessage can reply in an existing thread", async () => {
  const requests: Request[] = [];

  const result = await createTakosMobileChatMessage({
    session,
    content: "Continue mobile",
    spaceId: "me",
    threadId: "thread-1",
    locale: "en",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      const url = request.url;
      if (url.endsWith("/api/spaces/me/model")) {
        return json({ model: "takosumi/default" });
      }
      if (url.endsWith("/api/threads/thread-1/messages")) {
        return json({ message: { id: "message-2" } });
      }
      if (url.endsWith("/api/threads/thread-1/runs")) {
        return json({ run: { id: "run-2" } });
      }
      return new Response("", { status: 404 });
    },
  });

  expect(result).toEqual({
    spaceId: "me",
    threadId: "thread-1",
    routePath: "/chat/me/thread-1",
    messageId: "message-2",
    runId: "run-2",
  });
  expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual(
    [
      "GET https://takos.test/api/spaces/me/model",
      "POST https://takos.test/api/threads/thread-1/messages",
      "POST https://takos.test/api/threads/thread-1/runs",
    ],
  );
  expect(await requests[1].json()).toEqual({
    role: "user",
    content: "Continue mobile",
  });
  expect(await requests[2].json()).toEqual({
    agent_type: "default",
    model: "takosumi/default",
    input: { locale: "en" },
  });
});

test("createTakosMobileChatMessage rejects blank messages", async () => {
  await expect(
    createTakosMobileChatMessage({
      session,
      content: "  ",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    }),
  ).rejects.toThrow("Message text is required.");
});

test("loadTakosMobileRunStatus reads run detail for mobile progress", async () => {
  const requests: Request[] = [];

  await expect(
    loadTakosMobileRunStatus({
      session,
      runId: " run-1 ",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return json({
          run: {
            id: "run-1",
            thread_id: "thread-1",
            status: "completed",
            output: "Run finished with a useful answer.",
            error: null,
            started_at: "2026-07-01T09:00:00.000Z",
            completed_at: "2026-07-01T09:01:00.000Z",
            created_at: "2026-07-01T08:59:00.000Z",
          },
        });
      },
    }),
  ).resolves.toEqual({
    id: "run-1",
    threadId: "thread-1",
    status: "completed",
    output: "Run finished with a useful answer.",
    startedAt: "2026-07-01T09:00:00.000Z",
    completedAt: "2026-07-01T09:01:00.000Z",
    createdAt: "2026-07-01T08:59:00.000Z",
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://takos.test/api/runs/run-1");
  expect(requests[0].method).toBe("GET");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
});

test("cancelTakosMobileRun posts the run cancel endpoint", async () => {
  const requests: Request[] = [];

  await cancelTakosMobileRun({
    session,
    runId: " run-1 ",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return json({ success: true });
    },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://takos.test/api/runs/run-1/cancel");
  expect(requests[0].method).toBe("POST");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
});

test("loadTakosMobileRunEvents reads run event progress by cursor", async () => {
  const requests: Request[] = [];

  await expect(
    loadTakosMobileRunEvents({
      session,
      runId: " run-1 ",
      lastEventId: 7.8,
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return json({
          run_status: "completed",
          events: [
            {
              id: 8,
              event_id: "8",
              run_id: "run-1",
              type: "message",
              data: JSON.stringify({ content: "Assistant draft answer." }),
              created_at: "2026-07-01T09:00:20.000Z",
            },
            {
              id: 9,
              event_id: "9",
              run_id: "run-1",
              type: "run_status",
              data: JSON.stringify({ status: "running" }),
              created_at: "2026-07-01T09:00:30.000Z",
            },
            {
              id: 10,
              event_id: "10",
              run_id: "run-1",
              type: "completed",
              data: JSON.stringify({ status: "completed" }),
              created_at: "2026-07-01T09:01:00.000Z",
            },
          ],
        });
      },
    }),
  ).resolves.toEqual({
    runStatus: "completed",
    lastEventId: 10,
    events: [
      {
        id: 8,
        eventId: "8",
        runId: "run-1",
        type: "message",
        data: JSON.stringify({ content: "Assistant draft answer." }),
        messageRole: "assistant",
        messageText: "Assistant draft answer.",
        assistantText: "Assistant draft answer.",
        createdAt: "2026-07-01T09:00:20.000Z",
      },
      {
        id: 9,
        eventId: "9",
        runId: "run-1",
        type: "run_status",
        data: JSON.stringify({ status: "running" }),
        status: "running",
        createdAt: "2026-07-01T09:00:30.000Z",
      },
      {
        id: 10,
        eventId: "10",
        runId: "run-1",
        type: "completed",
        data: JSON.stringify({ status: "completed" }),
        status: "completed",
        createdAt: "2026-07-01T09:01:00.000Z",
      },
    ],
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe(
    "https://takos.test/api/runs/run-1/events?last_event_id=7",
  );
  expect(requests[0].method).toBe("GET");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
});

test("watchTakosMobileRunEventStream streams bearer SSE events", async () => {
  const requests: Request[] = [];
  const streamedEvents: unknown[] = [];

  const result = await watchTakosMobileRunEventStream({
    session,
    runId: " run-1 ",
    lastEventId: 7,
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(
        textStream([
          ": connected\n\n",
          'id: 8\nevent: message\ndata: {"content":"Streamed answer."}\n\n',
          'id: 9\nevent: completed\ndata: {"status":"completed"}\n\n',
        ]),
        {
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    },
    onEvent(event) {
      streamedEvents.push(event);
    },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe(
    "https://takos.test/api/runs/run-1/sse?last_event_id=7",
  );
  expect(requests[0].method).toBe("GET");
  expect(requests[0].headers.get("accept")).toBe("text/event-stream");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
  expect(result).toEqual({
    aborted: false,
    lastEventId: 9,
    terminalStatus: "completed",
    events: [
      {
        id: 8,
        eventId: "8",
        runId: "run-1",
        type: "message",
        data: '{"content":"Streamed answer."}',
        messageRole: "assistant",
        messageText: "Streamed answer.",
        assistantText: "Streamed answer.",
      },
      {
        id: 9,
        eventId: "9",
        runId: "run-1",
        type: "completed",
        data: '{"status":"completed"}',
        status: "completed",
      },
    ],
  });
  expect(streamedEvents).toEqual(result.events);
});

test("mobile run helpers reject blank run ids and classify terminal states", async () => {
  await expect(
    loadTakosMobileRunStatus({
      session,
      runId: "  ",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    }),
  ).rejects.toThrow("Run id is required.");

  await expect(
    cancelTakosMobileRun({
      session,
      runId: "  ",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    }),
  ).rejects.toThrow("Run id is required.");

  expect(isTakosMobileRunTerminalStatus("queued")).toBe(false);
  expect(isTakosMobileRunTerminalStatus("running")).toBe(false);
  expect(isTakosMobileRunTerminalStatus("completed")).toBe(true);
  expect(isTakosMobileRunTerminalStatus("failed")).toBe(true);
  expect(isTakosMobileRunTerminalStatus("cancelled")).toBe(true);
});

test("createTakosMobileAgentTask posts a planned task with a host-backed thread", async () => {
  const requests: Request[] = [];

  const result = await createTakosMobileAgentTask({
    session,
    spaceId: "me",
    title: "  Review mobile shell  ",
    description: "  Check the app handoff and native surface.  ",
    priority: "high",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return json({
        task: {
          id: "task-3",
          title: "Review mobile shell",
          description: "Check the app handoff and native surface.",
          status: "planned",
          priority: "high",
          thread_id: "thread-3",
          thread_title: "Review mobile shell",
          created_at: "2026-07-01T09:30:00.000Z",
          updated_at: "2026-07-01T09:30:00.000Z",
        },
      });
    },
  });

  expect(result).toEqual({
    id: "task-3",
    title: "Review mobile shell",
    description: "Check the app handoff and native surface.",
    status: "planned",
    priority: "high",
    threadTitle: "Review mobile shell",
    updatedAt: "2026-07-01T09:30:00.000Z",
    routePath: "/chat/me/thread-3",
  });
  expect(requests[0].url).toBe("https://takos.test/api/spaces/me/agent-tasks");
  expect(requests[0].method).toBe("POST");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
  expect(await requests[0].json()).toEqual({
    title: "Review mobile shell",
    description: "Check the app handoff and native surface.",
    priority: "high",
    status: "planned",
    create_thread: true,
  });
});

test("createTakosMobileAgentTask rejects invalid task input before posting", async () => {
  const fetcher = async () => {
    throw new Error("fetch should not be called");
  };

  await expect(
    createTakosMobileAgentTask({
      session,
      spaceId: "me",
      title: "  ",
      fetch: fetcher,
    }),
  ).rejects.toThrow("Task title is required.");

  await expect(
    createTakosMobileAgentTask({
      session,
      spaceId: "me",
      title: "x".repeat(241),
      fetch: fetcher,
    }),
  ).rejects.toThrow("Task title is too long.");
});

test("updateTakosMobileAgentTaskStatus patches task status and returns host route", async () => {
  const requests: Request[] = [];

  await expect(
    updateTakosMobileAgentTaskStatus({
      session,
      taskId: " task-1 ",
      status: "completed",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return json({
          task: {
            id: "task-1",
            space_id: "me",
            title: "Deploy mobile host",
            description: "Finish the app-host handoff.",
            status: "completed",
            priority: "high",
            resume_target: { thread_id: "thread-2" },
            thread_title: "Agent work",
            latest_run: { status: "completed" },
            updated_at: "2026-07-01T10:00:00.000Z",
          },
        });
      },
    }),
  ).resolves.toEqual({
    id: "task-1",
    title: "Deploy mobile host",
    description: "Finish the app-host handoff.",
    status: "completed",
    priority: "high",
    threadTitle: "Agent work",
    latestRunStatus: "completed",
    updatedAt: "2026-07-01T10:00:00.000Z",
    routePath: "/chat/me/thread-2",
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://takos.test/api/agent-tasks/task-1");
  expect(requests[0].method).toBe("PATCH");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
  expect(await requests[0].json()).toEqual({ status: "completed" });
});

test("updateTakosMobileAgentTaskStatus rejects blank task ids", async () => {
  await expect(
    updateTakosMobileAgentTaskStatus({
      session,
      taskId: "  ",
      status: "completed",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    }),
  ).rejects.toThrow("Task id is required.");
});

test("createTakosMobileMemory posts typed memory capture to the workspace", async () => {
  const requests: Request[] = [];

  const result = await createTakosMobileMemory({
    session,
    spaceId: "me",
    content: "  Remember the mobile memory flow.  ",
    type: "procedural",
    category: " architecture ",
    importance: 0.8,
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return json({
        id: "memory-3",
        type: "procedural",
        content: "Remember the mobile memory flow.",
        summary: "Mobile memory flow",
        category: "architecture",
        importance: 0.8,
        created_at: "2026-07-01T09:00:00.000Z",
      });
    },
  });

  expect(result).toEqual({
    id: "memory-3",
    type: "procedural",
    text: "Mobile memory flow",
    category: "architecture",
    importance: 0.8,
    createdAt: "2026-07-01T09:00:00.000Z",
    routePath: "/memory",
  });
  expect(requests[0].url).toBe("https://takos.test/api/spaces/me/memories");
  expect(requests[0].method).toBe("POST");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
  expect(await requests[0].json()).toEqual({
    type: "procedural",
    content: "Remember the mobile memory flow.",
    category: "architecture",
    source: "takos-mobile",
    importance: 0.8,
  });
});

test("createTakosMobileMemory accepts wrapped memory responses", async () => {
  await expect(
    createTakosMobileMemory({
      session,
      spaceId: "me",
      content: "Keep mobile clients host-backed.",
      fetch: async () =>
        json({
          memory: {
            id: "memory-4",
            type: "semantic",
            content: "Keep mobile clients host-backed.",
            importance: 0.5,
            created_at: "2026-07-01T09:05:00.000Z",
          },
        }),
    }),
  ).resolves.toMatchObject({
    id: "memory-4",
    type: "semantic",
    text: "Keep mobile clients host-backed.",
    routePath: "/memory",
  });
});

test("createTakosMobileMemory rejects blank memory text", async () => {
  await expect(
    createTakosMobileMemory({
      session,
      spaceId: "me",
      content: "  ",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    }),
  ).rejects.toThrow("Memory text is required.");
});

test("deleteTakosMobileMemory deletes a host memory by id", async () => {
  const requests: Request[] = [];

  await deleteTakosMobileMemory({
    session,
    memoryId: " memory-3 ",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return json({ success: true });
    },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://takos.test/api/memories/memory-3");
  expect(requests[0].method).toBe("DELETE");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
});

test("deleteTakosMobileMemory rejects blank memory ids", async () => {
  await expect(
    deleteTakosMobileMemory({
      session,
      memoryId: "  ",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    }),
  ).rejects.toThrow("Memory id is required.");
});

test("installTakosMobileGitApp plans and applies a Git URL Capsule through the host", async () => {
  const requests: Request[] = [];

  await expect(
    installTakosMobileGitApp({
      session,
      spaceId: " me ",
      gitUrl: " https://github.com/example/app.git ",
      ref: " main ",
      modulePath: ".",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request.clone());
        if (request.url.endsWith("/app-installations/git-url/plan")) {
          return json({
            source: {
              kind: "git",
              url: "https://github.com/example/app.git",
              ref: "main",
              commit: "1111111111111111111111111111111111111111",
            },
            runtime: { modes: ["shared-cell"] },
            expected: {
              commit: "1111111111111111111111111111111111111111",
              planDigest: "sha256:abc",
            },
          });
        }
        return json({
          accounts: {
            installationId: "inst-git-1",
            status: "ready",
          },
        });
      },
    }),
  ).resolves.toEqual({
    installationId: "inst-git-1",
    status: "ready",
    raw: {
      accounts: {
        installationId: "inst-git-1",
        status: "ready",
      },
    },
  });

  expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual(
    [
      "POST https://takos.test/api/spaces/me/app-installations/git-url/plan",
      "POST https://takos.test/api/spaces/me/app-installations/git-url/apply",
    ],
  );
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
  expect(await requests[0].json()).toEqual({
    git_url: "https://github.com/example/app.git",
    ref: "main",
    module_path: ".",
  });
  expect(await requests[1].json()).toEqual({
    git_url: "https://github.com/example/app.git",
    ref: "main",
    module_path: ".",
    source_commit: "1111111111111111111111111111111111111111",
    expected: {
      commit: "1111111111111111111111111111111111111111",
      planDigest: "sha256:abc",
    },
    expected_commit: "1111111111111111111111111111111111111111",
    expected_plan_digest: "sha256:abc",
    mode: "shared-cell",
    cost_ack: true,
  });
});

test("Git app revision helpers plan and apply an update with expected deployment guard", async () => {
  const requests: Request[] = [];

  const plan = await planTakosMobileGitAppRevision({
    session,
    spaceId: "me",
    installationId: " inst-1 ",
    gitUrl: "https://github.com/example/app.git",
    ref: "main",
    modulePath: "deploy",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      return json({
        source: {
          kind: "git",
          url: "https://github.com/example/app.git",
          ref: "main",
          commit: "2222222222222222222222222222222222222222",
        },
        expected: {
          commit: "2222222222222222222222222222222222222222",
          planDigest: "sha256:def",
          currentDeploymentId: "dep-1",
        },
      });
    },
  });

  await expect(
    applyTakosMobileGitAppRevision({
      session,
      installationId: "inst-1",
      plan,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request.clone());
        return json({
          kind: "takosumi.deployment-apply@v1",
          status: "queued",
        });
      },
    }),
  ).resolves.toEqual({
    status: "queued",
    raw: {
      kind: "takosumi.deployment-apply@v1",
      status: "queued",
    },
  });

  expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual(
    [
      "POST https://takos.test/api/spaces/me/app-installations/git-url/revision/plan",
      "POST https://takos.test/api/spaces/me/app-installations/git-url/revision/apply",
    ],
  );
  expect(await requests[0].json()).toEqual({
    operation: "upgrade",
    installation_id: "inst-1",
    git_url: "https://github.com/example/app.git",
    ref: "main",
    module_path: "deploy",
  });
  expect(await requests[1].json()).toEqual({
    git_url: "https://github.com/example/app.git",
    ref: "main",
    module_path: "deploy",
    source_commit: "2222222222222222222222222222222222222222",
    expected: {
      commit: "2222222222222222222222222222222222222222",
      planDigest: "sha256:def",
      currentDeploymentId: "dep-1",
    },
    expected_commit: "2222222222222222222222222222222222222222",
    expected_plan_digest: "sha256:def",
    operation: "upgrade",
    installation_id: "inst-1",
    expected_current_deployment_id: "dep-1",
  });
});

test("removeTakosMobileAppInstallation deletes a host installation with a reason", async () => {
  const requests: Request[] = [];

  await expect(
    removeTakosMobileAppInstallation({
      session,
      spaceId: "me",
      installationId: " inst-1 ",
      reason: " mobile remove ",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return json({
          installation: {
            id: "inst-1",
            status: "suspended",
          },
        });
      },
    }),
  ).resolves.toEqual({
    installationId: "inst-1",
    status: "suspended",
    raw: {
      installation: {
        id: "inst-1",
        status: "suspended",
      },
    },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe(
    "https://takos.test/api/spaces/me/app-installations/inst-1",
  );
  expect(requests[0].method).toBe("DELETE");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
  expect(await requests[0].json()).toEqual({ reason: "mobile remove" });
});

test("Git app lifecycle helpers reject unsafe source input before posting", async () => {
  const fetcher = async () => {
    throw new Error("fetch should not be called");
  };

  await expect(
    installTakosMobileGitApp({
      session,
      spaceId: "me",
      gitUrl: "http://github.com/example/app.git",
      ref: "main",
      fetch: fetcher,
    }),
  ).rejects.toThrow("Git URL must be an HTTPS URL without credentials.");

  await expect(
    installTakosMobileGitApp({
      session,
      spaceId: "me",
      gitUrl: "https://github.com/example/app.git",
      ref: "main",
      modulePath: "../bad",
      fetch: fetcher,
    }),
  ).rejects.toThrow("Module path must be repository-relative.");
});

test("loadTakosMobileNotificationSettings reads preferences and mute state", async () => {
  const requests: Request[] = [];

  const settings = await loadTakosMobileNotificationSettings({
    session,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith("/api/notifications/preferences")) {
        return json({
          push_supported_types: [
            "run.completed",
            "run.failed",
            "workspace.invite",
            "unknown",
          ],
          preferences: {
            "run.failed": {
              in_app: true,
              email: true,
              push: true,
            },
            "workspace.invite": {
              in_app: true,
              email: false,
              push: false,
            },
          },
        });
      }
      if (request.url.endsWith("/api/notifications/settings")) {
        return json({ muted_until: "2026-06-30T13:00:00.000Z" });
      }
      return json({});
    },
  });

  expect(requests.map((request) => request.url)).toEqual([
    "https://takos.test/api/notifications/preferences",
    "https://takos.test/api/notifications/settings",
  ]);
  for (const request of requests) {
    expect(request.headers.get("authorization")).toBe("Bearer mobile-token");
  }
  expect(settings.mutedUntil).toBe("2026-06-30T13:00:00.000Z");
  expect(settings.pushSupportedTypes).toEqual(["run.completed", "run.failed"]);
  expect(settings.preferences["run.failed"]).toEqual({
    in_app: true,
    email: true,
    push: true,
  });
  expect(settings.preferences["workspace.invite"]).toEqual({
    in_app: true,
    email: false,
    push: false,
  });
  expect(settings.preferences["deploy.completed"]).toEqual({
    in_app: false,
    email: false,
    push: false,
  });
});

test("updateTakosMobileNotificationPreference patches one notification channel", async () => {
  const requests: Request[] = [];

  const preferences = await updateTakosMobileNotificationPreference({
    session,
    type: "run.failed",
    channel: "push",
    enabled: true,
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return json({
        preferences: {
          "run.failed": {
            in_app: true,
            email: true,
            push: true,
          },
        },
      });
    },
  });

  expect(requests[0].url).toBe(
    "https://takos.test/api/notifications/preferences",
  );
  expect(requests[0].method).toBe("PATCH");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
  expect(await requests[0].json()).toEqual({
    updates: [
      {
        type: "run.failed",
        channel: "push",
        enabled: true,
      },
    ],
  });
  expect(preferences["run.failed"].push).toBe(true);
});

test("setTakosMobileNotificationsMutedUntil patches mute state", async () => {
  const requests: Request[] = [];

  const result = await setTakosMobileNotificationsMutedUntil({
    session,
    mutedUntil: "2026-06-30T13:00:00.000Z",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return json({ muted_until: "2026-06-30T13:00:00.000Z" });
    },
  });

  expect(requests[0].url).toBe("https://takos.test/api/notifications/settings");
  expect(requests[0].method).toBe("PATCH");
  expect(await requests[0].json()).toEqual({
    muted_until: "2026-06-30T13:00:00.000Z",
  });
  expect(result).toEqual({ mutedUntil: "2026-06-30T13:00:00.000Z" });
});

test("setTakosMobileNotificationsMutedUntil can clear mute state and rejects invalid dates", async () => {
  const requests: Request[] = [];

  await setTakosMobileNotificationsMutedUntil({
    session,
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return json({ muted_until: null });
    },
  });

  expect(await requests[0].json()).toEqual({ muted_until: null });
  await expect(
    setTakosMobileNotificationsMutedUntil({
      session,
      mutedUntil: "not-a-date",
    }),
  ).rejects.toThrow("Muted-until timestamp must be a valid datetime.");
});

test("loadTakosMobileNotificationsPage reads paged notifications with a stable cursor", async () => {
  const requests: Request[] = [];

  const page = await loadTakosMobileNotificationsPage({
    session,
    limit: 2,
    cursor: {
      before: "2026-06-30T10:00:00.000Z",
      beforeId: "notification-2",
    },
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return json({
        notifications: [
          {
            id: "notification-3",
            title: "Run finished",
            body: "The agent completed the workspace run.",
            data: { href: "/runs/run-3" },
            created_at: "2026-06-30T09:00:00.000Z",
            read_at: null,
          },
          {
            id: "notification-4",
            title: "Invite accepted",
            data: { path: "//unsafe" },
            created_at: "2026-06-30T08:00:00.000Z",
            read_at: "2026-06-30T08:05:00.000Z",
          },
          {
            id: "ignored",
            body: "Missing title",
          },
        ],
      });
    },
  });

  const url = new URL(requests[0].url);
  expect(url.pathname).toBe("/api/notifications");
  expect(url.searchParams.get("limit")).toBe("2");
  expect(url.searchParams.get("before")).toBe("2026-06-30T10:00:00.000Z");
  expect(url.searchParams.get("before_id")).toBe("notification-2");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
  expect(page).toEqual({
    notifications: [
      {
        id: "notification-3",
        title: "Run finished",
        body: "The agent completed the workspace run.",
        createdAt: "2026-06-30T09:00:00.000Z",
        routePath: "/runs/run-3",
        unread: true,
      },
      {
        id: "notification-4",
        title: "Invite accepted",
        createdAt: "2026-06-30T08:00:00.000Z",
        routePath: "/notifications",
        unread: false,
      },
    ],
    nextCursor: {
      before: "2026-06-30T08:00:00.000Z",
      beforeId: "notification-4",
    },
  });
});

test("loadTakosMobileNotificationsPage clamps the requested page size", async () => {
  const requests: Request[] = [];

  const page = await loadTakosMobileNotificationsPage({
    session,
    limit: 99,
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return json({ notifications: [] });
    },
  });

  const url = new URL(requests[0].url);
  expect(url.searchParams.get("limit")).toBe("50");
  expect(page).toEqual({ notifications: [] });
});

test("markTakosMobileNotificationRead patches the notification read endpoint", async () => {
  const requests: Request[] = [];

  await markTakosMobileNotificationRead({
    session,
    notificationId: "notification-1",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return json({ success: true });
    },
  });

  expect(requests[0].url).toBe(
    "https://takos.test/api/notifications/notification-1/read",
  );
  expect(requests[0].method).toBe("PATCH");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
});

test("markAllTakosMobileNotificationsRead patches the bulk read endpoint", async () => {
  const requests: Request[] = [];

  await markAllTakosMobileNotificationsRead({
    session,
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return json({ success: true });
    },
  });

  expect(requests[0].url).toBe("https://takos.test/api/notifications/read-all");
  expect(requests[0].method).toBe("PATCH");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
});

test("markTakosMobileNotificationRead rejects blank notification ids", async () => {
  await expect(
    markTakosMobileNotificationRead({
      session,
      notificationId: "  ",
    }),
  ).rejects.toThrow("Notification id is required.");
});

test("registerTakosMobilePush posts a product-neutral notification pusher", async () => {
  const requests: Request[] = [];

  await registerTakosMobilePush(
    {
      session,
      registration: {
        token: "push-token",
        provider: "fcm",
        environment: "test",
      },
    },
    {
      gatewayUrl: "https://push.example/_matrix/push/v1/notify",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return json({ ok: true });
      },
    },
  );

  expect(requests[0].url).toBe("https://takos.test/api/notifications/pushers");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
  expect(await requests[0].json()).toEqual({
    product: "takos",
    pusher: {
      kind: "http",
      app_id: "jp.takos.mobile",
      app_display_name: "Takos",
      pushkey: "push-token",
      data: {
        url: "https://push.example/_matrix/push/v1/notify",
        format: "event_id_only",
        provider: "fcm",
        environment: "test",
      },
    },
  });
});

test("registerTakosMobilePush fails clearly when the gateway is feature-off", async () => {
  await expect(
    registerTakosMobilePush(
      {
        session,
        registration: {
          token: "push-token",
          provider: "apns",
          environment: "sandbox",
        },
      },
      {
        gatewayUrl: null,
        fetch: async () => {
          throw new Error("must not send request");
        },
      },
    ),
  ).rejects.toThrow(
    "VITE_TAKOS_NOTIFICATION_PUSHER_GATEWAY_URL is not configured",
  );
});

test("registerTakosMobilePush rejects unsafe gateway configuration", async () => {
  await expect(
    registerTakosMobilePush(
      {
        session,
        registration: {
          token: "push-token",
          provider: "fcm",
          environment: "production",
        },
      },
      {
        gatewayUrl: "http://push.example/notify",
        fetch: async () => {
          throw new Error("must not send request");
        },
      },
    ),
  ).rejects.toThrow("must use HTTPS without credentials");
});

test("unregisterTakosMobilePush deletes the product mobile push payload", async () => {
  const requests: Request[] = [];

  await unregisterTakosMobilePush(
    {
      session,
      registration: {
        token: "push-token",
        provider: "fcm",
        environment: "test",
      },
    },
    {
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return json({ ok: true });
      },
    },
  );

  expect(requests[0].url).toBe("https://takos.test/api/notifications/pushers");
  expect(requests[0].method).toBe("DELETE");
  expect(requests[0].headers.get("authorization")).toBe("Bearer mobile-token");
  expect(await requests[0].json()).toEqual({
    product: "takos",
    app_id: "jp.takos.mobile",
    pushkey: "push-token",
  });
});

function json(value: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function textStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}
