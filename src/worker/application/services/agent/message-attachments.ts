import {
  MAX_CHAT_MESSAGE_METADATA_CHARACTERS,
  parseChatAttachmentMetadataList,
} from "../../../../contracts/public/chat-message.ts";

export type MessageAttachmentRef = {
  file_id: string;
  path?: string;
  name: string;
  mime_type?: string | null;
  size?: number;
};

/**
 * Parse the attachment references persisted in user-message metadata.
 *
 * Keep this parser shared by conversation-history rendering and the dedicated
 * chat attachment tool so the file IDs shown to the model are exactly the IDs
 * the read guard accepts.
 */
export function parseMessageAttachmentRefs(
  metadata: string | null | undefined,
  expectedThreadId?: string,
): MessageAttachmentRef[] {
  if (!metadata || metadata.length > MAX_CHAT_MESSAGE_METADATA_CHARACTERS) {
    return [];
  }
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    const attachments = (parsed as Record<string, unknown>).attachments;
    return parseChatAttachmentMetadataList(attachments, expectedThreadId)
      .filter((attachment): attachment is typeof attachment & {
        file_id: string;
      } => typeof attachment.file_id === "string")
      .map((attachment) => ({
        file_id: attachment.file_id,
        path: attachment.path,
        name: attachment.name,
        mime_type: attachment.mime_type,
        size: attachment.size,
      }));
  } catch {
    return [];
  }
}
