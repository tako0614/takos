import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";
import type { ContainerStartFailure, ToolContext } from "@/tools/types";

/**
 * Drizzle-chainable mock for getDb.
 * Production code uses: db.select({...}).from(table).where(...).get()
 * and db.insert(table).values({...}), db.update(table).set({...}).where(...)
 */
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert";

const mockSelectResults = {
  session: ((..._args: any[]) => undefined) as any, // session lookup by id
  repository: ((..._args: any[]) => undefined) as any, // single repo lookup
  repositories: ((..._args: any[]) => undefined) as any, // multi-repo lookup
};

function createDrizzleMock() {
  return {
    select: () => {
      const chain = {
        from: (table: unknown) => {
          (chain as Record<string, unknown>)._table = table;
          return chain;
        },
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        get: async () => {
          // Route to the correct mock based on call pattern
          // The production code calls select then from(sessions) or from(repositories)
          const table = (chain as Record<string, unknown>)._table as any;
          const tableName = table?.$$name ??
            table?.[Symbol.for("drizzle:Name")] ?? "";
          if (typeof tableName === "string" && tableName === "sessions") {
            return mockSelectResults.session();
          }
          return mockSelectResults.repository();
        },
        all: async () => {
          const result = mockSelectResults.repositories();
          return Array.isArray(result) ? result : result ? [result] : [];
        },
        _table: null as unknown,
      };
      return chain;
    },
    insert: () => ({
      values: () => ({
        run: async () => ({}),
        returning: async () => [{}],
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => ({}),
        run: async () => ({}),
      }),
    }),
  };
}

const mockRuntimeManager = {
  setRepositories: ((..._args: any[]) => undefined) as any,
  initSession: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/sync'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
import { generateId } from "@/utils";
import { containerStartHandler } from "@/tools/builtin/container/handlers/start";
import { requireContainer } from "@/tools/builtin/file/session";

function makeContext(initialFailure?: ContainerStartFailure): ToolContext {
  let sessionId: string | undefined;
  let lastFailure = initialFailure;

  return {
    spaceId: "ws_test",
    threadId: "thread_test",
    runId: "run_test",
    userId: "user_test",
    capabilities: [],
    env: {
      RUNTIME_HOST: "runtime.example.internal",
    } as unknown as Env,
    db: {} as D1Database,
    get sessionId() {
      return sessionId;
    },
    setSessionId: (nextSessionId: string | undefined) => {
      sessionId = nextSessionId;
    },
    getLastContainerStartFailure: () => lastFailure,
    setLastContainerStartFailure: (
      failure: ContainerStartFailure | undefined,
    ) => {
      lastFailure = failure;
    },
  };
}

Deno.test("container_start error propagation - stores the failed container_start root cause for follow-up tools", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  // session lookup returns null (no existing session)
  mockSelectResults.session = (() => null) as any;
  // single repo lookup returns the default repo
  mockSelectResults.repository = (() => ({
    id: "repo_main",
    name: "main",
    defaultBranch: "main",
  })) as any;
  // multi-repo lookup returns the default repo
  mockSelectResults.repositories = (() => [{
    id: "repo_main",
    name: "main",
    defaultBranch: "main",
  }]) as any;

  mockRuntimeManager.setRepositories;
  mockRuntimeManager.initSession;
  generateId =
    (() => "session_failed") as any =
      (() => "session_repo_1") as any;
  mockRuntimeManager.initSession = (async () => {
    throw new Error("Failed to init runtime session: boom");
  }) as any;

  const context = makeContext();

  await assertRejects(async () => {
    await containerStartHandler({}, context);
  }, "Failed to init runtime session: boom");

  assertEquals(context.sessionId, undefined);
  assertEquals(context.getLastContainerStartFailure(), {
    message: "Failed to init runtime session: boom",
    sessionId: "session_failed",
  });

  assertThrows(
    () => {
      (() => requireContainer(context));
    },
    "No container is running because the most recent container_start failed.\n\nLast start error: Failed to init runtime session: boom\nFailed session ID: session_failed\n\nResolve that error and call container_start again before using file operations.",
  );
});
Deno.test("container_start error propagation - clears stale start failures after a successful container_start", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  // session lookup returns null (no existing session)
  mockSelectResults.session = (() => null) as any;
  // single repo lookup returns the default repo
  mockSelectResults.repository = (() => ({
    id: "repo_main",
    name: "main",
    defaultBranch: "main",
  })) as any;
  // multi-repo lookup returns the default repo
  mockSelectResults.repositories = (() => [{
    id: "repo_main",
    name: "main",
    defaultBranch: "main",
  }]) as any;

  mockRuntimeManager.setRepositories;
  mockRuntimeManager.initSession;
  generateId =
    (() => "session_running") as any =
      (() => "session_repo_1") as any;
  mockRuntimeManager.initSession = (async () => ({
    success: true,
    file_count: 12,
    session_dir: "/workspace",
    work_dir: "/workspace",
    git_mode: true,
    branch: "main",
  })) as any;

  const context = makeContext({
    message: "Previous failure",
    sessionId: "session_old",
  });

  const result = await containerStartHandler({}, context);

  assertStringIncludes(result, "Session ID: session_running");
  assertEquals(context.sessionId, "session_running");
  assertEquals(context.getLastContainerStartFailure(), undefined);
});
