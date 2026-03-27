import { Icons } from '../../lib/Icons';
import { useI18n } from '../../store/i18n';
import { EmptyState } from '../common/EmptyState';
import type { ActivityEvent } from '../../types/profile';

function formatDay(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function iconForEvent(type: ActivityEvent['type']) {
  switch (type) {
    case 'commit':
      return <Icons.GitCommit className="w-4 h-4" />;
    case 'pull_request':
      return <Icons.GitPullRequest className="w-4 h-4" />;
    case 'release':
      return <Icons.Tag className="w-4 h-4" />;
    case 'deployment':
      return <Icons.Zap className="w-4 h-4" />;
    default:
      return <Icons.Info className="w-4 h-4" />;
  }
}

export function ProfileActivityTab({
  events,
  onNavigateToRepo,
}: {
  events: ActivityEvent[];
  onNavigateToRepo?: (ownerUsername: string, repoName: string) => void;
}) {
  const { t } = useI18n();

  if (!events || events.length === 0) {
    return (
      <EmptyState
        icon={<Icons.Zap className="w-12 h-12 mb-4" />}
        title={t('noActivityYet')}
      />
    );
  }

  const groups = new Map<string, ActivityEvent[]>();
  for (const ev of events) {
    const key = formatDay(ev.created_at);
    const list = groups.get(key) || [];
    list.push(ev);
    groups.set(key, list);
  }

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([day, dayEvents]) => (
        <div key={day}>
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{day}</h3>
          <div className="mt-3 space-y-3">
            {dayEvents.map((ev) => (
              <div
                key={ev.id}
                className="flex gap-3 p-4 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
              >
                <div className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                  {iconForEvent(ev.type)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {ev.title}
                  </div>
                  {ev.repo?.owner_username && ev.repo?.name ? (
                    <button
                      type="button"
                      onClick={() => onNavigateToRepo?.(ev.repo!.owner_username, ev.repo!.name)}
                      className="mt-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {ev.repo.owner_username}/{ev.repo.name}
                    </button>
                  ) : (
                    <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      {ev.type === 'deployment' ? 'Infrastructure' : ''}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    {formatTime(ev.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
