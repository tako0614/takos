import { createSignal, onCleanup } from "solid-js";
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
  renameItem: (id: string, name: string, isCurrentOperation?: () => boolean) => Promise<StorageFile | null>;
  currentPath: () => string;
  setSelectedFiles: Setter<Set<string>>;
  getScope: () => symbol | undefined;
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
  renaming: () => boolean;
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
  getScope,
}: UseStorageActionsParams): UseStorageActionsResult {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  let disposed = false;
  let pendingDeleteScope: symbol | undefined;
  onCleanup(() => { disposed = true; });

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
  const [renameSession, setRenameSession] = createSignal<{ scope: symbol }>();
  const [pendingRenameTargets, setPendingRenameTargets] = createSignal(new Set<string>());
  const renameKey = (file: StorageFile) => JSON.stringify([file.space_id, file.id]);
  const isCurrentRename = (session: { scope: symbol } | undefined) =>
    !disposed && session !== undefined && renameSession() === session && getScope() === session.scope;

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
        showToast("error", t("failedToGetDownloadUrl"));
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
      showToast("success", t("download"));
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : t("failedToLoad"),
      );
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleDelete = async (file: StorageFile) => {
    if (disposed) return;
    const scope = getScope();
    if (!scope || pendingDeleteScope === scope) return;
    const isCurrent = () => !disposed && getScope() === scope;
    pendingDeleteScope = scope;
    try {
      const confirmed = await confirm({
        title: t("deleteConfirmTitle"),
        message: file.type === "folder"
          ? t("deleteFolderConfirm").replace("{name}", file.name)
          : t("deleteFileConfirm").replace("{name}", file.name),
        confirmText: t("delete"),
        danger: true,
      });
      if (!confirmed || !isCurrent()) return;
      const result = await deleteItem(file.id);
      if (!isCurrent()) return;
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
    } finally {
      if (pendingDeleteScope === scope) pendingDeleteScope = undefined;
    }
  };

  const openRenameModal = (file: StorageFile) => {
    const scope = getScope();
    if (disposed || !scope) return;
    const oldTarget = renameTarget();
    const draft = showRenameModal() && oldTarget && renameKey(oldTarget) === renameKey(file) ? newName() : file.name;
    setRenameSession({ scope });
    setRenameTarget(file);
    setNewName(draft);
    setShowRenameModal(true);
  };

  const closeRenameModal = () => {
    setRenameSession(undefined);
    setShowRenameModal(false);
    setRenameTarget(null);
    setNewName("");
  };

  const handleRename = async () => {
    const target = renameTarget(), session = renameSession(), draft = newName(), name = draft.trim();
    if (!target || !session || !isCurrentRename(session) || !name || name === target.name) return;
    const key = renameKey(target);
    if (pendingRenameTargets().has(key)) return;
    setPendingRenameTargets(previous => new Set(previous).add(key));
    try {
      const result = await renameItem(target.id, name, () => isCurrentRename(session));
      if (!isCurrentRename(session)) {
        // A reopened dialog may keep its draft, but its no-op baseline must
        // adopt the completed save before it can explicitly restore an old name.
        const currentTarget = renameTarget();
        if (result && isCurrentRename(renameSession()) && currentTarget && renameKey(currentTarget) === key) setRenameTarget(result);
        return;
      }
      if (result) {
        showToast("success", t("renamedTo").replace("{name}", result.name));
        // Acknowledging the submitted name must not discard edits made while saving.
        if (newName() === draft) closeRenameModal();
        else setRenameTarget(result);
      } else {
        showToast("error", t("failedToRename"));
      }
    } finally {
      setPendingRenameTargets(previous => { const next = new Set(previous);next.delete(key);return next; });
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
    showRenameModal: () => showRenameModal() && isCurrentRename(renameSession()),
    renaming: () => {
      const target = renameTarget();
      return target !== null && isCurrentRename(renameSession()) && pendingRenameTargets().has(renameKey(target));
    },
    renameTarget,
    newName,
    setNewName,
    openRenameModal,
    closeRenameModal,
    handleRename,
  };
}
