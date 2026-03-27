import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n, type TranslationKey } from '../../../store/i18n';
import { Icons } from '../../../lib/Icons';
import { useFileAttachment } from '../../../hooks/useFileAttachment';
import type { Space } from '../../../types';

interface WelcomeViewProps {
  space?: Space;
  onNewChat?: (message?: string) => void;
  onCreateThread?: (message: string, files?: File[]) => void;
}

export function WelcomeView({ onNewChat, onCreateThread }: WelcomeViewProps) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { attachedFiles, addFiles, handleFileSelect, removeAttachedFile } = useFileAttachment({
    t: t as (key: TranslationKey, params?: Record<string, string | number>) => string,
    setError,
  });

  // Object URLs for image thumbnails
  const objectUrls = useMemo(() => {
    return attachedFiles.map((file) =>
      file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    );
  }, [attachedFiles]);

  useEffect(() => {
    return () => {
      for (const url of objectUrls) {
        if (url) URL.revokeObjectURL(url);
      }
    };
  }, [objectUrls]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed && attachedFiles.length === 0) return;
    if (onCreateThread) {
      onCreateThread(trimmed, attachedFiles.length > 0 ? attachedFiles : undefined);
    } else {
      onNewChat?.(trimmed);
    }
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  // Auto-resize textarea
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          const name = file.name && file.name !== 'image.png'
            ? file.name
            : `pasted-${Date.now()}.png`;
          pastedFiles.push(new File([file], name, { type: file.type }));
        }
      }
    }

    if (pastedFiles.length > 0) {
      e.preventDefault();
      addFiles(pastedFiles);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-auto bg-white dark:bg-zinc-900">
      <div className="w-full max-w-2xl">
        {/* Heading */}
        <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50 text-center mb-8 tracking-tight">
          {t('welcomeTitle')}
        </h1>

        {/* Input card */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 shadow-sm overflow-hidden">
          {/* Attached files */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {attachedFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-300"
                >
                  {objectUrls[index] ? (
                    <img
                      src={objectUrls[index]!}
                      alt={t('imagePreview')}
                      className="w-10 h-10 rounded object-cover flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <Icons.File className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span className="max-w-32 truncate">{file.name}</span>
                  <button
                    type="button"
                    className="p-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                    onClick={() => removeAttachedFile(index)}
                    aria-label={t('removeFile')}
                  >
                    <Icons.X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-4 pt-2 text-xs text-red-500">{error}</div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none min-h-[80px]"
            placeholder={t('inputPlaceholder')}
            value={input}
            onChange={handleChange}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={3}
          />

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between px-3 pb-3 pt-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                title={t('attachFile')}
                onClick={() => fileInputRef.current?.click()}
              >
                <Icons.Plus className="w-4 h-4" />
              </button>
            </div>
            <button
              type="button"
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              onClick={handleSend}
              disabled={!input.trim() && attachedFiles.length === 0}
            >
              <Icons.Send className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
