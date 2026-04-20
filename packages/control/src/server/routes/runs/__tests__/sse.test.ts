import { assertStringIncludes } from "jsr:@std/assert";
import { createPollingRunObservationStream } from "../observation.ts";

Deno.test("run SSE polling stream emits buffered events and closes on terminal status", async () => {
  const observedCursor: number[] = [];
  let callCount = 0;

  const stream = createPollingRunObservationStream(
    async (afterEventId) => {
      observedCursor.push(afterEventId);
      callCount += 1;

      if (callCount === 1) {
        return {
          events: [
            {
              id: 7,
              event_id: "7",
              run_id: "run-123",
              type: "run.started",
              data: '{"status":"running"}',
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
          runStatus: "running",
        };
      }

      return {
        events: [],
        runStatus: "completed",
      };
    },
    0,
    { pollIntervalMs: 0, heartbeatIntervalMs: 0 },
  );

  const text = await new Response(stream).text();

  assertStringIncludes(text, ": connected");
  assertStringIncludes(text, "id: 7");
  assertStringIncludes(text, "event: run.started");
  assertStringIncludes(text, 'data: {"status":"running"}');
  assertStringIncludes(JSON.stringify(observedCursor), "[0,7]");
});

Deno.test("run SSE polling stream closes after emitting a terminal event", async () => {
  const observedCursor: number[] = [];
  const stream = createPollingRunObservationStream(
    async (afterEventId) => {
      observedCursor.push(afterEventId);
      return {
        events: [
          {
            id: 9,
            event_id: "9",
            run_id: "run-123",
            type: "completed",
            data: '{"status":"completed"}',
            created_at: "2026-01-01T00:00:01.000Z",
          },
        ],
        runStatus: "completed",
      };
    },
    0,
    { pollIntervalMs: 0, heartbeatIntervalMs: 0 },
  );

  const text = await new Response(stream).text();

  assertStringIncludes(text, "id: 9");
  assertStringIncludes(text, "event: completed");
  assertStringIncludes(JSON.stringify(observedCursor), "[0]");
});
