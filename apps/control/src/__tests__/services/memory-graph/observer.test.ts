import { createToolObserver } from "@/services/memory-graph/observer";
import { RunOverlay } from "@/services/memory-graph/overlay";

import { assert, assertEquals } from "jsr:@std/assert";

let overlay: RunOverlay;
const accountId = "acct1";
const runId = "run1";
Deno.test("ToolObserver - creates claim + evidence from remember tool", () => {
  overlay = new RunOverlay();
  const observer = createToolObserver(accountId, runId, overlay);

  observer.observe({
    toolName: "remember",
    arguments: {
      content: "User prefers TypeScript over JavaScript",
      type: "semantic",
    },
    result: "Remembered (semantic): User prefers TypeScript...",
    timestamp: Date.now(),
  });

  const claims = observer.getOverlayClaims();
  assertEquals(claims.length, 1);
  assertEquals(claims[0].claimType, "fact");
  assertEquals(claims[0].subject, "User");
  assertEquals(claims[0].predicate, "prefers");

  const evidence = observer.getOverlayEvidence();
  assertEquals(evidence.length, 1);
  assertEquals(evidence[0].kind, "supports");
  assertEquals(evidence[0].trust, 0.9);
});
Deno.test("ToolObserver - creates claim from remember with procedural type", () => {
  overlay = new RunOverlay();
  const observer = createToolObserver(accountId, runId, overlay);

  observer.observe({
    toolName: "remember",
    arguments: {
      content: "Deploy process uses Cloudflare Workers",
      type: "procedural",
    },
    result: "Remembered",
    timestamp: Date.now(),
  });

  const claims = observer.getOverlayClaims();
  assertEquals(claims.length, 1);
  assertEquals(claims[0].claimType, "preference");
});
Deno.test("ToolObserver - adds taint evidence on tool errors for related claims", () => {
  overlay = new RunOverlay();
  const observer = createToolObserver(accountId, runId, overlay);

  // First, create a claim that mentions a tool
  overlay.addClaim({
    id: "c1",
    accountId,
    claimType: "fact",
    subject: "file_read",
    predicate: "is",
    object: "working",
  });

  // Observe a tool error
  observer.observe({
    toolName: "file_read",
    arguments: { path: "/nonexistent" },
    result: "",
    error: "File not found",
    timestamp: Date.now(),
  });

  const evidence = observer.getOverlayEvidence();
  assert(evidence.length >= 1);
  const taintedEvidence = evidence.find((e) => e.taint === "tool_error");
  assert(taintedEvidence !== undefined);
  assertEquals(taintedEvidence!.trust, 0.5);
});
Deno.test("ToolObserver - adds context evidence from recall tool", () => {
  overlay = new RunOverlay();
  const observer = createToolObserver(accountId, runId, overlay);

  // Pre-populate overlay with a claim
  overlay.addClaim({
    id: "c1",
    accountId,
    claimType: "fact",
    subject: "deployment",
    predicate: "uses",
    object: "Workers",
  });

  observer.observe({
    toolName: "recall",
    arguments: { query: "deployment" },
    result: "Found 2 memories about deployment...",
    timestamp: Date.now(),
  });

  const evidence = observer.getOverlayEvidence();
  const contextEvidence = evidence.find((e) =>
    e.sourceType === "memory_recall"
  );
  assert(contextEvidence !== undefined);
  assertEquals(contextEvidence!.kind, "context");
});
Deno.test("ToolObserver - ignores remember with no content", () => {
  overlay = new RunOverlay();
  const observer = createToolObserver(accountId, runId, overlay);

  observer.observe({
    toolName: "remember",
    arguments: { type: "semantic" },
    result: "",
    timestamp: Date.now(),
  });

  assertEquals(observer.getOverlayClaims().length, 0);
});
Deno.test("ToolObserver - never throws on observer errors", () => {
  overlay = new RunOverlay();
  const observer = createToolObserver(accountId, runId, overlay);

  // Should not throw even with unusual input
  try {
    (() => {
      observer.observe({
        toolName: "remember",
        arguments: { content: null as unknown as string, type: "semantic" },
        result: "",
        timestamp: Date.now(),
      });
    });
  } catch (_e) {
    throw new Error("Expected no throw");
  }
});
