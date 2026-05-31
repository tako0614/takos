import { assertEquals } from "@std/assert";

import { getSseNotifier } from "./sse-notifier-access.ts";

Deno.test("getSseNotifier returns undefined for missing or malformed env", () => {
  assertEquals(getSseNotifier(null), undefined);
  assertEquals(getSseNotifier(undefined), undefined);
  assertEquals(getSseNotifier({}), undefined);
  assertEquals(
    getSseNotifier({ SSE_NOTIFIER: { emit: () => undefined } }),
    undefined,
  );
  assertEquals(
    getSseNotifier({ SSE_NOTIFIER: { subscribe: () => undefined } }),
    undefined,
  );
});

Deno.test("getSseNotifier returns the injected Node SSE notifier", () => {
  const notifier = {
    emit: (
      _channel: string,
      _event: { type: string; data: unknown; event_id?: number },
    ) => undefined,
    subscribe: (_channel: string, _lastEventId?: number) =>
      new ReadableStream<Uint8Array>(),
  };

  assertEquals(getSseNotifier({ SSE_NOTIFIER: notifier }), notifier);
});
