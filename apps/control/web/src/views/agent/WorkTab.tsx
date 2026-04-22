import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { useRouter } from "../../hooks/useRouter.ts";
import { useConfirmDialog } from "../../store/confirm-dialog.ts";
import { rpc, rpcJson, rpcPath } from "../../lib/rpc.ts";
import { getErrorMessage } from "../../lib/errors.ts";
import { Icons } from "../../lib/Icons.tsx";
import { DEFAULT_MODEL_ID, FALLBACK_MODELS } from "../../lib/modelCatalog.ts";
import { SkeletonList } from "../../components/Skeleton.tsx";
import type {
  AgentTask,
  AgentTaskPriority,
  AgentTaskStatus,
  Run,
  Thread,
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

export function WorkTab(props: { spaceId: string }) {
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
  const [modelSettings, setModelSettings] = createSignal<ModelSettings | null>(
    null,
  );
  let tasksSeq = 0;
  let modelSettingsSeq = 0;

  const [form, setForm] = createSignal<TaskFormState>(INITIAL_FORM_STATE);
  const updateForm = <K extends keyof TaskFormState>(
    field: K,
    value: TaskFormState[K],
  ) => setForm((prev) => ({ ...prev, [field]: value }));

  createEffect(() => {
    const spaceId = props.spaceId;
    void fetchTasks(spaceId);
    void fetchModelSettings(spaceId);
  });

  const fetchModelSettings = async (spaceId = props.spaceId) => {
    const seq = ++modelSettingsSeq;
    try {
      const res = await rpc.spaces[":spaceId"].model.$get({
        param: { spaceId },
      });
      const data = await rpcJson<ModelSettings>(res);
      if (seq !== modelSettingsSeq || spaceId !== props.spaceId) return;
      const resolvedModel = data.ai_model || data.model || DEFAULT_MODEL_ID;
      const resolvedModelBackend = data.model_backend || "openai";
      const modelBackendKey =
        resolvedModelBackend as keyof typeof data.available_models;
      const raw = data.available_models?.[modelBackendKey] ??
        data.available_models?.openai;
      const modelIds = (raw || [])
        .map((entry) => (typeof entry === "string" ? entry : entry.id))
        .filter(Boolean);
      const fallbackModel = modelIds[0] || resolvedModel;
      setModelSettings({
        ...data,
        ai_model: resolvedModel,
        model_backend: resolvedModelBackend,
      });
      if (!form().model) {
        updateForm(
          "model",
          modelIds.includes(resolvedModel) ? resolvedModel : fallbackModel,
        );
      }
    } catch (err) {
      if (seq !== modelSettingsSeq || spaceId !== props.spaceId) return;
      console.error("Failed to fetch model settings:", err);
    }
  };

  const fetchTasks = async (spaceId = props.spaceId) => {
    const seq = ++tasksSeq;
    setLoading(true);
    try {
      const res = await rpc.spaces[":spaceId"]["agent-tasks"].$get({
        param: { spaceId },
      });
      const data = await rpcJson<{ tasks: AgentTask[] }>(res);
      if (seq !== tasksSeq || spaceId !== props.spaceId) return;
      setTasks(data.tasks || []);
    } catch {
      if (seq !== tasksSeq || spaceId !== props.spaceId) return;
      setTasks([]);
      showToast("error", t("failedToLoad"));
    } finally {
      if (seq === tasksSeq && spaceId === props.spaceId) {
        setLoading(false);
      }
    }
  };

  const resetForm = () => {
    setForm({
      ...INITIAL_FORM_STATE,
      model: modelSettings()?.ai_model || DEFAULT_MODEL_ID,
    });
    setError(null);
  };

  const openCreateForm = () => {
    resetForm();
    setEditingTask(null);
    setIsCreating(true);
  };

  const openEditForm = (task: AgentTask) => {
    setForm({
      title: task.title,
      description: task.description || "",
      status: toEditableStatus(task.status),
      priority: task.priority,
      agentType: task.agent_type || "default",
      model: task.model || modelSettings()?.ai_model || DEFAULT_MODEL_ID,
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
    if (!form().title.trim()) return;

    setSaving(true);
    setError(null);

    const f = form();
    const payload = {
      title: f.title.trim(),
      description: f.description.trim() || undefined,
      status: f.status,
      priority: f.priority,
      agent_type: f.agentType,
      model: f.model || undefined,
      due_at: f.dueAt
        ? new Date(`${f.dueAt}T00:00:00.000Z`).toISOString()
        : undefined,
    };

    try {
      if (editingTask()) {
        const res = await rpc["agent-tasks"][":id"].$patch({
          param: { id: editingTask()!.id },
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
    if (planningTaskId() === taskId) return;
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
    if (startingTaskId() === task.id) return;
    setStartingTaskId(task.id);
    try {
      let threadId = task.thread_id;

      if (!threadId) {
        const threadRes = await rpcPath(rpc, "spaces", ":spaceId", "threads")
          .$post({
            param: { spaceId: props.spaceId },
            json: { title: task.title, locale: lang },
          });
        const threadResponse = await rpcJson<{ thread: Thread }>(threadRes);
        threadId = threadResponse.thread.id;
        const patchRes = await rpc["agent-tasks"][":id"].$patch({
          param: { id: task.id },
          json: { thread_id: threadId },
        });
        await rpcJson(patchRes);
      }

      const msgRes = await rpcPath(rpc, "threads", ":id", "messages").$post({
        param: { id: threadId },
        json: {
          role: "user",
          content: task.description?.trim() || task.title,
        },
      });
      await rpcJson(msgRes);

      const runPayload: {
        agent_type: string;
        model?: string;
        input?: Record<string, unknown>;
      } = {
        agent_type: task.agent_type || "default",
        input: { locale: lang },
      };
      if (task.model) {
        runPayload.model = task.model;
      }

      const runRes = await rpcPath(rpc, "threads", ":threadId", "runs").$post({
        param: { threadId },
        json: runPayload,
      });
      const runResponse = await rpcJson<{ run: Run }>(runRes);

      const finalRes = await rpc["agent-tasks"][":id"].$patch({
        param: { id: task.id },
        json: {
          status: "in_progress",
          last_run_id: runResponse.run.id,
          started_at: new Date().toISOString(),
          thread_id: threadId,
        },
      });
      await rpcJson(finalRes);

      showToast("success", t("taskRunStarted"));
      await fetchTasks();
      navigate({
        view: "chat",
        spaceId: props.spaceId,
        threadId,
        runId: runResponse.run.id,
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
    const models = getModelsForModelBackend(ms!, ms?.model_backend || "openai");
    const resolved = models.length > 0 ? models : [...FALLBACK_MODELS];
    return ensureModelOption(resolved, form().model);
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
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h4 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("taskBoard")}
            </h4>
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
          </div>
          <TaskFilters
            activeFilter={activeFilter()}
            onFilterChange={setActiveFilter}
          />
        </div>

        {isCreating() && (
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
              saving={saving()}
              error={error()}
              onSubmit={handleSubmit}
              onClose={closeForm}
            />
          </div>
        )}

        {filteredTasks().length === 0
          ? (
            isCreating()
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
                  <button
                    type="button"
                    class="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-2"
                    onClick={openCreateForm}
                  >
                    <Icons.Plus class="w-4 h-4" />
                    {t("addTask")}
                  </button>
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
