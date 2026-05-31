import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { test } from "bun:test";


const { resolveMessageSequenceById } = await import(
  "../../../views/chat/message-sequence-resolver.ts"
);

test("resolveMessageSequenceById - finds the target sequence", async () => {
  const sequence = await resolveMessageSequenceById({
    messageId: "message-2",
    fetchPage: (offset) => {
      if (offset === 0) {
        return Promise.resolve({
          messages: [
            { id: "message-1", sequence: 10 },
            { id: "message-2", sequence: 11 },
          ],
          total: 2,
        });
      }
      return Promise.resolve({ messages: [], total: 2 });
    },
  });

  assertEquals(sequence, 11);
});

test("resolveMessageSequenceById - caps the scan at maxPages", async () => {
  let pagesFetched = 0;
  const sequence = await resolveMessageSequenceById({
    messageId: "missing",
    maxPages: 3,
    pageSize: 2,
    // total stays larger than what 3 pages of size 2 can reach, so the scan
    // must stop because of the page cap rather than exhausting `total`.
    fetchPage: (offset: number) => {
      pagesFetched++;
      return Promise.resolve({
        messages: [
          { id: `m-${offset}`, sequence: offset },
          { id: `m-${offset + 1}`, sequence: offset + 1 },
        ],
        total: 1000,
      });
    },
  });

  assertEquals(sequence, null);
  assertEquals(pagesFetched, 3);
});

test("resolveMessageSequenceById - returns null on fetch failure", async () => {
  const sequence = await resolveMessageSequenceById({
    messageId: "message-2",
    fetchPage: () => {
      return Promise.reject(new Error("network"));
    },
  });

  assertEquals(sequence, null);
});
