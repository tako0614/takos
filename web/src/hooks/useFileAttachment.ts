import { createSignal } from "solid-js";
import type { TranslationKey } from "../store/i18n.ts";
import { formatFileSize } from "../lib/format.ts";

export interface UseFileAttachmentOptions {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  setError: (value: string | null) => void;
}

export interface UseFileAttachmentResult {
  attachedFiles: File[];
  setAttachedFiles: (files: File[]) => void;
  addFiles: (files: File[]) => void;
  handleFileSelect: (e: Event & { currentTarget: HTMLInputElement }) => void;
  removeAttachedFile: (index: number) => void;
}

/**
 * Per-file upload cap mirrored from the server default
 * (`MAX_FILE_SIZE` in `src/worker/.../space-storage-shared.ts`). The
 * server remains the authoritative gate; this only avoids round-tripping
 * obvious oversize files.
 */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * Client-side MIME allowlist. The server MUST re-check, but rejecting clearly
 * disallowed types here gives users immediate feedback.
 *
 * Allowed groups:
 *   - image/*  (PNG, JPEG, GIF, WebP, ...)
 *   - video/*  (MP4, WebM, ...)
 *   - audio/*  (MP3, OGG, ...)
 *   - application/pdf
 *   - text/*   (plain text, CSV, markdown, ...)
 *   - application/json
 *
 * Other types (e.g. executables, archives, office docs) are rejected with a
 * clear user-facing error.
 */
const ALLOWED_MIME_PREFIXES = ["image/", "video/", "audio/", "text/"] as const;
const ALLOWED_MIME_EXACT = new Set<string>([
  "application/pdf",
  "application/json",
]);

function isMimeAllowed(mime: string): boolean {
  if (!mime) return false;
  const normalized = mime.toLowerCase();
  if (ALLOWED_MIME_EXACT.has(normalized)) return true;
  for (const prefix of ALLOWED_MIME_PREFIXES) {
    if (normalized.startsWith(prefix)) return true;
  }
  return false;
}

export function useFileAttachment(
  { t, setError }: UseFileAttachmentOptions,
): UseFileAttachmentResult {
  const [attachedFiles, setAttachedFiles] = createSignal<File[]>([]);

  function addFiles(files: File[]): void {
    const validFiles: File[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setError(
          t("fileTooLarge" as TranslationKey, {
            size: formatFileSize(MAX_FILE_SIZE),
          }),
        );
        continue;
      }
      // Reject empty / clearly disallowed MIME types client-side. The server
      // re-checks for security; this is purely UX.
      if (!isMimeAllowed(file.type)) {
        setError(t("fileTypeNotAllowed" as TranslationKey));
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length > 0) {
      setAttachedFiles((prev) => [...prev, ...validFiles]);
    }
  }

  function handleFileSelect(
    e: Event & { currentTarget: HTMLInputElement },
  ): void {
    const files = e.currentTarget.files;
    if (!files) return;
    addFiles(Array.from(files));
    e.currentTarget.value = "";
  }

  function removeAttachedFile(index: number): void {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  return {
    get attachedFiles() {
      return attachedFiles();
    },
    setAttachedFiles: (files: File[]) => setAttachedFiles(files),
    addFiles,
    handleFileSelect,
    removeAttachedFile,
  };
}
