import { expect, test } from "bun:test";
import { assertValidToolArguments } from "../../../tools/argument-validator.ts";
import {
  RECALL,
  REMEMBER,
  SET_REMINDER,
} from "../../../tools/custom/memory.ts";
import {
  MAX_MEMORY_CONTENT_CHARACTERS,
  MAX_REMINDER_CONTENT_CHARACTERS,
} from "../../../../shared/types/index.ts";

test("Memory tools publish strict bounded argument contracts", () => {
  expect(() =>
    assertValidToolArguments({
      content: "Remember the exact boundary.",
      type: "semantic",
      importance: 0,
    }, REMEMBER.parameters)
  ).not.toThrow();
  expect(() =>
    assertValidToolArguments({
      content: "valid",
      type: "semantic",
      forged: true,
    }, REMEMBER.parameters)
  ).toThrow("unexpected property forged");
  expect(() =>
    assertValidToolArguments({
      content: "x".repeat(MAX_MEMORY_CONTENT_CHARACTERS + 1),
      type: "semantic",
    }, REMEMBER.parameters)
  ).toThrow("expected at most");
  expect(() =>
    assertValidToolArguments({ query: "quality", limit: 1.5 }, RECALL.parameters)
  ).toThrow("expected integer");
  expect(() =>
    assertValidToolArguments({
      content: "x".repeat(MAX_REMINDER_CONTENT_CHARACTERS + 1),
      trigger_type: "time",
      trigger_value: "2026-08-11T09:00:00.000Z",
    }, SET_REMINDER.parameters)
  ).toThrow("expected at most");
});
