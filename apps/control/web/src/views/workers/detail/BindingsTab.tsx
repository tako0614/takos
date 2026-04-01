import { useI18n } from '../../../store/i18n.ts';
import { Icons } from '../../../lib/Icons.tsx';
import type { Resource } from '../../../types/index.ts';
import type { Binding } from '../worker-models.ts';

interface BindingsTabProps {
  bindings: Binding[];
  resources: Resource[];
  onAddBinding: (resource: Resource) => void;
  onSaveBindings: () => void;
  savingWorkerSettings: boolean;
}

export function BindingsTab({
  bindings,
  resources,
  onAddBinding,
  onSaveBindings,
  savingWorkerSettings,
}: BindingsTabProps) {
  const { t } = useI18n();

  return (
    <div class="space-y-4">
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('bindingsHint')}</p>
      <div class="space-y-2">
        {bindings.length === 0 ? (
          <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('noBindings')}</p>
        ) : (
          bindings.map((binding, _index) => (
            <div class="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <div class="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                {binding.type === 'd1' && <Icons.Database class="w-4 h-4" />}
                {binding.type === 'r2_bucket' && <Icons.Bucket class="w-4 h-4" />}
                {binding.type === 'kv_namespace' && <Icons.Key class="w-4 h-4" />}
                {binding.type === 'service' && <Icons.Server class="w-4 h-4" />}
              </div>
              <div class="flex-1">
                <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100">{binding.name}</span>
                <span class="ml-2 text-xs text-zinc-500">{binding.type}</span>
              </div>
            </div>
          ))
        )}
      </div>
      <div class="flex items-center gap-3">
        <select
          class="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50"
          onChange={(e) => {
            const res = resources.find(r => r.name === e.target.value);
            if (res) {
              onAddBinding(res);
            }
          }}
          value=""
        >
          <option value="">{t('addBinding')}</option>
          {resources.filter(r => ['d1', 'r2', 'kv'].includes(r.type)).map(r => (
            <option value={r.name}>{r.name} ({r.type})</option>
          ))}
        </select>
        <button type="button"
          class="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          onClick={onSaveBindings}
          disabled={savingWorkerSettings}
        >
          {savingWorkerSettings ? t('saving') : t('saveBindings')}
        </button>
      </div>
    </div>
  );
}
