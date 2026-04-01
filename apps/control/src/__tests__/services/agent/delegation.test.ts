import {
  buildDelegationPacket,
  buildDelegationSystemMessage,
  buildDelegationUserMessage,
  type DelegationPacket,
  getDelegationPacketFromRunInput,
  inferProductHintFromTextSamples,
  isDelegationLocale,
  isProductHint,
  normalizeStringArray,
  parseRunInputObject,
  PRODUCT_HINTS,
} from "@/application/services/agent/delegation.ts";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert";

Deno.test("normalizeStringArray - filters and trims string arrays", () => {
  assertEquals(normalizeStringArray(["  hello ", " world ", "", "  "]), [
    "hello",
    "world",
  ]);
});
Deno.test("normalizeStringArray - returns empty array for non-array input", () => {
  assertEquals(normalizeStringArray("not-an-array"), []);
  assertEquals(normalizeStringArray(null), []);
  assertEquals(normalizeStringArray(undefined), []);
  assertEquals(normalizeStringArray(42), []);
});
Deno.test("normalizeStringArray - filters out non-string items", () => {
  assertEquals(normalizeStringArray([1, null, "valid", undefined, "ok"]), [
    "valid",
    "ok",
  ]);
});

Deno.test("isDelegationLocale - accepts ja and en", () => {
  assertEquals(isDelegationLocale("ja"), true);
  assertEquals(isDelegationLocale("en"), true);
});
Deno.test("isDelegationLocale - rejects other values", () => {
  assertEquals(isDelegationLocale("fr"), false);
  assertEquals(isDelegationLocale(""), false);
  assertEquals(isDelegationLocale(null), false);
  assertEquals(isDelegationLocale(undefined), false);
  assertEquals(isDelegationLocale(42), false);
});

Deno.test("isProductHint - accepts all known product hints", () => {
  for (const hint of PRODUCT_HINTS) {
    assertEquals(isProductHint(hint), true);
  }
});
Deno.test("isProductHint - rejects unknown values", () => {
  assertEquals(isProductHint("unknown-product"), false);
  assertEquals(isProductHint(""), false);
  assertEquals(isProductHint(null), false);
  assertEquals(isProductHint(42), false);
});

Deno.test("parseRunInputObject - parses JSON string into object", () => {
  assertEquals(parseRunInputObject('{"task":"do it"}'), { task: "do it" });
});
Deno.test("parseRunInputObject - returns empty object for invalid JSON string", () => {
  assertEquals(parseRunInputObject("not-json"), {});
});
Deno.test("parseRunInputObject - returns empty object for array JSON", () => {
  assertEquals(parseRunInputObject("[1,2,3]"), {});
});
Deno.test("parseRunInputObject - passes through object input", () => {
  assertEquals(parseRunInputObject({ task: "test" }), { task: "test" });
});
Deno.test("parseRunInputObject - returns empty object for non-object types", () => {
  assertEquals(parseRunInputObject(null), {});
  assertEquals(parseRunInputObject(undefined), {});
  assertEquals(parseRunInputObject(42), {});
  assertEquals(parseRunInputObject([]), {});
});

const validInput = {
  task: "Fix the bug",
  parent_run_id: "run-1",
  parent_thread_id: "thread-1",
  root_thread_id: "root-1",
  goal: "Make it pass tests",
  deliverable: "Working code",
  constraints: ["Do not break API"],
  context: ["Found bug in module X"],
  acceptance_criteria: ["All tests pass"],
  product_hint: "takos",
  locale: "ja",
  thread_summary: "Bug investigation",
  thread_key_points: ["Module X is affected"],
};

Deno.test("getDelegationPacketFromRunInput - extracts a valid delegation packet from object input", () => {
  const result = getDelegationPacketFromRunInput(validInput);
  assertNotEquals(result, null);
  assertEquals(result!.task, "Fix the bug");
  assertEquals(result!.goal, "Make it pass tests");
  assertEquals(result!.product_hint, "takos");
  assertEquals(result!.locale, "ja");
  assertEquals(result!.constraints, ["Do not break API"]);
});
Deno.test("getDelegationPacketFromRunInput - extracts from nested delegation object", () => {
  const result = getDelegationPacketFromRunInput({ delegation: validInput });
  assertNotEquals(result, null);
  assertEquals(result!.task, "Fix the bug");
});
Deno.test("getDelegationPacketFromRunInput - extracts from JSON string", () => {
  const result = getDelegationPacketFromRunInput(JSON.stringify(validInput));
  assertNotEquals(result, null);
  assertEquals(result!.task, "Fix the bug");
});
Deno.test("getDelegationPacketFromRunInput - returns null when required fields are missing", () => {
  assertEquals(
    getDelegationPacketFromRunInput({ task: "no parent run id" }),
    null,
  );
  assertEquals(getDelegationPacketFromRunInput({}), null);
  assertEquals(getDelegationPacketFromRunInput(null), null);
});
Deno.test("getDelegationPacketFromRunInput - normalizes invalid product_hint and locale to null", () => {
  const result = getDelegationPacketFromRunInput({
    ...validInput,
    product_hint: "unknown",
    locale: "fr",
  });
  assertEquals(result!.product_hint, null);
  assertEquals(result!.locale, null);
});

Deno.test("inferProductHintFromTextSamples - detects takos from text samples", () => {
  assertEquals(
    inferProductHintFromTextSamples(["Fix apps/control module"]),
    "takos",
  );
  assertEquals(
    inferProductHintFromTextSamples(["Update takos-control"]),
    "takos",
  );
});
Deno.test("inferProductHintFromTextSamples - detects yurucommu from text samples", () => {
  assertEquals(
    inferProductHintFromTextSamples(["Update yurucommu feature"]),
    "yurucommu",
  );
});
Deno.test("inferProductHintFromTextSamples - detects roadtome from text samples", () => {
  assertEquals(
    inferProductHintFromTextSamples(["road-to-me improvements"]),
    "roadtome",
  );
  assertEquals(
    inferProductHintFromTextSamples(["road to me product"]),
    "roadtome",
  );
});
Deno.test("inferProductHintFromTextSamples - returns null when no product is detected", () => {
  assertEquals(inferProductHintFromTextSamples(["generic task"]), null);
  assertEquals(inferProductHintFromTextSamples([]), null);
});
Deno.test("inferProductHintFromTextSamples - returns null for ambiguous (tied) scores", () => {
  assertEquals(inferProductHintFromTextSamples(["takos yurucommu"]), null);
});
Deno.test("inferProductHintFromTextSamples - skips null/undefined samples", () => {
  assertEquals(
    inferProductHintFromTextSamples([null, undefined, "takos stuff"]),
    "takos",
  );
});

Deno.test("buildDelegationPacket - builds a packet with explicit fields", () => {
  const { packet, observability } = buildDelegationPacket({
    task: "Implement feature",
    goal: "Ship the feature",
    deliverable: "Code + tests",
    constraints: ["No breaking changes"],
    context: ["Parent found the root cause"],
    acceptanceCriteria: ["Tests pass"],
    productHint: "takos",
    locale: "ja",
    parentRunId: "run-1",
    parentThreadId: "thread-1",
    rootThreadId: "root-1",
    threadSummary: "Working on feature X",
    threadKeyPoints: ["Key point 1"],
  });

  assertEquals(packet.task, "Implement feature");
  assertEquals(packet.goal, "Ship the feature");
  assertEquals(packet.product_hint, "takos");
  assertEquals(packet.locale, "ja");
  assert(observability.explicit_field_count >= 7);
});
Deno.test("buildDelegationPacket - infers goal from latestUserMessage when not explicitly provided", () => {
  const { packet, observability } = buildDelegationPacket({
    task: "Fix bug",
    latestUserMessage: "Make it work properly",
    parentRunId: "run-1",
    parentThreadId: "thread-1",
    rootThreadId: "root-1",
  });

  assertEquals(packet.goal, "Make it work properly");
  assert(observability.inferred_field_count >= 1);
});
Deno.test("buildDelegationPacket - infers product hint from text samples", () => {
  const { packet } = buildDelegationPacket({
    task: "Fix apps/control module in takos",
    parentRunId: "run-1",
    parentThreadId: "thread-1",
    rootThreadId: "root-1",
  });

  assertEquals(packet.product_hint, "takos");
});
Deno.test("buildDelegationPacket - infers locale from parent run input", () => {
  const { packet } = buildDelegationPacket({
    task: "Fix bug",
    parentRunId: "run-1",
    parentThreadId: "thread-1",
    rootThreadId: "root-1",
    parentRunInput: { locale: "ja" },
  });

  assertEquals(packet.locale, "ja");
});
Deno.test("buildDelegationPacket - falls back to threadLocale and spaceLocale", () => {
  const { packet: p1 } = buildDelegationPacket({
    task: "Fix",
    parentRunId: "r1",
    parentThreadId: "t1",
    rootThreadId: "rt1",
    threadLocale: "en",
  });
  assertEquals(p1.locale, "en");

  const { packet: p2 } = buildDelegationPacket({
    task: "Fix",
    parentRunId: "r1",
    parentThreadId: "t1",
    rootThreadId: "rt1",
    spaceLocale: "ja",
  });
  assertEquals(p2.locale, "ja");
});
Deno.test("buildDelegationPacket - throws when task is empty", () => {
  assertThrows(
    () =>
      buildDelegationPacket({
        task: "  ",
        parentRunId: "r1",
        parentThreadId: "t1",
        rootThreadId: "rt1",
      }),
    Error,
    "Delegation task must be a non-empty string",
  );
});
Deno.test("buildDelegationPacket - tracks observability counters accurately", () => {
  const { observability } = buildDelegationPacket({
    task: "Do work",
    parentRunId: "run-1",
    parentThreadId: "thread-1",
    rootThreadId: "root-1",
    threadSummary: "Summary exists",
  });

  assertEquals(observability.has_thread_summary, true);
  assertEquals(observability.constraints_count, 0);
  assertEquals(observability.context_count, 0);
});

const packet: DelegationPacket = {
  task: "Implement the fix",
  goal: "Improve autonomy",
  deliverable: "Code changes",
  constraints: ["Do not break API"],
  context: ["Parent isolated the bug"],
  acceptance_criteria: ["Tests pass"],
  product_hint: "takos",
  locale: "ja",
  parent_run_id: "run-1",
  parent_thread_id: "thread-1",
  root_thread_id: "root-1",
  thread_summary: "Agent delegation fix",
  thread_key_points: ["Sub-agent context"],
};

Deno.test("buildDelegationSystemMessage - includes all non-empty fields in the system message", () => {
  const msg = buildDelegationSystemMessage(packet);
  assertEquals(msg.role, "system");
  assertStringIncludes(msg.content, "Delegated execution context:");
  assertStringIncludes(msg.content, "Goal: Improve autonomy");
  assertStringIncludes(msg.content, "Product hint: takos");
  assertStringIncludes(msg.content, "Deliverable: Code changes");
  assertStringIncludes(
    msg.content,
    "Parent thread summary: Agent delegation fix",
  );
  assertStringIncludes(msg.content, "Constraints:");
  assertStringIncludes(msg.content, "- Do not break API");
  assertStringIncludes(msg.content, "Relevant context:");
  assertStringIncludes(msg.content, "- Parent isolated the bug");
  assertStringIncludes(msg.content, "Acceptance criteria:");
  assertStringIncludes(msg.content, "- Tests pass");
});
Deno.test("buildDelegationSystemMessage - omits empty optional fields", () => {
  const minimalPacket: DelegationPacket = {
    task: "Do it",
    goal: null,
    deliverable: null,
    constraints: [],
    context: [],
    acceptance_criteria: [],
    product_hint: null,
    locale: null,
    parent_run_id: "run-1",
    parent_thread_id: "thread-1",
    root_thread_id: "root-1",
    thread_summary: null,
    thread_key_points: [],
  };
  const msg = buildDelegationSystemMessage(minimalPacket);
  assertEquals(msg.content, "Delegated execution context:");
});

Deno.test("buildDelegationUserMessage - creates a user message with parent run reference", () => {
  const packet: DelegationPacket = {
    task: "Implement feature X",
    goal: null,
    deliverable: null,
    constraints: [],
    context: [],
    acceptance_criteria: [],
    product_hint: null,
    locale: null,
    parent_run_id: "run-42",
    parent_thread_id: "thread-1",
    root_thread_id: "root-1",
    thread_summary: null,
    thread_key_points: [],
  };
  const msg = buildDelegationUserMessage(packet);
  assertEquals(msg.role, "user");
  assertStringIncludes(msg.content, "run: run-42");
  assertStringIncludes(msg.content, "Implement feature X");
});
