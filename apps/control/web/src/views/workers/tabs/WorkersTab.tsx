import { useI18n } from '../../../providers/I18nProvider';
import { Icons } from '../../../lib/Icons';
import type { Worker } from '../../../types';
import {
  getWorkerDisplayHostname,
  getWorkerDisplayName,
  getWorkerStatusBgClass,
  getWorkerUrl,
} from '../utils/workerUtils';

export interface WorkersTabProps {
  workers: Worker[];
  loading: boolean;
  onSelectWorker: (worker: Worker) => void;
}

export function WorkersTab({
  workers,
  loading,
  onSelectWorker,
}: WorkersTabProps) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
        <span className="text-sm text-zinc-400">{t('loading')}</span>
      </div>
    );
  }

  if (!workers || workers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
          <Icons.Server className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{t('noWorkers')}</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">{t('useAgentToCreateWorker')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {workers.map((worker) => {
        const workerName = getWorkerDisplayName(worker);
        const hostname = getWorkerDisplayHostname(worker);
        const workerUrl = getWorkerUrl(worker);

        return (
          <div
            key={worker.id}
            className="group relative flex items-start gap-4 p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 transition-all duration-200 cursor-pointer hover:border-zinc-200 dark:hover:border-zinc-700 hover:shadow-sm"
            onClick={() => onSelectWorker(worker)}
          >
            <div className="w-12 h-12 rounded-xl bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-800 dark:to-zinc-900 flex items-center justify-center text-zinc-500 dark:text-zinc-400 shrink-0">
              <Icons.Server className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0 py-0.5">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{workerName}</h3>
                <span className={`w-2 h-2 rounded-full shrink-0 ${getWorkerStatusBgClass(worker.status)}`} />
              </div>
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                <Icons.Globe className="w-3.5 h-3.5" />
                <span className="truncate">{hostname}</span>
              </div>
            </div>
            {workerUrl && (
              <button
                className="absolute top-3 right-3 p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(workerUrl, '_blank', 'noopener,noreferrer');
                }}
                title={t('open')}
              >
                <Icons.ExternalLink className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
