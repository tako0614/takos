import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useI18n } from '../../providers/I18nProvider';
import { Icons } from '../../lib/Icons';

interface ChatInputBarProps {
  input: string;
  onInputChange: (value: string) => void;
  attachedFiles: File[];
  onFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (index: number) => void;
  onSend: () => void;
  isLoading: boolean;
  isCancelling?: boolean;
  onCancel?: () => void;
  attachLabel: string;
  placeholder: string;
  inputHint: string;
  onFilePaste?: (files: File[]) => void;
  isDragOver?: boolean;
}

export function ChatInputBar({
  input,
  onInputChange,
  attachedFiles,
  onFileSelect,
  onRemoveFile,
  onSend,
  isLoading,
  isCancelling,
  onCancel,
  attachLabel,
  placeholder,
  inputHint,
  onFilePaste,
  isDragOver,
}: ChatInputBarProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isComposing, setIsComposing] = useState(false);
  const sendDisabled = (!input.trim() && attachedFiles.length === 0) || isLoading;

  // Create object URLs for image thumbnails and revoke on cleanup
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSend();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposing || e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onFilePaste) return;
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
          const renamedFile = new File([file], name, { type: file.type });
          pastedFiles.push(renamedFile);
        }
      }
    }

    if (pastedFiles.length > 0) {
      e.preventDefault();
      onFilePaste(pastedFiles);
    }
  };

  const borderClass = isDragOver
    ? 'border-blue-400 dark:border-blue-400'
    : 'border-zinc-200 dark:border-zinc-800 focus-within:border-zinc-300 dark:focus-within:border-zinc-700';

  return (
    <div className="bg-white dark:bg-zinc-900 px-3 py-3 md:px-6 lg:px-8 pb-[calc(0.75rem+var(--spacing-safe-bottom))] w-full max-w-3xl mx-auto">
      <form onSubmit={handleSubmit} className="mx-auto">
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachedFiles.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-300"
              >
                {objectUrls[index] ? (
                  <img
                    src={objectUrls[index]!}
                    alt={t('imagePreview')}
                    className="w-10 h-10 rounded object-cover flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                ) : (
                  <Icons.File />
                )}
                {objectUrls[index] && (
                  <Icons.Image className="hidden w-5 h-5 flex-shrink-0" />
                )}
                <span className="max-w-32 truncate">{file.name}</span>
                <button
                  type="button"
                  className="p-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                  onClick={() => onRemoveFile(index)}
                  aria-label={t('removeFile')}
                >
                  <Icons.X />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={`flex items-end gap-2 md:gap-3 bg-zinc-100 dark:bg-zinc-900 rounded-2xl border ${borderClass} p-2 transition-colors`}>
          <button
            type="button"
            className="flex-shrink-0 w-11 h-11 md:w-10 md:h-10 flex items-center justify-center rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            title={attachLabel}
            aria-label={attachLabel}
          >
            <Icons.Paperclip className="w-5 h-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={onFileSelect}
          />
          <textarea
            className="flex-1 bg-transparent border-none outline-none resize-none py-2.5 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-500 min-h-[44px] max-h-48 text-base"
            placeholder={placeholder}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            disabled={isLoading}
            rows={1}
          />
          {isLoading && onCancel ? (
            <button
              type="button"
              className="flex-shrink-0 w-11 h-11 md:w-10 md:h-10 flex items-center justify-center rounded-xl transition-colors bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onCancel}
              disabled={isCancelling}
              title={isCancelling ? t('cancellingRun') : t('cancelRun')}
              aria-label={isCancelling ? t('cancellingRun') : t('cancelRun')}
            >
              {isCancelling
                ? <Icons.Loader className="w-5 h-5 animate-spin" />
                : <Icons.Square className="w-5 h-5" />}
            </button>
          ) : (
            <button
              type="submit"
              className={`flex-shrink-0 w-11 h-11 md:w-10 md:h-10 flex items-center justify-center rounded-xl transition-colors ${
                sendDisabled
                  ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500 cursor-not-allowed'
                  : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200'
              }`}
              disabled={sendDisabled}
              aria-label={t('send')}
            >
              <Icons.Send className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="flex justify-center mt-3">
          <span className="text-xs text-zinc-500 dark:text-zinc-500">{inputHint}</span>
        </div>
      </form>
    </div>
  );
}
