import { useState, useCallback } from 'react';
import { useI18n } from '../../store/i18n';
import type { StorageFile } from '../../types';
import type { FileHandler, ResolvedHandler } from './storageUtils';
import {
  BUILTIN_IMAGE_VIEWER,
  resolveHandlers,
  getDefaultHandler,
  setDefaultHandler,
  clearDefaultHandler,
} from './storageUtils';
import { StorageHandlerPicker } from './StorageHandlerPicker';
import { StorageViewerShell } from './StorageViewerShell';
import { StorageTextEditor } from './StorageTextEditor';
import { StorageEmptyState } from './StorageEmptyState';

interface StorageFileViewerProps {
  spaceId: string;
  file: StorageFile;
  downloadUrl: string | null;
  fileHandlers: FileHandler[];
  onClose: () => void;
  onSave?: () => void;
}

export function StorageFileViewer({
  spaceId,
  file,
  downloadUrl,
  fileHandlers,
  onClose,
  onSave,
}: StorageFileViewerProps) {
  const { t } = useI18n();

  // Resolve all available handlers for this file
  const allHandlers = resolveHandlers(file, fileHandlers);
  const savedDefault = getDefaultHandler(file, allHandlers);

  // Active handler state: use saved default, or show picker if multiple
  const [activeHandler, setActiveHandler] = useState<ResolvedHandler | null>(() => {
    if (savedDefault) return savedDefault;
    if (allHandlers.length === 1) return allHandlers[0];
    return null; // show picker
  });
  const [showHandlerMenu, setShowHandlerMenu] = useState(false);

  const handleSelectHandler = useCallback((h: ResolvedHandler, asDefault: boolean) => {
    if (asDefault) {
      setDefaultHandler(file, h);
    }
    if (h.type === 'app') {
      const url = `${h.handler.open_url}?file_id=${encodeURIComponent(file.id)}&space_id=${encodeURIComponent(file.space_id)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      setActiveHandler(h);
    }
    setShowHandlerMenu(false);
  }, [file]);

  const handleClearDefault = useCallback(() => {
    clearDefaultHandler(file);
    setActiveHandler(null);
    setShowHandlerMenu(false);
  }, [file]);

  // If active handler is an app handler, it was already opened in a new window.
  // Show builtin viewer or picker.

  if (!activeHandler) {
    return (
      <StorageHandlerPicker
        file={file}
        downloadUrl={downloadUrl}
        handlers={allHandlers}
        onSelect={handleSelectHandler}
        onClose={onClose}
        t={t}
      />
    );
  }

  if (activeHandler.type === 'builtin' && activeHandler.builtinId === BUILTIN_IMAGE_VIEWER) {
    return (
      <StorageViewerShell
        file={file}
        downloadUrl={downloadUrl}
        allHandlers={allHandlers}
        activeHandler={activeHandler}
        showHandlerMenu={showHandlerMenu}
        setShowHandlerMenu={setShowHandlerMenu}
        onSelectHandler={handleSelectHandler}
        onClearDefault={handleClearDefault}
        onClose={onClose}
        t={t}
      >
        {downloadUrl ? (
          <div className="flex items-center justify-center h-full p-8">
            <img
              src={downloadUrl}
              alt={file.name}
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          </div>
        ) : (
          <StorageEmptyState file={file} downloadUrl={downloadUrl} t={t} />
        )}
      </StorageViewerShell>
    );
  }

  // Default: built-in text editor
  return (
    <StorageTextEditor
      spaceId={spaceId}
      file={file}
      downloadUrl={downloadUrl}
      allHandlers={allHandlers}
      activeHandler={activeHandler}
      showHandlerMenu={showHandlerMenu}
      setShowHandlerMenu={setShowHandlerMenu}
      onSelectHandler={handleSelectHandler}
      onClearDefault={handleClearDefault}
      onClose={onClose}
      onSave={onSave}
    />
  );
}
