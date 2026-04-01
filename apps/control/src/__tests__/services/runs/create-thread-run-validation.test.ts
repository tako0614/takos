import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import {
  createThreadRunValidationDeps,
  resolveRunModel,
  validateParentRunId,
} from "@/services/runs/create-thread-run-validation";

type RunNode = {
  id: string;
  threadId: string;
  accountId: string;
  parentRunId: string | null;
  rootThreadId: string | null;
  rootRunId: string | null;
};

function makeNode(overrides: Partial<RunNode> = {}): RunNode {
  return {
    id: overrides.id ?? "run-1",
    threadId: overrides.threadId ?? "thread-1",
    accountId: overrides.accountId ?? "space-1",
    parentRunId: overrides.parentRunId ?? null,
    rootThreadId: overrides.rootThreadId ?? null,
    rootRunId: overrides.rootRunId ?? null,
  };
}

function withValidationDeps<T>(
  overrides: Partial<typeof createThreadRunValidationDeps>,
  fn: () => Promise<T>,
) {
  const previous = {
    getRunHierarchyNode: createThreadRunValidationDeps.getRunHierarchyNode,
    getSpaceModel: createThreadRunValidationDeps.getSpaceModel,
    isValidOpaqueId: createThreadRunValidationDeps.isValidOpaqueId,
    logWarn: createThreadRunValidationDeps.logWarn,
    normalizeModelId: createThreadRunValidationDeps.normalizeModelId,
  };
  Object.assign(createThreadRunValidationDeps, overrides);
  return fn().finally(() => {
    createThreadRunValidationDeps.getRunHierarchyNode =
      previous.getRunHierarchyNode;
    createThreadRunValidationDeps.getSpaceModel = previous.getSpaceModel;
    createThreadRunValidationDeps.isValidOpaqueId = previous.isValidOpaqueId;
    createThreadRunValidationDeps.logWarn = previous.logWarn;
    createThreadRunValidationDeps.normalizeModelId = previous.normalizeModelId;
  });
}

const acceptOpaqueId = (value: unknown): value is string =>
  typeof value === "string";

Deno.test("validateParentRunId accepts a same-workspace parent with no nesting", async () => {
  await withValidationDeps(
    {
      isValidOpaqueId: acceptOpaqueId,
      getRunHierarchyNode: async (_db: D1Database, runId: string) =>
        runId === "parent-run" ? makeNode({ id: "parent-run" }) : null,
    },
    async () => {
      const error = await validateParentRunId(
        {} as D1Database,
        "space-1",
        "parent-run",
      );

      assertEquals(error, null);
    },
  );
});

Deno.test("validateParentRunId rejects a missing parent run", async () => {
  await withValidationDeps(
    {
      isValidOpaqueId: acceptOpaqueId,
      getRunHierarchyNode: async () => null,
    },
    async () => {
      const error = await validateParentRunId(
        {} as D1Database,
        "space-1",
        "missing-run",
      );

      assertEquals(error, "Invalid parent_run_id: run not found");
    },
  );
});

Deno.test("validateParentRunId rejects parents from another workspace", async () => {
  await withValidationDeps(
    {
      isValidOpaqueId: acceptOpaqueId,
      getRunHierarchyNode: async (_db: D1Database, runId: string) =>
        runId === "parent-run"
          ? makeNode({ id: "parent-run", accountId: "other-space" })
          : null,
    },
    async () => {
      const error = await validateParentRunId(
        {} as D1Database,
        "space-1",
        "parent-run",
      );

      assertEquals(
        error,
        "Invalid parent_run_id: parent run must be in the same workspace",
      );
    },
  );
});

Deno.test("validateParentRunId rejects broken parent chains", async () => {
  await withValidationDeps(
    {
      isValidOpaqueId: acceptOpaqueId,
      getRunHierarchyNode: async (_db: D1Database, runId: string) => {
        if (runId === "parent-run") {
          return makeNode({ id: "parent-run", parentRunId: "missing-run" });
        }
        return null;
      },
    },
    async () => {
      const error = await validateParentRunId(
        {} as D1Database,
        "space-1",
        "parent-run",
      );

      assertEquals(error, "Invalid parent_run_id: run hierarchy is broken");
    },
  );
});

Deno.test("validateParentRunId rejects cycles in the run hierarchy", async () => {
  await withValidationDeps(
    {
      isValidOpaqueId: acceptOpaqueId,
      getRunHierarchyNode: async (_db: D1Database, runId: string) => {
        if (runId === "run-A") {
          return makeNode({ id: "run-A", parentRunId: "run-B" });
        }
        if (runId === "run-B") {
          return makeNode({ id: "run-B", parentRunId: "run-A" });
        }
        return null;
      },
    },
    async () => {
      const error = await validateParentRunId(
        {} as D1Database,
        "space-1",
        "run-A",
      );

      assertEquals(
        error,
        "Invalid parent_run_id: run hierarchy cycle detected",
      );
    },
  );
});

Deno.test("validateParentRunId rejects nesting that exceeds the maximum depth", async () => {
  const nodes = new Map<string, RunNode>();
  for (let i = 0; i < 6; i++) {
    nodes.set(
      `run-${i}`,
      makeNode({
        id: `run-${i}`,
        parentRunId: i < 5 ? `run-${i + 1}` : null,
      }),
    );
  }

  await withValidationDeps(
    {
      isValidOpaqueId: acceptOpaqueId,
      getRunHierarchyNode: async (_db: D1Database, runId: string) =>
        nodes.get(runId) ?? null,
    },
    async () => {
      const error = await validateParentRunId(
        {} as D1Database,
        "space-1",
        "run-0",
      );

      assertStringIncludes(error ?? "", "Run nesting depth exceeded");
    },
  );
});

Deno.test("resolveRunModel falls back to the workspace model or default", async () => {
  await withValidationDeps(
    {
      getSpaceModel: async (_db: D1Database, spaceId: string) =>
        spaceId === "space-1" ? { aiModel: "gpt-5.4-mini" } : null,
      logWarn: spy(() => undefined),
    },
    async () => {
      const workspaceModel = await resolveRunModel(
        {} as D1Database,
        "space-1",
        undefined,
      );
      const requestedModel = await resolveRunModel(
        {} as D1Database,
        "space-1",
        "gpt-5.4-nano",
      );

      assertEquals(workspaceModel, "gpt-5.4-mini");
      assertEquals(requestedModel, "gpt-5.4-nano");
    },
  );
});

Deno.test("resolveRunModel logs and rejects suspicious model strings", async () => {
  const warnSpy = spy((_message: string) => undefined);

  await withValidationDeps(
    {
      getSpaceModel: async () => null,
      logWarn: warnSpy,
    },
    async () => {
      const model = await resolveRunModel(
        {} as D1Database,
        "space-1",
        '<script>alert("xss")</script>',
      );

      assertEquals(model, "gpt-5.4-nano");
      assertSpyCalls(warnSpy, 1);
      assertStringIncludes(
        String(warnSpy.calls[0].args[0] ?? ""),
        "Suspicious model parameter rejected",
      );
    },
  );
});

Deno.test("resolveRunModel uses the default model when workspace aiModel is null", async () => {
  await withValidationDeps(
    {
      getSpaceModel: async () => ({ aiModel: null }),
    },
    async () => {
      const model = await resolveRunModel(
        {} as D1Database,
        "space-1",
        undefined,
      );

      assertEquals(model, "gpt-5.4-nano");
    },
  );
});
