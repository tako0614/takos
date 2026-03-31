import { useI18n } from '../../store/i18n.ts';

interface ScopeListProps {
  identity: string[];
  resources: string[];
}

export function ScopeList({ identity, resources }: ScopeListProps) {
  const { t } = useI18n();

  if (identity.length === 0 && resources.length === 0) {
    return (
      <div class="bg-[var(--color-bg-primary)] rounded-lg p-3 text-sm text-[var(--color-text-tertiary)]">
        {t('oauthScopeNone')}
      </div>
    );
  }

  return (
    <div class="bg-[var(--color-bg-primary)] rounded-lg p-3 text-left">
      {identity.length > 0 && (
        <>
          <div class="text-xs font-semibold text-[var(--color-text-tertiary)] mb-1">
            {t('oauthScopeIdentity')}
          </div>
          {identity.map((scope) => (
            <div

              class="py-2 border-b border-[var(--color-border-primary)] text-sm text-[var(--color-text-secondary)]"
            >
              {scope}
            </div>
          ))}
        </>
      )}
      {resources.length > 0 && (
        <>
          <div class="text-xs font-semibold text-[var(--color-text-tertiary)] mt-2 mb-1">
            {t('oauthScopeResources')}
          </div>
          {resources.map((scope) => (
            <div

              class="py-2 border-b border-[var(--color-border-primary)] text-sm text-[var(--color-text-secondary)]"
            >
              {scope}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
