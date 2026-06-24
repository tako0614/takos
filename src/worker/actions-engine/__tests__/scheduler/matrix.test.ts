import { expect, test } from "bun:test";

import { createExecutionPlan } from "../../scheduler/job.ts";
import {
  expandMatrix,
  MatrixExpansionLimitError,
} from "../../scheduler/matrix.ts";
import type { Workflow } from "../../workflow-models.ts";

test("expandMatrix - returns empty when strategy or matrix is missing", () => {
  expect(expandMatrix(undefined)).toEqual([]);
  expect(expandMatrix({})).toEqual([]);
  expect(expandMatrix({ matrix: {} })).toEqual([]);
});

test("expandMatrix - expands simple cartesian product", () => {
  const expansions = expandMatrix({
    matrix: {
      os: ["ubuntu-latest", "windows-latest"],
      node: [18, 20],
    },
  });

  expect(expansions.length).toEqual(4);
  const combinations = expansions.map((entry) => entry.matrix);
  expect(combinations.some(
      (entry) => entry?.os === "ubuntu-latest" && entry?.node === 18,
    )).toBeTruthy();
  expect(combinations.some(
      (entry) => entry?.os === "ubuntu-latest" && entry?.node === 20,
    )).toBeTruthy();
  expect(combinations.some(
      (entry) => entry?.os === "windows-latest" && entry?.node === 18,
    )).toBeTruthy();
  expect(combinations.some(
      (entry) => entry?.os === "windows-latest" && entry?.node === 20,
    )).toBeTruthy();

  // strategy metadata
  for (const entry of expansions) {
    expect(entry.strategy["job-total"]).toEqual(4);
    expect(entry.strategy["fail-fast"]).toEqual(true);
  }
});

test("expandMatrix - applies exclude entries", () => {
  const expansions = expandMatrix({
    matrix: {
      os: ["ubuntu-latest", "windows-latest"],
      node: [18, 20],
      exclude: [{ os: "windows-latest", node: 18 }],
    },
  });

  expect(expansions.length).toEqual(3);
  for (const entry of expansions) {
    expect(!(entry.matrix?.os === "windows-latest" && entry.matrix?.node === 18)).toBeTruthy();
  }
});

test("expandMatrix - applies include entries that extend existing combinations", () => {
  const expansions = expandMatrix({
    matrix: {
      os: ["ubuntu-latest", "windows-latest"],
      node: [18, 20],
      include: [{ os: "ubuntu-latest", node: 20, experimental: true }],
    },
  });

  expect(expansions.length).toEqual(4);
  const matched = expansions.find(
    (entry) =>
      entry.matrix?.os === "ubuntu-latest" && entry.matrix?.node === 20,
  );
  expect(matched).toBeTruthy();
  expect(matched.matrix?.experimental).toEqual(true);
});

test("expandMatrix - adds non-matching include entries as new combinations", () => {
  const expansions = expandMatrix({
    matrix: {
      os: ["ubuntu-latest"],
      include: [{ os: "macos-latest", node: 20 }],
    },
  });

  // base cartesian has 1 entry, include adds one because os value does not match
  expect(expansions.length).toEqual(2);
  const osValues = expansions.map((entry) => entry.matrix?.os).sort();
  expect(osValues).toEqual(["macos-latest", "ubuntu-latest"]);
});

test("createExecutionPlan - expands matrix jobs into separate entries", () => {
  const workflow: Workflow = {
    name: "matrix-plan",
    on: "push",
    jobs: {
      test: {
        "runs-on": "ubuntu-latest",
        strategy: {
          matrix: {
            node: [18, 20, 22],
          },
        },
        steps: [{ run: "npm test" }],
      },
    },
  };

  const plan = createExecutionPlan(workflow);
  expect(plan.phases.length).toEqual(1);
  expect(plan.phases[0].length).toEqual(3);
  for (const jobId of plan.phases[0]) {
    expect(jobId.startsWith("test-")).toBeTruthy();
  }
});

test("expandMatrix - rejects a base cartesian product past the 256 cap (DoS)", () => {
  // 16 × 17 = 272 combinations > 256.
  expect(() =>
    expandMatrix({
      matrix: {
        a: Array.from({ length: 16 }, (_, i) => i),
        b: Array.from({ length: 17 }, (_, i) => i),
      },
    })
  ).toThrow(MatrixExpansionLimitError);
});

test("expandMatrix - rejects an oversized include array (DoS bypass)", () => {
  // Small base product, but a huge `include` array used to bypass the cap and
  // append unbounded jobs / cause quadratic CPU.
  const include = Array.from({ length: 300 }, (_, i) => ({ extra: i }));
  expect(() => expandMatrix({ matrix: { os: ["linux"], include } })).toThrow(
    MatrixExpansionLimitError,
  );
});

test("expandMatrix - rejects includes that push the total past the cap", () => {
  // 200 base combinations + 100 non-matching includes = 300 jobs > 256.
  const include = Array.from({ length: 100 }, (_, i) => ({ os: `extra-${i}` }));
  expect(() =>
    expandMatrix({
      matrix: { os: Array.from({ length: 200 }, (_, i) => `os-${i}`), include },
    })
  ).toThrow(MatrixExpansionLimitError);
});
