import type { JSX } from 'solid-js';
import { ModelSwitcher } from './ModelSwitcher';

interface ChatHeaderProps {
  selectedModel: string;
  isLoading: boolean;
  onModelChange?: (model: string) => void;
  actions?: JSX.Element;
}

export function ChatHeader(props: ChatHeaderProps) {
  return (
    <div class="hidden md:flex items-center px-6 lg:px-8 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <ModelSwitcher selectedModel={props.selectedModel} isLoading={props.isLoading} onModelChange={props.onModelChange} />
      <div class="ml-auto flex items-center gap-2">
        {props.actions}
      </div>
    </div>
  );
}
