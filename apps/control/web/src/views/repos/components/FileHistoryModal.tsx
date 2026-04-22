import { For, Show } from "solid-js";
import { Icons } from "../../../lib/Icons.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { Modal } from "../../../components/ui/Modal.tsx";
import { useI18n } from "../../../store/i18n.ts";

export type FileHistoryCommit = {
  sha: string;
  message: string;
  author: { name: string; email: string };
  date: string;
  status: "added" | "modified" | "deleted";
};

export type FileHistoryResponse = {
  path: string;
  ref: string;
  commits: FileHistoryCommit[];
};

interface FileHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  branch: string;
  loading: boolean;
  error: string | null;
  data: FileHistoryResponse | null;
}

export function FileHistoryModal(props: FileHistoryModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      size="lg"
      title={t("fileHistoryTitle")}
    >
      <div class="flex items-center justify-between gap-4 mb-4">
        <div class="min-w-0">
          <div class="text-sm text-zinc-500 dark:text-zinc-400">
            {t("path")}
          </div>
          <div class="font-mono text-sm text-zinc-900 dark:text-zinc-100 truncate">
            {props.filePath}
          </div>
        </div>
        <div class="text-xs text-zinc-500 dark:text-zinc-400 flex-shrink-0">
          {t("ref")}: <span class="font-mono">{props.branch}</span>
        </div>
      </div>

      <Show when={props.loading}>
        <div class="flex flex-col items-center justify-center py-10 text-zinc-500">
          <div class="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
          <span class="mt-3">{t("loadingHistory")}</span>
        </div>
      </Show>

      <Show when={!props.loading && props.error}>
        <div class="flex flex-col items-center justify-center py-10 text-zinc-500">
          <Icons.AlertTriangle class="w-10 h-10 text-zinc-700 dark:text-zinc-300" />
          <span class="mt-3 text-zinc-700 dark:text-zinc-300">
            {props.error}
          </span>
        </div>
      </Show>

      <Show
        when={!props.loading && !props.error &&
          (props.data?.commits?.length ?? 0) === 0}
      >
        <div class="text-zinc-500 text-sm">{t("noHistoryEntries")}</div>
      </Show>

      <Show
        when={!props.loading && !props.error &&
          (props.data?.commits?.length ?? 0) > 0}
      >
        <div class="divide-y divide-zinc-200 dark:divide-zinc-700">
          <For each={props.data?.commits || []}>
            {(cmt) => (
              <div class="py-3 flex items-start gap-3">
                <div
                  class={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                    cmt.status === "added"
                      ? "bg-green-500"
                      : cmt.status === "deleted"
                      ? "bg-red-500"
                      : "bg-blue-500"
                  }`}
                  title={cmt.status}
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-mono text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400">
                      {cmt.sha.slice(0, 7)}
                    </span>
                    <span class="text-sm text-zinc-900 dark:text-zinc-100 truncate">
                      {cmt.message}
                    </span>
                  </div>
                  <div class="mt-1 text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2 flex-wrap">
                    <span class="truncate">{cmt.author.name}</span>
                    <span class="text-zinc-300 dark:text-zinc-600">|</span>
                    <span>{formatDateTime(cmt.date)}</span>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Modal>
  );
}
