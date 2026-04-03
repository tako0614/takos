export function buildChatSearchNavigationState(
  spaceId: string | undefined,
  threadId: string,
  messageId: string,
) {
  return {
    view: "chat" as const,
    spaceId,
    threadId,
    runId: undefined,
    messageId,
  };
}
