import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useI18n } from '../../store/i18n';
import { useToast } from '../../hooks/useToast';
import { useRouter } from '../../hooks/useRouter';
import { useConfirmDialog } from '../../store/confirm-dialog';
import { rpc, rpcJson } from '../../lib/rpc';
import { getErrorMessage } from '../../lib/errors';
import { Icons } from '../../lib/Icons';
import { DEFAULT_MODEL_ID, FALLBACK_MODELS } from '../../lib/modelCatalog';
import { SkeletonList } from '../../components/Skeleton';
import type { AgentTask, AgentTaskPriority, AgentTaskStatus, Run, Thread } from '../../types';
import { TaskForm } from './work/TaskForm';
import { TaskCard } from './work/TaskCard';
import { TaskFilters } from './work/TaskFilters';
import {
  type ModelSettings,
  type TaskFilter,
  ensureModelOption,
  getModelsForProvider,
} from './work/types';

export function WorkTab({ spaceId }: { spaceId: string }) {
  const { t, tOr, lang } = useI18n();
  const { showToast } = useToast();
  const { navigate } = useRouter();
  const { confirm } = useConfirmDialog();
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<TaskFilter>('all');
  const [isCreating, setIsCreating] = useState(false);
  const [editingTask, setEditingTask] = useState<AgentTask | null>(null);
  const [saving, setSaving] = useState(false);
  const [planningTaskId, setPlanningTaskId] = useState<string | null>(null);
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<AgentTaskStatus>('planned');
  const [priority, setPriority] = useState<AgentTaskPriority>('medium');
  const [agentType, setAgentType] = useState('default');
  const [model, setModel] = useState('');
  const [dueAt, setDueAt] = useState('');

  useEffect(() => {
    void fetchTasks();
    void fetchModelSettings();
  }, [spaceId]);

  const fetchModelSettings = async () => {
    try {
      const res = await rpc.spaces[':spaceId'].model.$get({
        param: { spaceId },
      });
      const data = await rpcJson<ModelSettings>(res);
      const resolvedModel = data.ai_model || data.model || DEFAULT_MODEL_ID;
      const resolvedProvider = data.ai_provider || data.provider || 'openai';
      const providerKey = resolvedProvider as keyof typeof data.available_models;
      const raw = data.available_models?.[providerKey] ?? data.available_models?.openai;
      const modelIds = (raw || [])
        .map((entry) => (typeof entry === 'string' ? entry : entry.id))
        .filter(Boolean);
      const fallbackModel = modelIds[0] || resolvedModel;
      setModelSettings({
        ...data,
        ai_model: resolvedModel,
        ai_provider: resolvedProvider,
      });
      if (!model) {
        setModel(modelIds.includes(resolvedModel) ? resolvedModel : fallbackModel);
      }
    } catch (err) {
      console.error('Failed to fetch model settings:', err);
    }
  };

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await rpc.spaces[':spaceId']['agent-tasks'].$get({
        param: { spaceId },
      });
      const data = await rpcJson<{ tasks: AgentTask[] }>(res);
      setTasks(data.tasks || []);
    } catch {
      setTasks([]);
      showToast('error', t('failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setStatus('planned');
    setPriority('medium');
    setAgentType('default');
    setModel(modelSettings?.ai_model || DEFAULT_MODEL_ID);
    setDueAt('');
    setError(null);
  };

  const openCreateForm = () => {
    resetForm();
    setEditingTask(null);
    setIsCreating(true);
  };

  const openEditForm = (task: AgentTask) => {
    setTitle(task.title);
    setDescription(task.description || '');
    setStatus(task.status);
    setPriority(task.priority);
    setAgentType(task.agent_type || 'default');
    setModel(task.model || modelSettings?.ai_model || DEFAULT_MODEL_ID);
    setDueAt(task.due_at ? new Date(task.due_at).toISOString().slice(0, 10) : '');
    setError(null);
    setEditingTask(task);
    setIsCreating(true);
  };

  const closeForm = () => {
    setIsCreating(false);
    setEditingTask(null);
    resetForm();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    setError(null);

    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      priority,
      agent_type: agentType,
      model: model || undefined,
      due_at: dueAt ? new Date(`${dueAt}T00:00:00.000Z`).toISOString() : undefined,
    };

    try {
      if (editingTask) {
        const res = await rpc['agent-tasks'][':id'].$patch({
          param: { id: editingTask.id },
          json: payload,
        });
        await rpcJson(res);
      } else {
        const res = await rpc.spaces[':spaceId']['agent-tasks'].$post({
          param: { spaceId },
          json: payload,
        });
        await rpcJson(res);
      }
      closeForm();
      await fetchTasks();
    } catch (err: unknown) {
      setError(getErrorMessage(err, t('taskSaveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (taskId: string) => {
    const confirmed = await confirm({
      title: t('confirmDelete'),
      message: t('deleteWarning'),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;

    setDeletingTaskId(taskId);
    try {
      const res = await rpc['agent-tasks'][':id'].$delete({ param: { id: taskId } });
      await rpcJson(res);
      await fetchTasks();
    } catch {
      showToast('error', t('taskDeleteFailed'));
    } finally {
      setDeletingTaskId(null);
    }
  };

  const handleStatusChange = async (taskId: string, nextStatus: AgentTaskStatus) => {
    try {
      const res = await rpc['agent-tasks'][':id'].$patch({
        param: { id: taskId },
        json: { status: nextStatus },
      });
      await rpcJson(res);
      await fetchTasks();
    } catch {
      showToast('error', t('taskUpdateFailed'));
    }
  };

  const handlePlan = async (taskId: string) => {
    if (planningTaskId === taskId) return;
    setPlanningTaskId(taskId);
    try {
      const res = await rpc['agent-tasks'][':id'].plan.$post({ param: { id: taskId } });
      await rpcJson(res);
      showToast('success', t('taskPlanCreated'));
      await fetchTasks();
    } catch {
      showToast('error', t('taskPlanFailed'));
    } finally {
      setPlanningTaskId(null);
    }
  };

  const handleStart = async (task: AgentTask) => {
    if (startingTaskId === task.id) return;
    setStartingTaskId(task.id);
    try {
      let threadId = task.thread_id;

      if (!threadId) {
        const threadRes = await rpc.spaces[':spaceId'].threads.$post({
          param: { spaceId },
          json: { title: task.title, locale: lang },
        });
        const threadResponse = await rpcJson<{ thread: Thread }>(threadRes);
        threadId = threadResponse.thread.id;
        const patchRes = await rpc['agent-tasks'][':id'].$patch({
          param: { id: task.id },
          json: { thread_id: threadId },
        });
        await rpcJson(patchRes);
      }

      const msgRes = await rpc.threads[':id'].messages.$post({
        param: { id: threadId },
        json: {
          role: 'user',
          content: task.description?.trim() || task.title,
        },
      });
      await rpcJson(msgRes);

      const runPayload: { agent_type: string; model?: string; input?: Record<string, unknown> } = {
        agent_type: task.agent_type || 'default',
        input: { locale: lang },
      };
      if (task.model) {
        runPayload.model = task.model;
      }

      const runRes = await rpc.threads[':threadId'].runs.$post({
        param: { threadId },
        json: runPayload,
      });
      const runResponse = await rpcJson<{ run: Run }>(runRes);

      const finalRes = await rpc['agent-tasks'][':id'].$patch({
        param: { id: task.id },
        json: {
          status: 'in_progress',
          last_run_id: runResponse.run.id,
          started_at: new Date().toISOString(),
          thread_id: threadId,
        },
      });
      await rpcJson(finalRes);

      showToast('success', t('taskRunStarted'));
      await fetchTasks();
      navigate({ view: 'chat', spaceId, threadId, runId: runResponse.run.id, messageId: undefined });
    } catch {
      showToast('error', t('taskRunFailed'));
    } finally {
      setStartingTaskId(null);
    }
  };

  const handleOpenChat = (task: AgentTask) => {
    if (!task.thread_id) return;
    navigate({
      view: 'chat',
      spaceId,
      threadId: task.thread_id,
      runId: task.resume_target?.run_id ?? undefined,
      messageId: undefined,
    });
  };

  const filteredTasks = useMemo(() => {
    if (activeFilter === 'all') return tasks;
    return tasks.filter((task) => task.status === activeFilter);
  }, [activeFilter, tasks]);

  const availableModels = useMemo(() => {
    const models = getModelsForProvider(modelSettings, modelSettings?.ai_provider || 'openai');
    const resolved = models.length > 0 ? models : [...FALLBACK_MODELS];
    return ensureModelOption(resolved, model);
  }, [model, modelSettings]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="h-5 w-24 bg-zinc-200/50 dark:bg-zinc-700/50 rounded animate-pulse" />
            <div className="h-10 w-24 bg-zinc-200/50 dark:bg-zinc-700/50 rounded-lg animate-pulse" />
          </div>
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-8 w-20 bg-zinc-200/50 dark:bg-zinc-700/50 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
        <SkeletonList count={3} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('taskBoard')}</h4>
          <button
            type="button"
            className={`w-full sm:w-auto px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isCreating
                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200'
            }`}
            onClick={isCreating ? closeForm : openCreateForm}
          >
            {isCreating ? t('cancel') : t('addTask')}
          </button>
        </div>
        <TaskFilters activeFilter={activeFilter} onFilterChange={setActiveFilter} />
      </div>

      {isCreating && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-4 md:p-5">
          <TaskForm
            editingTask={editingTask}
            title={title}
            setTitle={setTitle}
            description={description}
            setDescription={setDescription}
            status={status}
            setStatus={setStatus}
            priority={priority}
            setPriority={setPriority}
            agentType={agentType}
            setAgentType={setAgentType}
            model={model}
            setModel={setModel}
            dueAt={dueAt}
            setDueAt={setDueAt}
            availableModels={availableModels}
            saving={saving}
            error={error}
            onSubmit={handleSubmit}
            onClose={closeForm}
          />
        </div>
      )}

      {filteredTasks.length === 0 ? (
        isCreating ? null : (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500 dark:text-zinc-400 gap-4">
            <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-900 dark:text-zinc-100">
              <Icons.Sparkles className="w-8 h-8" />
            </div>
            <div className="text-center">
              <p className="text-zinc-900 dark:text-zinc-100 font-medium">{t('noTasks')}</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                {tOr('tasksEmptyHint', 'Create tasks for your agent to work on autonomously')}
              </p>
            </div>
            <button
              type="button"
              className="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-2"
              onClick={openCreateForm}
            >
              <Icons.Plus className="w-4 h-4" />
              {t('addTask')}
            </button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isPlanning={planningTaskId === task.id}
              isStarting={startingTaskId === task.id}
              isDeleting={deletingTaskId === task.id}
              onStart={handleStart}
              onPlan={handlePlan}
              onOpenChat={handleOpenChat}
              onComplete={(taskId) => handleStatusChange(taskId, 'completed')}
              onEdit={openEditForm}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
