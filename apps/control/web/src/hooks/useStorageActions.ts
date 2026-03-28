import { useState, useCallback } from 'react';
import { useI18n } from '../store/i18n';
import { useToast } from '../store/toast';
import { useConfirmDialog } from '../store/confirm-dialog';
import type { StorageFile } from '../types';

interface UseStorageActionsParams {
  getDownloadUrl: (fileId: string) => Promise<string | null>;
  downloadFolderZip: (path: string) => Promise<Response | null>;
  deleteItem: (id: string) => Promise<boolean>;
  renameItem: (id: string, name: string) => Promise<unknown>;
  currentPath: string;
  setSelectedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
}

interface UseStorageActionsResult {
  // File viewer
  viewingFile: StorageFile | null;
  viewingFileDownloadUrl: string | null;
  handleOpenFile: (file: StorageFile) => Promise<void>;
  handleCloseViewer: () => void;
  // Download
  handleDownload: (file: StorageFile) => Promise<void>;
  downloadingZip: boolean;
  downloadedZipBytes: number;
  handleDownloadZip: () => Promise<void>;
  // Delete
  handleDelete: (file: StorageFile) => Promise<void>;
  // Rename
  showRenameModal: boolean;
  renameTarget: StorageFile | null;
  newName: string;
  setNewName: React.Dispatch<React.SetStateAction<string>>;
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
  const [viewingFile, setViewingFile] = useState<StorageFile | null>(null);
  const [viewingFileDownloadUrl, setViewingFileDownloadUrl] = useState<string | null>(null);

  // Rename state
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<StorageFile | null>(null);
  const [newName, setNewName] = useState('');

  // Zip download state
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadedZipBytes, setDownloadedZipBytes] = useState(0);

  const handleOpenFile = useCallback(async (file: StorageFile) => {
    if (file.type === 'folder') return;
    const url = await getDownloadUrl(file.id);
    setViewingFileDownloadUrl(url);
    setViewingFile(file);
  }, [getDownloadUrl]);

  const handleCloseViewer = useCallback(() => {
    setViewingFile(null);
    setViewingFileDownloadUrl(null);
  }, []);

  const handleDownload = useCallback(async (file: StorageFile) => {
    const url = await getDownloadUrl(file.id);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      showToast('error', t('failedToGetDownloadUrl'));
    }
  }, [getDownloadUrl, showToast, t]);

  const handleDownloadZip = useCallback(async () => {
    if (downloadingZip) return;
    setDownloadingZip(true);
    setDownloadedZipBytes(0);

    try {
      const res = await downloadFolderZip(currentPath);
      if (!res) {
        showToast('error', t('failedToGetDownloadUrl') || 'Failed to download');
        return;
      }

      const folderName = currentPath === '/'
        ? 'workspace'
        : currentPath.split('/').filter(Boolean).pop() || 'folder';
      const filename = `${folderName}.zip`;

      const blob = await res.blob();
      setDownloadedZipBytes(blob.size);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('success', t('download') || 'Download');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : (t('failedToLoad') || 'Failed'));
    } finally {
      setDownloadingZip(false);
    }
  }, [currentPath, downloadFolderZip, downloadingZip, showToast, t]);

  const handleDelete = useCallback(async (file: StorageFile) => {
    const confirmed = await confirm({
      title: t('deleteConfirmTitle'),
      message: file.type === 'folder'
        ? t('deleteFolderConfirm').replace('{name}', file.name)
        : t('deleteFileConfirm').replace('{name}', file.name),
      confirmText: t('delete'),
      danger: true,
    });

    if (!confirmed) return;

    const result = await deleteItem(file.id);
    if (result) {
      showToast('success', t('itemDeleted').replace('{name}', file.name));
      setSelectedFiles(prev => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
    } else {
      showToast('error', t('failedToDelete'));
    }
  }, [confirm, deleteItem, showToast, t, setSelectedFiles]);

  const openRenameModal = useCallback((file: StorageFile) => {
    setRenameTarget(file);
    setNewName(file.name);
    setShowRenameModal(true);
  }, []);

  const closeRenameModal = useCallback(() => {
    setShowRenameModal(false);
    setRenameTarget(null);
    setNewName('');
  }, []);

  const handleRename = useCallback(async () => {
    if (!renameTarget || !newName.trim()) return;

    const result = await renameItem(renameTarget.id, newName.trim());
    if (result) {
      showToast('success', t('renamedTo').replace('{name}', newName));
      setShowRenameModal(false);
      setRenameTarget(null);
      setNewName('');
    } else {
      showToast('error', t('failedToRename'));
    }
  }, [renameTarget, newName, renameItem, showToast, t]);

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
