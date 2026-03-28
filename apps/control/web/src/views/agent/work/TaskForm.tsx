import type { FormEvent } from 'react';
import { useI18n } from '../../../store/i18n';
import type { TranslationKey } from '../../../i18n';
import { Icons } from '../../../lib/Icons';
import type { AgentTask, AgentTaskPriority, AgentTaskStatus } from '../../../types';
import {
  STATUS_ORDER,
  PRIORITY_OPTIONS,
  getAgentTypeOptions,
  getLocalDateInputMin,
  type ModelSelectOption,
} from './task-work-types';

interface TaskFormProps {
  editingTask: AgentTask | null;
  title: string;
  setTitle: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  status: AgentTaskStatus;
  setStatus: (value: AgentTaskStatus) => void;
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
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}

export function TaskForm({
  editingTask,
  title,
  setTitle,
  description,
  setDescription,
  status,
  setStatus,
  priority,
  setPriority,
  agentType,
  setAgentType,
  model,
  setModel,
  dueAt,
  setDueAt,
  availableModels,
  saving,
  error,
  onSubmit,
  onClose,
}: TaskFormProps) {
  const { t, tOr } = useI18n();
  const tx = (key: string) => t(key as TranslationKey);
  const agentTypeOptions = getAgentTypeOptions(agentType);

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="space-y-1">
          <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {editingTask ? t('editTask') : t('createTask')}
          </h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {editingTask
              ? tOr('taskFormEditHint' as TranslationKey, 'Update scope, status, or execution settings without leaving the board.')
              : tOr('taskFormCreateHint' as TranslationKey, 'Define one outcome, then let the agent pick it up from chat.')}
          </p>
        </div>
        <button
          type="button"
          className="p-2 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          onClick={onClose}
          aria-label={t('close')}
        >
          <Icons.X />
        </button>
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('taskTitle')}</label>
        <input
          type="text"
          className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
          placeholder={t('taskTitlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('taskDescription')}</label>
        <textarea
          className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100 resize-y min-h-[140px]"
          placeholder={t('taskDescriptionPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('taskStatus')}</label>
          <select
            className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
            value={status}
            onChange={(e) => setStatus(e.target.value as AgentTaskStatus)}
          >
            {STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {tx(`taskStatus.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('taskPriority')}</label>
          <select
            className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
            value={priority}
            onChange={(e) => setPriority(e.target.value as AgentTaskPriority)}
          >
            {PRIORITY_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {tx(`taskPriority.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('taskAgentType')}</label>
          <select
            className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
            value={agentType}
            onChange={(e) => setAgentType(e.target.value)}
          >
            {agentTypeOptions.map((value) => (
              <option key={value} value={value}>
                {tOr(`agentType.${value}` as TranslationKey, value)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('taskModel')}</label>
          <select
            className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {availableModels.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('taskDueDate')}</label>
        <input
          type="date"
          className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          min={getLocalDateInputMin()}
          aria-describedby="due-date-hint"
        />
        <span id="due-date-hint" className="text-xs text-zinc-500 dark:text-zinc-400">
          {t('taskDueDateHint') || 'Optional - select a future date'}
        </span>
      </div>
      {error && <div className="text-red-600 dark:text-red-400 text-sm">{error}</div>}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-4">
        <button
          type="button"
          className="w-full sm:w-auto px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={onClose}
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          className="w-full sm:w-auto px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={saving || !title.trim()}
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </form>
  );
}
