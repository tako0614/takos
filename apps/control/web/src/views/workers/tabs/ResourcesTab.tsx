import { useI18n } from '../../../store/i18n.ts';
import { Icons } from '../../../lib/Icons.tsx';
import type { Resource } from '../../../types/index.ts';
import {
  getResourceStatusBgClass,
  getResourceTypeIcon,
  getResourceTypeName,
} from '../utils/resourceUtils.tsx';

export interface ResourcesTabProps {
  resources: Resource[];
  loading: boolean;
  onSelectResource: (resource: Resource) => void;
  onCreateResource: () => void;
}

export function ResourcesTab({
  resources,
  loading,
  onSelectResource,
  onCreateResource,
}: ResourcesTabProps) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div class="flex flex-col items-center justify-center h-64 gap-4">
        <div class="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
        <span class="text-sm text-zinc-400">{t('loading')}</span>
      </div>
    );
  }

  if (!resources || resources.length === 0) {
    return (
      <div class="flex flex-col items-center justify-center h-64 gap-4">
        <div class="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
          <Icons.Database class="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
        </div>
        <div class="text-center">
          <p class="text-sm font-medium text-zinc-600 dark:text-zinc-400">{t('noResources')}</p>
          <button type="button"
            class="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 rounded-xl text-sm font-medium transition-colors"
            onClick={onCreateResource}
          >
            <Icons.Plus class="w-4 h-4" />
            {t('createResource')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {resources.map((resource) => (
        <div

          class="group relative flex items-start gap-4 p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 transition-all duration-200 cursor-pointer hover:border-zinc-200 dark:hover:border-zinc-700 hover:shadow-sm"
          onClick={() => onSelectResource(resource)}
        >
          <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-800 dark:to-zinc-900 flex items-center justify-center text-zinc-500 dark:text-zinc-400 shrink-0">
            {getResourceTypeIcon(resource.type)}
          </div>
          <div class="flex-1 min-w-0 py-0.5">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{resource.name}</h3>
              <span class={`w-2 h-2 rounded-full shrink-0 ${getResourceStatusBgClass(resource.status)}`} />
            </div>
            <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1.5">{getResourceTypeName(resource.type)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
