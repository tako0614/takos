import { expect, test } from "bun:test";
import {
  createPlugin,
  fromJSON,
  SerovalDeserializationError,
  SerovalMalformedNodeError,
  toJSON,
  toJSONAsync,
} from "seroval";
import { HeadersPlugin, URLPlugin } from "seroval-plugins/web";

test("fromJSON rejects a plugin-produced thenable without invoking its callable", async () => {
  // GHSA-p6vx-979v-rg4c: a fulfilled Promise must not assimilate a callable
  // introduced by a plugin while restoring otherwise valid serialized data.
  class DeferredValue {}
  let invocations = 0;
  const plugin = createPlugin<DeferredValue, Record<string, never>>({
    tag: "takos-test/deferred-value",
    test: (value) => value instanceof DeferredValue,
    parse: { async: async () => ({}) },
    serialize: () => "({})",
    deserialize: () => ({
      // eslint-disable-next-line unicorn/no-thenable -- malicious thenable is the regression input.
      then(resolve: (value: string) => void) {
        invocations += 1;
        resolve("unexpected plugin invocation");
      },
    }),
  });
  const payload = await toJSONAsync(Promise.resolve(new DeferredValue()), {
    plugins: [plugin],
  });
  let restored: Promise<unknown> | undefined;
  let error: unknown;
  try {
    restored = fromJSON<Promise<unknown>>(payload, { plugins: [plugin] });
  } catch (caught) {
    error = caught;
  }
  if (restored) await restored;
  await Promise.resolve();
  expect(invocations).toBe(0);
  expect(error).toBeInstanceOf(SerovalDeserializationError);
  expect((error as SerovalDeserializationError).cause).toBeInstanceOf(
    SerovalMalformedNodeError,
  );
});

test("serialization restores shared references, cycles and web plugin values", () => {
  const shared = { workspace: "Takos" };
  const source = {
    first: shared,
    second: shared,
    created: new Date("2026-10-14T12:00:00Z"),
    bytes: new Uint8Array([0, 127, 255]),
    counts: new Map([["messages", 3]]),
    url: new URL("https://example.test/workspace?name=Takos"),
    headers: new Headers({ "content-type": "application/json" }),
    self: undefined as unknown,
  };
  source.self = source;
  const plugins = [URLPlugin, HeadersPlugin];
  const encoded = JSON.parse(JSON.stringify(toJSON(source, { plugins })));
  const restored = fromJSON<typeof source>(encoded, { plugins });

  expect(restored).not.toBe(source);
  expect(restored.first).toEqual({ workspace: "Takos" });
  expect(restored.first).toBe(restored.second);
  expect(restored.self).toBe(restored);
  expect(restored.created.toISOString()).toBe("2026-10-14T12:00:00.000Z");
  expect([...restored.bytes]).toEqual([0, 127, 255]);
  expect(restored.counts.get("messages")).toBe(3);
  expect(restored.url.searchParams.get("name")).toBe("Takos");
  expect(restored.headers.get("content-type")).toBe("application/json");
});

test("fulfilled Promise restoration preserves its value and shared identity", async () => {
  const result = Promise.resolve({ label: "loaded", count: 3 });
  const source = { first: result, second: result };
  const restored = fromJSON<typeof source>(await toJSONAsync(source));
  expect(restored.first).toBeInstanceOf(Promise);
  expect(restored.first).toBe(restored.second);
  expect(await restored.first).toEqual({ label: "loaded", count: 3 });
});

test("rejected Promise restoration preserves the error", async () => {
  const source = Promise.reject(new TypeError("workspace unavailable"));
  const restored = fromJSON<Promise<never>>(await toJSONAsync(source));
  await expect(restored).rejects.toBeInstanceOf(TypeError);
  await expect(restored).rejects.toThrow("workspace unavailable");
});
