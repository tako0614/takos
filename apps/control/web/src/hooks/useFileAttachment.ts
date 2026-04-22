import { createSignal } from "solid-js";
import { type TranslationKey } from "../store/i18n.ts";

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

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;

export function useFileAttachment(
  { t, setError }: UseFileAttachmentOptions,
): UseFileAttachmentResult {
  const [attachedFiles, setAttachedFiles] = createSignal<File[]>([]);

  function addFiles(files: File[]): void {
    const validFiles: File[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setError(t("fileTooLarge" as TranslationKey));
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
