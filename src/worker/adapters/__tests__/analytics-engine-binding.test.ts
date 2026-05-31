import { jest, test } from "bun:test";
import { assertEquals } from "@std/assert";
import { createAnalyticsEngineBinding } from "../analytics-engine-binding.ts";

function useFakeTime(now: string | number | Date) {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(now));
  return {
    tick(ms: number) {
      jest.advanceTimersByTime(ms);
    },
    restore() {
      jest.useRealTimers();
    },
  };
}

test(
  "analytics-engine binding dispose() cancels the pending flush timer",
  () => {
    const time = useFakeTime("2026-01-01T00:00:00Z");
    let fetchCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((
      _url: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      fetchCalls++;
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof globalThis.fetch;
    try {
      const binding = createAnalyticsEngineBinding({
        dataset: "test",
        otelEndpoint: "http://localhost:4318/v1/logs",
      });

      binding.writeDataPoint({ indexes: ["a"], blobs: ["x"] });
      // Timer is now scheduled for +1s. dispose() must cancel it.
      binding.dispose();
      assertEquals(binding.disposed, true);

      // Advance well past the timer deadline.
      time.tick(5000);
      assertEquals(
        fetchCalls,
        0,
        "disposed binding must not flush to OTEL collector",
      );
    } finally {
      globalThis.fetch = realFetch;
      time.restore();
    }
  },
);

test(
  "analytics-engine binding writeDataPoint is a no-op after dispose()",
  () => {
    const time = useFakeTime("2026-01-01T00:00:00Z");
    let fetchCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((
      _url: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      fetchCalls++;
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof globalThis.fetch;
    try {
      const binding = createAnalyticsEngineBinding({
        dataset: "test",
        otelEndpoint: "http://localhost:4318/v1/logs",
      });
      binding.dispose();

      binding.writeDataPoint({ indexes: ["a"] });
      time.tick(5000);
      assertEquals(fetchCalls, 0);
    } finally {
      globalThis.fetch = realFetch;
      time.restore();
    }
  },
);

test(
  "analytics-engine binding buffer mode discards events after dispose()",
  () => {
    const binding = createAnalyticsEngineBinding({
      dataset: "test",
      mode: "buffer",
    });
    binding.writeDataPoint({ indexes: ["before"] });
    assertEquals(binding.getBuffer().length, 1);

    binding.dispose();
    binding.writeDataPoint({ indexes: ["after"] });

    // The "before" event remains in the buffer (no flushing semantics for
    // buffer mode). The "after" event must have been dropped.
    assertEquals(binding.getBuffer().length, 1);
    assertEquals(binding.getBuffer()[0].indexes, ["before"]);
  },
);

test(
  "analytics-engine binding flush() flushes pending OTEL batch synchronously",
  () => {
    const time = useFakeTime("2026-01-01T00:00:00Z");
    let fetchCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((
      _url: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      fetchCalls++;
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof globalThis.fetch;
    try {
      const binding = createAnalyticsEngineBinding({
        dataset: "test",
        otelEndpoint: "http://localhost:4318/v1/logs",
      });
      binding.writeDataPoint({ indexes: ["a"] });
      binding.flush();
      assertEquals(fetchCalls, 1);

      // Subsequent timer firing must not re-flush an empty batch.
      time.tick(5000);
      assertEquals(fetchCalls, 1);
    } finally {
      globalThis.fetch = realFetch;
      time.restore();
    }
  },
);
