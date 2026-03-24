import { useI18n } from '../../providers/I18nProvider';
export function LoadingScreen() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-white dark:bg-zinc-900">
      <div className="w-6 h-6 border-2 border-zinc-400 dark:border-zinc-500 border-t-transparent rounded-full animate-spin mb-3" />
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('loading')}</p>
    </div>
  );
}
