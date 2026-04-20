import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { useCustomTools } from "../../hooks/useCustomTools.ts";
import { ToolCard } from "./ToolCard.tsx";

interface CustomToolsSectionProps {
  selectedSpaceId: string | null;
}

export function CustomToolsSection(props: CustomToolsSectionProps) {
  const { t } = useI18n();
  const { tools, loading } = useCustomTools({
    spaceId: () => props.selectedSpaceId || "",
  });

  if (!props.selectedSpaceId) {
    return (
      <div class="flex flex-col items-center justify-center h-64 gap-4">
        <div class="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
          <Icons.Wrench class="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
        </div>
        <p class="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          {t("selectSpace")}
        </p>
      </div>
    );
  }

  return loading()
    ? (
      <div class="flex flex-col items-center justify-center h-64 gap-4">
        <div class="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
        <span class="text-sm text-zinc-400">{t("loading")}</span>
      </div>
    )
    : tools().length === 0
    ? (
      <div class="flex flex-col items-center justify-center h-64 gap-4">
        <div class="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
          <Icons.Wrench class="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
        </div>
        <div class="text-center">
          <p class="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            {t("noCustomToolsYet")}
          </p>
        </div>
      </div>
    )
    : (
      <div class="grid gap-3">
        {tools().map((tool) => <ToolCard key={tool.id} tool={tool} />)}
      </div>
    );
}
