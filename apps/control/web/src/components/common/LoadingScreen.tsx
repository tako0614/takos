import { useI18n } from '../../store/i18n.ts';
export function LoadingScreen() {
  const { t } = useI18n();
  return (
    <div class="flex flex-col items-center justify-center h-screen bg-white dark:bg-zinc-900">
      <div class="w-6 h-6 border-2 border-zinc-400 dark:border-zinc-500 border-t-transparent rounded-full animate-spin mb-3" />
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('loading')}</p>
    </div>
  );
}
