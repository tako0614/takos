import { createSignal, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";
import { Button } from "../../components/ui/index.ts";
import { useMemoryData } from "../../hooks/useMemoryData.ts";
import { MemoryList } from "./MemoryList.tsx";
import { ReminderList } from "./ReminderList.tsx";

export function MemoryTab(props: {
  spaceId: string;
  spaceRecordId: string;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const [showReminders, setShowReminders] = createSignal(false);

  const {
    memories,
    reminders,
    loading,
    remindersLoading,
    memoryError,
    reminderError,
    fetchMemories,
    fetchReminders,
    deleteMemory,
    deleteReminder,
    createMemory,
    createReminder,
    updateMemory,
    updateReminder,
    savingMemory,
    savingReminder,
    getTypeIcon,
    getTypeLabel,
  } = useMemoryData(() => props.spaceId, () => props.spaceRecordId);

  const selectedError = () =>
    showReminders() ? reminderError() : memoryError();

  return (
    <Show
      when={!loading()}
      fallback={
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            "justify-content": "center",
            padding: "3rem 0",
            color: "var(--color-text-tertiary)",
            gap: "0.75rem",
          }}
        >
          <Icons.Loader class="w-5 h-5 animate-spin" />
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
              leftIcon={<Icons.HardDrive />}
              onClick={() => setShowReminders(false)}
            >
              {t("memories")} ({memories().length})
            </Button>
            <Button
              variant={showReminders() ? "primary" : "ghost"}
              size="sm"
              leftIcon={<Icons.Bell />}
              onClick={() => setShowReminders(true)}
            >
              {t("reminders")} ({reminders().length})
            </Button>
          </div>
        </div>

        <Show when={selectedError()}>
          {(message) => (
            <div
              role="alert"
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                border: "1px solid var(--color-error)",
                "border-radius": "var(--radius-md)",
                color: "var(--color-error)",
              }}
            >
              <span>{message()}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  showReminders()
                    ? void fetchReminders()
                    : void fetchMemories()}
              >
                {t("retry")}
              </Button>
            </div>
          )}
        </Show>

        <Show
          when={
            (showReminders() ? reminders().length : memories().length) > 0 ||
            !selectedError()
          }
        >
          <Show
            when={!showReminders() || !remindersLoading()}
            fallback={
              <div
                style={{
                  display: "flex",
                  "justify-content": "center",
                  padding: "3rem 0",
                }}
              >
                <Icons.Loader class="w-5 h-5 animate-spin" />
              </div>
            }
          >
            {!showReminders()
              ? (
              <MemoryList
                memories={memories()}
                onDelete={deleteMemory}
                onCreateMemory={createMemory}
                onUpdateMemory={updateMemory}
                savingMemory={savingMemory()}
                canEdit={props.canEdit}
                getTypeIcon={getTypeIcon}
                getTypeLabel={getTypeLabel}
              />
            )
              : (
              <ReminderList
                reminders={reminders()}
                onDelete={deleteReminder}
                onCreateReminder={createReminder}
                onUpdateReminder={updateReminder}
                savingReminder={savingReminder()}
                canEdit={props.canEdit}
              />
              )}
          </Show>
        </Show>
      </div>
    </Show>
  );
}
