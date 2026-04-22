import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import type { FollowUser } from "../../types/profile.ts";

interface ProfileUserListProps {
  users: FollowUser[];
  emptyTitle: string;
  emptyIcon: JSX.Element;
  onNavigateToProfile?: (username: string) => void;
  onToggleFollow: (user: FollowUser) => void;
}

export function ProfileUserList(props: ProfileUserListProps) {
  return (
    <Show
      when={props.users.length > 0}
      fallback={
        <div class="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
          {props.emptyIcon}
          <p class="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {props.emptyTitle}
          </p>
        </div>
      }
    >
      <div class="grid gap-3">
        <For each={props.users}>
          {(user) => (
            <div class="flex items-center gap-4 p-4 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
              <div
                class="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                onClick={() => props.onNavigateToProfile?.(user.username)}
                role="button"
                tabIndex={0}
              >
                <Show
                  when={user.picture}
                  fallback={
                    <div class="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-900 dark:text-zinc-100 font-medium">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                  }
                >
                  <img
                    src={user.picture!}
                    alt={user.name}
                    class="w-10 h-10 rounded-full"
                  />
                </Show>
                <div class="min-w-0">
                  <span class="block font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {user.name}
                  </span>
                  <span class="block text-sm text-zinc-500 dark:text-zinc-400 truncate">
                    @{user.username}
                  </span>
                  <Show when={user.bio}>
                    <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400 line-clamp-1">
                      {user.bio}
                    </p>
                  </Show>
                </div>
              </div>
              <button
                type="button"
                class={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  user.is_following
                    ? "bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600"
                    : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300"
                }`}
                onClick={() => props.onToggleFollow(user)}
              >
                {user.is_following ? "Following" : "Follow"}
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

export function ProfileEmptyIcon() {
  return <Icons.User class="w-12 h-12 mb-4" />;
}
