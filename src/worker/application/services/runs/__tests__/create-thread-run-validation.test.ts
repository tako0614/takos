import { afterEach, expect, test } from "bun:test";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import {
  createThreadRunValidationDeps,
  resolveRunModel,
} from "../create-thread-run-validation.ts";

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
