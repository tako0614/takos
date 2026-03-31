import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';

export interface AppsPageProps {
  onNavigateToStore?: () => void;
}

export function AppsPage({ onNavigateToStore }: AppsPageProps) {
  const { t } = useI18n();

  return (
    <div class="flex h-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900">
      <div class="flex-1 overflow-auto">
        <div class="mx-auto w-full max-w-6xl px-4 pb-10 pt-8">
          <div class="flex items-center justify-between pb-6">
            <h1 class="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {t('apps')}
            </h1>
          </div>

          <div class="mt-6 rounded-[2rem] border border-dashed border-zinc-300 bg-white px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
              <Icons.Package class="h-8 w-8" />
            </div>
            <h2 class="mt-5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {t('appsInstalledEmpty')}
            </h2>
            <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {t('appsInstalledEmptyDesc')}
            </p>
            {onNavigateToStore ? (
              <div class="mt-5">
                <button
                  onClick={onNavigateToStore}
                  class="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  <Icons.ShoppingBag class="h-4 w-4" />
                  {t('browseStore')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
