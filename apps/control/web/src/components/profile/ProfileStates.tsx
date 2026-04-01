import { Show } from 'solid-js';
import { Icons } from '../../lib/Icons.tsx';

interface ProfileLoadingStateProps {
  label?: string;
}

export function ProfileLoadingState(props: ProfileLoadingStateProps) {
  return (
    <div class="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900">
      <div class="flex flex-col items-center justify-center flex-1 text-zinc-500 dark:text-zinc-400">
        <div class="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-900 dark:border-t-white rounded-full animate-spin" />
        <span class="mt-3">{props.label ?? 'Loading profile...'}</span>
      </div>
    </div>
  );
}

interface ProfileErrorStateProps {
  message: string;
  onBack?: () => void;
}

export function ProfileErrorState(props: ProfileErrorStateProps) {
  return (
    <div class="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900">
      <div class="flex flex-col items-center justify-center flex-1 text-zinc-700 dark:text-zinc-300">
        <Icons.AlertTriangle class="w-12 h-12" />
        <span class="mt-3 text-lg">{props.message}</span>
        <Show when={props.onBack}>
          <button
            type="button"
            class="mt-4 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={props.onBack}
          >
            Go Back
          </button>
        </Show>
      </div>
    </div>
  );
}
