import type { Message } from "../../types/index.ts";

const MESSAGE_LOOKUP_PAGE_SIZE = 200;

/**
 * Upper bound on the number of pages this scan will fetch.
 *
 * There is no server endpoint that maps a message id directly to its sequence,
 * so deep-link resolution falls back to paging the thread timeline. To avoid an
 * unbounded fan-out of serial requests when deep-linking into a very old
 * message of a long thread, the scan is capped: at the default page size of 200
 * this covers the most recent {@link MESSAGE_LOOKUP_PAGE_SIZE} * this many
 * messages. Beyond that we give up and the caller renders the standard
 * "message not loaded" state rather than blocking chat open on dozens of
 * round-trips. If a by-id sequence lookup endpoint is added, replace this scan
 * with a single targeted request.
 */
const MAX_LOOKUP_PAGES = 25;

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
  maxPages?: number;
}

export async function resolveMessageSequenceById({
  messageId,
  fetchPage,
  pageSize = MESSAGE_LOOKUP_PAGE_SIZE,
  maxPages = MAX_LOOKUP_PAGES,
}: MessageSequenceLookupOptions): Promise<number | null> {
  try {
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    let pagesFetched = 0;

    while (offset < total && pagesFetched < maxPages) {
      const page = await fetchPage(offset, pageSize);
      pagesFetched++;
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
    // No by-id lookup exists, so a mid-scan fetch failure cannot be
    // distinguished from "not found" here; treat both as an unresolved
    // deep-link and let the caller surface the standard not-loaded state.
  }

  return null;
}
