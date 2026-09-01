import { type Accessor, createSignal } from "solid-js";
import type { StorageFile } from "../types/index.ts";
import type { RpcResponse } from "../lib/rpc.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { getErrorMessage } from "../lib/errors.ts";
import { useI18n } from "../store/i18n.ts";
import {
  buildStorageDownloadUrl,
  parseStorageBulkDeleteResponse,
  parseStorageBulkMutationResponse,
  parseStorageDeleteResponse,
  parseStorageFileMutationResponse,
  parseStorageListResponse,
  parseStorageUploadUrlResponse,
} from "./storage-response.ts";

interface UseSpaceStorageReturn {
  files: () => StorageFile[];
  currentPath: () => string;
  loading: () => boolean;
  error: () => string | null;
  truncated: () => boolean;
  loadFiles: (path?: string) => Promise<void>;
  createFolder: (name: string) => Promise<StorageFile | null>;
  uploadFile: (file: File) => Promise<StorageFile | null>;
  deleteItem: (fileId: string) => Promise<boolean>;
  deleteItems: (fileIds: string[]) => Promise<boolean>;
  renameItem: (fileId: string, name: string) => Promise<StorageFile | null>;
  moveItem: (fileId: string, parentPath: string) => Promise<StorageFile | null>;
  bulkMoveItems: (fileIds: string[], parentPath: string) => Promise<boolean>;
  bulkRenameItems: (
    renames: Array<{ file_id: string; name: string }>,
  ) => Promise<boolean>;
  getDownloadUrl: (fileId: string) => Promise<string | null>;
  downloadFolderZip: (path: string) => Promise<RpcResponse | null>;
}

export function useSpaceStorage(
  spaceIdentifier: Accessor<string | undefined>,
  spaceRecordId: Accessor<string | undefined>,
): UseSpaceStorageReturn {
  const { t } = useI18n();
  const [files, setFiles] = createSignal<StorageFile[]>([]);
  const [currentPath, setCurrentPath] = createSignal("/");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [truncated, setTruncated] = createSignal(false);
  // Monotonic counter to prevent stale loadFiles responses from overwriting newer ones
  let loadVersion = 0;

  const target = () => {
    const identifier = spaceIdentifier();
    const recordId = spaceRecordId();
    return identifier && recordId ? { identifier, recordId } : null;
  };
  const isCurrentTarget = (value: { identifier: string; recordId: string }) =>
    spaceIdentifier() === value.identifier && spaceRecordId() === value.recordId;

  const loadFiles = async (path = "/") => {
    const currentTarget = target();
    if (!currentTarget) return;

    const version = ++loadVersion;
    setLoading(true);
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage.$get({
        param: { spaceId: currentTarget.identifier },
        query: { path },
      });

      // Discard result if a newer loadFiles was called while this was in flight
      if (version !== loadVersion) return;
      if (!isCurrentTarget(currentTarget)) return;

      const data = parseStorageListResponse(await rpcJson<unknown>(res), {
        spaceId: currentTarget.recordId,
        path,
      });
      setFiles(data.files);
      setCurrentPath(data.path);
      setTruncated(data.truncated);
    } catch (err) {
      if (version !== loadVersion) return;
      if (!isCurrentTarget(currentTarget)) return;
      setError(getErrorMessage(err, t("failedToLoadFiles")));
    } finally {
      if (version === loadVersion && isCurrentTarget(currentTarget)) {
        setLoading(false);
      }
    }
  };

  const createFolder = async (name: string): Promise<StorageFile | null> => {
    const currentTarget = target();
    if (!currentTarget) return null;
    const requestedPath = currentPath();
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage.folders.$post({
        param: { spaceId: currentTarget.identifier },
        json: { name, parent_path: requestedPath },
      });

      const value = await rpcJson<unknown>(res);
      try {
        if (!isCurrentTarget(currentTarget)) return null;
        return parseStorageFileMutationResponse(value, {
          field: "folder",
          spaceId: currentTarget.recordId,
          name,
          parentPath: requestedPath,
        });
      } finally {
        if (isCurrentTarget(currentTarget)) await loadFiles(currentPath());
      }
    } catch (err) {
      setError(getErrorMessage(err, t("failedToCreateFolder")));
      return null;
    }
  };

  const uploadFile = async (file: File): Promise<StorageFile | null> => {
    const currentTarget = target();
    if (!currentTarget) return null;
    const requestedPath = currentPath();
    setError(null);

    try {
      const urlRes = await rpc.spaces[":spaceId"].storage["upload-url"].$post({
        param: { spaceId: currentTarget.identifier },
        json: {
          name: file.name,
          parent_path: requestedPath,
          size: file.size,
          mime_type: file.type || undefined,
        },
      });

      const urlData = parseStorageUploadUrlResponse(
        await rpcJson<unknown>(urlRes),
        currentTarget.identifier,
      );
      if (!isCurrentTarget(currentTarget)) return null;

      const uploadRes = await fetch(urlData.uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });

      if (!uploadRes.ok) {
        throw new Error(t("failedToUploadFile"));
      }

      const confirmRes = await rpc.spaces[":spaceId"].storage["confirm-upload"]
        .$post({
          param: { spaceId: currentTarget.identifier },
          json: { file_id: urlData.fileId },
        });

      const value = await rpcJson<unknown>(confirmRes);
      try {
        if (!isCurrentTarget(currentTarget)) return null;
        return parseStorageFileMutationResponse(value, {
          spaceId: currentTarget.recordId,
          id: urlData.fileId,
          name: file.name,
          parentPath: requestedPath,
        });
      } finally {
        if (isCurrentTarget(currentTarget)) await loadFiles(currentPath());
      }
    } catch (err) {
      setError(getErrorMessage(err, t("failedToUploadFile")));
      return null;
    }
  };

  const deleteItem = async (fileId: string): Promise<boolean> => {
    const currentTarget = target();
    if (!currentTarget) return false;
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage[":fileId"].$delete({
        param: { spaceId: currentTarget.identifier, fileId },
      });

      const value = await rpcJson<unknown>(res);
      try {
        parseStorageDeleteResponse(value, fileId);
        return isCurrentTarget(currentTarget);
      } finally {
        if (isCurrentTarget(currentTarget)) await loadFiles(currentPath());
      }
    } catch (err) {
      setError(getErrorMessage(err, t("failedToDelete")));
      return false;
    }
  };

  const deleteItems = async (fileIds: string[]): Promise<boolean> => {
    const currentTarget = target();
    if (!currentTarget || fileIds.length === 0) return false;
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage["bulk-delete"].$post({
        param: { spaceId: currentTarget.identifier },
        json: { file_ids: fileIds },
      });

      const value = await rpcJson<unknown>(res);
      try {
        const result = parseStorageBulkDeleteResponse(value, fileIds);
        return isCurrentTarget(currentTarget) && result.complete;
      } finally {
        if (isCurrentTarget(currentTarget)) await loadFiles(currentPath());
      }
    } catch (err) {
      setError(getErrorMessage(err, t("failedToDelete")));
      return false;
    }
  };

  const renameItem = async (
    fileId: string,
    name: string,
  ): Promise<StorageFile | null> => {
    const currentTarget = target();
    if (!currentTarget) return null;
    const requestedPath = currentPath();
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage[":fileId"].$patch({
        param: { spaceId: currentTarget.identifier, fileId },
        json: { name },
      });

      const value = await rpcJson<unknown>(res);
      try {
        if (!isCurrentTarget(currentTarget)) return null;
        return parseStorageFileMutationResponse(value, {
          spaceId: currentTarget.recordId,
          id: fileId,
          name,
          parentPath: requestedPath,
        });
      } finally {
        if (isCurrentTarget(currentTarget)) await loadFiles(currentPath());
      }
    } catch (err) {
      setError(getErrorMessage(err, t("failedToRename")));
      return null;
    }
  };

  const moveItem = async (
    fileId: string,
    parentPath: string,
  ): Promise<StorageFile | null> => {
    const currentTarget = target();
    if (!currentTarget) return null;
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage[":fileId"].$patch({
        param: { spaceId: currentTarget.identifier, fileId },
        json: { parent_path: parentPath },
      });

      const value = await rpcJson<unknown>(res);
      try {
        if (!isCurrentTarget(currentTarget)) return null;
        return parseStorageFileMutationResponse(value, {
          spaceId: currentTarget.recordId,
          id: fileId,
          parentPath,
        });
      } finally {
        if (isCurrentTarget(currentTarget)) await loadFiles(currentPath());
      }
    } catch (err) {
      setError(getErrorMessage(err, t("failedToMove")));
      return null;
    }
  };

  const bulkMoveItems = async (
    fileIds: string[],
    parentPath: string,
  ): Promise<boolean> => {
    const currentTarget = target();
    if (!currentTarget || fileIds.length === 0) return false;
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage["bulk-move"].$post({
        param: { spaceId: currentTarget.identifier },
        json: { file_ids: fileIds, parent_path: parentPath },
      });

      const value = await rpcJson<unknown>(res);
      try {
        const result = parseStorageBulkMutationResponse(value, {
          field: "moved",
          spaceId: currentTarget.recordId,
          fileIds,
          parentPath,
        });
        return isCurrentTarget(currentTarget) && result.complete;
      } finally {
        if (isCurrentTarget(currentTarget)) await loadFiles(currentPath());
      }
    } catch (err) {
      setError(getErrorMessage(err, t("failedToMove")));
      return false;
    }
  };

  const bulkRenameItems = async (
    renames: Array<{ file_id: string; name: string }>,
  ): Promise<boolean> => {
    const currentTarget = target();
    if (!currentTarget || renames.length === 0) return false;
    setError(null);

    try {
      const res = await rpc.spaces[":spaceId"].storage["bulk-rename"].$post({
        param: { spaceId: currentTarget.identifier },
        json: { renames },
      });

      const value = await rpcJson<unknown>(res);
      try {
        const result = parseStorageBulkMutationResponse(value, {
          field: "renamed",
          spaceId: currentTarget.recordId,
          fileIds: renames.map((rename) => rename.file_id),
          names: new Map(
            renames.map((rename) => [rename.file_id, rename.name]),
          ),
        });
        return isCurrentTarget(currentTarget) && result.complete;
      } finally {
        if (isCurrentTarget(currentTarget)) await loadFiles(currentPath());
      }
    } catch (err) {
      setError(getErrorMessage(err, t("failedToRename")));
      return false;
    }
  };

  const getDownloadUrl = async (fileId: string): Promise<string | null> => {
    const currentTarget = target();
    if (!currentTarget) return null;
    return buildStorageDownloadUrl(currentTarget.identifier, fileId);
  };

  const downloadFolderZip = async (
    path: string,
  ): Promise<RpcResponse | null> => {
    const currentTarget = target();
    if (!currentTarget) return null;

    try {
      const res = await rpc.spaces[":spaceId"].storage["download-zip"].$get({
        param: { spaceId: currentTarget.identifier },
        query: { path },
      });

      if (!res.ok) {
        await rpcJson<never>(res);
        throw new Error(t("failedToDownloadZip"));
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
