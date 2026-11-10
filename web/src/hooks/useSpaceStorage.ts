import { type Accessor, createSignal, onCleanup } from "solid-js";
import type { StorageFile } from "../types/index.ts";
import type { RpcResponse } from "../lib/rpc.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { getErrorMessage } from "../lib/errors.ts";
import { useI18n } from "../store/i18n.ts";
import { createLatestRequest } from "../lib/createLatestRequest.ts";

export interface StorageBulkDeleteResult {
  failedIds: string[];
}

interface UseSpaceStorageReturn {
  files: () => StorageFile[];
  currentPath: () => string;
  loading: () => boolean;
  error: () => string | null;
  truncated: () => boolean;
  loadFiles: (path?: string) => Promise<void>;
  createFolder: (name: string, isCurrentOperation?: () => boolean) => Promise<StorageFile | null>;
  uploadFile: (file: File) => Promise<StorageFile | null>;
  uploadScope: () => symbol | undefined;
  deleteItem: (fileId: string) => Promise<boolean>;
  deleteItems: (fileIds: string[]) => Promise<StorageBulkDeleteResult | null>;
  renameItem: (fileId: string, name: string, isCurrentOperation?: () => boolean) => Promise<StorageFile | null>;
  moveItem: (fileId: string, parentPath: string) => Promise<StorageFile | null>;
  bulkMoveItems: (fileIds: string[], parentPath: string) => Promise<boolean>;
  bulkRenameItems: (
    renames: Array<{ file_id: string; name: string }>,
  ) => Promise<boolean>;
  getDownloadUrl: (fileId: string) => Promise<string | null>;
  downloadFolderZip: (path: string) => Promise<RpcResponse | null>;
}

export function useSpaceStorage(
  spaceId: Accessor<string | undefined>,
): UseSpaceStorageReturn {
  const { t } = useI18n();
  const [files, setFiles] = createSignal<StorageFile[]>([]);
  const [currentPath, setCurrentPath] = createSignal("/");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [truncated, setTruncated] = createSignal(false);
  const listRequests = createLatestRequest();
  const [listedScope, setListedScope] = createSignal<symbol | undefined>();
  let disposed = false;
  onCleanup(() => { disposed = true;listRequests.next();setListedScope(undefined); });
  let uploadTarget: { spaceId: string; path: string; token: symbol } | undefined;
  let listedTarget: typeof uploadTarget;
  const uploadScope = () => {
    const scope = listedScope();
    return !disposed && uploadTarget && listedTarget === uploadTarget && spaceId() === uploadTarget.spaceId && scope === uploadTarget.token
      ? scope : undefined;
  };

  const loadFiles = async (path = "/") => {
    const currentSpaceId = spaceId();
    if (disposed) return;
    if (!currentSpaceId) { uploadTarget = undefined;listedTarget = undefined;setListedScope(undefined);return; }

    // Invalidate upload batches as soon as navigation starts, including A -> B -> A.
    // Refreshing the same folder does not retire the rest of its selected files.
    if (uploadTarget?.spaceId !== currentSpaceId || uploadTarget.path !== path) {
      uploadTarget = { spaceId: currentSpaceId, path, token: Symbol("storage-upload-target") };
      setListedScope(undefined);
    }
    const claim = listRequests.claim(() => !disposed && spaceId() === currentSpaceId);
    setLoading(true);
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage.$get({
        param: { spaceId: currentSpaceId },
        query: { path },
      });

      if (!claim.won()) return;

      const data = await rpcJson<
        { files: StorageFile[]; path: string; truncated?: boolean }
      >(res, { isCurrent: claim.won });
      // JSON decoding can outlive a folder, Workspace or component switch.
      if (!claim.won()) return;
      uploadTarget.path = data.path || path;
      listedTarget = uploadTarget;
      setFiles(data.files || []);
      setCurrentPath(data.path || path);
      setTruncated(data.truncated ?? false);
      setListedScope(uploadTarget.token);
    } catch (err) {
      if (!claim.won()) return;
      setError(getErrorMessage(err, t("failedToLoadFiles")));
      setFiles([]);
      setCurrentPath(path);
      setTruncated(false);
    } finally {
      if (claim.won()) {
        setLoading(false);
      }
    }
  };

  const createFolder = async (name: string, isCurrentOperation?: () => boolean): Promise<StorageFile | null> => {
    const currentSpaceId = spaceId(), parentPath = currentPath(), scope = uploadScope();
    if (!currentSpaceId || !scope) return null;
    const isCurrentView = () => scope === uploadScope() && currentPath() === parentPath;
    const isCurrent = () => isCurrentView() && isCurrentOperation?.() !== false;
    if (!isCurrent()) return null;
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage.folders.$post({
        param: { spaceId: currentSpaceId },
        json: { name, parent_path: parentPath },
      });

      if (!isCurrentView()) return null;
      const data = await rpcJson<{ folder: StorageFile }>(res, { isCurrent });
      if (!isCurrentView()) return null;
      // A successful create remains visible even if its dialog was canceled.
      await loadFiles(parentPath);
      return isCurrentView() ? data.folder : null;
    } catch (err) {
      if (isCurrent()) setError(getErrorMessage(err, t("failedToCreateFolder")));
      return null;
    }
  };

  const uploadFile = async (file: File): Promise<StorageFile | null> => {
    const currentSpaceId = spaceId(), parentPath = currentPath(), scope = uploadScope();
    if (!currentSpaceId || !scope) return null;
    const isCurrent = () => scope === uploadScope() && currentPath() === parentPath;
    let authenticationRequired = false;
    setError(null);

    try {
      const urlRes = await rpc.spaces[":spaceId"].storage["upload-url"].$post({
        param: { spaceId: currentSpaceId },
        json: {
          name: file.name,
          parent_path: parentPath,
          size: file.size,
          mime_type: file.type || undefined,
        },
      });
      if (!isCurrent()) return null;
      authenticationRequired = urlRes.status === 401;

      const urlData = await rpcJson<{
        file_id: string;
        upload_url: string;
        r2_key: string;
        expires_at: string;
      }>(urlRes, { isCurrent });
      if (!isCurrent()) return null;

      const uploadRes = await fetch(urlData.upload_url, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });
      if (!isCurrent()) return null;

      if (!uploadRes.ok) {
        throw new Error(t("failedToUploadFile"));
      }

      const confirmRes = await rpc.spaces[":spaceId"].storage["confirm-upload"]
        .$post({
          param: { spaceId: currentSpaceId },
          json: { file_id: urlData.file_id },
        });
      if (!isCurrent()) return null;
      authenticationRequired = confirmRes.status === 401;

      const confirmData = await rpcJson<{ file: StorageFile }>(confirmRes, { isCurrent });
      if (!isCurrent()) return null;
      await loadFiles(parentPath);
      return confirmData.file;
    } catch (err) {
      if (isCurrent()) {
        setError(getErrorMessage(err, t("failedToUploadFile")));
        // The caller must stop the remaining files while login navigation begins.
        if (authenticationRequired) throw err;
      }
      return null;
    }
  };

  const deleteItem = async (fileId: string): Promise<boolean> => {
    const currentSpaceId = spaceId(), parentPath = currentPath(), scope = uploadScope();
    if (!currentSpaceId || !scope) return false;
    const isCurrent = () => scope === uploadScope() && currentPath() === parentPath;
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage[":fileId"].$delete({
        param: { spaceId: currentSpaceId, fileId },
      });

      if (!isCurrent()) return false;
      await rpcJson(res, { isCurrent });
      if (!isCurrent()) return false;

      await loadFiles(parentPath);
      return isCurrent();
    } catch (err) {
      if (isCurrent()) setError(getErrorMessage(err, t("failedToDelete")));
      return false;
    }
  };

  const deleteItems = async (fileIds: string[]): Promise<StorageBulkDeleteResult | null> => {
    const currentSpaceId = spaceId(), parentPath = currentPath(), scope = uploadScope();
    if (!currentSpaceId || !scope || fileIds.length === 0) return null;
    const isCurrent = () => scope === uploadScope() && currentPath() === parentPath;
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage["bulk-delete"].$post({
        param: { spaceId: currentSpaceId },
        json: { file_ids: fileIds },
      });

      if (!isCurrent()) return null;
      const data = await rpcJson<{ success: boolean; failed_ids: string[] }>(res, { isCurrent });
      if (!isCurrent()) return null;
      // HTTP 200 can acknowledge only part of the confirmed selection.
      if (data.success !== true || !Array.isArray(data.failed_ids) ||
        !data.failed_ids.every(id => typeof id === "string" && fileIds.includes(id))) {
        throw new Error(t("failedToDeleteSome"));
      }

      await loadFiles(parentPath);
      if (!isCurrent()) return null;
      if (data.failed_ids.length > 0) setError(t("failedToDeleteSome"));
      return { failedIds: data.failed_ids };
    } catch (err) {
      if (isCurrent()) setError(getErrorMessage(err, t("failedToDelete")));
      return null;
    }
  };

  const renameItem = async (
    fileId: string,
    name: string,
    isCurrentOperation?: () => boolean,
  ): Promise<StorageFile | null> => {
    const currentSpaceId = spaceId(), parentPath = currentPath(), scope = uploadScope();
    if (!currentSpaceId || !scope) return null;
    const isCurrentView = () => scope === uploadScope() && currentPath() === parentPath;
    const isCurrent = () => isCurrentView() && isCurrentOperation?.() !== false;
    if (!isCurrent()) return null;
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage[":fileId"].$patch({
        param: { spaceId: currentSpaceId, fileId },
        json: { name },
      });

      if (!isCurrentView()) return null;
      const data = await rpcJson<{ file: StorageFile }>(res, { isCurrent });
      if (!isCurrentView()) return null;
      // Closing a dialog cannot undo an acknowledged mutation. Reconcile the
      // original view while keeping dialog feedback and authentication scoped.
      await loadFiles(parentPath);
      return isCurrentView() ? data.file : null;
    } catch (err) {
      if (isCurrent()) setError(getErrorMessage(err, t("failedToRename")));
      return null;
    }
  };

  const moveItem = async (
    fileId: string,
    parentPath: string,
  ): Promise<StorageFile | null> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) return null;
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage[":fileId"].$patch({
        param: { spaceId: currentSpaceId, fileId },
        json: { parent_path: parentPath },
      });

      const data = await rpcJson<{ file: StorageFile }>(res);
      await loadFiles(currentPath());
      return data.file;
    } catch (err) {
      setError(getErrorMessage(err, t("failedToMove")));
      return null;
    }
  };

  const bulkMoveItems = async (
    fileIds: string[],
    parentPath: string,
  ): Promise<boolean> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId || fileIds.length === 0) return false;
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage["bulk-move"].$post({
        param: { spaceId: currentSpaceId },
        json: { file_ids: fileIds, parent_path: parentPath },
      });

      await rpcJson(res);

      await loadFiles(currentPath());
      return true;
    } catch (err) {
      setError(getErrorMessage(err, t("failedToMove")));
      return false;
    }
  };

  const bulkRenameItems = async (
    renames: Array<{ file_id: string; name: string }>,
  ): Promise<boolean> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId || renames.length === 0) return false;
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage["bulk-rename"].$post({
        param: { spaceId: currentSpaceId },
        json: { renames },
      });

      await rpcJson(res);

      await loadFiles(currentPath());
      return true;
    } catch (err) {
      setError(getErrorMessage(err, t("failedToRename")));
      return false;
    }
  };

  const getDownloadUrl = async (fileId: string): Promise<string | null> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) return null;

    try {
      const res = await rpc.spaces[":spaceId"].storage["download-url"].$get({
        param: { spaceId: currentSpaceId },
        query: { file_id: fileId },
      });

      const data = await rpcJson<{ download_url: string }>(res);
      return data.download_url;
    } catch (err) {
      setError(getErrorMessage(err, t("failedToGetDownloadUrl")));
      return null;
    }
  };

  const downloadFolderZip = async (
    path: string,
  ): Promise<RpcResponse | null> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) return null;

    try {
      const res = await rpc.spaces[":spaceId"].storage["download-zip"].$get({
        param: { spaceId: currentSpaceId },
        query: { path },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || t("failedToDownloadZip"));
      }

      return res;
    } catch (err) {
      setError(getErrorMessage(err, t("failedToDownloadZip")));
      return null;
    }
  };

  return {
    files,
    currentPath,
    loading,
    error,
    truncated,
    loadFiles,
    createFolder,
    uploadFile,
    uploadScope,
    deleteItem,
    deleteItems,
    renameItem,
    moveItem,
    bulkMoveItems,
    bulkRenameItems,
    getDownloadUrl,
    downloadFolderZip,
  };
}
