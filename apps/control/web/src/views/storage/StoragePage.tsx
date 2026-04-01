import { createEffect, createSignal, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { useSpaceStorage } from "../../hooks/useSpaceStorage.ts";
import { Icons } from "../../lib/Icons.tsx";
import type { Space, StorageFile } from "../../types/index.ts";
import type { ContextMenuState, FileHandler } from "./storageUtils.tsx";
import { useStorageBulkOperations } from "../../hooks/useStorageBulkOperations.ts";
import { useFileUpload } from "../../hooks/useFileUpload.ts";
import { useStorageActions } from "../../hooks/useStorageActions.ts";
import { StorageToolbar } from "./StorageToolbar.tsx";
import { StorageBreadcrumbs } from "./StorageBreadcrumbs.tsx";
import { StorageFileTable } from "./StorageFileTable.tsx";
import { StorageBulkActions } from "./StorageBulkActions.tsx";
import { StorageContextMenu } from "./StorageContextMenu.tsx";
import { RenameModal } from "./RenameModal.tsx";
import { CreateFolderModal } from "./CreateFolderModal.tsx";
import { BulkMoveModal } from "./BulkMoveModal.tsx";
import { BulkRenameModal } from "./BulkRenameModal.tsx";
import { StorageFileViewer } from "./StorageFileViewer.tsx";

interface StoragePageProps {
  spaceId: string;
  spaces: Space[];
  initialPath?: string;
  initialFilePath?: string;
  onPathChange?: (path: string) => void;
}

function getParentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

export function StoragePage(props: StoragePageProps) {
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
  } = useSpaceStorage(props.spaceId);

  const [selectedFiles, setSelectedFiles] = createSignal<Set<string>>(
    new Set(),
  );
  const [showCreateFolderModal, setShowCreateFolderModal] = createSignal(false);
  const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(
    null,
  );
  const [fileHandlers, setFileHandlers] = createSignal<FileHandler[]>([]);

  const { uploading, handleFileSelect } = useFileUpload({ uploadFile });
  const [isDragOver, setIsDragOver] = createSignal(false);
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer) handleFileSelect(e.dataTransfer.files);
  };

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

  createEffect(() => {
    const _spaceId = props.spaceId;
    const _initialPath = props.initialPath;
    const _initialFilePath = props.initialFilePath;
    loadFiles(
      _initialFilePath
        ? getParentPath(_initialFilePath)
        : (_initialPath ?? "/"),
    );
  });

  createEffect(() => {
    const spaceId = props.spaceId;
    if (!spaceId) return;
    fetch(`/api/spaces/${encodeURIComponent(spaceId)}/storage/file-handlers`)
      .then((res) => res.ok ? res.json() : null)
      .then((data: { handlers: FileHandler[] } | null) => {
        if (data?.handlers) setFileHandlers(data.handlers);
      })
      .catch(
        () => {/* non-critical: file handlers are optional UI enhancement */},
      );
  });

  createEffect(() => {
    if (props.onPathChange && currentPath() !== (props.initialPath ?? "/")) {
      props.onPathChange(currentPath());
    }
  });

  createEffect(() => {
    const targetFilePath = props.initialFilePath;
    if (!targetFilePath) return;
    if (actions.viewingFile()?.path === targetFilePath) return;

    const parentPath = getParentPath(targetFilePath);
    if (currentPath() !== parentPath) return;

    const targetFile = files().find((file) =>
      file.path === targetFilePath && file.type !== "folder"
    );
    if (!targetFile) return;
    void actions.handleOpenFile(targetFile);
  });

  const navigateToFolder = (folder: StorageFile) => {
    loadFiles(folder.path);
    setSelectedFiles(new Set<string>());
  };

  const navigateUp = () => {
    if (currentPath() === "/") return;
    const parts = currentPath().split("/").filter(Boolean);
    parts.pop();
    const newPath = parts.length > 0 ? "/" + parts.join("/") : "/";
    loadFiles(newPath);
    setSelectedFiles(new Set<string>());
  };

  const navigateToPath = (path: string) => {
    loadFiles(path);
    setSelectedFiles(new Set<string>());
  };

  const selectAll = () => {
    setSelectedFiles(new Set(files().map((f: StorageFile) => f.id)));
  };

  const deselectAll = () => {
    setSelectedFiles(new Set<string>());
  };

  const toggleFileSelection = (fileId: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const hasSelection = () => selectedFiles().size > 0;
  const allSelected = () =>
    files().length > 0 && selectedFiles().size === files().length;

  return (
    <Show
      when={!actions.viewingFile()}
      fallback={
        <StorageFileViewer
          spaceId={props.spaceId}
          file={actions.viewingFile()!}
          downloadUrl={actions.viewingFileDownloadUrl()}
          fileHandlers={fileHandlers()}
          onClose={actions.handleCloseViewer}
          onSave={() => loadFiles(currentPath())}
        />
      }
    >
      <div
        class="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900"
        onClick={() => contextMenu() && setContextMenu(null)}
      >
        <StorageToolbar
          loading={loading()}
          uploading={uploading()}
          downloadingZip={actions.downloadingZip()}
          downloadedZipBytes={actions.downloadedZipBytes()}
          onRefresh={() => loadFiles(currentPath())}
          onDownloadZip={actions.handleDownloadZip}
          onNewFolder={() => setShowCreateFolderModal(true)}
          onFileSelect={handleFileSelect}
        />

        <StorageBreadcrumbs
          currentPath={currentPath()}
          onNavigate={navigateToPath}
        />

        {/* Main content */}
        <div
          class={"flex-1 overflow-auto mx-3 mb-3 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 relative " +
            (isDragOver() ? "ring-2 ring-blue-400 ring-inset" : "")}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          <Show when={isDragOver()}>
            <div class="absolute inset-0 bg-blue-50/80 dark:bg-blue-900/30 flex items-center justify-center z-10 pointer-events-none rounded-2xl">
              <div class="flex flex-col items-center gap-3">
                <div class="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-800/50 flex items-center justify-center">
                  <Icons.Upload class="w-8 h-8 text-blue-500" />
                </div>
                <span class="text-base font-medium text-blue-600 dark:text-blue-400">
                  {t("dropFilesToUpload")}
                </span>
              </div>
            </div>
          </Show>

          <Show when={error()}>
            <div class="p-4 m-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-sm">
              {error()}
            </div>
          </Show>

          <Show
            when={!(loading() && files().length === 0)}
            fallback={
              <div class="flex items-center justify-center h-full">
                <Icons.Loader class="w-8 h-8 animate-spin text-zinc-400" />
              </div>
            }
          >
            <Show
              when={files().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-500 select-none">
                  <div class="w-20 h-20 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-5">
                    <Icons.HardDrive class="w-10 h-10 text-zinc-300 dark:text-zinc-600" />
                  </div>
                  <p class="text-base font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                    {t("noFilesYet")}
                  </p>
                  <p class="text-sm text-zinc-400 dark:text-zinc-500">
                    {t("dragAndDropHint")}
                  </p>
                </div>
              }
            >
              <StorageFileTable
                files={files()}
                currentPath={currentPath()}
                selectedFiles={selectedFiles()}
                hasSelection={hasSelection()}
                allSelected={allSelected()}
                onSelectAll={selectAll}
                onDeselectAll={deselectAll}
                onToggleSelect={toggleFileSelection}
                onNavigateUp={navigateUp}
                onNavigateToFolder={navigateToFolder}
                onOpenFile={actions.handleOpenFile}
                onContextMenu={setContextMenu}
              />
            </Show>
          </Show>
        </div>

        <StorageBulkActions
          selectedCount={selectedFiles().size}
          onMove={bulk.openBulkMove}
          onRename={bulk.openBulkRename}
          onDelete={bulk.handleBulkDelete}
          onClear={deselectAll}
        />

        <Show when={contextMenu()}>
          {(menu) => (
            <StorageContextMenu
              state={menu()}
              onClose={() => setContextMenu(null)}
              onOpen={() => actions.handleOpenFile(menu().file)}
              onDownload={() => actions.handleDownload(menu().file)}
              onRename={() => actions.openRenameModal(menu().file)}
              onDelete={() => actions.handleDelete(menu().file)}
            />
          )}
        </Show>

        <CreateFolderModal
          isOpen={showCreateFolderModal()}
          onClose={() => setShowCreateFolderModal(false)}
          createFolder={createFolder}
        />

        <RenameModal
          isOpen={actions.showRenameModal()}
          renameTarget={actions.renameTarget()}
          newName={actions.newName()}
          onNewNameChange={actions.setNewName}
          onClose={actions.closeRenameModal}
          onRename={actions.handleRename}
        />

        <BulkMoveModal
          isOpen={bulk.showBulkMoveModal()}
          onClose={bulk.closeBulkMove}
          selectedCount={selectedFiles().size}
          bulkMovePath={bulk.bulkMovePath()}
          onPathChange={bulk.setBulkMovePath}
          onMove={bulk.handleBulkMove}
          moving={bulk.bulkMoving()}
          normalizePath={bulk.normalizePath}
        />

        <BulkRenameModal
          isOpen={bulk.showBulkRenameModal()}
          onClose={bulk.closeBulkRename}
          bulkRenames={bulk.bulkRenames()}
          onRenamesChange={bulk.setBulkRenames}
          onRename={bulk.handleBulkRename}
          renaming={bulk.bulkRenaming()}
        />
      </div>
    </Show>
  );
}
