import { createSignal } from "solid-js";
import type { Setter } from "solid-js";
import type { RpcResponse } from "../lib/rpc.ts";
import { useI18n } from "../store/i18n.ts";
import { useToast } from "../store/toast.ts";
import { useConfirmDialog } from "../store/confirm-dialog.ts";
import type { StorageFile } from "../types/index.ts";

interface UseStorageActionsParams {
  getDownloadUrl: (fileId: string) => Promise<string | null>;
  downloadFolderZip: (path: string) => Promise<RpcResponse | null>;
  deleteItem: (id: string) => Promise<boolean>;
  renameItem: (id: string, name: string) => Promise<unknown>;
  currentPath: () => string;
  setSelectedFiles: Setter<Set<string>>;
}

interface UseStorageActionsResult {
  // File viewer
  viewingFile: () => StorageFile | null;
  viewingFileDownloadUrl: () => string | null;
  handleOpenFile: (file: StorageFile) => Promise<void>;
  handleCloseViewer: () => void;
  // Download
  handleDownload: (file: StorageFile) => Promise<void>;
  downloadingZip: () => boolean;
  downloadedZipBytes: () => number;
  handleDownloadZip: () => Promise<void>;
  // Delete
  handleDelete: (file: StorageFile) => Promise<void>;
  // Rename
  showRenameModal: () => boolean;
  renameTarget: () => StorageFile | null;
  newName: () => string;
  setNewName: Setter<string>;
  openRenameModal: (file: StorageFile) => void;
  closeRenameModal: () => void;
  handleRename: () => Promise<void>;
}

export function useStorageActions({
  getDownloadUrl,
  downloadFolderZip,
  deleteItem,
  renameItem,
  currentPath,
  setSelectedFiles,
}: UseStorageActionsParams): UseStorageActionsResult {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  // File viewer state
  const [viewingFile, setViewingFile] = createSignal<StorageFile | null>(null);
  const [viewingFileDownloadUrl, setViewingFileDownloadUrl] = createSignal<
    string | null
  >(null);

  // Rename state
  const [showRenameModal, setShowRenameModal] = createSignal(false);
  const [renameTarget, setRenameTarget] = createSignal<StorageFile | null>(
    null,
  );
  const [newName, setNewName] = createSignal("");

  // Zip download state
  const [downloadingZip, setDownloadingZip] = createSignal(false);
  const [downloadedZipBytes, setDownloadedZipBytes] = createSignal(0);

  const handleOpenFile = async (file: StorageFile) => {
    if (file.type === "folder") return;
    const url = await getDownloadUrl(file.id);
    setViewingFileDownloadUrl(url);
    setViewingFile(file);
  };

  const handleCloseViewer = () => {
    setViewingFile(null);
    setViewingFileDownloadUrl(null);
  };

  const handleDownload = async (file: StorageFile) => {
    const url = await getDownloadUrl(file.id);
    if (url) {
      globalThis.open(url, "_blank", "noopener,noreferrer");
    } else {
      showToast("error", t("failedToGetDownloadUrl"));
    }
  };

  const handleDownloadZip = async () => {
    if (downloadingZip()) return;
    setDownloadingZip(true);
    setDownloadedZipBytes(0);

    try {
      const res = await downloadFolderZip(currentPath());
      if (!res) {
        showToast("error", t("failedToGetDownloadUrl") || "Failed to download");
        return;
      }

      const folderName = currentPath() === "/"
        ? "workspace"
        : currentPath().split("/").filter(Boolean).pop() || "folder";
      const filename = `${folderName}.zip`;

      const blob = await res.blob();
      setDownloadedZipBytes(blob.size);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("success", t("download") || "Download");
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : (t("failedToLoad") || "Failed"),
      );
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleDelete = async (file: StorageFile) => {
    const confirmed = await confirm({
      title: t("deleteConfirmTitle"),
      message: file.type === "folder"
        ? t("deleteFolderConfirm").replace("{name}", file.name)
        : t("deleteFileConfirm").replace("{name}", file.name),
      confirmText: t("delete"),
      danger: true,
    });

    if (!confirmed) return;

    const result = await deleteItem(file.id);
    if (result) {
      showToast("success", t("itemDeleted").replace("{name}", file.name));
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
    } else {
      showToast("error", t("failedToDelete"));
    }
  };

  const openRenameModal = (file: StorageFile) => {
    setRenameTarget(file);
    setNewName(file.name);
    setShowRenameModal(true);
  };

  const closeRenameModal = () => {
    setShowRenameModal(false);
    setRenameTarget(null);
    setNewName("");
  };

  const handleRename = async () => {
    const target = renameTarget();
    const name = newName();
    if (!target || !name.trim()) return;

    const result = await renameItem(target.id, name.trim());
    if (result) {
      showToast("success", t("renamedTo").replace("{name}", name));
      setShowRenameModal(false);
      setRenameTarget(null);
      setNewName("");
    } else {
      showToast("error", t("failedToRename"));
    }
  };

  return {
    viewingFile,
    viewingFileDownloadUrl,
    handleOpenFile,
    handleCloseViewer,
    handleDownload,
    downloadingZip,
    downloadedZipBytes,
    handleDownloadZip,
    handleDelete,
    showRenameModal,
    renameTarget,
    newName,
    setNewName,
    openRenameModal,
    closeRenameModal,
    handleRename,
  };
}
