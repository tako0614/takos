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
): MessageAttachmentRef[] {
  if (!metadata) return [];
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    const attachments = (parsed as Record<string, unknown>).attachments;
    if (!Array.isArray(attachments)) return [];
    const parsedAttachments: MessageAttachmentRef[] = [];
    for (const entry of attachments) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const value = entry as Record<string, unknown>;
      if (typeof value.file_id !== "string" || typeof value.name !== "string") {
        continue;
      }
      parsedAttachments.push({
        file_id: value.file_id,
        path: typeof value.path === "string" ? value.path : undefined,
        name: value.name,
        mime_type: typeof value.mime_type === "string" ? value.mime_type : null,
        size: typeof value.size === "number" ? value.size : undefined,
      });
    }
    return parsedAttachments;
  } catch {
    return [];
  }
}
