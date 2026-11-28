import { For, Show } from "solid-js";
import {
  getModelLabel,
  MODEL_OPTIONS,
  type ModelSelectOption,
} from "../../lib/modelCatalog.ts";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";

interface ModelSwitcherProps {
  selectedModel: string;
  models?: readonly ModelSelectOption[];
  isLoading?: boolean;
  onModelChange?: (model: string) => void;
}

export function ModelSwitcher(props: ModelSwitcherProps) {
  const { t } = useI18n();
  const models = () => (props.models?.length ? props.models : MODEL_OPTIONS);
  return (
    <Show
      when={props.onModelChange}
      fallback={
        <span class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {getModelLabel(props.selectedModel)}
        </span>
      }
    >
      <div class="relative inline-flex max-w-full min-w-0 items-center">
        <select
          value={props.selectedModel}
          onInput={(e) => props.onModelChange!(e.currentTarget.value)}
          disabled={props.isLoading ?? false}
          aria-label={t("selectModel")}
          class="appearance-none min-h-[44px] md:min-h-0 max-w-full min-w-0 truncate bg-transparent text-base font-semibold text-zinc-900 dark:text-zinc-100 pr-6 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <For each={models()}>
            {(opt) => (
              <option
                value={opt.id}
                disabled={opt.disabled}
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
