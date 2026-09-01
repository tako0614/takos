import { expect, test } from "bun:test";
import { coerceValue, isExpired, serializeValue } from "../kv-store-shared.ts";

test("KV adapter helpers preserve text, JSON, bytes, and streams", async () => {
  expect(coerceValue("plain", "text")).toBe("plain");
  expect(coerceValue('{"ok":true}', "json")).toEqual({ ok: true });
  expect(
    new TextDecoder().decode(
      coerceValue("bytes", "arrayBuffer") as ArrayBuffer,
    ),
  ).toBe("bytes");
  expect(
    await new Response(
      coerceValue("stream", "stream") as ReadableStream<Uint8Array>,
    ).text(),
  ).toBe("stream");

  expect(await serializeValue("plain")).toBe("plain");
  expect(await serializeValue(new TextEncoder().encode("bytes").buffer)).toBe(
    "bytes",
  );
  expect(
    await serializeValue(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("stream"));
          controller.close();
        },
      }),
    ),
  ).toBe("stream");
});

test("KV adapter expiration helper accepts backend timestamp shapes", () => {
  expect(isExpired(undefined)).toBe(false);
  expect(isExpired(null)).toBe(false);
  expect(isExpired("1")).toBe(true);
  expect(isExpired(9_999_999_999)).toBe(false);
});
