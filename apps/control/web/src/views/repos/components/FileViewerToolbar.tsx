import { Show } from "solid-js";
import { Icons } from "../../../lib/Icons.tsx";
import { formatFileSize } from "../../../lib/format.ts";
import { useI18n } from "../../../store/i18n.ts";

interface FileViewerToolbarProps {
  filePath: string;
  fileSize: number;
  canShowTextTools: boolean;
  blameEnabled: boolean;
  blameLoading: boolean;
  copied: boolean;
  onBack: () => void;
  onToggleBlame: () => void;
  onOpenHistory: () => void;
  onCopy: () => void;
  onDownload: () => void;
}

export function FileViewerToolbar(props: FileViewerToolbarProps) {
  const { t } = useI18n();

  return (
    <div class="flex items-center justify-between gap-4 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
      <div class="flex items-center gap-3 min-w-0">
        <button
          type="button"
          class="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex-shrink-0"
          onClick={props.onBack}
          aria-label={t("goBack")}
        >
          <Icons.ArrowLeft class="w-4 h-4" />
        </button>
        <div class="flex items-center gap-2 min-w-0">
          <Icons.File class="w-4 h-4 text-zinc-500 dark:text-zinc-400 flex-shrink-0" />
          <span class="text-zinc-900 dark:text-zinc-100 truncate">
            {props.filePath}
          </span>
        </div>
      </div>

      <div class="flex items-center gap-3 flex-shrink-0">
        <span class="text-sm text-zinc-500 dark:text-zinc-400">
          {formatFileSize(props.fileSize)}
        </span>
        <Show when={props.canShowTextTools}>
          <button
            type="button"
            class={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm transition-colors ${
              props.blameEnabled
                ? "bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-800"
                : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
            onClick={props.onToggleBlame}
            disabled={props.blameLoading}
            title={t("toggleBlame")}
          >
            <Icons.User class="w-4 h-4" />
            <span>{props.blameLoading ? t("blameLoading") : t("blame")}</span>
          </button>

          <button
            type="button"
            class="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={props.onOpenHistory}
            title={t("fileHistory")}
          >
            <Icons.Clock class="w-4 h-4" />
            <span>{t("history")}</span>
          </button>
        </Show>
        <Show when={props.canShowTextTools}>
          <button
            type="button"
            class="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={props.onCopy}
          >
            {props.copied
              ? <Icons.Check class="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
              : <Icons.Copy class="w-4 h-4" />}
            <span>{props.copied ? t("copied") : t("copy")}</span>
          </button>
        </Show>
        <button
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={props.onDownload}
        >
          <Icons.Download class="w-4 h-4" />
          <span>{t("download")}</span>
        </button>
      </div>
    </div>
  );
}
