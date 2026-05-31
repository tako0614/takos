import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { test } from "bun:test";


const { buildChatSearchNavigationState } = await import(
  "../../../components/layout/app-modal-state.ts"
);

test("buildChatSearchNavigationState - preserves message deep-links", () => {
  assertEquals(
    buildChatSearchNavigationState(
      "space-1",
      "thread-9",
      "message-2",
    ),
    {
      view: "chat",
      spaceId: "space-1",
      threadId: "thread-9",
      runId: undefined,
      messageId: "message-2",
    },
  );
});
