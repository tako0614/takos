import { useState, useCallback, useRef } from 'react';
import type { StorageFile } from '../types';
import { rpc, rpcJson } from '../lib/rpc';
import { getErrorMessage } from '@takos/common/errors';

interface UseSpaceStorageReturn {
  files: StorageFile[];
  currentPath: string;
  loading: boolean;
  error: string | null;
  truncated: boolean;
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
  downloadFolderZip: (path: string) => Promise<Response | null>;
}

export function useSpaceStorage(spaceId: string): UseSpaceStorageReturn {
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  // Monotonic counter to prevent stale loadFiles responses from overwriting newer ones
  const loadVersionRef = useRef(0);

  const loadFiles = useCallback(async (path = '/') => {
    if (!spaceId) return;

    const version = ++loadVersionRef.current;
    setLoading(true);
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage.$get({
        param: { spaceId: spaceId },
        query: { path },
      });

      // Discard result if a newer loadFiles was called while this was in flight
      if (version !== loadVersionRef.current) return;

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to load files');
      }

      const data = await rpcJson<{ files: StorageFile[]; path: string; truncated?: boolean }>(res);
      setFiles(data.files || []);
      setCurrentPath(data.path || path);
      setTruncated(data.truncated ?? false);
    } catch (err) {
      if (version !== loadVersionRef.current) return;
      setError(getErrorMessage(err, 'Failed to load files'));
      setFiles([]);
      setCurrentPath(path);
      setTruncated(false);
    } finally {
      if (version === loadVersionRef.current) {
        setLoading(false);
      }
    }
  }, [spaceId]);

  const createFolder = useCallback(async (name: string): Promise<StorageFile | null> => {
    if (!spaceId) return null;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage.folders.$post({
        param: { spaceId: spaceId },
        json: { name, parent_path: currentPath },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to create folder');
      }

      const data = await rpcJson<{ folder: StorageFile }>(res);
      await loadFiles(currentPath);
      return data.folder;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create folder'));
      return null;
    }
  }, [spaceId, currentPath, loadFiles]);

  const uploadFile = useCallback(async (file: File): Promise<StorageFile | null> => {
    if (!spaceId) return null;
    setError(null);

    try {
      const urlRes = await rpc.spaces[':spaceId'].storage['upload-url'].$post({
        param: { spaceId: spaceId },
        json: {
          name: file.name,
          parent_path: currentPath,
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
        param: { spaceId: spaceId },
        json: { file_id: urlData.file_id },
      });

      if (!confirmRes.ok) {
        const data = await rpcJson<{ error: string }>(confirmRes);
        throw new Error(data.error || 'Failed to confirm upload');
      }

      const confirmData = await rpcJson<{ file: StorageFile }>(confirmRes);
      await loadFiles(currentPath);
      return confirmData.file;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to upload file'));
      return null;
    }
  }, [spaceId, currentPath, loadFiles]);

  const deleteItem = useCallback(async (fileId: string): Promise<boolean> => {
    if (!spaceId) return false;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage[':fileId'].$delete({
        param: { spaceId: spaceId, fileId },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to delete');
      }

      await loadFiles(currentPath);
      return true;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete'));
      return false;
    }
  }, [spaceId, currentPath, loadFiles]);

  const deleteItems = useCallback(async (fileIds: string[]): Promise<boolean> => {
    if (!spaceId || fileIds.length === 0) return false;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage['bulk-delete'].$post({
        param: { spaceId: spaceId },
        json: { file_ids: fileIds },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to delete');
      }

      await loadFiles(currentPath);
      return true;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete'));
      return false;
    }
  }, [spaceId, currentPath, loadFiles]);

  const renameItem = useCallback(async (fileId: string, name: string): Promise<StorageFile | null> => {
    if (!spaceId) return null;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage[':fileId'].$patch({
        param: { spaceId: spaceId, fileId },
        json: { name },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to rename');
      }

      const data = await rpcJson<{ file: StorageFile }>(res);
      await loadFiles(currentPath);
      return data.file;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to rename'));
      return null;
    }
  }, [spaceId, currentPath, loadFiles]);

  const moveItem = useCallback(async (fileId: string, parentPath: string): Promise<StorageFile | null> => {
    if (!spaceId) return null;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage[':fileId'].$patch({
        param: { spaceId: spaceId, fileId },
        json: { parent_path: parentPath },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to move');
      }

      const data = await rpcJson<{ file: StorageFile }>(res);
      await loadFiles(currentPath);
      return data.file;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to move'));
      return null;
    }
  }, [spaceId, currentPath, loadFiles]);

  const bulkMoveItems = useCallback(async (fileIds: string[], parentPath: string): Promise<boolean> => {
    if (!spaceId || fileIds.length === 0) return false;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage['bulk-move'].$post({
        param: { spaceId: spaceId },
        json: { file_ids: fileIds, parent_path: parentPath },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to move');
      }

      await loadFiles(currentPath);
      return true;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to move'));
      return false;
    }
  }, [spaceId, currentPath, loadFiles]);

  const bulkRenameItems = useCallback(async (renames: Array<{ file_id: string; name: string }>): Promise<boolean> => {
    if (!spaceId || renames.length === 0) return false;
    setError(null);

    try {
      const res = await rpc.spaces[':spaceId'].storage['bulk-rename'].$post({
        param: { spaceId: spaceId },
        json: { renames },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error: string }>(res);
        throw new Error(data.error || 'Failed to rename');
      }

      await loadFiles(currentPath);
      return true;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to rename'));
      return false;
    }
  }, [spaceId, currentPath, loadFiles]);

  const getDownloadUrl = useCallback(async (fileId: string): Promise<string | null> => {
    if (!spaceId) return null;

    try {
      const res = await rpc.spaces[':spaceId'].storage['download-url'].$get({
        param: { spaceId: spaceId },
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
  }, [spaceId]);

  const downloadFolderZip = useCallback(async (path: string): Promise<Response | null> => {
    if (!spaceId) return null;

    try {
      const res = await rpc.spaces[':spaceId'].storage['download-zip'].$get({
        param: { spaceId: spaceId },
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
  }, [spaceId]);

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
