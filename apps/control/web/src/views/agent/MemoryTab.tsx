import { createSignal } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";
import { Button } from "../../components/ui/index.ts";
import { useMemoryData } from "../../hooks/useMemoryData.ts";
import { MemoryList } from "./MemoryList.tsx";
import { ReminderList } from "./ReminderList.tsx";

export function MemoryTab({ spaceId }: { spaceId: string }) {
  const { t } = useI18n();
  const [showReminders, setShowReminders] = createSignal(false);

  const {
    memories,
    reminders,
    loading,
    deleteMemory,
    deleteReminder,
    createMemory,
    createReminder,
    savingMemory,
    savingReminder,
  } = useMemoryData(spaceId);

  if (loading()) {
    return (
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
    );
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
      <div style={{ display: "flex", "align-items": "center", gap: "0.75rem" }}>
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
            onClick={() =>
              setShowReminders(false)}
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

      {!showReminders()
        ? (
          <MemoryList
            memories={memories()}
            onDelete={deleteMemory}
            onCreateMemory={(data) => createMemory({ ...data, source: "user" })}
            savingMemory={savingMemory()}
          />
        )
        : (
          <ReminderList
            reminders={reminders()}
            onDelete={deleteReminder}
            onCreateReminder={createReminder}
            savingReminder={savingReminder()}
          />
        )}
    </div>
  );
}
