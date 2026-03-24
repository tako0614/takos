/**
 * Skeleton components for loading states
 * Provides visual placeholder while content is loading
 */

interface SkeletonProps {
  className?: string;
}

function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-zinc-200/50 dark:bg-zinc-700/50 rounded ${className}`}
      aria-hidden="true"
    />
  );
}

function SkeletonText({ className = '' }: SkeletonProps) {
  return <Skeleton className={`h-4 ${className}`} />;
}

function SkeletonAvatar({ className = '' }: SkeletonProps) {
  return <Skeleton className={`w-10 h-10 rounded-full ${className}`} />;
}

function SkeletonCard({ className = '' }: SkeletonProps) {
  return (
    <div className={`bg-zinc-100 dark:bg-zinc-900 rounded-lg p-4 border border-zinc-200 dark:border-zinc-800 ${className}`}>
      <div className="flex items-start gap-3">
        <SkeletonAvatar />
        <div className="flex-1 space-y-2">
          <SkeletonText className="w-1/3" />
          <SkeletonText className="w-2/3" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonList({ count = 3, className = '' }: SkeletonProps & { count?: number }) {
  return (
    <div className={`space-y-3 ${className}`} role="status" aria-label="Loading content">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
