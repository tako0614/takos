import { assert, assertEquals } from "jsr:@std/assert";
import {
  looksLikeWrappedConnectionMessage,
  SSE_RUN_EVENT_TYPES,
  wrapSseMessage,
} from "../../hooks/useSseConnectionManager.ts";

Deno.test("useSseConnectionManager helpers - register named SSE run events", () => {
  assert(SSE_RUN_EVENT_TYPES.includes("tool_call"));
  assert(SSE_RUN_EVENT_TYPES.includes("completed"));
  assert(!SSE_RUN_EVENT_TYPES.includes("message"));
});

Deno.test("useSseConnectionManager helpers - wraps named events with event id", () => {
  const wrapped = wrapSseMessage(
    "tool_call",
    JSON.stringify({ tool: "fs" }),
    "42",
  );
  const parsed = JSON.parse(wrapped) as {
    type: string;
    data: string;
    eventId?: number;
    event_id?: string;
  };

  assertEquals(parsed, {
    type: "tool_call",
    data: JSON.stringify({ tool: "fs" }),
    eventId: 42,
    event_id: "42",
  });
});

Deno.test("useSseConnectionManager helpers - keeps already wrapped message payloads intact", () => {
  const wrappedMessage = JSON.stringify({
    type: "completed",
    data: { status: "done" },
    event_id: "99",
  });

  assert(looksLikeWrappedConnectionMessage(wrappedMessage));
  assertEquals(wrapSseMessage("message", wrappedMessage, "99"), wrappedMessage);
});
