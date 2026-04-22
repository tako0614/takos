import { createMemo, createSignal } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import type { Memory, Reminder } from "../../types/index.ts";

export interface MemoryListProps {
  memories: Memory[];
  reminders: Reminder[];
  loading: boolean;
  showReminders: boolean;
  onShowRemindersChange: (value: boolean) => void;
  onDeleteMemory: (id: string) => void;
  onDeleteReminder: (id: string) => void;
  getTypeIcon: (type: Memory["type"]) => string;
  getTypeLabel: (type: Memory["type"]) => string;
  getTriggerIcon: (type: Reminder["trigger_type"]) => string;
  getPriorityClasses: (priority: Reminder["priority"]) => string;
}

export function MemoryList(props: MemoryListProps) {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = createSignal("");
  const [activeFilter, setActiveFilter] = createSignal<"all" | Memory["type"]>(
    "all",
  );

  const filteredMemories = createMemo(() =>
    props.memories.filter((m) => {
      const matchesFilter = activeFilter() === "all" ||
        m.type === activeFilter();
      const matchesSearch = !searchQuery() ||
        m.content.toLowerCase().includes(searchQuery().toLowerCase()) ||
        (m.category &&
          m.category.toLowerCase().includes(searchQuery().toLowerCase()));
      return matchesFilter && matchesSearch;
    })
  );

  return (
    <div class="flex-1 overflow-y-auto p-6">
      <div class="flex gap-2 mb-6 border-b border-zinc-200 dark:border-zinc-700">
        <button
          type="button"
          class={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            !props.showReminders
              ? "text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100"
              : "text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
          onClick={() => props.onShowRemindersChange(false)}
        >
          <Icons.HardDrive />
          <span>{t("memories")} ({props.memories.length})</span>
        </button>
        <button
          type="button"
          class={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            props.showReminders
              ? "text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100"
              : "text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
          onClick={() => props.onShowRemindersChange(true)}
        >
          <Icons.Bell />
          <span>{t("reminders")} ({props.reminders.length})</span>
        </button>
      </div>

      {props.loading
        ? (
          <div class="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
            <div class="w-8 h-8 border-2 border-zinc-900 dark:border-zinc-100 border-t-transparent rounded-full animate-spin mb-4" />
            <span>{t("loading")}</span>
          </div>
        )
        : !props.showReminders
        ? (
          <div class="flex flex-col gap-6">
            <div class="flex flex-col gap-4">
              <div class="relative flex items-center">
                <Icons.Search class="w-5 h-5 absolute left-3 text-zinc-500 dark:text-zinc-400" />
                <input
                  type="text"
                  class="w-full pl-10 pr-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors"
                  placeholder={t("memorySearch")}
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                />
              </div>
              <div class="flex flex-wrap gap-2">
                {(["all", "episode", "semantic", "procedural"] as const).map(
                  (filter) => (
                    <button
                      type="button"
                      class={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        activeFilter() === filter
                          ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100"
                      }`}
                      onClick={() => setActiveFilter(filter)}
                    >
                      {filter === "all" ? "All" : props.getTypeIcon(filter)}
                      {" "}
                      {filter === "all" ? "" : props.getTypeLabel(filter)}
                    </button>
                  ),
                )}
              </div>
            </div>

            {filteredMemories().length === 0
              ? (
                <div class="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
                  <Icons.HardDrive class="w-12 h-12 mb-4" />
                  <p>{t("noMemories")}</p>
                </div>
              )
              : (
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredMemories().map((memory) => (
                    <div class="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 flex flex-col gap-3 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors">
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-sm text-zinc-500 dark:text-zinc-400">
                          {props.getTypeIcon(memory.type)}{" "}
                          {props.getTypeLabel(memory.type)}
                        </span>
                        {memory.category && (
                          <span class="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-700 rounded text-xs text-zinc-500 dark:text-zinc-400">
                            {memory.category}
                          </span>
                        )}
                      </div>
                      <div class="flex-1 text-sm text-zinc-900 dark:text-zinc-100 leading-relaxed">
                        {memory.content}
                      </div>
                      <div class="flex items-center justify-between gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                        <span
                          class="text-xs text-zinc-600 dark:text-zinc-400"
                          title={t("memoryImportance")}
                        >
                          {"\u2605".repeat(Math.round(memory.importance * 5))}
                          {"\u2606".repeat(
                            5 - Math.round(memory.importance * 5),
                          )}
                        </span>
                        <span class="text-xs text-zinc-500 dark:text-zinc-400">
                          {new Date(memory.created_at).toLocaleDateString()}
                        </span>
                        <button
                          type="button"
                          class="p-1.5 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                          onClick={() => props.onDeleteMemory(memory.id)}
                          title={t("deleteMemory")}
                        >
                          <Icons.Trash />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        )
        : (
          <div class="flex flex-col gap-6">
            {props.reminders.length === 0
              ? (
                <div class="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
                  <Icons.Bell class="w-12 h-12 mb-4" />
                  <p>{t("noReminders")}</p>
                </div>
              )
              : (
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {props.reminders.map((reminder) => (
                    <div
                      class={`bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 flex flex-col gap-3 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors ${
                        props.getPriorityClasses(reminder.priority)
                      }`}
                    >
                      <div class="flex items-center justify-between gap-2">
                        <span class="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                          {props.getTriggerIcon(reminder.trigger_type)}
                          <span>
                            {reminder.trigger_type === "time"
                              ? t("reminderTime")
                              : reminder.trigger_type === "condition"
                              ? t("reminderCondition")
                              : t("reminderContext")}
                          </span>
                        </span>
                        <span
                          class={`px-2 py-0.5 rounded text-xs font-medium ${
                            reminder.status === "pending"
                              ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
                              : reminder.status === "triggered"
                              ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                              : "bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
                          }`}
                        >
                          {reminder.status === "pending"
                            ? t("reminderPending")
                            : reminder.status === "triggered"
                            ? t("reminderTriggered")
                            : t("reminderDismissed")}
                        </span>
                      </div>
                      <div class="flex-1 text-sm text-zinc-900 dark:text-zinc-100 leading-relaxed">
                        {reminder.content}
                      </div>
                      <div class="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-700 px-2 py-1 rounded">
                        {reminder.trigger_value}
                      </div>
                      <div class="flex items-center justify-between gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                        <span class="text-xs text-zinc-500 dark:text-zinc-400">
                          {new Date(reminder.created_at).toLocaleDateString()}
                        </span>
                        <button
                          type="button"
                          class="p-1.5 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                          onClick={() => props.onDeleteReminder(reminder.id)}
                          title={t("delete")}
                        >
                          <Icons.Trash />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        )}
    </div>
  );
}
