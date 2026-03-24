import { Icons } from '../../lib/Icons';

interface ChatErrorBannerProps {
  error: string;
  onDismiss: () => void;
}

export function ChatErrorBanner({ error, onDismiss }: ChatErrorBannerProps) {
  return (
    <div className="flex items-center gap-2 mx-4 mb-2 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200">
      <Icons.AlertTriangle className="w-5 h-5 text-zinc-600 dark:text-zinc-400 flex-shrink-0" />
      <span className="flex-1 text-sm">{error}</span>
      <button className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-600 dark:text-zinc-400" onClick={onDismiss}>
        <Icons.X />
      </button>
    </div>
  );
}
