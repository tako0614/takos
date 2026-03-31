import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Icons } from '../../lib/Icons';
import { Badge } from '../ui';
import type { ProfileTab, UserProfile } from '../../types/profile';

interface ProfileTabsProps {
  activeTab: ProfileTab;
  profile: UserProfile;
  onSelectTab: (tab: ProfileTab) => void;
  requestsCount?: number;
}

interface TabButtonProps {
  isActive: boolean;
  onClick: () => void;
  icon: JSX.Element;
  label: string;
  count?: number;
}

function TabButton(props: TabButtonProps) {
  return (
    <button
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '0.5rem',
        padding: '0.75rem 1rem',
        'font-size': '0.875rem',
        'font-weight': 500,
        'white-space': 'nowrap',
        background: 'none',
        border: 'none',
        'border-bottom': `2px solid ${props.isActive ? 'var(--color-primary)' : 'transparent'}`,
        color: props.isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        cursor: 'pointer',
        transition: 'var(--transition-colors)',
        'margin-bottom': '-1px',
      }}
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.label}</span>
      <Show when={props.count !== undefined}>
        <Badge variant="default" size="sm" style={{ 'margin-left': '0.25rem' }}>
          {props.count}
        </Badge>
      </Show>
    </button>
  );
}

export function ProfileTabs(props: ProfileTabsProps) {
  return (
    <div
      style={{
        display: 'flex',
        'border-bottom': '1px solid var(--color-border-primary)',
        'background-color': 'var(--color-surface-primary)',
        'overflow-x': 'auto',
      }}
    >
      <TabButton
        isActive={props.activeTab === 'repositories'}
        onClick={() => props.onSelectTab('repositories')}
        icon={<Icons.Folder style={{ width: '1rem', height: '1rem' }} />}
        label="Repositories"
        count={props.profile.public_repo_count}
      />
      <TabButton
        isActive={props.activeTab === 'stars'}
        onClick={() => props.onSelectTab('stars')}
        icon={<Icons.Star style={{ width: '1rem', height: '1rem' }} />}
        label="Stars"
      />
      <TabButton
        isActive={props.activeTab === 'activity'}
        onClick={() => props.onSelectTab('activity')}
        icon={<Icons.Zap style={{ width: '1rem', height: '1rem' }} />}
        label="Activity"
      />
      <TabButton
        isActive={props.activeTab === 'followers'}
        onClick={() => props.onSelectTab('followers')}
        icon={<Icons.User style={{ width: '1rem', height: '1rem' }} />}
        label="Followers"
        count={props.profile.followers_count}
      />
      <TabButton
        isActive={props.activeTab === 'following'}
        onClick={() => props.onSelectTab('following')}
        icon={<Icons.User style={{ width: '1rem', height: '1rem' }} />}
        label="Following"
        count={props.profile.following_count}
      />
      <Show when={props.profile.is_self}>
        <TabButton
          isActive={props.activeTab === 'requests'}
          onClick={() => props.onSelectTab('requests')}
          icon={<Icons.User style={{ width: '1rem', height: '1rem' }} />}
          label="Requests"
          count={props.requestsCount}
        />
      </Show>
    </div>
  );
}
