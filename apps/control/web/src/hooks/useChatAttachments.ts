import { rpc, rpcJson } from "../lib/rpc.ts";
import type { Accessor } from "solid-js";
import type { ChatAttachmentMetadata } from "../views/chat/messageMetadata.ts";
import { useI18n } from "../store/i18n.ts";

function sanitizeAttachmentFileName(name: string): string {
  const trimmed = name.trim();
  const fallback = "attachment";
  let sanitized = "";
  for (const char of trimmed || fallback) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || '\\/:*?"<>|'.includes(char)) {
      sanitized += "-";
      continue;
    }
    sanitized += char;
  }
  return sanitized || fallback;
}

export function buildChatAttachmentPath(
  threadId: string,
  fileName: string,
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `/chat-attachments/${threadId}/${timestamp}-${
    sanitizeAttachmentFileName(fileName)
  }`;
}

export interface UseChatAttachmentsOptions {
  spaceId: Accessor<string>;
  threadId: Accessor<string>;
}

export interface UseChatAttachmentsResult {
  ensureAttachmentFolder: (
    path: string,
    spaceIdOverride?: string,
  ) => Promise<void>;
  uploadChatAttachments: (
    selectedFiles: File[],
  ) => Promise<ChatAttachmentMetadata[]>;
}

export function useChatAttachments({
  spaceId,
  threadId,
}: UseChatAttachmentsOptions): UseChatAttachmentsResult {
  const { t } = useI18n();

  const ensureAttachmentFolder = async (
    path: string,
    spaceIdOverride?: string,
  ): Promise<void> => {
    const segments = path.split("/").filter(Boolean);
    let parentPath = "/";
    const currentSpaceId = spaceIdOverride ?? spaceId();

    for (const segment of segments) {
      const res = await rpc.spaces[":spaceId"].storage.folders.$post({
        param: { spaceId: currentSpaceId },
        json: { name: segment, parent_path: parentPath },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error?: string }>(res).catch(
          () => ({} as { error?: string }),
        );
        const error = (data as { error?: string }).error ||
          t("failedToCreateAttachmentFolder");
        if (!error.includes("already exists")) {
          throw new Error(error);
        }
      }

      parentPath = parentPath === "/"
        ? `/${segment}`
        : `${parentPath}/${segment}`;
    }
  };

  const uploadChatAttachments = async (
    selectedFiles: File[],
  ): Promise<ChatAttachmentMetadata[]> => {
    if (selectedFiles.length === 0) return [];

    const currentSpaceId = spaceId();
    const currentThreadId = threadId();
    const attachmentRoot = "/chat-attachments";
    const threadFolder = `${attachmentRoot}/${currentThreadId}`;
    await ensureAttachmentFolder(attachmentRoot, currentSpaceId);
    await ensureAttachmentFolder(threadFolder, currentSpaceId);

    const uploaded: ChatAttachmentMetadata[] = [];

    for (const file of selectedFiles) {
      const uploadRes = await rpc.spaces[":spaceId"].storage["upload-url"]
        .$post({
          param: { spaceId: currentSpaceId },
          json: {
            name: `${new Date().toISOString().replace(/[:.]/g, "-")}-${
              sanitizeAttachmentFileName(file.name)
            }`,
            parent_path: threadFolder,
            size: file.size,
            mime_type: file.type || undefined,
          },
        });

      if (!uploadRes.ok) {
        const data = await rpcJson<{ error?: string }>(uploadRes).catch(
          () => ({} as { error?: string }),
        );
        throw new Error(
          data.error ||
            t("failedToPrepareAttachmentUpload", { name: file.name }),
        );
      }

      const uploadData = await rpcJson<{
        file_id: string;
        upload_url: string;
      }>(uploadRes);

      const blobRes = await fetch(uploadData.upload_url, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });

      if (!blobRes.ok) {
        throw new Error(t("failedToUploadAttachment", { name: file.name }));
      }

      const confirmRes = await rpc.spaces[":spaceId"].storage["confirm-upload"]
        .$post({
          param: { spaceId: currentSpaceId },
          json: { file_id: uploadData.file_id },
        });

      if (!confirmRes.ok) {
        const data = await rpcJson<{ error?: string }>(confirmRes).catch(
          () => ({} as { error?: string }),
        );
        throw new Error(
          data.error ||
            t("failedToFinalizeAttachmentUpload", { name: file.name }),
        );
      }

      const confirmData = await rpcJson<{
        file: {
          id: string;
          path: string;
          name: string;
          mime_type: string | null;
          size: number;
        };
      }>(confirmRes);

      uploaded.push({
        file_id: confirmData.file.id,
        path: confirmData.file.path,
        name: confirmData.file.name,
        mime_type: confirmData.file.mime_type,
        size: confirmData.file.size,
      });
    }

    return uploaded;
  };

  return {
    ensureAttachmentFolder,
    uploadChatAttachments,
  };
}
