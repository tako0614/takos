import { createSignal, createMemo, createEffect, onCleanup } from 'solid-js';
import { Show, For } from 'solid-js';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';

interface ChatInputBarProps {
  input: string;
  onInputChange: (value: string) => void;
  attachedFiles: File[];
  onFileSelect: (e: Event & { currentTarget: HTMLInputElement }) => void;
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

export function ChatInputBar(props: ChatInputBarProps) {
  const { t } = useI18n();
  let fileInputRef: HTMLInputElement | undefined;
  const [isComposing, setIsComposing] = createSignal(false);
  const sendDisabled = () => (!props.input.trim() && props.attachedFiles.length === 0) || props.isLoading;

  // Create object URLs for image thumbnails and revoke on cleanup
  const objectUrls = createMemo(() => {
    return props.attachedFiles.map((file) =>
      file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    );
  });

  createEffect(() => {
    const urls = objectUrls();
    onCleanup(() => {
      for (const url of urls) {
        if (url) URL.revokeObjectURL(url);
      }
    });
  });

  const handleSubmit = (e: Event & { currentTarget: HTMLFormElement }) => {
    e.preventDefault();
    props.onSend();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isComposing() || (e as any).isComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      props.onSend();
    }
  };

  const handlePaste = (e: ClipboardEvent) => {
    if (!props.onFilePaste) return;
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
      props.onFilePaste!(pastedFiles);
    }
  };

  const borderClass = () => props.isDragOver
    ? 'border-blue-400 dark:border-blue-400'
    : 'border-zinc-200 dark:border-zinc-800 focus-within:border-zinc-300 dark:focus-within:border-zinc-700';

  return (
    <div class="bg-white dark:bg-zinc-900 px-3 py-3 md:px-6 lg:px-8 pb-[calc(0.75rem+var(--spacing-safe-bottom))] w-full max-w-3xl mx-auto">
      <form onSubmit={handleSubmit} class="mx-auto">
        <Show when={props.attachedFiles.length > 0}>
          <div class="flex flex-wrap gap-2 mb-3">
            <For each={props.attachedFiles}>{(file, index) => (
              <div
                class="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-300"
              >
                <Show when={objectUrls()[index()]} fallback={<Icons.File />}>
                  <img
                    src={objectUrls()[index()]!}
                    alt={t('imagePreview')}
                    class="w-10 h-10 rounded object-cover flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                </Show>
                <Show when={objectUrls()[index()]}>
                  <Icons.Image class="hidden w-5 h-5 flex-shrink-0" />
                </Show>
                <span class="max-w-32 truncate">{file.name}</span>
                <button
                  type="button"
                  class="p-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                  onClick={() => props.onRemoveFile(index())}
                  aria-label={t('removeFile')}
                >
                  <Icons.X />
                </button>
              </div>
            )}</For>
          </div>
        </Show>
        <div class={`flex items-end gap-2 md:gap-3 bg-zinc-100 dark:bg-zinc-900 rounded-2xl border ${borderClass()} p-2 transition-colors`}>
          <button
            type="button"
            class="flex-shrink-0 w-11 h-11 md:w-10 md:h-10 flex items-center justify-center rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={() => fileInputRef?.click()}
            disabled={props.isLoading}
            title={props.attachLabel}
            aria-label={props.attachLabel}
          >
            <Icons.Paperclip class="w-5 h-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={props.onFileSelect}
          />
          <textarea
            class="flex-1 bg-transparent border-none outline-none resize-none py-2.5 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-500 min-h-[44px] max-h-48 text-base"
            placeholder={props.placeholder}
            value={props.input}
            onInput={(e) => props.onInputChange(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            disabled={props.isLoading}
            rows={1}
          />
          <Show when={props.isLoading && props.onCancel} fallback={
            <button
              type="submit"
              class={`flex-shrink-0 w-11 h-11 md:w-10 md:h-10 flex items-center justify-center rounded-xl transition-colors ${
                sendDisabled()
                  ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500 cursor-not-allowed'
                  : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200'
              }`}
              disabled={sendDisabled()}
              aria-label={t('send')}
            >
              <Icons.Send class="w-5 h-5" />
            </button>
          }>
            <button
              type="button"
              class="flex-shrink-0 w-11 h-11 md:w-10 md:h-10 flex items-center justify-center rounded-xl transition-colors bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={props.onCancel}
              disabled={props.isCancelling}
              title={props.isCancelling ? t('cancellingRun') : t('cancelRun')}
              aria-label={props.isCancelling ? t('cancellingRun') : t('cancelRun')}
            >
              <Show when={props.isCancelling} fallback={<Icons.Square class="w-5 h-5" />}>
                <Icons.Loader class="w-5 h-5 animate-spin" />
              </Show>
            </button>
          </Show>
        </div>
        <div class="flex justify-center mt-3">
          <span class="text-xs text-zinc-500 dark:text-zinc-500">{props.inputHint}</span>
        </div>
      </form>
    </div>
  );
}
