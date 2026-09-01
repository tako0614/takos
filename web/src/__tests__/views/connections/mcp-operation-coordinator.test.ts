import { expect, test } from "bun:test";
import {
  createMcpOperationCoordinator,
  type McpOperationCoordinatorState,
} from "../../../views/connections/mcp-operation-coordinator.ts";

test("portable Connections operations exclude mutations in both directions", () => {
  let state!: McpOperationCoordinatorState;
  const coordinator = createMcpOperationCoordinator((next) => {
    state = next;
  });

  const releaseExport = coordinator.acquirePortable("export");
  expect(releaseExport).not.toBeNull();
  expect(state).toEqual({
    portableOperation: "export",
    activeMutations: 0,
  });
  expect(coordinator.acquireMutation()).toBeNull();
  expect(coordinator.acquirePortable("import")).toBeNull();

  releaseExport?.();
  expect(state.portableOperation).toBeNull();

  const releaseFirst = coordinator.acquireMutation();
  const releaseSecond = coordinator.acquireMutation();
  expect(state.activeMutations).toBe(2);
  expect(coordinator.acquirePortable("import")).toBeNull();

  releaseFirst?.();
  releaseFirst?.();
  expect(state.activeMutations).toBe(1);
  expect(coordinator.acquirePortable("import")).toBeNull();

  releaseSecond?.();
  const releaseImport = coordinator.acquirePortable("import");
  expect(releaseImport).not.toBeNull();
  expect(state.portableOperation).toBe("import");
  releaseImport?.();
  expect(state).toEqual({ portableOperation: null, activeMutations: 0 });
});
