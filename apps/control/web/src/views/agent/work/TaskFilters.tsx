import { useI18n } from '../../../providers/I18nProvider';
import type { TranslationKey } from '../../../i18n';
import { STATUS_ORDER, type TaskFilter } from './types';

interface TaskFiltersProps {
  activeFilter: TaskFilter;
  onFilterChange: (filter: TaskFilter) => void;
}

export function TaskFilters({ activeFilter, onFilterChange }: TaskFiltersProps) {
  const { t } = useI18n();
  const tx = (key: string) => t(key as TranslationKey);

  return (
    <div className="flex flex-wrap gap-2">
      {['all', ...STATUS_ORDER].map((value) => (
        <button
          key={value}
          type="button"
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            activeFilter === value
              ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
              : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
          }`}
          onClick={() => onFilterChange(value as TaskFilter)}
        >
          {value === 'all' ? t('taskFilterAll') : tx(`taskStatus.${value}`)}
        </button>
      ))}
    </div>
  );
}
