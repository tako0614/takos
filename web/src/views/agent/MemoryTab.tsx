import { createSignal, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";
import { Button } from "../../components/ui/index.ts";
import { useMemoryData } from "../../hooks/useMemoryData.ts";
import { MemoryList } from "./MemoryList.tsx";
import { ReminderList } from "./ReminderList.tsx";

export function MemoryTab(props: { spaceId: string }) {
  const { t } = useI18n();
  const [showReminders, setShowReminders] = createSignal(false);

  const {
    memories,
    reminders,
    loading,
    error,
    fetchMemories,
    fetchReminders,
    deleteMemory,
    deleteReminder,
    createMemory,
    createReminder,
    savingMemory,
    savingReminder,
    getTypeIcon,
    getTypeLabel,
  } = useMemoryData(() => props.spaceId);

  return (
    <Show
      when={!loading()}
      fallback={
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            "justify-content": "center",
            padding: "3rem 0",
            color: "var(--color-text-secondary)",
            gap: "0.75rem",
          }}
        >
          <Icons.Loader class="w-5 h-5 animate-spin" aria-hidden="true" />
          <p>{t("loading")}</p>
        </div>
      }
    >
      <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
        <div
          style={{ display: "flex", "align-items": "center", gap: "0.75rem" }}
        >
          <div
            style={{
              display: "flex",
              "background-color": "var(--color-surface-secondary)",
              "border-radius": "var(--radius-lg)",
              padding: "0.25rem",
            }}
          >
            <Button
              variant={!showReminders() ? "primary" : "ghost"}
              size="sm"
              aria-pressed={!showReminders()}
              leftIcon={<Icons.HardDrive aria-hidden="true" />}
              onClick={() => setShowReminders(false)}
            >
              {t("memories")} ({memories().length})
            </Button>
            <Button
              variant={showReminders() ? "primary" : "ghost"}
              size="sm"
              aria-pressed={showReminders()}
              leftIcon={<Icons.Bell aria-hidden="true" />}
              onClick={() => setShowReminders(true)}
            >
              {t("reminders")} ({reminders().length})
            </Button>
          </div>
        </div>

        <Show when={error()}>
          {(err) => (
            <div
              role="alert"
              class="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
            >
              <span class="min-w-0 flex-1">{err()}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void fetchMemories();
                  void fetchReminders();
                }}
              >
                {t("retry")}
              </Button>
            </div>
          )}
        </Show>

        {!showReminders()
          ? (
            <MemoryList
              memories={memories()}
              hasError={Boolean(error())}
              onDelete={deleteMemory}
              onCreateMemory={(data) =>
                createMemory({ ...data, source: "user" })}
              savingMemory={savingMemory()}
              getTypeIcon={getTypeIcon}
              getTypeLabel={getTypeLabel}
            />
          )
          : (
            <ReminderList
              reminders={reminders()}
              hasError={Boolean(error())}
              onDelete={deleteReminder}
              onCreateReminder={createReminder}
              savingReminder={savingReminder()}
            />
          )}
      </div>
    </Show>
  );
}
