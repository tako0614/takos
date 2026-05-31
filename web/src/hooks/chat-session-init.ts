export interface ChatSessionInitState {
  threadId: string;
  focusSequence: number | null;
}

export function nextChatSessionInitState(
  previous: ChatSessionInitState | undefined,
  threadId: string,
  focusSequence: number | null,
): ChatSessionInitState {
  if (!previous) {
    return { threadId, focusSequence };
  }

  if (threadId !== previous.threadId) {
    return { threadId, focusSequence };
  }

  if (focusSequence !== null && focusSequence !== previous.focusSequence) {
    return { threadId, focusSequence };
  }

  return previous;
}
