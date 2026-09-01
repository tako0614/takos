import { createSignal } from "solid-js";
import { Icons } from "../lib/Icons.tsx";
import { useI18n } from "../store/i18n.ts";
import { useMemoryData } from "../hooks/useMemoryData.ts";
import { MemoryList } from "./memory/MemoryList.tsx";
import { MemoryCreateForm, ReminderCreateForm } from "./memory/MemoryForm.tsx";
import type { Memory, Reminder } from "../types/index.ts";

export interface MemoryPageProps {
  spaceId: string;
  spaceRecordId: string;
  onBack: () => void;
}

const getPriorityClasses = (pri: Reminder["priority"]) => {
  switch (pri) {
    case "critical":
      return "border-l-4 border-l-danger";
    case "high":
      return "border-l-4 border-l-accent";
    case "normal":
      return "border-l-4 border-l-accent";
    case "low":
      return "border-l-4 border-l-text-zinc-500";
    default:
      return "border-l-4 border-l-accent";
  }
};

export function MemoryPage(props: MemoryPageProps) {
  const { t } = useI18n();
  const [showReminders, setShowReminders] = createSignal(false);
  const [showCreateMemory, setShowCreateMemory] = createSignal(false);
  const [showCreateReminder, setShowCreateReminder] = createSignal(false);
  const [editingMemory, setEditingMemory] = createSignal<Memory | null>(null);
  const [editingReminder, setEditingReminder] = createSignal<Reminder | null>(
    null,
  );

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
    updateMemory,
    updateReminder,
    memoryForm,
    setMemoryForm,
    reminderForm,
    setReminderForm,
    handleCreateMemory: baseCreateMemory,
    handleCreateReminder: baseCreateReminder,
    getTypeIcon,
    getTypeLabel,
    getTriggerIcon,
  } = useMemoryData(() => props.spaceId, () => props.spaceRecordId);

  const handleCreateMemory = async (
    e: Event & { currentTarget: HTMLFormElement },
  ) => {
    e.preventDefault();
    const current = editingMemory();
    const saved = current
      ? await updateMemory(current.id, {
        content: memoryForm().content,
        category: memoryForm().category,
      })
      : await baseCreateMemory(e);
    if (saved) {
      setShowCreateMemory(false);
      setEditingMemory(null);
    }
  };

  const handleCreateReminder = async (
    e: Event & { currentTarget: HTMLFormElement },
  ) => {
    e.preventDefault();
    const current = editingReminder();
    const saved = current
      ? await updateReminder(current.id, {
        content: reminderForm().content,
        trigger_value: reminderForm().triggerValue,
        priority: reminderForm().priority,
      })
      : await baseCreateReminder(e);
    if (saved) {
      setShowCreateReminder(false);
      setEditingReminder(null);
    }
  };

  const openCreateMemory = () => {
    setEditingMemory(null);
    setMemoryForm({
      content: "",
      type: "semantic",
      category: "",
      saving: false,
    });
    setShowCreateMemory(true);
  };

  const openCreateReminder = () => {
    setEditingReminder(null);
    setReminderForm({
      content: "",
      triggerType: "time",
      triggerValue: "",
      priority: "normal",
      saving: false,
    });
    setShowCreateReminder(true);
  };

  const openEditMemory = (memory: Memory) => {
    setEditingMemory(memory);
    setMemoryForm({
      content: memory.content,
      type: memory.type,
      category: memory.category ?? "",
      saving: false,
    });
    setShowCreateMemory(true);
  };

  const openEditReminder = (reminder: Reminder) => {
    setEditingReminder(reminder);
    setReminderForm({
      content: reminder.content,
      triggerType: reminder.trigger_type,
      triggerValue: reminder.trigger_value ?? "",
      priority: reminder.priority,
      saving: false,
    });
    setShowCreateReminder(true);
  };

  return (
    <div class="flex flex-col h-full bg-white dark:bg-zinc-900">
      <header class="flex items-center gap-4 px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
        <button
          type="button"
          class="p-2 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={props.onBack}
          aria-label={t("back")}
        >
          <Icons.ArrowLeft />
        </button>
        <h1 class="flex items-center gap-2 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          <Icons.HardDrive />
          <span>{t("memories")}</span>
        </h1>
        <div class="ml-auto">
          <button
            type="button"
            class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors cursor-pointer"
            onClick={() =>
              showReminders() ? openCreateReminder() : openCreateMemory()}
          >
            <Icons.Plus />
            <span>
              {showReminders() ? t("createReminder") : t("createMemory")}
            </span>
          </button>
        </div>
      </header>

      <MemoryList
        memories={memories()}
        reminders={reminders()}
        loading={showReminders() ? remindersLoading() : loading()}
        error={showReminders() ? reminderError() : memoryError()}
        onRetry={() =>
          showReminders() ? void fetchReminders() : void fetchMemories()}
        showReminders={showReminders()}
        onShowRemindersChange={setShowReminders}
        onDeleteMemory={deleteMemory}
        onDeleteReminder={deleteReminder}
        onEditMemory={openEditMemory}
        onEditReminder={openEditReminder}
        getTypeIcon={getTypeIcon}
        getTypeLabel={getTypeLabel}
        getTriggerIcon={getTriggerIcon}
        getPriorityClasses={getPriorityClasses}
      />

      {showCreateMemory() && (
        <MemoryCreateForm
          memoryForm={memoryForm()}
          onFormChange={setMemoryForm}
          onSubmit={handleCreateMemory}
          onClose={() => setShowCreateMemory(false)}
          getTypeIcon={getTypeIcon}
          editing={editingMemory() !== null}
        />
      )}

      {showCreateReminder() && (
        <ReminderCreateForm
          reminderForm={reminderForm()}
          onFormChange={setReminderForm}
          onSubmit={handleCreateReminder}
          onClose={() => setShowCreateReminder(false)}
          getTriggerIcon={getTriggerIcon}
          editing={editingReminder() !== null}
        />
      )}
    </div>
  );
}
