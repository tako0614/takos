import type { Message } from "../../types/index.ts";

const MESSAGE_LOOKUP_PAGE_SIZE = 200;

export interface MessageSequenceLookupPage {
  messages: Array<Pick<Message, "id" | "sequence">>;
  total: number;
}

export interface MessageSequenceLookupOptions {
  messageId: string;
  fetchPage: (
    offset: number,
    limit: number,
  ) => Promise<MessageSequenceLookupPage>;
  pageSize?: number;
}

export async function resolveMessageSequenceById({
  messageId,
  fetchPage,
  pageSize = MESSAGE_LOOKUP_PAGE_SIZE,
}: MessageSequenceLookupOptions): Promise<number | null> {
  try {
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;

    while (offset < total) {
      const page = await fetchPage(offset, pageSize);
      const matchedMessage = page.messages.find((message) =>
        message.id === messageId
      );
      if (matchedMessage) {
        return matchedMessage.sequence;
      }

      total = page.total;
      if (page.messages.length === 0) {
        break;
      }
      offset += page.messages.length;
    }
  } catch {
    // Treat fetch failures as unresolved deep-links.
  }

  return null;
}
