import type { JSX } from "solid-js";
import type { ModelSelectOption } from "../../lib/modelCatalog.ts";
import { ModelSwitcher } from "./ModelSwitcher.tsx";

interface ChatHeaderProps {
  selectedModel: string;
  models?: readonly ModelSelectOption[];
  isLoading: boolean;
  onModelChange?: (model: string) => void;
  actions?: JSX.Element;
}

export function ChatHeader(props: ChatHeaderProps) {
  return (
    <div class="hidden md:flex items-center px-6 lg:px-8 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <ModelSwitcher
        selectedModel={props.selectedModel}
        models={props.models}
        isLoading={props.isLoading}
        onModelChange={props.onModelChange}
      />
      <div class="ml-auto flex items-center gap-2">{props.actions}</div>
    </div>
  );
}
