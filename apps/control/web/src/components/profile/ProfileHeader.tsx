import type { CSSProperties } from 'react';
import { Icons } from '../../lib/Icons';
import { Avatar, Button } from '../ui';
import type { ProfileTab, UserProfile } from '../../types/profile';
import { formatDate, formatNumber } from '../../lib/format';

interface ProfileHeaderProps {
  profile: UserProfile;
  onBack?: () => void;
  onSelectTab: (tab: ProfileTab) => void;
  onToggleFollow: () => void;
  followLoading: boolean;
  onToggleBlock?: () => void;
  onToggleMute?: () => void;
  blockLoading?: boolean;
  muteLoading?: boolean;
}

export function ProfileHeader({
  profile,
  onBack,
  onSelectTab,
  onToggleFollow,
  followLoading,
  onToggleBlock,
  onToggleMute,
  blockLoading = false,
  muteLoading = false,
}: ProfileHeaderProps) {
  const statButtonStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    transition: 'var(--transition-colors)',
  };

  const followLabel = profile.is_following
    ? 'Following'
    : profile.follow_requested
      ? 'Requested'
      : 'Follow';
  const followVariant = (profile.is_following || profile.follow_requested) ? 'secondary' : 'primary';

  return (
    <>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backgroundColor: 'var(--color-bg-secondary)',
          borderBottom: '1px solid var(--color-border-primary)',
        }}
      >
        {onBack && (
          <div style={{ padding: '0.75rem 1.5rem' }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              aria-label="Go back"
              leftIcon={<Icons.ArrowLeft />}
            />
          </div>
        )}
      </div>

      <div
        style={{
          padding: '1.5rem',
          borderBottom: '1px solid var(--color-border-primary)',
          backgroundColor: 'var(--color-surface-primary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.5rem' }}>
          <div style={{ flexShrink: 0 }}>
            <Avatar
              src={profile.picture || undefined}
              name={profile.name}
              size="xl"
              style={{
                width: '6rem',
                height: '6rem',
                fontSize: '1.75rem',
                border: '2px solid var(--color-border-primary)',
              }}
            />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                color: 'var(--color-text-primary)',
                margin: 0,
              }}
            >
              {profile.name}
            </h1>
            {profile.username && (
              <span style={{ color: 'var(--color-text-secondary)' }}>
                @{profile.username}
                {profile.private_account && !profile.is_self && (
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', opacity: 0.8 }}>
                    (Private)
                  </span>
                )}
              </span>
            )}
            {profile.bio && (
              <p
                style={{
                  marginTop: '0.5rem',
                  color: 'var(--color-text-secondary)',
                  marginBottom: 0,
                }}
              >
                {profile.bio}
              </p>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1.5rem',
                marginTop: '1rem',
              }}
            >
              {([
                { tab: 'repositories' as const, count: profile.public_repo_count, label: 'repositories' },
                { tab: 'followers' as const, count: profile.followers_count, label: 'followers' },
                { tab: 'following' as const, count: profile.following_count, label: 'following' },
              ]).map(({ tab, count, label }) => (
                <button key={tab} style={statButtonStyle} onClick={() => onSelectTab(tab)}>
                  <span style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {formatNumber(count)}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ flexShrink: 0 }}>
            {!profile.is_self && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {onToggleMute && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onToggleMute}
                    disabled={muteLoading || followLoading || blockLoading}
                    isLoading={muteLoading}
                  >
                    {profile.is_muted ? 'Unmute' : 'Mute'}
                  </Button>
                )}
                {onToggleBlock && (
                  <Button
                    variant={profile.is_blocking ? 'danger' : 'ghost'}
                    size="sm"
                    onClick={onToggleBlock}
                    disabled={blockLoading || followLoading || muteLoading}
                    isLoading={blockLoading}
                  >
                    {profile.is_blocking ? 'Unblock' : 'Block'}
                  </Button>
                )}
                <Button
                  variant={followVariant}
                  onClick={onToggleFollow}
                  disabled={followLoading || blockLoading}
                  isLoading={followLoading}
                >
                  {followLabel}
                </Button>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginTop: '1rem',
            fontSize: '0.75rem',
            color: 'var(--color-text-tertiary)',
          }}
        >
          <Icons.Clock style={{ width: '1rem', height: '1rem' }} />
          <span>Joined {formatDate(profile.created_at)}</span>
        </div>
      </div>
    </>
  );
}
