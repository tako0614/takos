import { For } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";

interface StorageBreadcrumbsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function StorageBreadcrumbs(props: StorageBreadcrumbsProps) {
  const { t } = useI18n();
  const breadcrumbParts = () =>
    props.currentPath === "/"
      ? []
      : props.currentPath.split("/").filter(Boolean);

  return (
    <div class="flex-shrink-0 flex items-center gap-1 px-5 pb-2 overflow-x-auto">
      <button
        type="button"
        onClick={() => props.onNavigate("/")}
        class={"flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors " +
          (breadcrumbParts().length === 0
            ? "font-medium text-zinc-900 dark:text-zinc-100 bg-zinc-200/60 dark:bg-zinc-800"
            : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800")}
      >
        <Icons.HardDrive class="w-4 h-4" />
        {t("storageTitle")}
      </button>
      <For each={breadcrumbParts()}>
        {(part, index) => {
          const isLast = () => index() === breadcrumbParts().length - 1;
          return (
            <>
              <Icons.ChevronRight class="w-4 h-4 text-zinc-400 flex-shrink-0" />
              <button
                type="button"
                onClick={() =>
                  props.onNavigate(
                    "/" + breadcrumbParts().slice(0, index() + 1).join("/"),
                  )}
                class={"px-3 py-1.5 rounded-lg text-sm truncate max-w-[200px] transition-colors " +
                  (isLast()
                    ? "font-medium text-zinc-900 dark:text-zinc-100 bg-zinc-200/60 dark:bg-zinc-800"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800")}
              >
                {part}
              </button>
            </>
          );
        }}
      </For>
    </div>
  );
}
