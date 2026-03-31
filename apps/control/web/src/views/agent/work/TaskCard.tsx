import { useI18n } from '../../../store/i18n.ts';
import type { TranslationKey } from '../../../i18n.ts';
import { Icons } from '../../../lib/Icons.tsx';
import type { AgentTask } from '../../../types/index.ts';
import {
  getStatusClasses,
  getPriorityClasses,
  parsePlan,
  resolveAgentTypeLabel,
} from './task-work-utils.ts';

interface TaskCardProps {
  task: AgentTask;
  isPlanning: boolean;
  isStarting: boolean;
  isDeleting: boolean;
  onStart: (task: AgentTask) => void;
  onPlan: (taskId: string) => void;
  onOpenChat: (task: AgentTask) => void;
  onComplete: (taskId: string) => void;
  onEdit: (task: AgentTask) => void;
  onDelete: (taskId: string) => void;
}

export function TaskCard({
  task,
  isPlanning,
  isStarting,
  isDeleting,
  onStart,
  onPlan,
  onOpenChat,
  onComplete,
  onEdit,
  onDelete,
}: TaskCardProps) {
  const { t, lang } = useI18n();
  const tx = (key: string) => t(key as TranslationKey);

  const plan = parsePlan(task.plan);
  const dueDate = task.due_at
    ? new Date(task.due_at).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', { timeZone: 'UTC' })
    : null;
  const canStartTask = task.status !== 'completed' && task.status !== 'cancelled';
  const canCompleteTask = task.status !== 'completed' && task.status !== 'cancelled';
  const latestRun = task.latest_run;

  return (
    <div class="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h5 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{task.title}</h5>
            <span class={`text-xs font-medium px-2 py-0.5 rounded-full border ${getStatusClasses(task.status)}`}>
              {tx(`taskStatus.${task.status}`)}
            </span>
            <span class={`text-xs font-medium ${getPriorityClasses(task.priority)}`}>
              {tx(`taskPriority.${task.priority}`)}
            </span>
          </div>
          {task.description && (
            <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-2 whitespace-pre-wrap">
              {task.description}
            </p>
          )}
          <div class="text-xs text-zinc-500 dark:text-zinc-400 mt-2 flex flex-wrap gap-3">
            {dueDate && <span>{t('taskDueLabel')}: {dueDate}</span>}
            {task.agent_type && (
              <span>{t('taskAgentLabel')}: {resolveAgentTypeLabel(t, task.agent_type)}</span>
            )}
            {task.model && <span>{t('taskModelLabel')}: {task.model}</span>}
            {task.thread_title && <span>{t('taskThreadLabel')}: {task.thread_title}</span>}
          </div>
          {latestRun && (
            <div class="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white/60 dark:bg-zinc-900/60 px-3 py-3 text-xs text-zinc-500 dark:text-zinc-400">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium text-zinc-800 dark:text-zinc-200">{t('taskLatestRun')}</span>
                <span>{t(`runStatus_${latestRun.status}` as TranslationKey)}</span>
                <span>{t('taskArtifactsCount', { count: latestRun.artifact_count })}</span>
              </div>
              {latestRun.error && (
                <div class="mt-2 text-red-600 dark:text-red-400 whitespace-pre-wrap">{latestRun.error}</div>
              )}
            </div>
          )}
          {plan && (
            <div class="mt-3 text-xs text-zinc-500 dark:text-zinc-400 bg-white/60 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 space-y-1">
              <div class="font-medium text-zinc-800 dark:text-zinc-200">{t('taskPlan')}</div>
              {plan.type && <div>{t('taskPlanType')}: {plan.type}</div>}
              {plan.tools && plan.tools.length > 0 && (
                <div>{t('taskPlanTools')}: {plan.tools.join(', ')}</div>
              )}
              {plan.reasoning && (
                <div class="text-zinc-500 dark:text-zinc-400">{plan.reasoning}</div>
              )}
            </div>
          )}
        </div>
        <div class="flex flex-wrap gap-2">
          {canStartTask && (
            <button
              type="button"
              class="px-3 min-h-[44px] text-xs font-medium rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={() => onStart(task)}
              disabled={isStarting}
            >
              {isStarting ? <Icons.Loader class="w-4 h-4 animate-spin" /> : <Icons.Play class="w-4 h-4" />}
              {t('taskStart')}
            </button>
          )}
          {!task.plan && (
            <button
              type="button"
              class="px-3 min-h-[44px] text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 hover:border-zinc-900/60 dark:hover:border-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1"
              onClick={() => onPlan(task.id)}
              disabled={isPlanning}
            >
              {isPlanning && <Icons.Loader class="w-4 h-4 animate-spin" />}
              {t('taskGeneratePlan')}
            </button>
          )}
          {task.thread_id && (
            <button
              type="button"
              class="px-3 min-h-[44px] text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 hover:border-zinc-900/60 dark:hover:border-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors flex items-center gap-1"
              onClick={() => onOpenChat(task)}
            >
              <Icons.ExternalLink />
              {t('taskResumeChat')}
            </button>
          )}
          {canCompleteTask && (
            <button
              type="button"
              class="px-3 min-h-[44px] text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 hover:border-zinc-900/60 dark:hover:border-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors flex items-center gap-1"
              onClick={() => onComplete(task.id)}
            >
              <Icons.Check />
              {t('taskComplete')}
            </button>
          )}
          <button
            type="button"
            class="px-3 min-h-[44px] text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            onClick={() => onEdit(task)}
          >
            {t('edit')}
          </button>
          <button
            type="button"
            class="px-3 min-h-[44px] text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1"
            onClick={() => onDelete(task.id)}
            disabled={isDeleting}
          >
            {isDeleting && <Icons.Loader class="w-4 h-4 animate-spin" />}
            {t('delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
