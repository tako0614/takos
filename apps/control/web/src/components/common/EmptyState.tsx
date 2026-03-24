import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
}

export function EmptyState({ icon, title, subtitle }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
      {icon}
      <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
      {subtitle && (
        <p className="mt-1 text-sm">{subtitle}</p>
      )}
    </div>
  );
}
