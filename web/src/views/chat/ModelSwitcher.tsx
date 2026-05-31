import { For, Show } from "solid-js";
import { getModelLabel, MODEL_OPTIONS } from "../../lib/modelCatalog.ts";
import { Icons } from "../../lib/Icons.tsx";

interface ModelSwitcherProps {
  selectedModel: string;
  isLoading?: boolean;
  onModelChange?: (model: string) => void;
}

export function ModelSwitcher(props: ModelSwitcherProps) {
  return (
    <Show
      when={props.onModelChange}
      fallback={
        <span class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {getModelLabel(props.selectedModel)}
        </span>
      }
    >
      <div class="relative">
        <select
          value={props.selectedModel}
          onInput={(e) => props.onModelChange!(e.currentTarget.value)}
          disabled={props.isLoading ?? false}
          class="appearance-none bg-transparent text-base font-semibold text-zinc-900 dark:text-zinc-100 pr-6 cursor-pointer focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <For each={MODEL_OPTIONS}>
            {(opt) => (
              <option
                value={opt.id}
                class="bg-white dark:bg-zinc-900 text-base font-normal"
              >
                {opt.label}
              </option>
            )}
          </For>
        </select>
        <div class="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500 dark:text-zinc-400">
          <Icons.ChevronDown class="w-4 h-4" />
        </div>
      </div>
    </Show>
  );
}
