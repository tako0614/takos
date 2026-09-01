import { rpc, rpcJson } from "../lib/rpc.ts";
import type { Accessor } from "solid-js";
import type { ChatAttachmentMetadata } from "../views/chat/messageMetadata.ts";
import { useI18n } from "../store/i18n.ts";
import {
  parseStorageFileMutationResponse,
  parseStorageUploadUrlResponse,
} from "./storage-response.ts";

/**
 * Strict allowlist pattern: [a-zA-Z0-9._-]+ only.
 *
 * Any character outside this set is dropped. If nothing valid survives we
 * fall back to a UUID-derived name so we always have a stable, safe segment
 * for storage paths.
 */
const SAFE_FILENAME_PATTERN = /[^a-zA-Z0-9._-]+/g;

function uuidFallbackName(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `attachment-${cryptoApi.randomUUID()}`;
  }
  // Last-resort fallback for environments without crypto.randomUUID.
  const random = Math.random().toString(36).slice(2);
  return `attachment-${Date.now()}-${random}`;
}

function sanitizeAttachmentFileName(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return uuidFallbackName();
  // Strip path separators and any other disallowed chars in one pass.
  const sanitized = trimmed
    .replace(/^\.+/, "") // disallow leading dots (".", "..", hidden files)
    .replace(SAFE_FILENAME_PATTERN, "_");
  // Collapse runs of underscores from the replacement above.
  const collapsed = sanitized.replace(/_+/g, "_").replace(
    /^[_.-]+|[_.-]+$/g,
    "",
  );
  if (!collapsed) return uuidFallbackName();
  // Cap to a sane length to avoid blowing storage key limits.
  return collapsed.length > 200 ? collapsed.slice(0, 200) : collapsed;
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
  spaceRecordId: Accessor<string>;
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
  spaceRecordId,
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
    const currentSpaceRecordId = spaceRecordId();
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

      const uploadData = parseStorageUploadUrlResponse(
        await rpcJson<unknown>(uploadRes),
        currentSpaceId,
      );

      const blobRes = await fetch(uploadData.uploadUrl, {
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
          json: { file_id: uploadData.fileId },
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

      const confirmedFile = parseStorageFileMutationResponse(
        await rpcJson<unknown>(confirmRes),
        {
          spaceId: currentSpaceRecordId,
          id: uploadData.fileId,
          parentPath: threadFolder,
        },
      );

      uploaded.push({
        file_id: confirmedFile.id,
        path: confirmedFile.path,
        name: confirmedFile.name,
        mime_type: confirmedFile.mime_type,
        size: confirmedFile.size,
      });
    }

    return uploaded;
  };

  return {
    ensureAttachmentFolder,
    uploadChatAttachments,
  };
}
