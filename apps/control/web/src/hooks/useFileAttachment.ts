import { useState, type ChangeEvent } from 'react';
import { type TranslationKey } from '../store/i18n';

export interface UseFileAttachmentOptions {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  setError: (value: string | null) => void;
}

export interface UseFileAttachmentResult {
  attachedFiles: File[];
  setAttachedFiles: (files: File[]) => void;
  addFiles: (files: File[]) => void;
  handleFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  removeAttachedFile: (index: number) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;

export function useFileAttachment({ t, setError }: UseFileAttachmentOptions): UseFileAttachmentResult {
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  function addFiles(files: File[]): void {
    const validFiles: File[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setError(t('fileTooLarge' as TranslationKey));
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length > 0) {
      setAttachedFiles((prev) => [...prev, ...validFiles]);
    }
  }

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>): void {
    const files = e.target.files;
    if (!files) return;
    addFiles(Array.from(files));
    e.target.value = '';
  }

  function removeAttachedFile(index: number): void {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  return {
    attachedFiles,
    setAttachedFiles,
    addFiles,
    handleFileSelect,
    removeAttachedFile,
  };
}
