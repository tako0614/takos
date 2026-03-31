import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import { Button } from '../../components/ui';
import type { User, UserSettings } from '../../types';
import { SettingsAccount } from './SettingsAccount';
import { SettingsLanguage } from './SettingsLanguage';
import { SettingsPreferences } from './SettingsPreferences';
import { SettingsOAuth } from './SettingsOAuth';
import { SettingsBilling } from './SettingsBilling';

export function SettingsView({
  user,
  userSettings,
  onSettingsChange,
  onBack,
  embedded = false,
}: {
  user: User | null;
  userSettings: UserSettings | null;
  onSettingsChange?: (settings: UserSettings) => void;
  onBack?: () => void;
  embedded?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div class="flex h-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900">
      {!embedded && (
        <header class="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <Icons.ArrowLeft class="h-4 w-4" />
          </Button>
          <h1 class="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {t('settingsTitle')}
          </h1>
        </header>
      )}

      <main class="flex-1 overflow-y-auto">
        <div class="mx-auto w-full max-w-2xl space-y-3 px-4 pb-10 pt-6">
          <SettingsAccount user={user} />
          <SettingsLanguage />
          {userSettings && (
            <SettingsPreferences
              userSettings={userSettings}
              onSettingsChange={onSettingsChange}
            />
          )}
          <SettingsOAuth />
          <SettingsBilling user={user} />
        </div>
      </main>
    </div>
  );
}
