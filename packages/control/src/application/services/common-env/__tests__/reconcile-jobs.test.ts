import { assertEquals } from "jsr:@std/assert";

import { CommonEnvReconcileJobStore } from "../reconcile-jobs.ts";

Deno.test("CommonEnvReconcileJobStore.parseTargetKeys - parses valid JSON array of strings", () => {
  const result = CommonEnvReconcileJobStore.parseTargetKeys({
    targetKeysJson: '["MY_VAR","ANOTHER"]',
  });

  assertEquals(result, ["MY_VAR", "ANOTHER"]);
});

Deno.test("CommonEnvReconcileJobStore.parseTargetKeys - returns undefined for null targetKeysJson", () => {
  const result = CommonEnvReconcileJobStore.parseTargetKeys({
    targetKeysJson: null,
  });

  assertEquals(result, undefined);
});

Deno.test("CommonEnvReconcileJobStore.parseTargetKeys - returns undefined for invalid JSON", () => {
  const result = CommonEnvReconcileJobStore.parseTargetKeys({
    targetKeysJson: "not-json",
  });

  assertEquals(result, undefined);
});

Deno.test("CommonEnvReconcileJobStore.parseTargetKeys - returns undefined for non-array JSON", () => {
  const result = CommonEnvReconcileJobStore.parseTargetKeys({
    targetKeysJson: '{"key":"val"}',
  });

  assertEquals(result, undefined);
});

Deno.test("CommonEnvReconcileJobStore.parseTargetKeys - filters out non-string elements", () => {
  const result = CommonEnvReconcileJobStore.parseTargetKeys({
    targetKeysJson: '["MY_VAR", 123, null, "ANOTHER"]',
  });

  assertEquals(result, ["MY_VAR", "ANOTHER"]);
});

Deno.test("CommonEnvReconcileJobStore.parseTargetKeys - returns undefined for empty array", () => {
  const result = CommonEnvReconcileJobStore.parseTargetKeys({
    targetKeysJson: "[]",
  });

  assertEquals(result, undefined);
});

Deno.test("CommonEnvReconcileJobStore.parseTargetKeys - returns undefined for array of all non-strings", () => {
  const result = CommonEnvReconcileJobStore.parseTargetKeys({
    targetKeysJson: "[1, 2, 3]",
  });

  assertEquals(result, undefined);
});
