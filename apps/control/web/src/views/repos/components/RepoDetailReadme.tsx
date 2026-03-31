import { Show } from 'solid-js';
import { Icons } from '../../../lib/Icons.tsx';

interface RepoDetailReadmeProps {
  readme: string | null;
  readmeLoading: boolean;
}

export function RepoDetailReadme(props: RepoDetailReadmeProps) {
  return (
    <Show when={props.readme || props.readmeLoading}>
      <div class="mt-4 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-3 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
          <Icons.FileText class="w-4 h-4 text-zinc-500" />
          <span class="font-medium text-zinc-900 dark:text-zinc-100">README.md</span>
        </div>
        <div class="p-6 bg-white dark:bg-zinc-900">
          <Show when={props.readmeLoading} fallback={
            <div class="prose dark:prose-invert prose-zinc max-w-none prose-pre:bg-zinc-100 dark:prose-pre:bg-zinc-800 prose-pre:border prose-pre:border-zinc-200 dark:prose-pre:border-zinc-700">
              <pre class="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300 font-mono">{props.readme}</pre>
            </div>
          }>
            <div class="flex items-center justify-center py-8">
              <div class="w-6 h-6 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
