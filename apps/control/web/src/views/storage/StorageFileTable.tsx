import { useState, useCallback } from 'react';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import type { StorageFile } from '../../types';
import { formatFileSize, formatDateTime } from '../../lib/format';
import { getFileIcon, type ContextMenuState } from './storageUtils';

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

export function StorageFileTable({
  files,
  currentPath,
  selectedFiles,
  hasSelection,
  allSelected,
  onSelectAll,
  onDeselectAll,
  onToggleSelect,
  onNavigateUp,
  onNavigateToFolder,
  onOpenFile,
  onContextMenu,
}: StorageFileTableProps) {
  const { t } = useI18n();
  const [hoveredFileId, setHoveredFileId] = useState<string | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, file: StorageFile) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu({ file, x: e.clientX, y: e.clientY });
  }, [onContextMenu]);

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-white dark:bg-zinc-900 z-[1]">
        <tr className="border-b border-zinc-100 dark:border-zinc-800">
          <th className="w-12 px-4 py-2.5">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => allSelected ? onDeselectAll() : onSelectAll()}
              className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
          </th>
          <th className="px-2 py-2.5 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t('name')}
          </th>
          <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 w-28 hidden sm:table-cell">
            {t('size')}
          </th>
          <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 w-40 hidden md:table-cell">
            {t('modified')}
          </th>
          <th className="w-12" />
        </tr>
      </thead>
      <tbody>
        {currentPath !== '/' && (
          <tr
            className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
            onClick={onNavigateUp}
          >
            <td className="px-4 py-2" />
            <td className="px-2 py-2" colSpan={4}>
              <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
                <Icons.ArrowLeft className="w-4 h-4" />
                <span className="text-sm">..</span>
              </div>
            </td>
          </tr>
        )}
        {files.map(file => {
          const isSelected = selectedFiles.has(file.id);
          const isHovered = hoveredFileId === file.id;
          const showCheck = hasSelection || isHovered || isSelected;

          return (
            <tr
              key={file.id}
              className={
                'group cursor-pointer transition-colors '
                + (isSelected
                  ? 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50')
              }
              onClick={() => file.type === 'folder' ? onNavigateToFolder(file) : onOpenFile(file)}
              onContextMenu={(e) => handleContextMenu(e, file)}
              onMouseEnter={() => setHoveredFileId(file.id)}
              onMouseLeave={() => setHoveredFileId(null)}
            >
              <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                <div className={showCheck ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelect(file.id)}
                    className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </div>
              </td>
              <td className="px-2 py-2">
                <div className="flex items-center gap-3">
                  {getFileIcon(file)}
                  <span
                    className="truncate max-w-md text-zinc-900 dark:text-zinc-100 text-sm"
                    title={file.name}
                  >
                    {file.name}
                  </span>
                </div>
              </td>
              <td className="px-4 py-2 text-zinc-400 dark:text-zinc-500 hidden sm:table-cell">
                {file.type === 'folder' ? '-' : formatFileSize(file.size)}
              </td>
              <td className="px-4 py-2 text-zinc-400 dark:text-zinc-500 hidden md:table-cell">
                {formatDateTime(file.updated_at)}
              </td>
              <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                <button
                  className="p-1.5 rounded-full opacity-0 group-hover:opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 dark:text-zinc-500 transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    onContextMenu({ file, x: rect.right - 208, y: rect.bottom + 4 });
                  }}
                >
                  <Icons.MoreHorizontal className="w-4 h-4" />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
