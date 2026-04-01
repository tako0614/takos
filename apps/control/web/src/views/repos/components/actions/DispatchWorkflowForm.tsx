import { Show } from 'solid-js';
import type { Setter } from 'solid-js';
import { Icons } from '../../../../lib/Icons.tsx';
import { useI18n } from '../../../../store/i18n.ts';

interface DispatchWorkflowFormProps {
  workflowPath: string;
  setWorkflowPath: Setter<string>;
  workflowRef: string;
  setWorkflowRef: Setter<string>;
  workflowInputs: string;
  setWorkflowInputs: Setter<string>;
  dispatching: boolean;
  onDispatch: () => void;
}

export function DispatchWorkflowForm(props: DispatchWorkflowFormProps) {
  const { t } = useI18n();

  return (
    <div class="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-3">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-zinc-500 dark:text-zinc-400">{t('workflowPathLabel')}</label>
          <input
            value={props.workflowPath}
            onInput={(e) => props.setWorkflowPath(e.currentTarget.value)}
            placeholder=".takos/workflows/ci.yml"
            class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          />
        </div>
        <div>
          <label class="text-xs text-zinc-500 dark:text-zinc-400">{t('refBranchOrTag')}</label>
          <input
            value={props.workflowRef}
            onInput={(e) => props.setWorkflowRef(e.currentTarget.value)}
            placeholder="main"
            class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          />
        </div>
      </div>
      <div>
        <label class="text-xs text-zinc-500 dark:text-zinc-400">{t('inputJson')}</label>
        <textarea
          value={props.workflowInputs}
          onInput={(e) => props.setWorkflowInputs(e.currentTarget.value)}
          placeholder='{"environment":"production"}'
          rows={3}
          class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 font-mono"
        />
      </div>
      <div class="flex justify-end">
        <button type="button"
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-700 text-white hover:bg-zinc-700 dark:hover:bg-zinc-600 transition-colors disabled:opacity-60"
          onClick={props.onDispatch}
          disabled={props.dispatching}
        >
          <Show when={props.dispatching} fallback={
            <>
              <Icons.Play class="w-4 h-4" />
              <span>{t('dispatch')}</span>
            </>
          }>
            <span>{t('dispatching')}</span>
          </Show>
        </button>
      </div>
    </div>
  );
}
