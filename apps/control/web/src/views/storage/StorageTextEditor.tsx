import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { useI18n } from '../../store/i18n';
import { useToast } from '../../store/toast';
import { useFileContent } from '../../hooks/useFileContent';
import { detectLanguage } from '../../lib/languageMap';
import { Icons } from '../../lib/Icons';
import { Button } from '../../components/ui/Button';
import type { StorageFile } from '../../types';
import type { ResolvedHandler } from './storageUtils';
import { StorageViewerShell } from './StorageViewerShell';
import { StorageEmptyState } from './StorageEmptyState';

const MonacoEditor = lazy(() => import('../../lib/MonacoEditor'));

export function StorageTextEditor({
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
    <StorageViewerShell
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
        <StorageEmptyState file={file} downloadUrl={downloadUrl} t={t} label={t('binaryFile')} />
      ) : (
        <StorageEmptyState file={file} downloadUrl={downloadUrl} t={t} />
      )}
    </StorageViewerShell>
  );
}
