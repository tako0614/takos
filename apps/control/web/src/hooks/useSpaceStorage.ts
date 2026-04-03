import { createSignal, type Accessor } from 'solid-js';
import type { StorageFile } from '../types/index.ts';
import type { RpcResponse } from '../lib/rpc.ts';
import { rpc, rpcJson } from '../lib/rpc.ts';
import { getErrorMessage } from 'takos-common/errors';

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
  bulkRenameItems: (renames: Array<{ file_id: string; name: string }>) => Promise<boolean>;
  getDownloadUrl: (fileId: string) => Promise<string | null>;
  downloadFolderZip: (path: string) => Promise<RpcResponse | null>;
}

export function useSpaceStorage(spaceId: Accessor<string | undefined>): UseSpaceStorageReturn {
  const [files, setFiles] = createSignal<StorageFile[]>([]);
  const [currentPath, setCurrentPath] = createSignal('/');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [truncated, setTruncated] = createSignal(false);
  // Monotonic counter to prevent stale loadFiles responses from overwriting newer ones
  let loadVersion = 0;

  const loadFiles = async (path = '/') => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) return;

    const version = ++loadVersion;
    setLoading(true);
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage.$get({
        param: { spaceId: currentSpaceId },
        query: { path },
      });

      // Discard result if a newer loadFiles was called while this was in flight
      if (version !== loadVersion) return;
      if (spaceId() !== currentSpaceId) return;

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to load files');
      }

      const data = await rpcJson<{ files: StorageFile[]; path: string; truncated?: boolean }>(res);
      setFiles(data.files || []);
      setCurrentPath(data.path || path);
      setTruncated(data.truncated ?? false);
    } catch (err) {
      if (version !== loadVersion) return;
      if (spaceId() !== currentSpaceId) return;
      setError(getErrorMessage(err, 'Failed to load files'));
      setFiles([]);
      setCurrentPath(path);
      setTruncated(false);
    } finally {
      if (version === loadVersion && spaceId() === currentSpaceId) {
        setLoading(false);
      }
    }
  };

  const createFolder = async (name: string): Promise<StorageFile | null> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) return null;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage.folders.$post({
        param: { spaceId: currentSpaceId },
        json: { name, parent_path: currentPath() },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to create folder');
      }

      const data = await rpcJson<{ folder: StorageFile }>(res);
      await loadFiles(currentPath());
      return data.folder;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create folder'));
      return null;
    }
  };

  const uploadFile = async (file: File): Promise<StorageFile | null> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) return null;
    setError(null);

    try {
      const urlRes = await rpc.spaces[':spaceId'].storage['upload-url'].$post({
        param: { spaceId: currentSpaceId },
        json: {
          name: file.name,
          parent_path: currentPath(),
          size: file.size,
          mime_type: file.type || undefined,
        },
      });

      if (!urlRes.ok) {
        const data = await rpcJson<{ error: string }>(urlRes);
        throw new Error(data.error || 'Failed to get upload URL');
      }

      const urlData = await rpcJson<{
        file_id: string;
        upload_url: string;
        r2_key: string;
        expires_at: string;
      }>(urlRes);

      const uploadRes = await fetch(urlData.upload_url, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
      });

      if (!uploadRes.ok) {
        throw new Error('Failed to upload file');
      }

      const confirmRes = await rpc.spaces[':spaceId'].storage['confirm-upload'].$post({
        param: { spaceId: currentSpaceId },
        json: { file_id: urlData.file_id },
      });

      if (!confirmRes.ok) {
        const data = await rpcJson<{ error: string }>(confirmRes);
        throw new Error(data.error || 'Failed to confirm upload');
      }

      const confirmData = await rpcJson<{ file: StorageFile }>(confirmRes);
      await loadFiles(currentPath());
      return confirmData.file;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to upload file'));
      return null;
    }
  };

  const deleteItem = async (fileId: string): Promise<boolean> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) return false;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage[':fileId'].$delete({
        param: { spaceId: currentSpaceId, fileId },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to delete');
      }

      await loadFiles(currentPath());
      return true;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete'));
      return false;
    }
  };

  const deleteItems = async (fileIds: string[]): Promise<boolean> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId || fileIds.length === 0) return false;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage['bulk-delete'].$post({
        param: { spaceId: currentSpaceId },
        json: { file_ids: fileIds },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to delete');
      }

      await loadFiles(currentPath());
      return true;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete'));
      return false;
    }
  };

  const renameItem = async (fileId: string, name: string): Promise<StorageFile | null> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) return null;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage[':fileId'].$patch({
        param: { spaceId: currentSpaceId, fileId },
        json: { name },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to rename');
      }

      const data = await rpcJson<{ file: StorageFile }>(res);
      await loadFiles(currentPath());
      return data.file;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to rename'));
      return null;
    }
  };

  const moveItem = async (fileId: string, parentPath: string): Promise<StorageFile | null> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) return null;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage[':fileId'].$patch({
        param: { spaceId: currentSpaceId, fileId },
        json: { parent_path: parentPath },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to move');
      }

      const data = await rpcJson<{ file: StorageFile }>(res);
      await loadFiles(currentPath());
      return data.file;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to move'));
      return null;
    }
  };

  const bulkMoveItems = async (fileIds: string[], parentPath: string): Promise<boolean> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId || fileIds.length === 0) return false;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage['bulk-move'].$post({
        param: { spaceId: currentSpaceId },
        json: { file_ids: fileIds, parent_path: parentPath },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to move');
      }

      await loadFiles(currentPath());
      return true;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to move'));
      return false;
    }
  };

  const bulkRenameItems = async (renames: Array<{ file_id: string; name: string }>): Promise<boolean> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId || renames.length === 0) return false;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage['bulk-rename'].$post({
        param: { spaceId: currentSpaceId },
        json: { renames },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to rename');
      }

      await loadFiles(currentPath());
      return true;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to rename'));
      return false;
    }
  };

  const getDownloadUrl = async (fileId: string): Promise<string | null> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) return null;

    try {
      const res = await rpc.spaces[':spaceId'].storage['download-url'].$get({
        param: { spaceId: currentSpaceId },
        query: { file_id: fileId },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to get download URL');
      }

      const data = await rpcJson<{ download_url: string }>(res);
      return data.download_url;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to get download URL'));
      return null;
    }
  };

  const downloadFolderZip = async (path: string): Promise<RpcResponse | null> => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) return null;

    try {
      const res = await rpc.spaces[':spaceId'].storage['download-zip'].$get({
        param: { spaceId: currentSpaceId },
        query: { path },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Failed to download ZIP');
      }

      return res;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to download ZIP'));
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
