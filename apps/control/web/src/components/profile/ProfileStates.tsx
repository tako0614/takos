import { Icons } from '../../lib/Icons';

interface ProfileLoadingStateProps {
  label?: string;
}

export function ProfileLoadingState({ label = 'Loading profile...' }: ProfileLoadingStateProps) {
  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900">
      <div className="flex flex-col items-center justify-center flex-1 text-zinc-500 dark:text-zinc-400">
        <div className="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-900 dark:border-t-white rounded-full animate-spin" />
        <span className="mt-3">{label}</span>
      </div>
    </div>
  );
}

interface ProfileErrorStateProps {
  message: string;
  onBack?: () => void;
}

export function ProfileErrorState({ message, onBack }: ProfileErrorStateProps) {
  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900">
      <div className="flex flex-col items-center justify-center flex-1 text-zinc-700 dark:text-zinc-300">
        <Icons.AlertTriangle className="w-12 h-12" />
        <span className="mt-3 text-lg">{message}</span>
        {onBack && (
          <button
            className="mt-4 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={onBack}
          >
            Go Back
          </button>
        )}
      </div>
    </div>
  );
}
