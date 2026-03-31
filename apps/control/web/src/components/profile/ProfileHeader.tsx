import type { JSX } from 'solid-js';
import { Show, For } from 'solid-js';
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

export function ProfileHeader(props: ProfileHeaderProps) {
  const statButtonStyle: JSX.CSSProperties = {
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0',
    transition: 'var(--transition-colors)',
  };

  const followLabel = () =>
    props.profile.is_following
      ? 'Following'
      : props.profile.follow_requested
        ? 'Requested'
        : 'Follow';
  const followVariant = () =>
    (props.profile.is_following || props.profile.follow_requested) ? 'secondary' : 'primary';

  const stats = () => [
    { tab: 'repositories' as const, count: props.profile.public_repo_count, label: 'repositories' },
    { tab: 'followers' as const, count: props.profile.followers_count, label: 'followers' },
    { tab: 'following' as const, count: props.profile.following_count, label: 'following' },
  ];

  return (
    <>
      <div
        style={{
          position: 'sticky',
          top: '0',
          'z-index': 10,
          'background-color': 'var(--color-bg-secondary)',
          'border-bottom': '1px solid var(--color-border-primary)',
        }}
      >
        <Show when={props.onBack}>
          <div style={{ padding: '0.75rem 1.5rem' }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onBack}
              aria-label="Go back"
              leftIcon={<Icons.ArrowLeft />}
            />
          </div>
        </Show>
      </div>

      <div
        style={{
          padding: '1.5rem',
          'border-bottom': '1px solid var(--color-border-primary)',
          'background-color': 'var(--color-surface-primary)',
        }}
      >
        <div style={{ display: 'flex', 'align-items': 'flex-start', gap: '1.5rem' }}>
          <div style={{ 'flex-shrink': 0 }}>
            <Avatar
              src={props.profile.picture || undefined}
              name={props.profile.name}
              size="xl"
              style={{
                width: '6rem',
                height: '6rem',
                'font-size': '1.75rem',
                border: '2px solid var(--color-border-primary)',
              }}
            />
          </div>

          <div style={{ flex: 1, 'min-width': '0' }}>
            <h1
              style={{
                'font-size': '1.5rem',
                'font-weight': 700,
                color: 'var(--color-text-primary)',
                margin: '0',
              }}
            >
              {props.profile.name}
            </h1>
            <Show when={props.profile.username}>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                @{props.profile.username}
                <Show when={props.profile.private_account && !props.profile.is_self}>
                  <span style={{ 'margin-left': '0.5rem', 'font-size': '0.75rem', opacity: 0.8 }}>
                    (Private)
                  </span>
                </Show>
              </span>
            </Show>
            <Show when={props.profile.bio}>
              <p
                style={{
                  'margin-top': '0.5rem',
                  color: 'var(--color-text-secondary)',
                  'margin-bottom': '0',
                }}
              >
                {props.profile.bio}
              </p>
            </Show>

            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '1.5rem',
                'margin-top': '1rem',
              }}
            >
              <For each={stats()}>
                {(item) => (
                  <button style={statButtonStyle} onClick={() => props.onSelectTab(item.tab)}>
                    <span style={{ 'font-size': '1.125rem', 'font-weight': 700, color: 'var(--color-text-primary)' }}>
                      {formatNumber(item.count)}
                    </span>
                    <span style={{ 'font-size': '0.75rem', color: 'var(--color-text-secondary)' }}>
                      {item.label}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </div>

          <div style={{ 'flex-shrink': 0 }}>
            <Show when={!props.profile.is_self}>
              <div style={{ display: 'flex', 'align-items': 'center', gap: '0.5rem' }}>
                <Show when={props.onToggleMute}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={props.onToggleMute}
                    disabled={(props.muteLoading ?? false) || props.followLoading || (props.blockLoading ?? false)}
                    isLoading={props.muteLoading ?? false}
                  >
                    {props.profile.is_muted ? 'Unmute' : 'Mute'}
                  </Button>
                </Show>
                <Show when={props.onToggleBlock}>
                  <Button
                    variant={props.profile.is_blocking ? 'danger' : 'ghost'}
                    size="sm"
                    onClick={props.onToggleBlock}
                    disabled={(props.blockLoading ?? false) || props.followLoading || (props.muteLoading ?? false)}
                    isLoading={props.blockLoading ?? false}
                  >
                    {props.profile.is_blocking ? 'Unblock' : 'Block'}
                  </Button>
                </Show>
                <Button
                  variant={followVariant()}
                  onClick={props.onToggleFollow}
                  disabled={props.followLoading || (props.blockLoading ?? false)}
                  isLoading={props.followLoading}
                >
                  {followLabel()}
                </Button>
              </div>
            </Show>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '0.5rem',
            'margin-top': '1rem',
            'font-size': '0.75rem',
            color: 'var(--color-text-tertiary)',
          }}
        >
          <Icons.Clock style={{ width: '1rem', height: '1rem' }} />
          <span>Joined {formatDate(props.profile.created_at)}</span>
        </div>
      </div>
    </>
  );
}
