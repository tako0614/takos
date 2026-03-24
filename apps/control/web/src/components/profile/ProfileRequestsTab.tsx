import { Icons } from '../../lib/Icons';
import { useI18n } from '../../providers/I18nProvider';
import { EmptyState } from '../common/EmptyState';
import type { FollowRequest } from '../../types/profile';

export function ProfileRequestsTab({
  requests,
  onAccept,
  onReject,
  onNavigateToProfile,
  actionLoadingId,
}: {
  requests: FollowRequest[];
  onAccept: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onNavigateToProfile?: (username: string) => void;
  actionLoadingId?: string | null;
}) {
  const { t } = useI18n();

  if (!requests || requests.length === 0) {
    return (
      <EmptyState
        icon={<Icons.Inbox className="w-12 h-12 mb-4" />}
        title={t('noFollowRequests')}
      />
    );
  }

  return (
    <div className="grid gap-3">
      {requests.map((req) => (
        <div
          key={req.id}
          className="flex items-center gap-4 p-4 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
        >
          <div
            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
            onClick={() => onNavigateToProfile?.(req.requester.username)}
            role="button"
            tabIndex={0}
          >
            {req.requester.picture ? (
              <img src={req.requester.picture} alt={req.requester.name} className="w-10 h-10 rounded-full" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-900 dark:text-zinc-100 font-medium">
                {req.requester.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <span className="block font-medium text-zinc-900 dark:text-zinc-100 truncate">{req.requester.name}</span>
              <span className="block text-sm text-zinc-500 dark:text-zinc-400 truncate">@{req.requester.username}</span>
              {req.requester.bio && (
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 line-clamp-1">
                  {req.requester.bio}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors disabled:opacity-50"
              onClick={() => onReject(req.id)}
              disabled={actionLoadingId === req.id}
            >
              {t('reject')}
            </button>
            <button
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-50"
              onClick={() => onAccept(req.id)}
              disabled={actionLoadingId === req.id}
            >
              {actionLoadingId === req.id ? '...' : t('accept')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
