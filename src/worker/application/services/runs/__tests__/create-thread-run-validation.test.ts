import { afterEach, expect, test } from "bun:test";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import {
  createThreadRunValidationDeps,
  resolveRunModel,
  resolveSelectableRunModel,
} from "../create-thread-run-validation.ts";
import {
  clientOperationRowId,
  deriveClientOperationId,
} from "../../../../shared/utils/client-operation-id.ts";

const originalGetSpaceModel = createThreadRunValidationDeps.getSpaceModel;
const originalLogWarn = createThreadRunValidationDeps.logWarn;

afterEach(() => {
  createThreadRunValidationDeps.getSpaceModel = originalGetSpaceModel;
  createThreadRunValidationDeps.logWarn = originalLogWarn;
});

test("resolveRunModel rejects the wrapper-only local-smoke model", async () => {
  createThreadRunValidationDeps.getSpaceModel = async () => null;
  const warnings: string[] = [];
  createThreadRunValidationDeps.logWarn = (message) => {
    warnings.push(message);
  };

  const model = await resolveRunModel(
    {} as SqlDatabaseBinding,
    "space_1",
    "local-smoke",
  );

  expect(model).toBe(createThreadRunValidationDeps.defaultModelId);
  expect(warnings).toHaveLength(1);
});

test("resolveRunModel also rejects a saved local-smoke Workspace setting", async () => {
  createThreadRunValidationDeps.getSpaceModel = async () => ({
    aiModel: "local-smoke",
  });
  createThreadRunValidationDeps.logWarn = () => undefined;

  await expect(
    resolveRunModel({} as SqlDatabaseBinding, "space_1", undefined),
  ).resolves.toBe(createThreadRunValidationDeps.defaultModelId);
});

test("explicit Run models must remain selectable in the operator catalog", async () => {
  await expect(
    resolveSelectableRunModel(
      {} as SqlDatabaseBinding,
      "space_1",
      createThreadRunValidationDeps.defaultModelId,
    ),
  ).resolves.toBe(createThreadRunValidationDeps.defaultModelId);

  await expect(
    resolveSelectableRunModel(
      {} as SqlDatabaseBinding,
      "space_1",
      "client-only-model",
    ),
  ).resolves.toBeNull();
  await expect(
    resolveSelectableRunModel(
      {} as SqlDatabaseBinding,
      "space_1",
      "local-smoke",
    ),
  ).resolves.toBeNull();
});

test("client operation IDs derive disjoint deterministic message and Run IDs", () => {
  const key = "ab".repeat(16);
  expect(clientOperationRowId("thread", key)).toBe(`thread_request_${key}`);
  expect(clientOperationRowId("message", key)).toBe(`msg_request_${key}`);
  expect(clientOperationRowId("run", key)).toBe(`run_request_${key}`);
  expect(clientOperationRowId("workspace", key)).toBe(
    `workspace_request_${key}`,
  );
  expect(() => clientOperationRowId("run", "not-a-key")).toThrow(
    "Invalid client operation id",
  );
});

test("server operation IDs are stable, fixed-width, and namespace separated", async () => {
  const first = await deriveClientOperationId("task-thread", "task_1");
  expect(first).toMatch(/^[a-f0-9]{32}$/);
  expect(await deriveClientOperationId("task-thread", "task_1")).toBe(first);
  expect(await deriveClientOperationId("task-run", "task_1")).not.toBe(first);
});
