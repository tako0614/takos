import { createMemo, createSignal, Show } from "solid-js";
import { moveTabFocus } from "../../lib/a11y.ts";
import { Icons } from "../../lib/Icons.tsx";
import {
  formatImportanceRating,
  formatImportanceStars,
  formatLocalizedDate,
} from "../../lib/memory-format.ts";
import { useI18n } from "../../store/i18n.ts";
import type { Memory, Reminder } from "../../types/index.ts";

export interface MemoryListProps {
  memories: Memory[];
  reminders: Reminder[];
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
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
  const i18n = useI18n();
  const t = i18n.t;
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

  const handleTabKeyDown = (e: KeyboardEvent) => {
    const nextTab = moveTabFocus(e);
    if (nextTab === "memories") props.onShowRemindersChange(false);
    else if (nextTab === "reminders") props.onShowRemindersChange(true);
  };

  return (
    <div class="flex-1 overflow-y-auto p-6">
      <div
        role="tablist"
        aria-label={t("memories")}
        class="flex gap-2 mb-6 border-b border-zinc-200 dark:border-zinc-700"
      >
        <button
          id="memory-tab-memories"
          type="button"
          role="tab"
          data-tab-id="memories"
          aria-selected={!props.showReminders}
          aria-controls="memory-panel-memories"
          tabIndex={!props.showReminders ? 0 : -1}
          class={`flex items-center gap-2 min-h-[44px] px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            !props.showReminders
              ? "text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100"
              : "text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
          onClick={() => props.onShowRemindersChange(false)}
          onKeyDown={handleTabKeyDown}
        >
          <Icons.HardDrive aria-hidden="true" />
          <span>{`${t("memories")} (${props.memories.length})`}</span>
        </button>
        <button
          id="memory-tab-reminders"
          type="button"
          role="tab"
          data-tab-id="reminders"
          aria-selected={props.showReminders}
          aria-controls="memory-panel-reminders"
          tabIndex={props.showReminders ? 0 : -1}
          class={`flex items-center gap-2 min-h-[44px] px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            props.showReminders
              ? "text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100"
              : "text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
          onClick={() => props.onShowRemindersChange(true)}
          onKeyDown={handleTabKeyDown}
        >
          <Icons.Bell aria-hidden="true" />
          <span>{`${t("reminders")} (${props.reminders.length})`}</span>
        </button>
      </div>

      <Show when={props.error}>
        {(err) => (
          <div
            role="alert"
            class="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
          >
            <Icons.AlertTriangle class="h-4 w-4 shrink-0" />
            <span class="min-w-0 flex-1">{err()}</span>
            <Show when={props.onRetry}>
              <button
                type="button"
                class="min-h-[44px] sm:min-h-0 rounded-lg border border-red-300 dark:border-red-800 px-3 py-1.5 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                onClick={() => props.onRetry?.()}
              >
                {t("retry")}
              </button>
            </Show>
          </div>
        )}
      </Show>

      {props.loading
        ? (
          <div class="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
            <div class="w-8 h-8 border-2 border-zinc-900 dark:border-zinc-100 border-t-transparent rounded-full animate-spin mb-4" />
            <span>{t("loading")}</span>
          </div>
        )
        : !props.showReminders
        ? (
          <div
            id="memory-panel-memories"
            role="tabpanel"
            aria-labelledby="memory-tab-memories"
            class="flex flex-col gap-6"
          >
            <div class="flex flex-col gap-4">
              <div class="relative flex items-center">
                <Icons.Search
                  aria-hidden="true"
                  class="pointer-events-none w-5 h-5 absolute left-3 text-zinc-500 dark:text-zinc-400"
                />
                <input
                  type="text"
                  class="w-full min-h-[44px] pl-10 pr-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-base sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100 focus:ring-2 focus:ring-zinc-900/15 dark:focus:ring-zinc-100/20 transition-colors"
                  placeholder={t("memorySearch")}
                  aria-label={t("memorySearch")}
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                />
              </div>
              <div class="flex flex-wrap gap-2">
                {(["all", "episode", "semantic", "procedural"] as const).map(
                  (filter) => (
                    <button
                      type="button"
                      aria-pressed={activeFilter() === filter}
                      class={`min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        activeFilter() === filter
                          ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100"
                      }`}
                      onClick={() => setActiveFilter(filter)}
                    >
                      {filter === "all"
                        ? t("all")
                        : `${props.getTypeIcon(filter)} ${props.getTypeLabel(filter)}`}
                    </button>
                  ),
                )}
              </div>
            </div>

            {filteredMemories().length === 0
              ? !props.error && (
                <div class="flex flex-col items-center justify-center gap-3 py-16 text-zinc-500 dark:text-zinc-400">
                  <Icons.HardDrive class="w-12 h-12" aria-hidden="true" />
                  <p>
                    {props.memories.length > 0 &&
                        (searchQuery().trim() || activeFilter() !== "all")
                      ? t("noResults")
                      : t("noMemories")}
                  </p>
                  <Show
                    when={props.memories.length > 0 &&
                      (searchQuery().trim() || activeFilter() !== "all")}
                  >
                    <button
                      type="button"
                      class="min-h-[44px] sm:min-h-0 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                      onClick={() => {
                        setSearchQuery("");
                        setActiveFilter("all");
                      }}
                    >
                      {t("clearFilters")}
                    </button>
                  </Show>
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
                          <span class="px-2 py-0.5 bg-zinc-200/80 dark:bg-zinc-700 rounded text-xs text-zinc-700 dark:text-zinc-200">
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
                          title={`${t("memoryImportance")}: ${
                            formatImportanceRating(memory.importance)
                          }/5`}
                          aria-label={`${t("memoryImportance")}: ${
                            formatImportanceRating(memory.importance)
                          }/5`}
                        >
                          <span aria-hidden="true">
                            {formatImportanceStars(memory.importance)}
                          </span>
                        </span>
                        <span class="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatLocalizedDate(memory.created_at, i18n.lang)}
                        </span>
                        <button
                          type="button"
                          class="inline-flex min-w-[44px] min-h-[44px] md:min-w-8 md:min-h-8 items-center justify-center rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                          onClick={() => props.onDeleteMemory(memory.id)}
                          title={t("deleteMemory")}
                          aria-label={t("deleteMemory")}
                        >
                          <Icons.Trash class="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        )
        : (
          <div
            id="memory-panel-reminders"
            role="tabpanel"
            aria-labelledby="memory-tab-reminders"
            class="flex flex-col gap-6"
          >
            {props.reminders.length === 0
              ? !props.error && (
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
                              ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200"
                              : reminder.status === "triggered"
                              ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                              : "bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-200"
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
                      <div class="text-xs text-zinc-700 dark:text-zinc-200 bg-zinc-200/80 dark:bg-zinc-700 px-2 py-1 rounded">
                        {reminder.trigger_value}
                      </div>
                      <div class="flex items-center justify-between gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                        <span class="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatLocalizedDate(reminder.created_at, i18n.lang)}
                        </span>
                        <button
                          type="button"
                          class="inline-flex min-w-[44px] min-h-[44px] md:min-w-8 md:min-h-8 items-center justify-center rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                          onClick={() => props.onDeleteReminder(reminder.id)}
                          title={t("delete")}
                          aria-label={t("delete")}
                        >
                          <Icons.Trash class="w-4 h-4" aria-hidden="true" />
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
