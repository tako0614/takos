import { expect, test } from "bun:test";
import { createRunSchema } from "../runs/create.ts";
import { AGENT_TYPES } from "../../../shared/types/agent-tasks.ts";
import { MAX_RUN_INPUT_BYTES } from "../../../shared/utils/run-input.ts";

test("public Run creation accepts only current agent modes and bounded input", () => {
  for (const agentType of AGENT_TYPES) {
    expect(
      createRunSchema.safeParse({
        agent_type: agentType,
        model: "gpt-5.5",
        input: { locale: "ja" },
        idempotency_key: "ab".repeat(16),
        confirmation_grant_id: "confirmation_1",
      }).success,
    ).toBe(true);
  }
  expect(
    createRunSchema.safeParse({ agent_type: "privileged-invented-mode" })
      .success,
  ).toBe(false);
  expect(
    createRunSchema.safeParse({
      agent_type: "default",
      trusted: true,
    }).success,
  ).toBe(false);
});

test("public Run creation rejects oversized persistence and identifier fields", () => {
  expect(
    createRunSchema.safeParse({
      input: { payload: "x".repeat(MAX_RUN_INPUT_BYTES) },
    }).success,
  ).toBe(false);
  expect(
    createRunSchema.safeParse({ parent_run_id: "p".repeat(129) }).success,
  ).toBe(false);
  expect(
    createRunSchema.safeParse({ model: "m".repeat(129) }).success,
  ).toBe(false);
  expect(
    createRunSchema.safeParse({ confirmation_grant_id: "c".repeat(129) })
      .success,
  ).toBe(false);
});
