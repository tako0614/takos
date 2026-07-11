import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, messages, threads } from "../../../infra/db/index.ts";
import {
  getStorageItem,
  readFileContent,
} from "../../services/source/space-storage.ts";
import { parseMessageAttachmentRefs } from "../../services/agent/message-attachments.ts";
import type { ToolDefinition, ToolHandler } from "../tool-definitions.ts";
import { defineTools } from "./define-tools.ts";

// Tool results are committed with the terminal transcript. Keep attachment
// content well below the common 256 KiB result ceiling (base64 expands binary
// data by roughly one third) so the returned JSON remains complete rather than
// being generically truncated into invalid JSON.
const MAX_CHAT_ATTACHMENT_READ_BYTES = 128 * 1024;

export const CHAT_ATTACHMENT_READ: ToolDefinition = {
  name: "chat_attachment_read",
  description:
    "Read a small Takos chat attachment (up to 128 KiB) by the file_id shown in the current thread's Attachment metadata. Larger or specialized files require an installed document/computer capability. This is limited to files actually attached under this thread's /chat-attachments path; it is not a general workspace-storage or installed takos-storage tool.",
  category: "space",
  namespace: "chat.attachments",
  family: "chat.attachments.read",
  risk_level: "none",
  side_effects: false,
  tool_class: "space_mapped",
  operation_id: "space_storage.read",
  parameters: {
    type: "object",
    properties: {
      file_id: {
        type: "string",
        description:
          "The exact file_id from Attachment metadata in a user message in this thread.",
      },
    },
    required: ["file_id"],
  },
};

async function isReferencedChatAttachment(
  context: Parameters<ToolHandler>[1],
  fileId: string,
): Promise<boolean> {
  const db = getDb(context.db);
  const owningThread = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.id, context.threadId),
        eq(threads.accountId, context.spaceId),
      ),
    )
    .get();
  if (!owningThread) return false;

  // Narrow in SQL before parsing, then require an exact structured match. The
  // instr predicate is parameterized, so a caller-controlled file ID cannot
  // become a LIKE pattern or SQL fragment.
  const candidateMessages = await db
    .select({ metadata: messages.metadata })
    .from(messages)
    .where(
      and(
        eq(messages.threadId, context.threadId),
        sql`instr(${messages.metadata}, ${fileId}) > 0`,
      ),
    )
    .orderBy(desc(messages.sequence))
    .limit(20)
    .all();

  return candidateMessages.some((message) =>
    parseMessageAttachmentRefs(message.metadata).some(
      (attachment) => attachment.file_id === fileId,
    ),
  );
}

export const chatAttachmentReadHandler: ToolHandler = async (args, context) => {
  const fileId = typeof args.file_id === "string" ? args.file_id.trim() : "";
  if (!fileId) throw new Error("file_id is required");

  const bucket = context.env.GIT_OBJECTS;
  if (!bucket) throw new Error("Takos chat attachment storage is unavailable");

  if (!(await isReferencedChatAttachment(context, fileId))) {
    throw new Error(
      "Attachment is not referenced by a user message in the current thread",
    );
  }

  const file = await getStorageItem(context.db, context.spaceId, fileId);
  const expectedPathPrefix = `/chat-attachments/${context.threadId}/`;
  if (
    !file ||
    file.type !== "file" ||
    !file.path.startsWith(expectedPathPrefix)
  ) {
    throw new Error(
      "Attachment is not a Takos chat attachment for this thread",
    );
  }

  const result = await readFileContent(
    context.db,
    bucket,
    context.spaceId,
    fileId,
    MAX_CHAT_ATTACHMENT_READ_BYTES,
  );
  return JSON.stringify({
    attachment: {
      file_id: result.file.id,
      name: result.file.name,
      path: result.file.path,
      mime_type: result.file.mime_type,
      size: result.file.size,
    },
    encoding: result.encoding,
    // Binary content remains bounded by the attachment-read limit and the
    // common tool output limit. Keeping it structured lets a capable consumer
    // decode it without confusing it with an installed storage service.
    content: result.content,
  });
};

export const {
  tools: CHAT_ATTACHMENT_TOOLS,
  handlers: CHAT_ATTACHMENT_HANDLERS,
} = defineTools([[CHAT_ATTACHMENT_READ, chatAttachmentReadHandler]]);
