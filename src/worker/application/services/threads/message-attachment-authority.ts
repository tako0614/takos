import { and, eq, inArray } from "drizzle-orm";
import {
  type ChatAttachmentMetadata,
  MAX_CLIENT_ATTACHMENT_ID_CHARACTERS,
  MAX_CLIENT_MESSAGE_ATTACHMENTS,
  parseChatAttachmentMetadataList,
} from "../../../../contracts/public/chat-message.ts";
import { accountStorageFiles, getDb } from "../../../infra/db/index.ts";
import type { SqlDatabaseLike } from "../../../shared/types/bindings.ts";

export type ClientMessageAttachment = ChatAttachmentMetadata & {
  file_id: string;
};

export type CanonicalMessageAttachment = Required<
  Pick<ChatAttachmentMetadata, "file_id" | "path" | "name" | "size">
> & Pick<ChatAttachmentMetadata, "mime_type">;

export class InvalidClientMessageAttachmentError extends Error {
  constructor() {
    super("Invalid chat attachment");
    this.name = "InvalidClientMessageAttachmentError";
  }
}

/**
 * Turn untrusted public message claims into a Worker-owned Storage projection.
 * A chat attachment is a ready file directly under this Thread's reserved
 * folder; callers cannot publish another Workspace file by claiming its ID.
 */
export async function canonicalizeClientMessageAttachments(
  dbBinding: SqlDatabaseLike,
  spaceId: string,
  threadId: string,
  attachments: ClientMessageAttachment[],
): Promise<CanonicalMessageAttachment[]> {
  if (attachments.length === 0) return [];
  if (
    attachments.length > MAX_CLIENT_MESSAGE_ATTACHMENTS ||
    attachments.some((attachment) =>
      typeof attachment.file_id !== "string" ||
      attachment.file_id.length === 0 ||
      attachment.file_id.length > MAX_CLIENT_ATTACHMENT_ID_CHARACTERS ||
      attachment.file_id !== attachment.file_id.trim() ||
      /[\/\\\u0000-\u001f\u007f]/u.test(attachment.file_id)
    )
  ) {
    throw new InvalidClientMessageAttachmentError();
  }

  const fileIds = attachments.map((attachment) => attachment.file_id);
  if (new Set(fileIds).size !== fileIds.length) {
    throw new InvalidClientMessageAttachmentError();
  }

  const db = getDb(dbBinding);
  const rows = await db.select({
    id: accountStorageFiles.id,
    name: accountStorageFiles.name,
    path: accountStorageFiles.path,
    size: accountStorageFiles.size,
    mimeType: accountStorageFiles.mimeType,
    r2Key: accountStorageFiles.r2Key,
  }).from(accountStorageFiles).where(and(
    eq(accountStorageFiles.accountId, spaceId),
    eq(accountStorageFiles.type, "file"),
    eq(accountStorageFiles.uploadState, "ready"),
    inArray(accountStorageFiles.id, fileIds),
  )).all();
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  return fileIds.map((fileId) => {
    const row = rowsById.get(fileId);
    if (!row?.r2Key) throw new InvalidClientMessageAttachmentError();

    const [canonical] = parseChatAttachmentMetadataList([{
      file_id: row.id,
      path: row.path,
      name: row.name,
      mime_type: row.mimeType,
      size: row.size,
    }], threadId);
    if (
      !canonical?.file_id || !canonical.path ||
      canonical.size === undefined
    ) {
      throw new InvalidClientMessageAttachmentError();
    }
    return canonical as CanonicalMessageAttachment;
  });
}
