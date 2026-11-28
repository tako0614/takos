import { createSignal, For, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";
import type { StorageFile } from "../../types/index.ts";
import { formatDateTime, formatFileSize } from "../../lib/format.ts";
import { type ContextMenuState, getFileIcon } from "./storageUtils.tsx";

interface StorageFileTableProps {
  files: StorageFile[];
  currentPath: string;
  selectedFiles: Set<string>;
  hasSelection: boolean;
  allSelected: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onToggleSelect: (fileId: string) => void;
  onNavigateUp: () => void;
  onNavigateToFolder: (file: StorageFile) => void;
  onOpenFile: (file: StorageFile) => void;
  onContextMenu: (state: ContextMenuState) => void;
}

export function StorageFileTable(props: StorageFileTableProps) {
  const { t } = useI18n();
  const [hoveredFileId, setHoveredFileId] = createSignal<string | null>(null);

  const handleContextMenu = (e: MouseEvent, file: StorageFile) => {
    e.preventDefault();
    e.stopPropagation();
    props.onContextMenu({ file, x: e.clientX, y: e.clientY });
  };

  return (
    <table class="w-full table-fixed text-sm">
      <thead class="sticky top-0 bg-white dark:bg-zinc-900 z-[1]">
        <tr class="border-b border-zinc-100 dark:border-zinc-800">
          <th class="w-12 px-1 sm:px-2 py-1.5">
            <label class="inline-flex min-w-[40px] min-h-[40px] items-center justify-center cursor-pointer">
              <input
                type="checkbox"
                checked={props.allSelected}
                aria-label={t("selectAllItems")}
                onInput={() =>
                  props.allSelected ? props.onDeselectAll() : props.onSelectAll()}
                class="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
            </label>
          </th>
          <th class="px-2 py-2.5 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t("name")}
          </th>
          <th class="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 w-24 hidden sm:table-cell">
            {t("size")}
          </th>
          <th class="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 w-40 hidden md:table-cell">
            {t("modified")}
          </th>
          <th class="w-12" />
        </tr>
      </thead>
      <tbody>
        <Show when={props.currentPath !== "/"}>
          <tr
            class="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
            onClick={props.onNavigateUp}
          >
            <td class="px-1 sm:px-2 py-1.5" />
            <td class="px-2 py-1.5 min-w-0">
              <button
                type="button"
                class="w-full min-h-[40px] flex items-center gap-3 text-left text-zinc-600 dark:text-zinc-300 bg-transparent border-0 p-0 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
                aria-label={t("parentFolder")}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onNavigateUp();
                }}
              >
                <Icons.ArrowLeft class="w-4 h-4 shrink-0" aria-hidden="true" />
                <span class="text-sm">..</span>
              </button>
            </td>
            <td class="hidden sm:table-cell" />
            <td class="hidden md:table-cell" />
            <td />
          </tr>
        </Show>
        <For each={props.files}>
          {(file) => {
            const isSelected = () => props.selectedFiles.has(file.id);
            const isHovered = () => hoveredFileId() === file.id;
            const showCheck = () =>
              props.hasSelection || isHovered() || isSelected();

            return (
              <tr
                class={"group cursor-pointer transition-colors " +
                  (isSelected()
                    ? "bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50")}
                onClick={() =>
                  file.type === "folder"
                    ? props.onNavigateToFolder(file)
                    : props.onOpenFile(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
                onMouseEnter={() => setHoveredFileId(file.id)}
                onMouseLeave={() => setHoveredFileId(null)}
              >
                <td
                  class="px-1 sm:px-2 py-1 text-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <label
                    class={`inline-flex min-w-[40px] min-h-[40px] items-center justify-center cursor-pointer transition-opacity ${
                      showCheck()
                        ? "opacity-100"
                        : "opacity-100 md:opacity-0 md:group-hover:opacity-100 group-focus-within:opacity-100"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected()}
                      aria-label={t("selectItem", { name: file.name })}
                      onInput={() => props.onToggleSelect(file.id)}
                      class="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </label>
                </td>
                <td class="px-2 py-1.5 min-w-0">
                  <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <span class="shrink-0">{getFileIcon(file)}</span>
                    <button
                      type="button"
                      class="min-w-0 flex-1 min-h-[40px] flex flex-col justify-center text-left text-zinc-900 dark:text-zinc-100 text-sm bg-transparent border-0 p-0 cursor-pointer hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] rounded-sm"
                      title={file.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        file.type === "folder"
                          ? props.onNavigateToFolder(file)
                          : props.onOpenFile(file);
                      }}
                    >
                      <span class="block w-full truncate">{file.name}</span>
                      <Show when={file.type !== "folder"}>
                        <span class="sm:hidden text-xs text-zinc-500 dark:text-zinc-400">
                          {formatFileSize(file.size)}
                        </span>
                      </Show>
                    </button>
                  </div>
                </td>
                <td class="px-4 py-2 text-zinc-500 dark:text-zinc-400 hidden sm:table-cell truncate">
                  {file.type === "folder" ? "-" : formatFileSize(file.size)}
                </td>
                <td class="px-4 py-2 text-zinc-500 dark:text-zinc-400 hidden md:table-cell truncate">
                  {formatDateTime(file.updated_at)}
                </td>
                <td
                  class="px-1 py-1 text-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    aria-label={t("moreActions")}
                    aria-haspopup="menu"
                    class="inline-flex min-w-[40px] min-h-[40px] items-center justify-center rounded-full opacity-100 md:opacity-0 md:group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      props.onContextMenu({
                        file,
                        x: rect.right - 208,
                        y: rect.bottom + 4,
                      });
                    }}
                  >
                    <Icons.MoreHorizontal class="w-4 h-4" />
                  </button>
                </td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  );
}
