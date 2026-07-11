import { expect, test } from "bun:test";
import { validateAgentEngineCheckoutState } from "../../validate-agent-engine-source.ts";

const source = {
  schemaVersion: 1,
  repository: "tako0614/takos-agent-engine",
  commit: "a".repeat(40),
};

test("agent engine checkout must match the immutable pin and be clean", () => {
  expect(
    validateAgentEngineCheckoutState(source, `${"a".repeat(40)}\n`, ""),
  ).toEqual([]);
  expect(
    validateAgentEngineCheckoutState(source, "b".repeat(40), ""),
  ).toContain(
    `takos-agent-engine checkout HEAD ${"b".repeat(40)} does not match pinned commit ${"a".repeat(40)}`,
  );
  expect(
    validateAgentEngineCheckoutState(
      source,
      "a".repeat(40),
      " M src/model/runner.rs\n",
    ),
  ).toContain(
    "takos-agent-engine checkout must be clean before validating a release source",
  );
});
