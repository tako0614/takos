import { createMemo, createSignal, onCleanup } from "solid-js";
import { type TranslationKey, useI18n } from "../../../store/i18n.ts";
import { Icons } from "../../../lib/Icons.tsx";
import { useFileAttachment } from "../../../hooks/useFileAttachment.ts";
import type { Space } from "../../../types/index.ts";

interface WelcomeViewProps {
  space?: Space;
  onNewChat?: (message?: string) => void;
  onCreateThread?: (message: string, files?: File[]) => void;
}

export function WelcomeView(props: WelcomeViewProps) {
  const { t } = useI18n();
  const [input, setInput] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [isComposing, setIsComposing] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  const fileAttachments = useFileAttachment({
    t: t as (
      key: TranslationKey,
      params?: Record<string, string | number>,
    ) => string,
    setError,
  });

  // Object URLs for image thumbnails
  const objectUrls = createMemo(() => {
    return fileAttachments.attachedFiles.map((file) =>
      file.type.startsWith("image/") ? URL.createObjectURL(file) : null
    );
  });

  onCleanup(() => {
    for (const url of objectUrls()) {
      if (url) URL.revokeObjectURL(url);
    }
  });

  const handleSend = () => {
    const trimmed = input().trim();
    const attachedFiles = fileAttachments.attachedFiles;
    if (!trimmed && attachedFiles.length === 0) return;
    if (props.onCreateThread) {
      props.onCreateThread(
        trimmed,
        attachedFiles.length > 0 ? attachedFiles : undefined,
      );
    } else {
      props.onNewChat?.(trimmed);
    }
    setInput("");
    if (textareaRef) {
      textareaRef.style.height = "auto";
    }
  };

  // Auto-resize textarea
  const handleChange = (e: Event & { currentTarget: HTMLTextAreaElement }) => {
    setInput(e.currentTarget.value);
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const handlePaste = (
    e: ClipboardEvent & { currentTarget: HTMLTextAreaElement },
  ) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          const name = file.name && file.name !== "image.png"
            ? file.name
            : `pasted-${Date.now()}.png`;
          pastedFiles.push(new File([file], name, { type: file.type }));
        }
      }
    }

    if (pastedFiles.length > 0) {
      e.preventDefault();
      fileAttachments.addFiles(pastedFiles);
    }
  };

  return (
    <div class="flex-1 flex flex-col items-center justify-center p-6 overflow-auto bg-white dark:bg-zinc-900">
      <div class="w-full max-w-2xl">
        {/* Heading */}
        <h1 class="text-3xl font-semibold text-zinc-900 dark:text-zinc-50 text-center mb-8 tracking-tight">
          {t("welcomeTitle")}
        </h1>

        {/* Input card */}
        <div class="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 shadow-sm overflow-hidden">
          {/* Attached files */}
          {fileAttachments.attachedFiles.length > 0 && (
            <div class="flex flex-wrap gap-2 px-4 pt-3">
              {fileAttachments.attachedFiles.map((file, index) => (
                <div class="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-300">
                  {objectUrls()[index]
                    ? (
                      <img
                        src={objectUrls()[index]!}
                        alt={t("imagePreview")}
                        class="w-10 h-10 rounded object-cover flex-shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )
                    : <Icons.File class="w-4 h-4 flex-shrink-0" />}
                  <span class="max-w-32 truncate">{file.name}</span>
                  <button
                    type="button"
                    class="p-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                    onClick={() => fileAttachments.removeAttachedFile(index)}
                    aria-label={t("removeFile")}
                  >
                    <Icons.X class="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error?.() && (
            <div class="px-4 pt-2 text-xs text-red-500">{error()}</div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            class="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none min-h-[80px]"
            placeholder={t("inputPlaceholder")}
            value={input()}
            onInput={handleChange}
            onPaste={handlePaste}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={(e) => {
              setIsComposing(false);
              handleChange(e);
            }}
            onKeyDown={(e) => {
              if (isComposing() || e.isComposing || e.keyCode === 229) {
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
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
            style={{ display: "none" }}
            onChange={fileAttachments.handleFileSelect}
          />

          {/* Bottom toolbar */}
          <div class="flex items-center justify-between px-3 pb-3 pt-1">
            <div class="flex items-center gap-1">
              <button
                type="button"
                class="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                title={t("attachFile")}
                onClick={() => fileInputRef?.click()}
              >
                <Icons.Plus class="w-4 h-4" />
              </button>
            </div>
            <button
              type="button"
              class="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              onClick={handleSend}
              disabled={!input().trim() &&
                fileAttachments.attachedFiles.length === 0}
            >
              <Icons.Send class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
