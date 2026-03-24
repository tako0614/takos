import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { useI18n } from '../../providers/I18nProvider';
import { useToast } from '../../hooks/useToast';
import { useFileContent } from '../../hooks/useFileContent';
import { detectLanguage } from '../../lib/languageMap';
import { formatFileSize, formatDateTime } from '../../lib/format';
import { Icons } from '../../lib/Icons';
import { Button } from '../../components/ui/Button';
import type { StorageFile } from '../../types';
import type { FileHandler, ResolvedHandler } from './storageUtils';
import {
  BUILTIN_TEXT_EDITOR,
  BUILTIN_IMAGE_VIEWER,
  resolveHandlers,
  getDefaultHandler,
  setDefaultHandler,
  clearDefaultHandler,
  handlerDisplayName,
} from './storageUtils';

const MonacoEditor = lazy(() => import('../../lib/MonacoEditor'));

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
  const { showToast } = useToast();

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
      <HandlerPicker
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
      <ViewerShell
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
          <EmptyState file={file} downloadUrl={downloadUrl} t={t} />
        )}
      </ViewerShell>
    );
  }

  // Default: built-in text editor
  return (
    <TextEditorViewer
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

// ── Built-in text editor ──

function TextEditorViewer({
  spaceId,
  file,
  downloadUrl,
  allHandlers,
  activeHandler,
  showHandlerMenu,
  setShowHandlerMenu,
  onSelectHandler,
  onClearDefault,
  onClose,
  onSave,
}: {
  spaceId: string;
  file: StorageFile;
  downloadUrl: string | null;
  allHandlers: ResolvedHandler[];
  activeHandler: ResolvedHandler;
  showHandlerMenu: boolean;
  setShowHandlerMenu: (v: boolean) => void;
  onSelectHandler: (h: ResolvedHandler, asDefault: boolean) => void;
  onClearDefault: () => void;
  onClose: () => void;
  onSave?: () => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { content, encoding, loading, error, saving, loadContent, saveContent } = useFileContent(spaceId);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const editorRef = useRef<unknown>(null);

  useEffect(() => {
    loadContent(file.id);
  }, [file.id, loadContent]);

  useEffect(() => {
    if (content !== null) {
      setEditedContent(content);
      setIsDirty(false);
    }
  }, [content]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setEditedContent(value);
      setIsDirty(value !== content);
    }
  }, [content]);

  const handleSave = useCallback(async () => {
    if (!isDirty || editedContent === null) return;
    const success = await saveContent(file.id, editedContent);
    if (success) {
      setIsDirty(false);
      showToast('success', t('saved') || 'Saved');
      onSave?.();
    }
  }, [isDirty, editedContent, file.id, saveContent, showToast, t, onSave]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  const language = detectLanguage(file.name);
  const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

  const extraButtons = isDirty ? (
    <Button
      variant="primary"
      size="sm"
      onClick={handleSave}
      isLoading={saving}
      leftIcon={<Icons.Save className="w-4 h-4" />}
    >
      {t('save') || 'Save'}
    </Button>
  ) : null;

  return (
    <ViewerShell
      file={file}
      downloadUrl={downloadUrl}
      allHandlers={allHandlers}
      activeHandler={activeHandler}
      showHandlerMenu={showHandlerMenu}
      setShowHandlerMenu={setShowHandlerMenu}
      onSelectHandler={onSelectHandler}
      onClearDefault={onClearDefault}
      onClose={onClose}
      t={t}
      extraButtons={extraButtons}
    >
      {loading ? (
        <div className="flex items-center justify-center h-full">
          <Icons.Loader className="w-8 h-8 animate-spin text-zinc-500" />
        </div>
      ) : error ? (
        <div className="p-4 m-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">
          {error}
        </div>
      ) : encoding === 'utf-8' && editedContent !== null ? (
        <Suspense fallback={
          <div className="flex items-center justify-center h-full">
            <Icons.Loader className="w-8 h-8 animate-spin text-zinc-500" />
          </div>
        }>
          <MonacoEditor
            height="100%"
            language={language}
            theme={prefersDark ? 'vs-dark' : 'vs'}
            value={editedContent}
            onChange={handleEditorChange}
            onMount={(editor) => { editorRef.current = editor; }}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
            }}
          />
        </Suspense>
      ) : encoding === 'base64' ? (
        <EmptyState file={file} downloadUrl={downloadUrl} t={t} label={t('binaryFile')} />
      ) : (
        <EmptyState file={file} downloadUrl={downloadUrl} t={t} />
      )}
    </ViewerShell>
  );
}

// ── Viewer shell (header + handler switch) ──

function ViewerShell({
  file,
  downloadUrl,
  allHandlers,
  activeHandler,
  showHandlerMenu,
  setShowHandlerMenu,
  onSelectHandler,
  onClearDefault,
  onClose,
  t,
  extraButtons,
  children,
}: {
  file: StorageFile;
  downloadUrl: string | null;
  allHandlers: ResolvedHandler[];
  activeHandler: ResolvedHandler;
  showHandlerMenu: boolean;
  setShowHandlerMenu: (v: boolean) => void;
  onSelectHandler: (h: ResolvedHandler, asDefault: boolean) => void;
  onClearDefault: () => void;
  onClose: () => void;
  t: (key: string) => string;
  extraButtons?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hasAlternatives = allHandlers.length > 1;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title={t('back')}
          >
            <Icons.ArrowLeft className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </button>
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
              {file.name}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {file.path} &middot; {formatFileSize(file.size)} &middot; {formatDateTime(file.updated_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {extraButtons}

          {/* Handler switcher */}
          {hasAlternatives && (
            <div className="relative">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowHandlerMenu(!showHandlerMenu)}
              >
                {handlerDisplayName(activeHandler, t)}
                <Icons.ChevronDown className="w-3 h-3 ml-1" />
              </Button>
              {showHandlerMenu && (
                <HandlerDropdown
                  handlers={allHandlers}
                  activeHandler={activeHandler}
                  onSelect={(h) => onSelectHandler(h, false)}
                  onSetDefault={(h) => onSelectHandler(h, true)}
                  onClearDefault={onClearDefault}
                  onClose={() => setShowHandlerMenu(false)}
                  t={t}
                />
              )}
            </div>
          )}

          {downloadUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(downloadUrl, '_blank', 'noopener,noreferrer')}
              leftIcon={<Icons.Download className="w-4 h-4" />}
            >
              {t('download')}
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

// ── Handler picker (shown when no default and multiple handlers) ──

function HandlerPicker({
  file,
  downloadUrl,
  handlers,
  onSelect,
  onClose,
  t,
}: {
  file: StorageFile;
  downloadUrl: string | null;
  handlers: ResolvedHandler[];
  onSelect: (h: ResolvedHandler, asDefault: boolean) => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center gap-3">
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title={t('back')}
        >
          <Icons.ArrowLeft className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
        </button>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {file.name}
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
            {file.path} &middot; {formatFileSize(file.size)} &middot; {formatDateTime(file.updated_at)}
          </p>
        </div>
      </div>

      {/* Picker */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-4 text-center">
            {t('openWith') || 'Open with...'}
          </p>
          <div className="space-y-2">
            {handlers.map((h, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  onClick={() => onSelect(h, false)}
                  className="flex-1 text-left px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {handlerDisplayName(h, t)}
                  </span>
                  {h.type === 'builtin' && (
                    <span className="ml-2 text-xs text-zinc-400">{t('builtin') || 'Built-in'}</span>
                  )}
                </button>
                <button
                  onClick={() => onSelect(h, true)}
                  className="px-3 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-xs text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 whitespace-nowrap"
                  title={t('setAsDefault') || 'Set as default'}
                >
                  {t('setAsDefault') || 'Set as default'}
                </button>
              </div>
            ))}
          </div>
          {downloadUrl && (
            <div className="mt-4 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(downloadUrl, '_blank', 'noopener,noreferrer')}
                leftIcon={<Icons.Download className="w-4 h-4" />}
              >
                {t('download')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Handler dropdown menu ──

function HandlerDropdown({
  handlers,
  activeHandler,
  onSelect,
  onSetDefault,
  onClearDefault,
  onClose,
  t,
}: {
  handlers: ResolvedHandler[];
  activeHandler: ResolvedHandler;
  onSelect: (h: ResolvedHandler) => void;
  onSetDefault: (h: ResolvedHandler) => void;
  onClearDefault: () => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-handler-dropdown]')) onClose();
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [onClose]);

  return (
    <div
      data-handler-dropdown
      className="absolute right-0 top-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 z-20 min-w-[220px]"
    >
      <div className="px-3 py-1.5 text-xs text-zinc-400 uppercase tracking-wider">
        {t('openWith') || 'Open with'}
      </div>
      {handlers.map((h, i) => {
        const isActive = h.type === activeHandler.type &&
          (h.type === 'builtin'
            ? h.builtinId === (activeHandler as typeof h).builtinId
            : h.handler.id === (activeHandler as typeof h).handler.id);
        return (
          <div key={i} className="flex items-center group">
            <button
              onClick={() => onSelect(h)}
              className={
                'flex-1 text-left px-3 py-2 text-sm transition-colors ' +
                (isActive
                  ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700')
              }
            >
              {handlerDisplayName(h, t)}
              {h.type === 'builtin' && (
                <span className="ml-1 text-xs text-zinc-400">{t('builtin') || 'Built-in'}</span>
              )}
            </button>
            <button
              onClick={() => onSetDefault(h)}
              className="px-2 py-2 text-xs text-zinc-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"
              title={t('setAsDefault') || 'Set as default'}
            >
              <Icons.Star className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
      <div className="border-t border-zinc-200 dark:border-zinc-700 mt-1 pt-1">
        <button
          onClick={onClearDefault}
          className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
        >
          {t('clearDefault') || 'Clear default'}
        </button>
      </div>
    </div>
  );
}

// ── Empty / binary state ──

function EmptyState({
  file,
  downloadUrl,
  t,
  label,
}: {
  file: StorageFile;
  downloadUrl: string | null;
  t: (key: string) => string;
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-zinc-500 dark:text-zinc-400 gap-4">
      <Icons.File className="w-16 h-16 opacity-50" />
      <p className="text-lg font-medium">{label || file.name}</p>
      <p className="text-sm">{formatFileSize(file.size)} &middot; {file.mime_type || t('unknownType')}</p>
      {downloadUrl && (
        <Button
          variant="primary"
          onClick={() => window.open(downloadUrl, '_blank', 'noopener,noreferrer')}
          leftIcon={<Icons.Download className="w-4 h-4" />}
        >
          {t('download')}
        </Button>
      )}
    </div>
  );
}
