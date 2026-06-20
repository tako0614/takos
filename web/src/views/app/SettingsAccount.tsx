import { useI18n } from "../../store/i18n.ts";
import type { User } from "../../types/index.ts";

export function SettingsAccount(props: { user: User | null }) {
  const { t } = useI18n();

  return (
    <div class="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div class="space-y-3 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-zinc-500 dark:text-zinc-400">{t("name")}</span>
          <span class="font-medium text-zinc-900 dark:text-zinc-100">
            {props.user?.name || "-"}
          </span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-zinc-500 dark:text-zinc-400">{t("email")}</span>
          <span class="font-medium text-zinc-900 dark:text-zinc-100">
            {props.user?.email || "-"}
          </span>
        </div>
      </div>
    </div>
  );
}
