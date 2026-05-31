import assert from "node:assert/strict";
import { parseReplayCursor, toWsEnvelope } from "./notifier-base.ts";

Deno.test("toWsEnvelope emits the canonical notifier broadcast shape", () => {
  assert.deepEqual(
    toWsEnvelope({
      type: "run.delta",
      data: { text: "hello" },
      eventId: 42,
      createdAt: "2026-05-14T00:00:00.000Z",
    }),
    {
      type: "run.delta",
      data: { text: "hello" },
      eventId: 42,
      event_id: "42",
      created_at: "2026-05-14T00:00:00.000Z",
    },
  );
});

Deno.test("parseReplayCursor accepts absent/empty and non-negative integers", () => {
  assert.equal(parseReplayCursor(null), 0);
  assert.equal(parseReplayCursor(""), 0);
  assert.equal(parseReplayCursor("0"), 0);
  assert.equal(parseReplayCursor("42"), 42);
});

Deno.test("parseReplayCursor fails closed (null) on garbage input", () => {
  // parseInt would have coerced these to NaN / 5 / -3, silently breaking the
  // 400 guard and the e.id > cursor replay filter. Strict parse rejects them.
  assert.equal(parseReplayCursor("abc"), null);
  assert.equal(parseReplayCursor("5x"), null);
  assert.equal(parseReplayCursor("-3"), null);
  assert.equal(parseReplayCursor("3.5"), null);
  assert.equal(parseReplayCursor("99999999999999999999"), null); // > MAX_SAFE_INTEGER
});
