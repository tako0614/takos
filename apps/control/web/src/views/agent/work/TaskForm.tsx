import { createMemo } from "solid-js";
import { useI18n } from "../../../store/i18n.ts";
import type { TranslationKey } from "../../../i18n.ts";
import { Icons } from "../../../lib/Icons.tsx";
import type { AgentTask, AgentTaskPriority } from "../../../types/index.ts";
import {
  type EditableAgentTaskStatus,
  type ModelSelectOption,
  PRIORITY_OPTIONS,
  STATUS_ORDER,
} from "./task-work-types.ts";
import {
  getAgentTypeOptions,
  getLocalDateInputMin,
} from "./task-work-utils.ts";

interface TaskFormProps {
  editingTask: AgentTask | null;
  title: string;
  setTitle: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  status: EditableAgentTaskStatus;
  setStatus: (value: EditableAgentTaskStatus) => void;
  priority: AgentTaskPriority;
  setPriority: (value: AgentTaskPriority) => void;
  agentType: string;
  setAgentType: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  dueAt: string;
  setDueAt: (value: string) => void;
  availableModels: ModelSelectOption[];
  saving: boolean;
  error: string | null;
  onSubmit: (e: Event & { currentTarget: HTMLFormElement }) => void;
  onClose: () => void;
}

export function TaskForm(props: TaskFormProps) {
  const { t, tOr } = useI18n();
  const tx = (key: string) => t(key as TranslationKey);
  const agentTypeOptions = createMemo(() =>
    getAgentTypeOptions(props.agentType)
  );

  return (
    <form
      class="flex flex-col gap-4"
      onSubmit={(e) => props.onSubmit(e)}
    >
      <div class="flex items-start justify-between gap-3 mb-2">
        <div class="space-y-1">
          <h4 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {props.editingTask ? t("editTask") : t("createTask")}
          </h4>
          <p class="text-sm text-zinc-500 dark:text-zinc-400">
            {props.editingTask
              ? tOr(
                "taskFormEditHint" as TranslationKey,
                "Update scope, status, or execution settings without leaving the board.",
              )
              : tOr(
                "taskFormCreateHint" as TranslationKey,
                "Define one outcome, then let the agent pick it up from chat.",
              )}
          </p>
        </div>
        <button
          type="button"
          class="p-2 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          onClick={() => props.onClose()}
          aria-label={t("close")}
        >
          <Icons.X />
        </button>
      </div>
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("taskTitle")}
        </label>
        <input
          type="text"
          class="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
          placeholder={t("taskTitlePlaceholder")}
          value={props.title}
          onInput={(e) => props.setTitle(e.currentTarget.value)}
          autofocus
          required
        />
      </div>
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("taskDescription")}
        </label>
        <textarea
          class="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100 resize-y min-h-[140px]"
          placeholder={t("taskDescriptionPlaceholder")}
          value={props.description}
          onInput={(e) => props.setDescription(e.currentTarget.value)}
          rows={5}
        />
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {t("taskStatus")}
          </label>
          <select
            class="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
            value={props.status}
            onChange={(e) =>
              props.setStatus(e.currentTarget.value as EditableAgentTaskStatus)}
          >
            {STATUS_ORDER.map((value) => (
              <option value={value}>
                {tx(`taskStatus.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {t("taskPriority")}
          </label>
          <select
            class="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
            value={props.priority}
            onChange={(e) =>
              props.setPriority(e.currentTarget.value as AgentTaskPriority)}
          >
            {PRIORITY_OPTIONS.map((value) => (
              <option value={value}>
                {tx(`taskPriority.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {t("taskAgentType")}
          </label>
          <select
            class="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
            value={props.agentType}
            onChange={(e) => props.setAgentType(e.currentTarget.value)}
          >
            {agentTypeOptions().map((value) => (
              <option value={value}>
                {tOr(`agentType.${value}` as TranslationKey, value)}
              </option>
            ))}
          </select>
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {t("taskModel")}
          </label>
          <select
            class="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
            value={props.model}
            onChange={(e) => props.setModel(e.currentTarget.value)}
          >
            {props.availableModels.map((option) => (
              <option value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("taskDueDate")}
        </label>
        <input
          type="date"
          class="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
          value={props.dueAt}
          onInput={(e) => props.setDueAt(e.currentTarget.value)}
          min={getLocalDateInputMin()}
          aria-describedby="due-date-hint"
        />
        <span
          id="due-date-hint"
          class="text-xs text-zinc-500 dark:text-zinc-400"
        >
          {t("taskDueDateHint") || "Optional - select a future date"}
        </span>
      </div>
      {props.error && (
        <div class="text-red-600 dark:text-red-400 text-sm">
          {props.error}
        </div>
      )}
      <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-4">
        <button
          type="button"
          class="w-full sm:w-auto px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={() => props.onClose()}
        >
          {t("cancel")}
        </button>
        <button
          type="submit"
          class="w-full sm:w-auto px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={props.saving || !props.title.trim()}
        >
          {props.saving ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
