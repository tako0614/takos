import { assertEquals } from "jsr:@std/assert";

const messagePersistenceSource = new URL(
  "../../../../../../packages/control/src/application/services/agent/message-persistence.ts",
  import.meta.url,
);

Deno.test("message persistence - source keeps the retry and idempotency guards", async () => {
  const source = await Deno.readTextFile(messagePersistenceSource);
  assertEquals(source.includes("UNIQUE constraint"), true);
  assertEquals(source.includes("idempotency"), true);
  assertEquals(source.includes("maxRetries = 5"), true);
  assertEquals(source.includes("sequence conflict"), true);
});

Deno.test("message persistence - source keeps offload and insert behavior", async () => {
  const source = await Deno.readTextFile(messagePersistenceSource);
  assertEquals(source.includes("shouldOffloadMessage"), true);
  assertEquals(source.includes("writeMessageToR2"), true);
  assertEquals(source.includes("db.insert(messages).values"), true);
  assertEquals(source.includes("Failed to add message after"), true);
});
