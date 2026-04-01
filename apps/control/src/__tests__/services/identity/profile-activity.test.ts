// deno-lint-ignore-file no-import-prefix no-unversioned-import require-await
import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals, assertObjectMatch } from "jsr:@std/assert";

import {
  fetchProfileActivity,
  profileActivityDeps,
} from "@/services/identity/profile-activity";

type FakeStep = {
  all?: unknown[];
};

const originalProfileActivityDeps = {
  getDb: profileActivityDeps.getDb,
  listServiceRouteRecordsByIds: profileActivityDeps.listServiceRouteRecordsByIds,
};

function createFakeDrizzleDatabase(steps: FakeStep[]) {
  let index = 0;
  const buildChain = () => {
    const step = steps[index++] ?? {};
    const chain = {
      from() {
        return chain;
      },
      innerJoin() {
        return chain;
      },
      leftJoin() {
        return chain;
      },
      where() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return chain;
      },
      all: async () => step.all ?? [],
    };
    return chain;
  };

  return {
    select() {
      return buildChain();
    },
  };
}

function restoreProfileActivityDeps() {
  profileActivityDeps.getDb = originalProfileActivityDeps.getDb;
  profileActivityDeps.listServiceRouteRecordsByIds =
    originalProfileActivityDeps.listServiceRouteRecordsByIds;
}

function installProfileActivityDeps(
  steps: FakeStep[],
  routes: Array<{ id: string; hostname: string | null; routeRef?: string | null; slug?: string | null }> = [],
) {
  const db = createFakeDrizzleDatabase(steps);
  profileActivityDeps.getDb = () => db as never;
  profileActivityDeps.listServiceRouteRecordsByIds = async () => routes as never;
}

Deno.test(
  "fetchProfileActivity - returns empty events when all queries return empty",
  async () => {
    installProfileActivityDeps([{ all: [] }, { all: [] }, { all: [] }, { all: [] }]);

    try {
      const result = await fetchProfileActivity({} as D1Database, {
        profileUserId: "user-1",
        profileUserEmail: "user@example.com",
        limit: 10,
        before: null,
      });

      assertEquals(result.events, []);
      assertEquals(result.has_more, false);
    } finally {
      restoreProfileActivityDeps();
    }
  },
);

Deno.test(
  "fetchProfileActivity - merges and sorts events by created_at descending",
  async () => {
    installProfileActivityDeps([
      {
        all: [{
          id: "c1",
          sha: "abc123",
          message: "fix: bug\ndetails",
          commitDate: "2026-01-03T00:00:00.000Z",
          repoName: "repo-1",
          accountId: "acc-1",
          accountSlug: "alice",
        }],
      },
      {
        all: [{
          id: "r1",
          tag: "v1.0.0",
          name: "First release",
          publishedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          repoName: "repo-1",
          accountId: "acc-1",
          accountSlug: "alice",
        }],
      },
      {
        all: [{
          id: "pr1",
          number: 42,
          title: "Add feature",
          status: "merged",
          createdAt: "2026-01-02T00:00:00.000Z",
          repoName: "repo-1",
          accountId: "acc-1",
          accountSlug: "alice",
        }],
      },
      { all: [] },
    ]);

    try {
      const result = await fetchProfileActivity({} as D1Database, {
        profileUserId: "user-1",
        profileUserEmail: "user@example.com",
        limit: 10,
        before: null,
      });

      assertEquals(result.events.length, 3);
      assertEquals(result.events[0]!.id, "c1");
      assertEquals(result.events[1]!.id, "pr1");
      assertEquals(result.events[2]!.id, "r1");
      assertEquals(result.has_more, false);
    } finally {
      restoreProfileActivityDeps();
    }
  },
);

Deno.test(
  "fetchProfileActivity - correctly maps commit events (first line of message)",
  async () => {
    installProfileActivityDeps([
      {
        all: [{
          id: "c1",
          sha: "deadbeef",
          message: "first line\nsecond line\nthird line",
          commitDate: "2026-01-01T00:00:00.000Z",
          repoName: "my-repo",
          accountId: "acc-1",
          accountSlug: "alice",
        }],
      },
      { all: [] },
      { all: [] },
      { all: [] },
    ]);

    try {
      const result = await fetchProfileActivity({} as D1Database, {
        profileUserId: "user-1",
        profileUserEmail: "user@example.com",
        limit: 10,
        before: null,
      });

      assertObjectMatch(result.events[0], {
        type: "commit",
        title: "first line",
        data: { sha: "deadbeef" },
        repo: { owner_username: "alice", name: "my-repo" },
      });
    } finally {
      restoreProfileActivityDeps();
    }
  },
);

Deno.test("fetchProfileActivity - correctly maps release events", async () => {
  installProfileActivityDeps([
    { all: [] },
    {
      all: [{
        id: "r1",
        tag: "v2.0.0",
        name: "Major Release",
        publishedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        repoName: "my-repo",
        accountId: "acc-1",
        accountSlug: "alice",
      }],
    },
    { all: [] },
    { all: [] },
  ]);

  try {
    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: "user-1",
      profileUserEmail: "user@example.com",
      limit: 10,
      before: null,
    });

    assertObjectMatch(result.events[0], {
      type: "release",
      title: "Released v2.0.0",
      data: { tag: "v2.0.0", name: "Major Release" },
    });
  } finally {
    restoreProfileActivityDeps();
  }
});

Deno.test("fetchProfileActivity - correctly maps pull request events", async () => {
  installProfileActivityDeps([
    { all: [] },
    { all: [] },
    {
      all: [{
        id: "pr1",
        number: 99,
        title: "My PR",
        status: "open",
        createdAt: "2026-01-01T00:00:00.000Z",
        repoName: "repo",
        accountId: "acc-1",
        accountSlug: "bob",
      }],
    },
    { all: [] },
  ]);

  try {
    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: "user-1",
      profileUserEmail: "user@example.com",
      limit: 10,
      before: null,
    });

    assertObjectMatch(result.events[0], {
      type: "pull_request",
      title: "PR #99: My PR",
      data: { number: 99, status: "open" },
    });
  } finally {
    restoreProfileActivityDeps();
  }
});

Deno.test("fetchProfileActivity - correctly maps deployment events", async () => {
  installProfileActivityDeps(
    [
      { all: [] },
      { all: [] },
      { all: [] },
      {
        all: [{
          id: "d1",
          status: "success",
          version: "1.0.0",
          completedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          serviceId: "svc-1",
        }],
      },
    ],
    [{
      id: "svc-1",
      hostname: "my-worker.example.com",
      routeRef: "worker-route",
      slug: "my-worker",
    }],
  );

  try {
    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: "user-1",
      profileUserEmail: "user@example.com",
      limit: 10,
      before: null,
    });

    assertObjectMatch(result.events[0], {
      type: "deployment",
      title: "Deployed my-worker.example.com",
      repo: null,
      data: {
        service_hostname: "my-worker.example.com",
        service_slug: "my-worker",
        service_name: "worker-route",
        status: "success",
        version: "1.0.0",
      },
    });
  } finally {
    restoreProfileActivityDeps();
  }
});

Deno.test("fetchProfileActivity - sets has_more when events exceed limit", async () => {
  const commits = Array.from({ length: 6 }, (_, index) => ({
    id: `c${index}`,
    sha: `sha${index}`,
    message: `Commit ${index}`,
    commitDate: `2026-01-0${index + 1}T00:00:00.000Z`,
    repoName: "repo",
    accountId: "acc-1",
    accountSlug: "alice",
  }));

  installProfileActivityDeps([
    { all: commits },
    { all: [] },
    { all: [] },
    { all: [] },
  ]);

  try {
    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: "user-1",
      profileUserEmail: "user@example.com",
      limit: 5,
      before: null,
    });

    assertEquals(result.events.length, 5);
    assertEquals(result.has_more, true);
  } finally {
    restoreProfileActivityDeps();
  }
});

Deno.test(
  "fetchProfileActivity - uses account id as owner_username when slug is null",
  async () => {
    installProfileActivityDeps([
      {
        all: [{
          id: "c1",
          sha: "abc",
          message: "Commit",
          commitDate: "2026-01-01T00:00:00.000Z",
          repoName: "repo",
          accountId: "acc-1",
          accountSlug: null,
        }],
      },
      { all: [] },
      { all: [] },
      { all: [] },
    ]);

    try {
      const result = await fetchProfileActivity({} as D1Database, {
        profileUserId: "user-1",
        profileUserEmail: "user@example.com",
        limit: 10,
        before: null,
      });

      assertEquals(result.events[0]!.repo?.owner_username, "acc-1");
    } finally {
      restoreProfileActivityDeps();
    }
  },
);
