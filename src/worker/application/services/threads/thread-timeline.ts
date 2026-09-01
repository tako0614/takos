import type { Env } from "../../../shared/types/index.ts";
import { listThreadMessages } from "./thread-service.ts";

export const threadTimelineDeps = {
  listThreadMessages,
};

export async function getThreadTimeline(
  env: Env,
  threadId: string,
  limit: number,
  offset: number,
  latest = false,
) {
  const page = await threadTimelineDeps.listThreadMessages(
    env,
    env.DB,
    threadId,
    limit,
    offset,
    { latest },
  );

  return {
    messages: page.messages,
    total: page.total,
    limit,
    offset: page.offset,
    truncation: {
      message_data: page.messageDataTruncated,
    },
  };
}
