import { Show } from 'solid-js';
import type { JSX } from 'solid-js';

interface EmptyStateProps {
  icon: JSX.Element;
  title: string;
  subtitle?: string;
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div class="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
      {props.icon}
      <p class="text-lg font-medium text-zinc-900 dark:text-zinc-100">{props.title}</p>
      <Show when={props.subtitle}>
        <p class="mt-1 text-sm">{props.subtitle}</p>
      </Show>
    </div>
  );
}
