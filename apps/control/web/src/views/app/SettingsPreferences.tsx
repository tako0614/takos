import { useState } from 'react';
import { useI18n } from '../../store/i18n';
import { rpc, rpcJson } from '../../lib/rpc';
import { Icons } from '../../lib/Icons';
import { Button } from '../../components/ui';
import type { UserSettings } from '../../types';
import { Section, Toggle } from './SettingsShared';

export function SettingsPreferences({
  userSettings,
  onSettingsChange,
}: {
  userSettings: UserSettings;
  onSettingsChange?: (settings: UserSettings) => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);

  const updateSetting = async (patch: Partial<UserSettings>) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await rpc.me.settings.$patch({ json: patch });
      const settings = await rpcJson<UserSettings>(res);
      onSettingsChange?.(settings);
    } catch (err) {
      console.error('Failed to update settings:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Section title={t('autoUpdateSettings')}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t('autoUpdateHint')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saving && <Icons.Loader className="h-4 w-4 animate-spin text-zinc-400" />}
            <Toggle
              checked={userSettings.auto_update_enabled}
              onChange={(v) => updateSetting({ auto_update_enabled: v })}
              disabled={saving}
            />
          </div>
        </div>
      </Section>

      <Section title={t('privacyTitle')}>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('privateAccount')}</div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('requireApprovalForFollowers')}
              </div>
            </div>
            <Toggle
              checked={userSettings.private_account}
              onChange={(v) => updateSetting({ private_account: v })}
              disabled={saving}
            />
          </div>

          <div>
            <div className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">
              {t('activityVisibility')}
            </div>
            <div className="flex flex-wrap gap-2">
              {(['public', 'followers', 'private'] as const).map((v) => (
                <Button
                  key={v}
                  variant={userSettings.activity_visibility === v ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => updateSetting({ activity_visibility: v })}
                  disabled={saving}
                >
                  {v === 'public' ? t('visibilityPublic') : v === 'followers' ? t('visibilityFollowers') : t('visibilityPrivate')}
                </Button>
              ))}
              {saving && <Icons.Loader className="h-4 w-4 animate-spin text-zinc-400" />}
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
