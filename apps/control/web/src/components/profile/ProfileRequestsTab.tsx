import { Show, For } from 'solid-js';
import { Icons } from '../../lib/Icons.tsx';
import { useI18n } from '../../store/i18n.ts';
import { EmptyState } from '../common/EmptyState.tsx';
import type { FollowRequest } from '../../types/profile.ts';

export function ProfileRequestsTab(props: {
  requests: FollowRequest[];
  onAccept: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onNavigateToProfile?: (username: string) => void;
  actionLoadingId?: string | null;
}) {
  const { t } = useI18n();

  return (
    <Show
      when={props.requests && props.requests.length > 0}
      fallback={
        <EmptyState
          icon={<Icons.Inbox class="w-12 h-12 mb-4" />}
          title={t('noFollowRequests')}
        />
      }
    >
      <div class="grid gap-3">
        <For each={props.requests}>
          {(req) => (
            <div
              class="flex items-center gap-4 p-4 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
            >
              <div
                class="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                onClick={() => props.onNavigateToProfile?.(req.requester.username)}
                role="button"
                tabIndex={0}
              >
                <Show
                  when={req.requester.picture}
                  fallback={
                    <div class="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-900 dark:text-zinc-100 font-medium">
                      {req.requester.name.charAt(0).toUpperCase()}
                    </div>
                  }
                >
                  <img src={req.requester.picture!} alt={req.requester.name} class="w-10 h-10 rounded-full" />
                </Show>
                <div class="min-w-0">
                  <span class="block font-medium text-zinc-900 dark:text-zinc-100 truncate">{req.requester.name}</span>
                  <span class="block text-sm text-zinc-500 dark:text-zinc-400 truncate">@{req.requester.username}</span>
                  <Show when={req.requester.bio}>
                    <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400 line-clamp-1">
                      {req.requester.bio}
                    </p>
                  </Show>
                </div>
              </div>

              <div class="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors disabled:opacity-50"
                  onClick={() => props.onReject(req.id)}
                  disabled={props.actionLoadingId === req.id}
                >
                  {t('reject')}
                </button>
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-50"
                  onClick={() => props.onAccept(req.id)}
                  disabled={props.actionLoadingId === req.id}
                >
                  {props.actionLoadingId === req.id ? '...' : t('accept')}
                </button>
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
