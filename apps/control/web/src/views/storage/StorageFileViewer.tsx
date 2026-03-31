import { createSignal, Show } from 'solid-js';
import { useI18n } from '../../store/i18n.ts';
import type { StorageFile } from '../../types/index.ts';
import type { FileHandler, ResolvedHandler } from './storageUtils.tsx';
import {
  BUILTIN_IMAGE_VIEWER,
  resolveHandlers,
  getDefaultHandler,
  setDefaultHandler,
  clearDefaultHandler,
} from './storageUtils.tsx';
import { StorageHandlerPicker } from './StorageHandlerPicker.tsx';
import { StorageViewerShell } from './StorageViewerShell.tsx';
import { StorageTextEditor } from './StorageTextEditor.tsx';
import { StorageEmptyState } from './StorageEmptyState.tsx';

interface StorageFileViewerProps {
  spaceId: string;
  file: StorageFile;
  downloadUrl: string | null;
  fileHandlers: FileHandler[];
  onClose: () => void;
  onSave?: () => void;
}

export function StorageFileViewer(props: StorageFileViewerProps) {
  const { t } = useI18n();

  // Resolve all available handlers for this file
  const allHandlers = resolveHandlers(props.file, props.fileHandlers);
  const savedDefault = getDefaultHandler(props.file, allHandlers);

  // Active handler state: use saved default, or show picker if multiple
  const [activeHandler, setActiveHandler] = createSignal<ResolvedHandler | null>(
    savedDefault ?? (allHandlers.length === 1 ? allHandlers[0] : null)
  );
  const [showHandlerMenu, setShowHandlerMenu] = createSignal(false);

  const handleSelectHandler = (h: ResolvedHandler, asDefault: boolean) => {
    if (asDefault) {
      setDefaultHandler(props.file, h);
    }
    if (h.type === 'app') {
      const url = `${h.handler.open_url}?file_id=${encodeURIComponent(props.file.id)}&space_id=${encodeURIComponent(props.file.space_id)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      setActiveHandler(h);
    }
    setShowHandlerMenu(false);
  };

  const handleClearDefault = () => {
    clearDefaultHandler(props.file);
    setActiveHandler(null);
    setShowHandlerMenu(false);
  };

  // If active handler is an app handler, it was already opened in a new window.
  // Show builtin viewer or picker.

  return (
    <Show when={activeHandler()} fallback={
      <StorageHandlerPicker
        file={props.file}
        downloadUrl={props.downloadUrl}
        handlers={allHandlers}
        onSelect={handleSelectHandler}
        onClose={props.onClose}
        t={t}
      />
    }>
      {(handler) => (
        <Show
          when={handler().type === 'builtin' && (handler() as { type: 'builtin'; builtinId: string }).builtinId === BUILTIN_IMAGE_VIEWER}
          fallback={
            <StorageTextEditor
              spaceId={props.spaceId}
              file={props.file}
              downloadUrl={props.downloadUrl}
              allHandlers={allHandlers}
              activeHandler={handler()}
              showHandlerMenu={showHandlerMenu()}
              setShowHandlerMenu={setShowHandlerMenu}
              onSelectHandler={handleSelectHandler}
              onClearDefault={handleClearDefault}
              onClose={props.onClose}
              onSave={props.onSave}
            />
          }
        >
          <StorageViewerShell
            file={props.file}
            downloadUrl={props.downloadUrl}
            allHandlers={allHandlers}
            activeHandler={handler()}
            showHandlerMenu={showHandlerMenu()}
            setShowHandlerMenu={setShowHandlerMenu}
            onSelectHandler={handleSelectHandler}
            onClearDefault={handleClearDefault}
            onClose={props.onClose}
            t={t}
          >
            <Show when={props.downloadUrl} fallback={
              <StorageEmptyState file={props.file} downloadUrl={props.downloadUrl} t={t} />
            }>
              <div class="flex items-center justify-center h-full p-8">
                <img
                  src={props.downloadUrl!}
                  alt={props.file.name}
                  class="max-w-full max-h-full object-contain rounded-lg"
                />
              </div>
            </Show>
          </StorageViewerShell>
        </Show>
      )}
    </Show>
  );
}
