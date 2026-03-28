import { useState, useCallback, useEffect, type DragEvent } from 'react';
import { useI18n } from '../../store/i18n';
import { useSpaceStorage } from '../../hooks/useSpaceStorage';
import { Icons } from '../../lib/Icons';
import type { StorageFile, Space } from '../../types';
import type { FileHandler, ContextMenuState } from './storageUtils';
import { useStorageBulkOperations } from '../../hooks/useStorageBulkOperations';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useStorageActions } from '../../hooks/useStorageActions';
import { StorageToolbar } from './StorageToolbar';
import { StorageBreadcrumbs } from './StorageBreadcrumbs';
import { StorageFileTable } from './StorageFileTable';
import { StorageBulkActions } from './StorageBulkActions';
import { StorageContextMenu } from './StorageContextMenu';
import { RenameModal } from './RenameModal';
import { CreateFolderModal } from './CreateFolderModal';
import { BulkMoveModal } from './BulkMoveModal';
import { BulkRenameModal } from './BulkRenameModal';
import { StorageFileViewer } from './StorageFileViewer';

interface StoragePageProps {
  spaceId: string;
  spaces: Space[];
  initialPath?: string;
  onPathChange?: (path: string) => void;
}

export function StoragePage({
  spaceId,
  spaces,
  initialPath = '/',
  onPathChange,
}: StoragePageProps) {
  const { t } = useI18n();

  const {
    files,
    currentPath,
    loading,
    error,
    loadFiles,
    createFolder,
    uploadFile,
    deleteItem,
    deleteItems,
    renameItem,
    bulkMoveItems,
    bulkRenameItems,
    getDownloadUrl,
    downloadFolderZip,
  } = useSpaceStorage(spaceId);

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [fileHandlers, setFileHandlers] = useState<FileHandler[]>([]);

  const { uploading, handleFileSelect } = useFileUpload({ uploadFile });
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDragOver = useCallback((e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback((e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }, []);
  const handleDrop = useCallback((e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); handleFileSelect(e.dataTransfer.files); }, [handleFileSelect]);

  const actions = useStorageActions({
    getDownloadUrl,
    downloadFolderZip,
    deleteItem,
    renameItem,
    currentPath,
    setSelectedFiles,
  });

  const bulk = useStorageBulkOperations({
    files,
    selectedFiles,
    setSelectedFiles,
    deleteItems,
    bulkMoveItems,
    bulkRenameItems,
  });

  useEffect(() => {
    loadFiles(initialPath);
  }, [spaceId, initialPath]);

  useEffect(() => {
    if (!spaceId) return;
    fetch(`/api/spaces/${encodeURIComponent(spaceId)}/storage/file-handlers`)
      .then(res => res.ok ? res.json() : null)
      .then((data: { handlers: FileHandler[] } | null) => {
        if (data?.handlers) setFileHandlers(data.handlers);
      })
      .catch(() => { /* non-critical: file handlers are optional UI enhancement */ });
  }, [spaceId]);

  useEffect(() => {
    if (onPathChange && currentPath !== initialPath) {
      onPathChange(currentPath);
    }
  }, [currentPath, initialPath, onPathChange]);

  const navigateToFolder = useCallback((folder: StorageFile) => {
    loadFiles(folder.path);
    setSelectedFiles(new Set());
  }, [loadFiles]);

  const navigateUp = useCallback(() => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const newPath = parts.length > 0 ? '/' + parts.join('/') : '/';
    loadFiles(newPath);
    setSelectedFiles(new Set());
  }, [currentPath, loadFiles]);

  const navigateToPath = useCallback((path: string) => {
    loadFiles(path);
    setSelectedFiles(new Set());
  }, [loadFiles]);

  const selectAll = useCallback(() => {
    setSelectedFiles(new Set(files.map(f => f.id)));
  }, [files]);

  const deselectAll = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const toggleFileSelection = useCallback((fileId: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }, []);

  const hasSelection = selectedFiles.size > 0;
  const allSelected = files.length > 0 && selectedFiles.size === files.length;

  // If viewing a file, show the viewer
  if (actions.viewingFile) {
    return (
      <StorageFileViewer
        spaceId={spaceId}
        file={actions.viewingFile}
        downloadUrl={actions.viewingFileDownloadUrl}
        fileHandlers={fileHandlers}
        onClose={actions.handleCloseViewer}
        onSave={() => loadFiles(currentPath)}
      />
    );
  }

  return (
    <div
      className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900"
      onClick={() => contextMenu && setContextMenu(null)}
    >
      <StorageToolbar
        loading={loading}
        uploading={uploading}
        downloadingZip={actions.downloadingZip}
        downloadedZipBytes={actions.downloadedZipBytes}
        onRefresh={() => loadFiles(currentPath)}
        onDownloadZip={actions.handleDownloadZip}
        onNewFolder={() => setShowCreateFolderModal(true)}
        onFileSelect={handleFileSelect}
      />

      <StorageBreadcrumbs currentPath={currentPath} onNavigate={navigateToPath} />

      {/* Main content */}
      <div
        className={
          'flex-1 overflow-auto mx-3 mb-3 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 relative '
          + (isDragOver ? 'ring-2 ring-blue-400 ring-inset' : '')
        }
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 bg-blue-50/80 dark:bg-blue-900/30 flex items-center justify-center z-10 pointer-events-none rounded-2xl">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-800/50 flex items-center justify-center">
                <Icons.Upload className="w-8 h-8 text-blue-500" />
              </div>
              <span className="text-base font-medium text-blue-600 dark:text-blue-400">{t('dropFilesToUpload')}</span>
            </div>
          </div>
        )}

        {error && (
          <div className="p-4 m-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-sm">
            {error}
          </div>
        )}

        {loading && files.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Icons.Loader className="w-8 h-8 animate-spin text-zinc-400" />
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-500 select-none">
            <div className="w-20 h-20 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-5">
              <Icons.HardDrive className="w-10 h-10 text-zinc-300 dark:text-zinc-600" />
            </div>
            <p className="text-base font-medium text-zinc-500 dark:text-zinc-400 mb-1">{t('noFilesYet')}</p>
            <p className="text-sm text-zinc-400 dark:text-zinc-500">{t('dragAndDropHint')}</p>
          </div>
        ) : (
          <StorageFileTable
            files={files}
            currentPath={currentPath}
            selectedFiles={selectedFiles}
            hasSelection={hasSelection}
            allSelected={allSelected}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
            onToggleSelect={toggleFileSelection}
            onNavigateUp={navigateUp}
            onNavigateToFolder={navigateToFolder}
            onOpenFile={actions.handleOpenFile}
            onContextMenu={setContextMenu}
          />
        )}
      </div>

      <StorageBulkActions
        selectedCount={selectedFiles.size}
        onMove={bulk.openBulkMove}
        onRename={bulk.openBulkRename}
        onDelete={bulk.handleBulkDelete}
        onClear={deselectAll}
      />

      {contextMenu && (
        <StorageContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpen={() => actions.handleOpenFile(contextMenu.file)}
          onDownload={() => actions.handleDownload(contextMenu.file)}
          onRename={() => actions.openRenameModal(contextMenu.file)}
          onDelete={() => actions.handleDelete(contextMenu.file)}
        />
      )}

      <CreateFolderModal
        isOpen={showCreateFolderModal}
        onClose={() => setShowCreateFolderModal(false)}
        createFolder={createFolder}
      />

      <RenameModal
        isOpen={actions.showRenameModal}
        renameTarget={actions.renameTarget}
        newName={actions.newName}
        onNewNameChange={actions.setNewName}
        onClose={actions.closeRenameModal}
        onRename={actions.handleRename}
      />

      <BulkMoveModal
        isOpen={bulk.showBulkMoveModal}
        onClose={bulk.closeBulkMove}
        selectedCount={selectedFiles.size}
        bulkMovePath={bulk.bulkMovePath}
        onPathChange={bulk.setBulkMovePath}
        onMove={bulk.handleBulkMove}
        moving={bulk.bulkMoving}
        normalizePath={bulk.normalizePath}
      />

      <BulkRenameModal
        isOpen={bulk.showBulkRenameModal}
        onClose={bulk.closeBulkRename}
        bulkRenames={bulk.bulkRenames}
        onRenamesChange={bulk.setBulkRenames}
        onRename={bulk.handleBulkRename}
        renaming={bulk.bulkRenaming}
      />
    </div>
  );
}
