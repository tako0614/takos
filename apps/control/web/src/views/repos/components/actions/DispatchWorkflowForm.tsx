import { Icons } from '../../../../lib/Icons';
import { useI18n } from '../../../../store/i18n';

interface DispatchWorkflowFormProps {
  workflowPath: string;
  setWorkflowPath: (value: string) => void;
  workflowRef: string;
  setWorkflowRef: (value: string) => void;
  workflowInputs: string;
  setWorkflowInputs: (value: string) => void;
  dispatching: boolean;
  onDispatch: () => void;
}

export function DispatchWorkflowForm({
  workflowPath,
  setWorkflowPath,
  workflowRef,
  setWorkflowRef,
  workflowInputs,
  setWorkflowInputs,
  dispatching,
  onDispatch,
}: DispatchWorkflowFormProps) {
  const { t } = useI18n();

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-500 dark:text-zinc-400">{t('workflowPathLabel')}</label>
          <input
            value={workflowPath}
            onChange={(e) => setWorkflowPath(e.target.value)}
            placeholder=".takos/workflows/ci.yml"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500 dark:text-zinc-400">{t('refBranchOrTag')}</label>
          <input
            value={workflowRef}
            onChange={(e) => setWorkflowRef(e.target.value)}
            placeholder="main"
            className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-zinc-500 dark:text-zinc-400">{t('inputJson')}</label>
        <textarea
          value={workflowInputs}
          onChange={(e) => setWorkflowInputs(e.target.value)}
          placeholder='{"environment":"production"}'
          rows={3}
          className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 font-mono"
        />
      </div>
      <div className="flex justify-end">
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-700 text-white hover:bg-zinc-700 dark:hover:bg-zinc-600 transition-colors disabled:opacity-60"
          onClick={onDispatch}
          disabled={dispatching}
        >
          {dispatching ? (
            <span>{t('dispatching')}</span>
          ) : (
            <>
              <Icons.Play className="w-4 h-4" />
              <span>{t('dispatch')}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
