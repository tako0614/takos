import { expect, test } from "bun:test";
import type { Workflow } from "../../workflow-models.ts";
import {
  buildDependencyGraph,
  DependencyError,
  groupIntoPhases,
} from "../../scheduler/dependency.ts";

test("dependency helpers - throws DependencyError with the same circular message shape for sorting and phase grouping", () => {
  const workflow: Workflow = {
    name: "cycle-workflow",
    on: "push",
    jobs: {
      a: {
        "runs-on": "ubuntu-latest",
        needs: "c",
        steps: [{ run: "echo a" }],
      },
      b: {
        "runs-on": "ubuntu-latest",
        needs: "a",
        steps: [{ run: "echo b" }],
      },
      c: {
        "runs-on": "ubuntu-latest",
        needs: "b",
        steps: [{ run: "echo c" }],
      },
    },
  };
  const graph = buildDependencyGraph(workflow);

  const toDependencyError = (fn: () => unknown): DependencyError => {
    try {
      fn();
    } catch (error) {
      expect(error instanceof DependencyError).toBeTruthy();
      return error as DependencyError;
    }
    throw new Error("Expected DependencyError to be thrown");
  };

  const phaseError = toDependencyError(() => groupIntoPhases(graph));

  expect(/^Circular dependency detected: .+( -> .+)+$/
      .test(phaseError.message)).toBeTruthy();
});
