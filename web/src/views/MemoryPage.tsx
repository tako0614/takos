import { createSignal } from "solid-js";
import { Icons } from "../lib/Icons.tsx";
import { useI18n } from "../store/i18n.ts";
import { useMemoryData } from "../hooks/useMemoryData.ts";
import { MemoryList } from "./memory/MemoryList.tsx";
import { MemoryCreateForm, ReminderCreateForm } from "./memory/MemoryForm.tsx";
import type { Reminder } from "../types/index.ts";

export interface MemoryPageProps {
  spaceId: string;
  onBack: () => void;
}

const getPriorityClasses = (pri: Reminder["priority"]) => {
  switch (pri) {
    case "high":
      return "border-l-4 border-l-danger";
    case "normal":
      return "border-l-4 border-l-accent";
    case "low":
      return "border-l-4 border-l-zinc-500";
    default:
      return "border-l-4 border-l-accent";
  }
};

export function MemoryPage(props: MemoryPageProps) {
  const { t } = useI18n();
  const [showReminders, setShowReminders] = createSignal(false);
  const [showCreateMemory, setShowCreateMemory] = createSignal(false);
  const [showCreateReminder, setShowCreateReminder] = createSignal(false);

  const {
    memories,
    reminders,
    loading,
    error,
    fetchMemories,
    fetchReminders,
    deleteMemory,
    deleteReminder,
    memoryForm,
    setMemoryForm,
    reminderForm,
    setReminderForm,
    handleCreateMemory: baseCreateMemory,
    handleCreateReminder: baseCreateReminder,
    getTypeIcon,
    getTypeLabel,
    getTriggerIcon,
  } = useMemoryData(() => props.spaceId);

  const handleCreateMemory = async (
    e: Event & { currentTarget: HTMLFormElement },
  ) => {
    if (await baseCreateMemory(e)) {
      setShowCreateMemory(false);
    }
  };

  const handleCreateReminder = async (
    e: Event & { currentTarget: HTMLFormElement },
  ) => {
    if (await baseCreateReminder(e)) {
      setShowCreateReminder(false);
    }
  };

  const handleRetry = () => {
    void fetchMemories();
    void fetchReminders();
  };

  return (
    <div class="flex flex-col h-full bg-white dark:bg-zinc-900">
      <header class="flex items-center gap-2 sm:gap-4 px-3 sm:px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
        <button
          type="button"
          class="p-2 min-w-[44px] min-h-[44px] shrink-0 flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={props.onBack}
          aria-label={t("goBack")}
          title={t("goBack")}
        >
          <Icons.ArrowLeft aria-hidden="true" />
        </button>
        <h1 class="flex items-center gap-2 min-w-0 text-lg sm:text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          <Icons.Database class="h-5 w-5 shrink-0" aria-hidden="true" />
          <span class="min-w-0 truncate">{t("memories")}</span>
        </h1>
        <div class="ml-auto shrink-0">
          <button
            type="button"
            class="inline-flex min-h-[44px] md:min-h-0 items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium text-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors cursor-pointer"
            onClick={() =>
              showReminders()
                ? setShowCreateReminder(true)
                : setShowCreateMemory(true)}
          >
            <Icons.Plus aria-hidden="true" />
            <span>
              {showReminders() ? t("createReminder") : t("createMemory")}
            </span>
          </button>
        </div>
      </header>

      <MemoryList
        memories={memories()}
        reminders={reminders()}
        loading={loading()}
        error={error()}
        onRetry={handleRetry}
        showReminders={showReminders()}
        onShowRemindersChange={setShowReminders}
        onDeleteMemory={deleteMemory}
        onDeleteReminder={deleteReminder}
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
        />
      )}

      {showCreateReminder() && (
        <ReminderCreateForm
          reminderForm={reminderForm()}
          onFormChange={setReminderForm}
          onSubmit={handleCreateReminder}
          onClose={() => setShowCreateReminder(false)}
          getTriggerIcon={getTriggerIcon}
        />
      )}
    </div>
  );
}
