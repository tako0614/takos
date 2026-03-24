import { Icons } from '../../../lib/Icons';

interface RepoDetailReadmeProps {
  readme: string | null;
  readmeLoading: boolean;
}

export function RepoDetailReadme({ readme, readmeLoading }: RepoDetailReadmeProps) {
  if (!readme && !readmeLoading) return null;

  return (
    <div className="mt-4 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
        <Icons.FileText className="w-4 h-4 text-zinc-500" />
        <span className="font-medium text-zinc-900 dark:text-zinc-100">README.md</span>
      </div>
      <div className="p-6 bg-white dark:bg-zinc-900">
        {readmeLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="prose dark:prose-invert prose-zinc max-w-none prose-pre:bg-zinc-100 dark:prose-pre:bg-zinc-800 prose-pre:border prose-pre:border-zinc-200 dark:prose-pre:border-zinc-700">
            <pre className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300 font-mono">{readme}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
