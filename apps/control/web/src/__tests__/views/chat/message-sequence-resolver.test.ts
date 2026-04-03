import { assertEquals } from "jsr:@std/assert";

const { resolveMessageSequenceById } = await import(
  "../../../views/chat/message-sequence-resolver.ts"
);

Deno.test("resolveMessageSequenceById - finds the target sequence", async () => {
  const sequence = await resolveMessageSequenceById({
    messageId: "message-2",
    fetchPage: async (offset) => {
      if (offset === 0) {
        return {
          messages: [
            { id: "message-1", sequence: 10 },
            { id: "message-2", sequence: 11 },
          ],
          total: 2,
        };
      }
      return { messages: [], total: 2 };
    },
  });

  assertEquals(sequence, 11);
});

Deno.test("resolveMessageSequenceById - returns null on fetch failure", async () => {
  const sequence = await resolveMessageSequenceById({
    messageId: "message-2",
    fetchPage: async () => {
      throw new Error("network");
    },
  });

  assertEquals(sequence, null);
});
