import {
  createEffect,
  createMemo,
  createSignal,
  Show,
  untrack,
} from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { useRouter } from "../../hooks/useRouter.ts";
import { useConfirmDialog } from "../../store/confirm-dialog.ts";
import { rpc, rpcJson } from "../../lib/rpc.ts";
import { getErrorMessage } from "../../lib/errors.ts";
import { Icons } from "../../lib/Icons.tsx";
import { readModelSettingsResponse } from "../../lib/model-settings-response.ts";
import { SkeletonList } from "../../components/Skeleton.tsx";
import type {
  AgentTask,
  AgentTaskPriority,
  AgentTaskStatus,
} from "../../types/index.ts";
import { TaskForm } from "./work/TaskForm.tsx";
import { TaskCard } from "./work/TaskCard.tsx";
import { TaskFilters } from "./work/TaskFilters.tsx";
import {
  type EditableAgentTaskStatus,
  type ModelSettings,
  STATUS_ORDER,
  type TaskFilter,
} from "./work/task-work-types.ts";
import {
  ensureModelOption,
  getModelsForModelBackend,
} from "./work/task-work-utils.ts";
import { readTaskStartResponse } from "./work/task-start-response.ts";
import { readAgentTaskListResponse } from "./work/task-response.ts";

interface TaskFormState {
  title: string;
  description: string;
  status: EditableAgentTaskStatus;
  priority: AgentTaskPriority;
  agentType: string;
  model: string;
  dueAt: string;
}

const INITIAL_FORM_STATE: TaskFormState = {
  title: "",
  description: "",
  status: "planned",
  priority: "medium",
  agentType: "default",
  model: "",
  dueAt: "",
};

function toEditableStatus(status: AgentTaskStatus): EditableAgentTaskStatus {
  return STATUS_ORDER.includes(status as EditableAgentTaskStatus)
    ? status as EditableAgentTaskStatus
    : "blocked";
}

export function WorkTab(
  props: { spaceId: string; canEdit: boolean; canDelete: boolean },
) {
  const { t, lang } = useI18n();
  const { showToast } = useToast();
  const { navigate } = useRouter();
  const { confirm } = useConfirmDialog();
  const [tasks, setTasks] = createSignal<AgentTask[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [activeFilter, setActiveFilter] = createSignal<TaskFilter>("all");
  const [isCreating, setIsCreating] = createSignal(false);
  const [editingTask, setEditingTask] = createSignal<AgentTask | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [planningTaskId, setPlanningTaskId] = createSignal<string | null>(null);
  const [startingTaskId, setStartingTaskId] = createSignal<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [taskLoadError, setTaskLoadError] = createSignal<string | null>(null);
  const [modelSettings, setModelSettings] = createSignal<ModelSettings | null>(
    null,
  );
  let tasksSeq = 0;
  let modelSettingsSeq = 0;
  let tasksSpaceId: string | null = null;

  const [form, setForm] = createSignal<TaskFormState>(INITIAL_FORM_STATE);
  const updateForm = <K extends keyof TaskFormState>(
    field: K,
    value: TaskFormState[K],
  ) => setForm((prev) => ({ ...prev, [field]: value }));

  createEffect(() => {
    const spaceId = props.spaceId;
    if (tasksSpaceId !== spaceId) {
      tasksSpaceId = spaceId;
      setTasks([]);
      setTaskLoadError(null);
    }
    void fetchTasks(spaceId);
    void fetchModelSettings(spaceId);
  });

  const fetchModelSettings = async (spaceId = props.spaceId) => {
    const seq = ++modelSettingsSeq;
    try {
      const res = await rpc.spaces[":spaceId"].model.$get({
        param: { spaceId },
      });
      const data = readModelSettingsResponse(await rpcJson<unknown>(res));
      if (seq !== modelSettingsSeq || spaceId !== props.spaceId) return;
      setModelSettings(data);
    } catch (err) {
      if (seq !== modelSettingsSeq || spaceId !== props.spaceId) return;
      console.error("Failed to fetch model settings:", err);
      setModelSettings(null);
    }
  };

  const fetchTasks = async (spaceId = props.spaceId) => {
    const seq = ++tasksSeq;
    // fetchTasks is called from a createEffect. Do not make the current list a
    // dependency of that effect or every successful setTasks would refetch.
    setLoading(untrack(tasks).length === 0);
    try {
      const res = await rpc.spaces[":spaceId"]["agent-tasks"].$get({
        param: { spaceId },
      });
      const nextTasks = readAgentTaskListResponse(await rpcJson<unknown>(res));
      if (seq !== tasksSeq || spaceId !== props.spaceId) return;
      setTasks(nextTasks);
      setTaskLoadError(null);
    } catch {
      if (seq !== tasksSeq || spaceId !== props.spaceId) return;
      setTaskLoadError(t("failedToLoad"));
    } finally {
      if (seq === tasksSeq && spaceId === props.spaceId) {
        setLoading(false);
      }
    }
  };

  const resetForm = () => {
    setForm(INITIAL_FORM_STATE);
    setError(null);
  };

  const openCreateForm = () => {
    if (!props.canEdit) return;
    resetForm();
    setEditingTask(null);
    setIsCreating(true);
  };

  const openEditForm = (task: AgentTask) => {
    if (!props.canEdit) return;
    setForm({
      title: task.title,
      description: task.description || "",
      status: toEditableStatus(task.status),
      priority: task.priority,
      agentType: task.agent_type || "default",
      model: task.model || "",
      dueAt: task.due_at
        ? new Date(task.due_at).toISOString().slice(0, 10)
        : "",
    });
    setError(null);
    setEditingTask(task);
    setIsCreating(true);
  };

  const closeForm = () => {
    setIsCreating(false);
    setEditingTask(null);
    resetForm();
  };

  const handleSubmit = async (
    e: Event & { currentTarget: HTMLFormElement },
  ) => {
    e.preventDefault();
    if (!props.canEdit || !form().title.trim()) return;

    setSaving(true);
    setError(null);

    const f = form();
    const payload = {
      title: f.title.trim(),
      description: f.description.trim() || null,
      status: f.status,
      priority: f.priority,
      agent_type: f.agentType,
      model: f.model || null,
      due_at: f.dueAt
        ? new Date(`${f.dueAt}T00:00:00.000Z`).toISOString()
        : null,
    };

    try {
      const task = editingTask();
      if (task) {
        const res = await rpc["agent-tasks"][":id"].$patch({
          param: { id: task.id },
          json: payload,
        });
        await rpcJson(res);
      } else {
        const res = await rpc.spaces[":spaceId"]["agent-tasks"].$post({
          param: { spaceId: props.spaceId },
          json: payload,
        });
        await rpcJson(res);
      }
      closeForm();
      await fetchTasks();
    } catch (err: unknown) {
      setError(getErrorMessage(err, t("taskSaveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!props.canDelete) return;
    const confirmed = await confirm({
      title: t("confirmDelete"),
      message: t("deleteWarning"),
      confirmText: t("delete"),
      danger: true,
    });
    if (!confirmed) return;

    setDeletingTaskId(taskId);
    try {
      const res = await rpc["agent-tasks"][":id"].$delete({
        param: { id: taskId },
      });
      await rpcJson(res);
      await fetchTasks();
    } catch {
      showToast("error", t("taskDeleteFailed"));
    } finally {
      setDeletingTaskId(null);
    }
  };

  const handleStatusChange = async (
    taskId: string,
    nextStatus: EditableAgentTaskStatus,
  ) => {
    if (!props.canEdit) return;
    try {
      const res = await rpc["agent-tasks"][":id"].$patch({
        param: { id: taskId },
        json: { status: nextStatus },
      });
      await rpcJson(res);
      await fetchTasks();
    } catch {
      showToast("error", t("taskUpdateFailed"));
    }
  };

  const handlePlan = async (taskId: string) => {
    if (!props.canEdit || planningTaskId() === taskId) return;
    setPlanningTaskId(taskId);
    try {
      const res = await rpc["agent-tasks"][":id"].plan.$post({
        param: { id: taskId },
      });
      await rpcJson(res);
      showToast("success", t("taskPlanCreated"));
      await fetchTasks();
    } catch {
      showToast("error", t("taskPlanFailed"));
    } finally {
      setPlanningTaskId(null);
    }
  };

  const handleStart = async (task: AgentTask) => {
    if (!props.canEdit || startingTaskId() === task.id) return;
    setStartingTaskId(task.id);
    try {
      const response = await rpc["agent-tasks"][":id"].start.$post({
        param: { id: task.id },
        json: { locale: lang },
      });
      const started = readTaskStartResponse(
        await rpcJson<unknown>(response),
        task.id,
      );

      showToast("success", t("taskRunStarted"));
      await fetchTasks();
      navigate({
        view: "chat",
        spaceId: props.spaceId,
        threadId: started.threadId,
        runId: started.runId,
        messageId: undefined,
      });
    } catch {
      showToast("error", t("taskRunFailed"));
    } finally {
      setStartingTaskId(null);
    }
  };

  const handleOpenChat = (task: AgentTask) => {
    if (!task.thread_id) return;
    navigate({
      view: "chat",
      spaceId: props.spaceId,
      threadId: task.thread_id,
      runId: task.resume_target?.run_id ?? undefined,
      messageId: undefined,
    });
  };

  const filteredTasks = createMemo(() => {
    if (activeFilter() === "all") return tasks();
    return tasks().filter((task: AgentTask) => task.status === activeFilter());
  });

  const availableModels = createMemo(() => {
    const ms = modelSettings();
    const models = getModelsForModelBackend(ms, ms?.modelBackend);
    return ensureModelOption(models, form().model);
  });

  return (
    <Show
      when={!loading()}
      fallback={
        <div class="flex flex-col gap-6">
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <div class="h-5 w-24 bg-zinc-200/50 dark:bg-zinc-700/50 rounded animate-pulse" />
              <div class="h-10 w-24 bg-zinc-200/50 dark:bg-zinc-700/50 rounded-lg animate-pulse" />
            </div>
            <div class="flex gap-2">
              {[1, 2, 3, 4].map((_i) => (
                <div class="h-8 w-20 bg-zinc-200/50 dark:bg-zinc-700/50 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
          <SkeletonList count={3} />
        </div>
      }
    >
      <div class="flex flex-col gap-6">
        <Show when={taskLoadError()}>
          {(message) => (
            <div
              role="alert"
              aria-live="assertive"
              class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
            >
              <span>{message()}</span>
              <button
                type="button"
                class="min-h-[44px] rounded-lg border border-red-300 px-3 py-2 font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-950/60"
                onClick={() => void fetchTasks()}
                disabled={loading()}
              >
                {t("retry")}
              </button>
            </div>
          )}
        </Show>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h4 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("taskBoard")}
            </h4>
            {props.canEdit && (
              <button
                type="button"
                class={`w-full sm:w-auto px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isCreating()
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200"
                }`}
                onClick={isCreating() ? closeForm : openCreateForm}
              >
                {isCreating() ? t("cancel") : t("addTask")}
              </button>
            )}
          </div>
          <TaskFilters
            activeFilter={activeFilter()}
            onFilterChange={setActiveFilter}
          />
        </div>

        {props.canEdit && isCreating() && (
          <div class="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-4 md:p-5">
            <TaskForm
              editingTask={editingTask()}
              title={form().title}
              setTitle={(v) => updateForm("title", v)}
              description={form().description}
              setDescription={(v) => updateForm("description", v)}
              status={form().status}
              setStatus={(v) => updateForm("status", v)}
              priority={form().priority}
              setPriority={(v) => updateForm("priority", v)}
              agentType={form().agentType}
              setAgentType={(v) => updateForm("agentType", v)}
              model={form().model}
              setModel={(v) => updateForm("model", v)}
              dueAt={form().dueAt}
              setDueAt={(v) => updateForm("dueAt", v)}
              availableModels={availableModels()}
              workspaceModel={modelSettings()?.model}
              saving={saving()}
              error={error()}
              onSubmit={handleSubmit}
              onClose={closeForm}
            />
          </div>
        )}

        {filteredTasks().length === 0
          ? (
            taskLoadError() || isCreating()
              ? null
              : (
                <div class="flex flex-col items-center justify-center py-12 text-zinc-500 dark:text-zinc-400 gap-4">
                  <div class="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-900 dark:text-zinc-100">
                    <Icons.Sparkles class="w-8 h-8" />
                  </div>
                  <div class="text-center">
                    <p class="text-zinc-900 dark:text-zinc-100 font-medium">
                      {t("noTasks")}
                    </p>
                    <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                      {t("tasksEmptyHint")}
                    </p>
                  </div>
                  {props.canEdit && (
                    <button
                      type="button"
                      class="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-2"
                      onClick={openCreateForm}
                    >
                      <Icons.Plus class="w-4 h-4" />
                      {t("addTask")}
                    </button>
                  )}
                </div>
              )
          )
          : (
            <div class="flex flex-col gap-4">
              {filteredTasks().map((task: AgentTask) => (
                <TaskCard
                  task={task}
                  isPlanning={planningTaskId() === task.id}
                  isStarting={startingTaskId() === task.id}
                  isDeleting={deletingTaskId() === task.id}
                  canEdit={props.canEdit}
                  canDelete={props.canDelete}
                  onStart={handleStart}
                  onPlan={handlePlan}
                  onOpenChat={handleOpenChat}
                  onComplete={(taskId) =>
                    handleStatusChange(taskId, "completed")}
                  onEdit={openEditForm}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
      </div>
    </Show>
  );
}
