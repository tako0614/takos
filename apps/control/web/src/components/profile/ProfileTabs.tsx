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
  icon: React.ReactNode;
  label: string;
  count?: number;
}

function TabButton({ isActive, onClick, icon, label, count }: TabButtonProps) {
  return (
    <button
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1rem',
        fontSize: '0.875rem',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        background: 'none',
        border: 'none',
        borderBottom: `2px solid ${isActive ? 'var(--color-primary)' : 'transparent'}`,
        color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        cursor: 'pointer',
        transition: 'var(--transition-colors)',
        marginBottom: '-1px',
      }}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && (
        <Badge variant="default" size="sm" style={{ marginLeft: '0.25rem' }}>
          {count}
        </Badge>
      )}
    </button>
  );
}

export function ProfileTabs({ activeTab, profile, onSelectTab, requestsCount }: ProfileTabsProps) {
  return (
    <div
      style={{
        display: 'flex',
        borderBottom: '1px solid var(--color-border-primary)',
        backgroundColor: 'var(--color-surface-primary)',
        overflowX: 'auto',
      }}
    >
      <TabButton
        isActive={activeTab === 'repositories'}
        onClick={() => onSelectTab('repositories')}
        icon={<Icons.Folder style={{ width: '1rem', height: '1rem' }} />}
        label="Repositories"
        count={profile.public_repo_count}
      />
      <TabButton
        isActive={activeTab === 'stars'}
        onClick={() => onSelectTab('stars')}
        icon={<Icons.Star style={{ width: '1rem', height: '1rem' }} />}
        label="Stars"
      />
      <TabButton
        isActive={activeTab === 'activity'}
        onClick={() => onSelectTab('activity')}
        icon={<Icons.Zap style={{ width: '1rem', height: '1rem' }} />}
        label="Activity"
      />
      <TabButton
        isActive={activeTab === 'followers'}
        onClick={() => onSelectTab('followers')}
        icon={<Icons.User style={{ width: '1rem', height: '1rem' }} />}
        label="Followers"
        count={profile.followers_count}
      />
      <TabButton
        isActive={activeTab === 'following'}
        onClick={() => onSelectTab('following')}
        icon={<Icons.User style={{ width: '1rem', height: '1rem' }} />}
        label="Following"
        count={profile.following_count}
      />
      {profile.is_self && (
        <TabButton
          isActive={activeTab === 'requests'}
          onClick={() => onSelectTab('requests')}
          icon={<Icons.User style={{ width: '1rem', height: '1rem' }} />}
          label="Requests"
          count={requestsCount}
        />
      )}
    </div>
  );
}
