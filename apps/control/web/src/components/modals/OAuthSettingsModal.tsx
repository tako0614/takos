import { createSignal } from 'solid-js';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import { Modal } from '../ui/Modal';
import { Tabs, TabList, Tab, TabPanel } from '../ui/Tabs';
import { OAuthConsentTab } from './OAuthConsentTab';
import { OAuthClientTab } from './OAuthClientTab';
import { OAuthTokenTab } from './OAuthTokenTab';

export interface OAuthConsent {
  id: string;
  client_id: string;
  client_name: string;
  client_uri: string | null;
  client_logo: string | null;
  scopes: string[];
  granted_at: string;
}

export interface PersonalAccessToken {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface OAuthClientDev {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  redirect_uris: string[];
  client_type: 'confidential' | 'public';
  status: string;
  created_at: string;
}

export interface OAuthSettingsModalProps {
  onClose: () => void;
}

export function OAuthSettingsModal(props: OAuthSettingsModalProps) {
  const { t } = useI18n();
  const [loading, setLoading] = createSignal(true);

  const loadingSpinner = (
    <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', padding: '3rem 0' }}>
      <div style={{ width: '1.5rem', height: '1.5rem', border: '2px solid var(--color-border-primary)', 'border-top-color': 'var(--color-primary)', 'border-radius': '50%', animation: 'spin 1s linear infinite' }} />
    </div>
  );

  return (
    <Modal isOpen={true} onClose={props.onClose} title={t('oauthSettings')} size="xl">
      <Tabs defaultTab="authorized" onChange={() => setLoading(true)}>
        <TabList>
          <Tab id="authorized">
            <div style={{ display: 'flex', 'align-items': 'center', gap: '0.5rem' }}>
              <Icons.Key />
              {t('authorizedApps')}
            </div>
          </Tab>
          <Tab id="apps">
            <div style={{ display: 'flex', 'align-items': 'center', gap: '0.5rem' }}>
              <Icons.Code />
              {t('developerApps')}
            </div>
          </Tab>
          <Tab id="tokens">
            <div style={{ display: 'flex', 'align-items': 'center', gap: '0.5rem' }}>
              <Icons.Key />
              Personal Tokens
            </div>
          </Tab>
        </TabList>

        <TabPanel id="authorized">
          {loading() && loadingSpinner}
          <OAuthConsentTab loading={loading()} onLoadingChange={setLoading} />
        </TabPanel>

        <TabPanel id="apps">
          {loading() && loadingSpinner}
          <OAuthClientTab loading={loading()} onLoadingChange={setLoading} />
        </TabPanel>

        <TabPanel id="tokens">
          {loading() && loadingSpinner}
          <OAuthTokenTab loading={loading()} onLoadingChange={setLoading} />
        </TabPanel>
      </Tabs>
    </Modal>
  );
}
