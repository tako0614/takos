import { Icons } from '../../lib/Icons';
import { useI18n } from '../../store/i18n';
import { SettingsView } from './SettingsView';
import type { User, UserSettings } from '../../types';

interface SettingsModalProps {
  user: User | null;
  userSettings: UserSettings | null;
  onSettingsChange: (settings: UserSettings) => void;
  onClose: () => void;
}

export function SettingsModal({
  user,
  userSettings,
  onSettingsChange,
  onClose,
}: SettingsModalProps) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {t('accountSettings')}
          </h3>
          <button
            className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            onClick={onClose}
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SettingsView
            user={user}
            userSettings={userSettings}
            onSettingsChange={onSettingsChange}
            onBack={onClose}
            embedded
          />
        </div>
      </div>
    </div>
  );
}
