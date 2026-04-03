import { assertEquals } from "jsr:@std/assert";

const { buildChatSearchNavigationState } = await import(
  "../../../components/layout/app-modal-state.ts"
);

Deno.test("buildChatSearchNavigationState - preserves message deep-links", () => {
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
