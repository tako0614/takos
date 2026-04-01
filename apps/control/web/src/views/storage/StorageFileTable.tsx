import { createSignal, For, Show } from 'solid-js';
import { useI18n } from '../../store/i18n.ts';
import { Icons } from '../../lib/Icons.tsx';
import type { StorageFile } from '../../types/index.ts';
import { formatFileSize, formatDateTime } from '../../lib/format.ts';
import { getFileIcon, type ContextMenuState } from './storageUtils.tsx';

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
    <table class="w-full text-sm">
      <thead class="sticky top-0 bg-white dark:bg-zinc-900 z-[1]">
        <tr class="border-b border-zinc-100 dark:border-zinc-800">
          <th class="w-12 px-4 py-2.5">
            <input
              type="checkbox"
              checked={props.allSelected}
              onInput={() => props.allSelected ? props.onDeselectAll() : props.onSelectAll()}
              class="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
          </th>
          <th class="px-2 py-2.5 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t('name')}
          </th>
          <th class="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 w-28 hidden sm:table-cell">
            {t('size')}
          </th>
          <th class="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 w-40 hidden md:table-cell">
            {t('modified')}
          </th>
          <th class="w-12" />
        </tr>
      </thead>
      <tbody>
        <Show when={props.currentPath !== '/'}>
          <tr
            class="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
            onClick={props.onNavigateUp}
          >
            <td class="px-4 py-2" />
            <td class="px-2 py-2" colSpan={4}>
              <div class="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
                <Icons.ArrowLeft class="w-4 h-4" />
                <span class="text-sm">..</span>
              </div>
            </td>
          </tr>
        </Show>
        <For each={props.files}>{(file) => {
          const isSelected = () => props.selectedFiles.has(file.id);
          const isHovered = () => hoveredFileId() === file.id;
          const showCheck = () => props.hasSelection || isHovered() || isSelected();

          return (
            <tr
              class={
                'group cursor-pointer transition-colors '
                + (isSelected()
                  ? 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50')
              }
              onClick={() => file.type === 'folder' ? props.onNavigateToFolder(file) : props.onOpenFile(file)}
              onContextMenu={(e) => handleContextMenu(e, file)}
              onMouseEnter={() => setHoveredFileId(file.id)}
              onMouseLeave={() => setHoveredFileId(null)}
            >
              <td class="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                <div class={showCheck() ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}>
                  <input
                    type="checkbox"
                    checked={isSelected()}
                    onInput={() => props.onToggleSelect(file.id)}
                    class="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </div>
              </td>
              <td class="px-2 py-2">
                <div class="flex items-center gap-3">
                  {getFileIcon(file)}
                  <span
                    class="truncate max-w-md text-zinc-900 dark:text-zinc-100 text-sm"
                    title={file.name}
                  >
                    {file.name}
                  </span>
                </div>
              </td>
              <td class="px-4 py-2 text-zinc-400 dark:text-zinc-500 hidden sm:table-cell">
                {file.type === 'folder' ? '-' : formatFileSize(file.size)}
              </td>
              <td class="px-4 py-2 text-zinc-400 dark:text-zinc-500 hidden md:table-cell">
                {formatDateTime(file.updated_at)}
              </td>
              <td class="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                <button type="button"
                  class="p-1.5 rounded-full opacity-0 group-hover:opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 dark:text-zinc-500 transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    props.onContextMenu({ file, x: rect.right - 208, y: rect.bottom + 4 });
                  }}
                >
                  <Icons.MoreHorizontal class="w-4 h-4" />
                </button>
              </td>
            </tr>
          );
        }}</For>
      </tbody>
    </table>
  );
}
