import type { ReactNode } from 'react';
import { Icons } from '../../lib/Icons';
import type { FollowUser } from '../../types/profile';

interface ProfileUserListProps {
  users: FollowUser[];
  emptyTitle: string;
  emptyIcon: ReactNode;
  onNavigateToProfile?: (username: string) => void;
  onToggleFollow: (user: FollowUser) => void;
}

export function ProfileUserList({
  users,
  emptyTitle,
  emptyIcon,
  onNavigateToProfile,
  onToggleFollow,
}: ProfileUserListProps) {
  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
        {emptyIcon}
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{emptyTitle}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {users.map((user) => (
        <div key={user.username} className="flex items-center gap-4 p-4 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <div
            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
            onClick={() => onNavigateToProfile?.(user.username)}
            role="button"
            tabIndex={0}
          >
            {user.picture ? (
              <img src={user.picture} alt={user.name} className="w-10 h-10 rounded-full" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-900 dark:text-zinc-100 font-medium">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <span className="block font-medium text-zinc-900 dark:text-zinc-100 truncate">{user.name}</span>
              <span className="block text-sm text-zinc-500 dark:text-zinc-400 truncate">@{user.username}</span>
              {user.bio && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 line-clamp-1">{user.bio}</p>}
            </div>
          </div>
          <button
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              user.is_following
                ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300'
            }`}
            onClick={() => onToggleFollow(user)}
          >
            {user.is_following ? 'Following' : 'Follow'}
          </button>
        </div>
      ))}
    </div>
  );
}

export function ProfileEmptyIcon() {
  return <Icons.User className="w-12 h-12 mb-4" />;
}
