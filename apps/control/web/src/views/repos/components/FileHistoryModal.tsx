import { Icons } from '../../../lib/Icons';
import { formatDateTime } from '../../../lib/format';
import { Modal } from '../../../components/ui/Modal';
import { useI18n } from '../../../store/i18n';

export type FileHistoryCommit = {
  sha: string;
  message: string;
  author: { name: string; email: string };
  date: string;
  status: 'added' | 'modified' | 'deleted';
};

export type FileHistoryResponse = {
  path: string;
  ref: string;
  commits: FileHistoryCommit[];
};

interface FileHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  branch: string;
  loading: boolean;
  error: string | null;
  data: FileHistoryResponse | null;
}

export function FileHistoryModal({
  isOpen,
  onClose,
  filePath,
  branch,
  loading,
  error,
  data,
}: FileHistoryModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={t('fileHistoryTitle')}
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="text-sm text-zinc-500 dark:text-zinc-400">{t('path')}</div>
          <div className="font-mono text-sm text-zinc-900 dark:text-zinc-100 truncate">{filePath}</div>
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 flex-shrink-0">
          {t('ref')}: <span className="font-mono">{branch}</span>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-10 text-zinc-500">
          <div className="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
          <span className="mt-3">{t('loadingHistory')}</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-10 text-zinc-500">
          <Icons.AlertTriangle className="w-10 h-10 text-zinc-700 dark:text-zinc-300" />
          <span className="mt-3 text-zinc-700 dark:text-zinc-300">{error}</span>
        </div>
      ) : (data?.commits?.length ?? 0) === 0 ? (
        <div className="text-zinc-500 text-sm">{t('noHistoryEntries')}</div>
      ) : (
        <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {(data?.commits || []).map((cmt) => (
            <div key={cmt.sha} className="py-3 flex items-start gap-3">
              <div
                className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                  cmt.status === 'added'
                    ? 'bg-green-500'
                    : cmt.status === 'deleted'
                      ? 'bg-red-500'
                      : 'bg-blue-500'
                }`}
                title={cmt.status}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400">
                    {cmt.sha.slice(0, 7)}
                  </span>
                  <span className="text-sm text-zinc-900 dark:text-zinc-100 truncate">{cmt.message}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2 flex-wrap">
                  <span className="truncate">{cmt.author.name}</span>
                  <span className="text-zinc-300 dark:text-zinc-600">|</span>
                  <span>{formatDateTime(cmt.date)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
