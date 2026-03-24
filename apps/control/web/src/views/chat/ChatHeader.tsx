import type { ReactNode } from 'react';
import { ModelSwitcher } from './ModelSwitcher';

interface ChatHeaderProps {
  selectedModel: string;
  isLoading: boolean;
  onTierChange?: (model: string) => void;
  actions?: ReactNode;
}

export function ChatHeader({
  selectedModel,
  isLoading,
  onTierChange,
  actions,
}: ChatHeaderProps) {
  return (
    <div className="hidden md:flex items-center px-6 lg:px-8 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <ModelSwitcher selectedModel={selectedModel} isLoading={isLoading} onTierChange={onTierChange} />
      <div className="ml-auto flex items-center gap-2">
        {actions}
      </div>
    </div>
  );
}
