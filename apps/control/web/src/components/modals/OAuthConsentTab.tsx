import { useState, useEffect } from 'react';
import type { OAuthConsent } from './OAuthSettingsModal';
import { useI18n } from '../../providers/I18nProvider';
import { useConfirmDialog } from '../../providers/ConfirmDialogProvider';
import { rpc, rpcJson } from '../../lib/rpc';
import { formatShortDate } from '../../lib/format';
import { toSafeHref } from '../../lib/safeHref';
import { Icons } from '../../lib/Icons';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

/**
 * Frontend-local scope descriptions. The authoritative scope list lives in
 * src/types/oauth.ts (OAUTH_SCOPES). Keep these two in sync.
 */
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: 'OpenID Connect identity',
  profile: 'Read your profile information',
  email: 'Read your email address',
  'spaces:read': 'Read your workspaces',
  'spaces:write': 'Create and modify workspaces',
  'files:read': 'Read files in workspaces',
  'files:write': 'Create and modify files',
  'memories:read': 'Read memories',
  'memories:write': 'Create and modify memories',
  'threads:read': 'Read chat threads',
  'threads:write': 'Create and send messages',
  'agents:execute': 'Execute AI agents',
  'repos:read': 'Read repositories',
  'repos:write': 'Create and modify repositories',
};

interface OAuthConsentTabProps {
  loading: boolean;
  onLoadingChange: (loading: boolean) => void;
}

export function OAuthConsentTab({ loading, onLoadingChange }: OAuthConsentTabProps) {
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const [consents, setConsents] = useState<OAuthConsent[]>([]);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    fetchConsents();
  }, []);

  async function fetchConsents(): Promise<void> {
    onLoadingChange(true);
    try {
      const res = await rpc.me.oauth.consents.$get();
      const data = await rpcJson<{ consents: OAuthConsent[] }>(res);
      setConsents(data.consents || []);
    } catch (err) {
      console.error('Failed to fetch consents:', err);
    } finally {
      onLoadingChange(false);
    }
  }

  async function handleRevokeConsent(clientId: string): Promise<void> {
    const confirmed = await confirm({
      title: t('revokeAccess'),
      message: t('revokeConfirm'),
      confirmText: t('revokeAccess'),
      danger: true,
    });
    if (!confirmed) return;
    setRevoking(clientId);
    try {
      const res = await rpc.me.oauth.consents[':clientId'].$delete({ param: { clientId } });
      await rpcJson(res);
      setConsents(prev => prev.filter(c => c.client_id !== clientId));
    } catch (err) {
      console.error('Failed to revoke:', err);
    } finally {
      setRevoking(null);
    }
  }

  if (loading) return null;

  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
        {t('authorizedAppsDesc')}
      </p>
      {consents.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '3rem 0',
            color: 'var(--color-text-tertiary)',
          }}
        >
          <Icons.Key style={{ width: '3rem', height: '3rem', margin: '0 auto 1rem', opacity: 0.5 }} />
          <p style={{ fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>{t('noAuthorizedApps')}</p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>{t('noAuthorizedAppsDesc')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {consents.map(consent => {
            const safeClientUri = toSafeHref(consent.client_uri);
            return (
              <Card key={consent.id}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                  <div
                    style={{
                      width: '2.5rem',
                      height: '2.5rem',
                      borderRadius: 'var(--radius-lg)',
                      backgroundColor: 'var(--color-surface-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {consent.client_logo ? (
                      <img src={consent.client_logo} alt={consent.client_name + ' logo'} style={{ width: '2rem', height: '2rem', borderRadius: 'var(--radius-md)' }} />
                    ) : (
                      <Icons.Code style={{ width: '1.25rem', height: '1.25rem', color: 'var(--color-text-tertiary)' }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <h4 style={{ fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>{consent.client_name}</h4>
                      {safeClientUri && (
                        <a href={safeClientUri} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text-primary)' }} aria-label={`${consent.client_name} - ${t('openInNewTab')}`}>
                          <Icons.ExternalLink style={{ width: '1rem', height: '1rem' }} />
                        </a>
                      )}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>
                      {t('grantedOn')}: {formatShortDate(consent.granted_at)}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.5rem' }}>
                      {consent.scopes.map(scope => (
                        <Badge key={scope} variant="default" title={SCOPE_DESCRIPTIONS[scope] || scope}>
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleRevokeConsent(consent.client_id)}
                    disabled={revoking === consent.client_id}
                    isLoading={revoking === consent.client_id}
                  >
                    {t('revokeAccess')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
