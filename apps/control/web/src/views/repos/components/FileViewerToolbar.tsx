import { Icons } from '../../../lib/Icons';
import { formatFileSize } from '../../../lib/format';
import { useI18n } from '../../../store/i18n';

interface FileViewerToolbarProps {
  filePath: string;
  fileSize: number;
  canShowTextTools: boolean;
  blameEnabled: boolean;
  blameLoading: boolean;
  copied: boolean;
  onBack: () => void;
  onToggleBlame: () => void;
  onOpenHistory: () => void;
  onCopy: () => void;
  onDownload: () => void;
}

export function FileViewerToolbar({
  filePath,
  fileSize,
  canShowTextTools,
  blameEnabled,
  blameLoading,
  copied,
  onBack,
  onToggleBlame,
  onOpenHistory,
  onCopy,
  onDownload,
}: FileViewerToolbarProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
      <div className="flex items-center gap-3 min-w-0">
        <button
          className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex-shrink-0"
          onClick={onBack}
          aria-label={t('goBack')}
        >
          <Icons.ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <Icons.File className="w-4 h-4 text-zinc-500 dark:text-zinc-400 flex-shrink-0" />
          <span className="text-zinc-900 dark:text-zinc-100 truncate">{filePath}</span>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">{formatFileSize(fileSize)}</span>
        {canShowTextTools && (
          <>
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm transition-colors ${
                blameEnabled
                  ? 'bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-800'
                  : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
              onClick={onToggleBlame}
              disabled={blameLoading}
              title={t('toggleBlame')}
            >
              <Icons.User className="w-4 h-4" />
              <span>{blameLoading ? t('blameLoading') : t('blame')}</span>
            </button>

            <button
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              onClick={onOpenHistory}
              title={t('fileHistory')}
            >
              <Icons.Clock className="w-4 h-4" />
              <span>{t('history')}</span>
            </button>
          </>
        )}
        {canShowTextTools && (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={onCopy}
          >
            {copied ? <Icons.Check className="w-4 h-4 text-zinc-900 dark:text-zinc-100" /> : <Icons.Copy className="w-4 h-4" />}
            <span>{copied ? t('copied') : t('copy')}</span>
          </button>
        )}
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={onDownload}
        >
          <Icons.Download className="w-4 h-4" />
          <span>{t('download')}</span>
        </button>
      </div>
    </div>
  );
}
