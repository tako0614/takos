import { createMemo, createUniqueId } from "solid-js";
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
  const fieldPrefix = createUniqueId();
  const titleId = `${fieldPrefix}-title`;
  const descriptionId = `${fieldPrefix}-description`;
  const statusId = `${fieldPrefix}-status`;
  const priorityId = `${fieldPrefix}-priority`;
  const agentTypeId = `${fieldPrefix}-agent-type`;
  const modelId = `${fieldPrefix}-model`;
  const dueAtId = `${fieldPrefix}-due-at`;
  const dueDateHintId = `${fieldPrefix}-due-date-hint`;

  return (
    <form
      class="flex flex-col gap-4"
      onSubmit={(e) => props.onSubmit(e)}
    >
      <div class="flex items-start justify-between gap-3 mb-2">
        <div class="space-y-1">
          <h3 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {props.editingTask ? t("editTask") : t("createTask")}
          </h3>
          <p class="text-sm text-zinc-600 dark:text-zinc-400">
            {props.editingTask
              ? t("taskFormEditHint" as TranslationKey)
              : t("taskFormCreateHint" as TranslationKey)}
          </p>
        </div>
        <button
          type="button"
          class="inline-flex min-w-[44px] min-h-[44px] sm:min-w-8 sm:min-h-8 items-center justify-center rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          onClick={() => props.onClose()}
          aria-label={t("close")}
        >
          <Icons.X aria-hidden="true" />
        </button>
      </div>
      <div class="flex flex-col gap-2">
        <label
          for={titleId}
          class="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          {t("taskTitle")}
        </label>
        <input
          id={titleId}
          type="text"
          class="min-h-[44px] sm:min-h-0 w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-base sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100 focus:ring-2 focus:ring-zinc-900/15 dark:focus:ring-zinc-100/20"
          placeholder={t("taskTitlePlaceholder")}
          value={props.title}
          onInput={(e) => props.setTitle(e.currentTarget.value)}
          autofocus
          required
        />
      </div>
      <div class="flex flex-col gap-2">
        <label
          for={descriptionId}
          class="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          {t("taskDescription")}
        </label>
        <textarea
          id={descriptionId}
          class="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-base sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100 focus:ring-2 focus:ring-zinc-900/15 dark:focus:ring-zinc-100/20 resize-y min-h-[140px]"
          placeholder={t("taskDescriptionPlaceholder")}
          value={props.description}
          onInput={(e) => props.setDescription(e.currentTarget.value)}
          rows={5}
        />
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <label
            for={statusId}
            class="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {t("taskStatus")}
          </label>
          <select
            id={statusId}
            class="min-h-[44px] sm:min-h-0 w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-base sm:text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100 focus:ring-2 focus:ring-zinc-900/15 dark:focus:ring-zinc-100/20"
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
          <label
            for={priorityId}
            class="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {t("taskPriority")}
          </label>
          <select
            id={priorityId}
            class="min-h-[44px] sm:min-h-0 w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-base sm:text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100 focus:ring-2 focus:ring-zinc-900/15 dark:focus:ring-zinc-100/20"
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
          <label
            for={agentTypeId}
            class="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {t("taskAgentType")}
          </label>
          <select
            id={agentTypeId}
            class="min-h-[44px] sm:min-h-0 w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-base sm:text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100 focus:ring-2 focus:ring-zinc-900/15 dark:focus:ring-zinc-100/20"
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
          <label
            for={modelId}
            class="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {t("taskModel")}
          </label>
          <select
            id={modelId}
            class="min-h-[44px] sm:min-h-0 w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-base sm:text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100 focus:ring-2 focus:ring-zinc-900/15 dark:focus:ring-zinc-100/20"
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
        <label
          for={dueAtId}
          class="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          {t("taskDueDate")}
        </label>
        <input
          id={dueAtId}
          type="date"
          class="min-h-[44px] sm:min-h-0 w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-base sm:text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100 focus:ring-2 focus:ring-zinc-900/15 dark:focus:ring-zinc-100/20"
          value={props.dueAt}
          onInput={(e) => props.setDueAt(e.currentTarget.value)}
          min={getLocalDateInputMin()}
          aria-describedby={dueDateHintId}
        />
        <span
          id={dueDateHintId}
          class="text-xs text-zinc-600 dark:text-zinc-400"
        >
          {t("taskDueDateHint")}
        </span>
      </div>
      {props.error && (
        <div role="alert" class="text-red-600 dark:text-red-400 text-sm">
          {props.error}
        </div>
      )}
      <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-4">
        <button
          type="button"
          class="min-h-[44px] sm:min-h-0 w-full sm:w-auto px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={() => props.onClose()}
        >
          {t("cancel")}
        </button>
        <button
          type="submit"
          class="min-h-[44px] sm:min-h-0 w-full sm:w-auto px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={props.saving || !props.title.trim()}
        >
          {props.saving ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
