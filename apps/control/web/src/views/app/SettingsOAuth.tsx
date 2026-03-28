import { useState } from 'react';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import { Button } from '../../components/ui';
import { OAuthSettingsModal } from '../../components/modals/OAuthSettingsModal';
import { Section } from './SettingsShared';

export function SettingsOAuth() {
  const { t } = useI18n();
  const [showOAuthModal, setShowOAuthModal] = useState(false);

  return (
    <>
      <Section title={t('oauthSettings')}>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          {t('authorizedAppsDesc')}
        </p>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Icons.Key className="h-4 w-4" />}
          onClick={() => setShowOAuthModal(true)}
        >
          {t('oauthSettings')}
        </Button>
      </Section>

      {showOAuthModal && (
        <OAuthSettingsModal onClose={() => setShowOAuthModal(false)} />
      )}
    </>
  );
}
