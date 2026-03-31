import { createSignal } from 'solid-js';
import { useI18n } from '../../store/i18n.ts';
import { Icons } from '../../lib/Icons.tsx';
import { Button } from '../../components/ui/index.ts';
import { OAuthSettingsModal } from '../../components/modals/OAuthSettingsModal.tsx';
import { Section } from './SettingsShared.tsx';

export function SettingsOAuth() {
  const { t } = useI18n();
  const [showOAuthModal, setShowOAuthModal] = createSignal(false);

  return (
    <>
      <Section title={t('oauthSettings')}>
        <p class="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          {t('authorizedAppsDesc')}
        </p>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Icons.Key class="h-4 w-4" />}
          onClick={() => setShowOAuthModal(true)}
        >
          {t('oauthSettings')}
        </Button>
      </Section>

      {showOAuthModal() && (
        <OAuthSettingsModal onClose={() => setShowOAuthModal(false)} />
      )}
    </>
  );
}
