/**
 * Skeleton components for loading states
 * Provides visual placeholder while content is loading
 */
import { For } from "solid-js";

interface SkeletonProps {
  class?: string;
}

function Skeleton(props: SkeletonProps) {
  return (
    <div
      class={`animate-pulse bg-zinc-200/50 dark:bg-zinc-700/50 rounded ${
        props.class ?? ""
      }`}
      aria-hidden="true"
    />
  );
}

function SkeletonText(props: SkeletonProps) {
  return <Skeleton class={`h-4 ${props.class ?? ""}`} />;
}

function SkeletonAvatar(props: SkeletonProps) {
  return <Skeleton class={`w-10 h-10 rounded-full ${props.class ?? ""}`} />;
}

function SkeletonCard(props: SkeletonProps) {
  return (
    <div
      class={`bg-zinc-100 dark:bg-zinc-900 rounded-lg p-4 border border-zinc-200 dark:border-zinc-800 ${
        props.class ?? ""
      }`}
    >
      <div class="flex items-start gap-3">
        <SkeletonAvatar />
        <div class="flex-1 space-y-2">
          <SkeletonText class="w-1/3" />
          <SkeletonText class="w-2/3" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonList(props: SkeletonProps & { count?: number }) {
  return (
    <div
      class={`space-y-3 ${props.class ?? ""}`}
      role="status"
      aria-label="Loading content"
    >
      <For each={Array.from({ length: props.count ?? 3 })}>
        {() => <SkeletonCard />}
      </For>
    </div>
  );
}
