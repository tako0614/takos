import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import {
  appendUniqueMobileItemsByKey,
  appendUniqueMobileItemsById,
  canSubmitMobileText,
  confirmMobileAction,
  formatMobilePreviewDate,
  mobileErrorMessage,
  mobileTextRemaining,
} from "@takosjp/takosumi-mobile-kit";
import {
  defineMobileHostActions,
  MobileComposeField,
  MobileComposeFooter,
  MobileComposeForm,
  MobileComposeSection,
  MobilePreviewCard,
  MobilePreviewList,
  MobilePreviewSection,
  renderMobileClientApp,
  type MobileShellMetric,
} from "@takosjp/takosumi-mobile-kit/solid";
import { productAdapter } from "./product.ts";
import { createProductNativeBridge } from "./native.ts";
import {
  applyTakosMobileGitAppInstall,
  applyTakosMobileGitAppRevision,
  planTakosMobileGitAppInstall,
  planTakosMobileGitAppRevision,
  removeTakosMobileAppInstallation,
  type TakosMobileGitAppPlan,
} from "./apps.ts";
import {
  createTakosMobileAgentTask,
  updateTakosMobileAgentTaskStatus,
  type TakosMobileAgentTaskPriority,
  type TakosMobileAgentTaskStatus,
} from "./agent-tasks.ts";
import {
  cancelTakosMobileRun,
  createTakosMobileChatMessage,
  isTakosMobileRunTerminalStatus,
  loadTakosMobileRunEvents,
  loadTakosMobileThreadMessages,
  loadTakosMobileThreadTranscript,
  loadTakosMobileRunStatus,
  watchTakosMobileRunEventStream,
  type TakosMobileRunEvent,
  type TakosMobileRunEventMessageRole,
  type TakosMobileRunSummary,
} from "./chat.ts";
import {
  loadTakosMobileHome,
  type TakosMobileHome,
  type TakosMobileThreadMessagePreview,
} from "./home.ts";
import { createTakosMobileMemory, deleteTakosMobileMemory } from "./memory.ts";
import {
  loadTakosMobileNotificationsPage,
  loadTakosMobileNotificationSettings,
  markAllTakosMobileNotificationsRead,
  markTakosMobileNotificationRead,
  setTakosMobileNotificationsMutedUntil,
  takosMobileNotificationChannels,
  takosMobileNotificationTypes,
  type TakosMobileNotificationsCursor,
  type TakosMobileNotificationChannel,
  type TakosMobileNotificationPreferences,
  type TakosMobileNotificationType,
  updateTakosMobileNotificationPreference,
} from "./notifications.ts";
import { registerTakosMobilePush, unregisterTakosMobilePush } from "./push.ts";
import "./styles.css";

const APP_PREVIEW_LIMIT = 4;

const workspaceMetrics = [
  {
    label: "Workspaces",
    value: (home) => home?.workspaceCount,
  },
  {
    label: "Apps",
    value: (home) => home?.appCount,
  },
  {
    label: "Unread",
    value: (home) => home?.unreadNotifications,
  },
] satisfies readonly MobileShellMetric<TakosMobileHome>[];

const workspaceActions = defineMobileHostActions<TakosMobileHome>([
  {
    label: "Open workspace",
    description: "Continue in the hosted Takos UI.",
    path: "/",
  },
  {
    label: "Chat",
    description: "Open the workspace chat surface.",
    path: "/chat",
  },
  {
    label: "Apps",
    description: "Open app launcher and installed apps.",
    path: "/apps",
  },
  {
    label: "Notifications",
    description: "Review account and workspace notifications.",
    path: "/notifications",
  },
]);

renderMobileClientApp<TakosMobileHome>({
  adapter: productAdapter,
  createNativeBridge: createProductNativeBridge,
  loadHome: loadTakosMobileHome,
  registerPush: registerTakosMobilePush,
  unregisterPush: unregisterTakosMobilePush,
  sessionUnlock: {
    restoreMode: "if-available",
    prompt: {
      message: "Unlock your Takos mobile session.",
      title: "Takos",
      subtitle: "Use your device lock to continue.",
      allowDeviceCredential: true,
    },
  },
  homeLabel: "workspace",
  copy: {
    summary:
      "Connect to an existing Takos host by URL, or create one through Takosumi Host Center.",
    connectLabel: "Host URL or QR payload",
    discoveredHeading: "Discovered host",
    homeFallbackTitle: "Workspace",
    lockedSessionTitle: "Takos session locked",
    unlockSessionLabel: "Unlock Takos",
    refreshLabel: "Refresh workspace",
    homeTitle: (home) => home?.userName,
    metricsLabel: "Workspace summary",
    shortcutsLabel: "Workspace shortcuts",
  },
  metrics: workspaceMetrics,
  hostActions: workspaceActions,
  renderHomeExtra: ({
    home,
    session,
    refreshHome,
    openHostRoute,
    openExternalUrl,
  }) => (
    <>
      <QuickChatComposer
        home={home}
        session={session}
        refreshHome={refreshHome}
        openHostRoute={openHostRoute}
      />
      <Show when={home?.recentThreads?.length}>
        <RecentChatsPreview
          home={home}
          session={session}
          openHostRoute={openHostRoute}
        />
      </Show>
      <Show when={home?.threadList?.length}>
        <ThreadTranscriptBrowser
          home={home}
          session={session}
          openHostRoute={openHostRoute}
        />
      </Show>
      <Show when={home?.chatTarget}>
        {(chatTarget) => (
          <QuickAgentTaskComposer
            spaceId={chatTarget().spaceId}
            session={session}
            refreshHome={refreshHome}
            openHostRoute={openHostRoute}
          />
        )}
      </Show>
      <Show when={home?.agentTasks?.length}>
        <AgentTasksPreview
          tasks={home?.agentTasks}
          session={session}
          refreshHome={refreshHome}
          openHostRoute={openHostRoute}
        />
      </Show>
      <Show when={home?.chatTarget}>
        {(chatTarget) => (
          <QuickAppInstallComposer
            spaceId={chatTarget().spaceId}
            session={session}
            refreshHome={refreshHome}
            openHostRoute={openHostRoute}
          />
        )}
      </Show>
      <Show when={home?.appInstallations?.length}>
        <AppInstallationsPreview
          installations={home?.appInstallations}
          session={session}
          refreshHome={refreshHome}
          openHostRoute={openHostRoute}
          openExternalUrl={openExternalUrl}
        />
      </Show>
      <Show when={home?.chatTarget}>
        {(chatTarget) => (
          <QuickMemoryComposer
            spaceId={chatTarget().spaceId}
            session={session}
            refreshHome={refreshHome}
            openHostRoute={openHostRoute}
          />
        )}
      </Show>
      <Show when={home?.memories?.length}>
        <MemoryPreview
          memories={home?.memories}
          session={session}
          refreshHome={refreshHome}
          openHostRoute={openHostRoute}
        />
      </Show>
      <Show when={home?.apps?.length}>
        <InstalledAppsPreview
          apps={home?.apps ?? []}
          openHostRoute={openHostRoute}
          openExternalUrl={openExternalUrl}
        />
      </Show>
      <Show when={home}>
        {(currentHome) => (
          <NotificationsInboxPreview
            initialNotifications={currentHome().recentNotifications ?? []}
            session={session}
            openHostRoute={openHostRoute}
          />
        )}
      </Show>
      <NotificationSettingsPreview
        session={session}
        openHostRoute={openHostRoute}
      />
    </>
  ),
});

type TakosMobileThreadPreview = NonNullable<
  TakosMobileHome["recentThreads"]
>[number];

type TakosMobileAgentTaskPreview = NonNullable<
  TakosMobileHome["agentTasks"]
>[number];

type TakosMobileMemoryPreview = NonNullable<
  TakosMobileHome["memories"]
>[number];

type TakosMobileAppPreview = NonNullable<TakosMobileHome["apps"]>[number];

type TakosMobileAppLaunchTarget = TakosMobileAppPreview["launchTarget"];

type TakosMobileAppInstallationPreview = NonNullable<
  TakosMobileHome["appInstallations"]
>[number];

interface AgentTaskActionState {
  readonly status?: TakosMobileAgentTaskStatus;
  readonly message?: string;
  readonly loading?: TakosMobileAgentTaskStatus;
}

interface AppInstallationActionState {
  readonly loading?: "plan" | "apply" | "remove";
  readonly message?: string;
  readonly plan?: TakosMobileGitAppPlan;
}

function QuickAppInstallComposer(props: {
  readonly spaceId: string;
  readonly session: Parameters<
    typeof planTakosMobileGitAppInstall
  >[0]["session"];
  readonly refreshHome: () => Promise<void>;
  readonly openHostRoute: (path: string) => Promise<void>;
}) {
  const [gitUrl, setGitUrl] = createSignal("");
  const [ref, setRef] = createSignal("main");
  const [modulePath, setModulePath] = createSignal(".");
  const [status, setStatus] = createSignal("");
  const [plan, setPlan] = createSignal<TakosMobileGitAppPlan | undefined>();
  const [lastInstallationId, setLastInstallationId] = createSignal<
    string | undefined
  >();
  const [action, setAction] = createSignal<"plan" | "apply" | undefined>();
  const canPlan = () =>
    canSubmitMobileText({ value: gitUrl(), disabled: Boolean(action()) }) &&
    canSubmitMobileText({ value: ref(), disabled: Boolean(action()) }) &&
    canSubmitMobileText({ value: modulePath(), disabled: Boolean(action()) });
  const canApply = () => Boolean(plan()) && !action();

  function resetPlan() {
    setPlan(undefined);
    setLastInstallationId(undefined);
  }

  async function submitPlan(event: SubmitEvent) {
    event.preventDefault();
    if (!canPlan()) return;
    setAction("plan");
    setStatus("");
    resetPlan();
    try {
      const nextPlan = await planTakosMobileGitAppInstall({
        session: props.session,
        spaceId: props.spaceId,
        gitUrl: gitUrl(),
        ref: ref(),
        modulePath: modulePath(),
      });
      setPlan(nextPlan);
      setStatus(
        nextPlan.title ? `Plan ready for ${nextPlan.title}.` : "Plan ready.",
      );
    } catch (error) {
      setStatus(mobileErrorMessage(error, "Failed to plan install."));
    } finally {
      setAction(undefined);
    }
  }

  async function applyInstall() {
    const currentPlan = plan();
    if (!currentPlan || !canApply()) return;
    setAction("apply");
    setStatus("");
    try {
      const result = await applyTakosMobileGitAppInstall({
        session: props.session,
        plan: currentPlan,
      });
      setStatus(
        result.status
          ? `Install ${formatStatus(result.status)}.`
          : "Install queued.",
      );
      setPlan(undefined);
      setGitUrl("");
      setLastInstallationId(result.installationId);
      await props.refreshHome();
    } catch (error) {
      setStatus(mobileErrorMessage(error, "Failed to install app."));
    } finally {
      setAction(undefined);
    }
  }

  return (
    <section class="compose-section" aria-label="Install app from Git URL">
      <h3>Install app</h3>
      <form
        class="compose-form app-install-compose-form"
        onSubmit={(event) => void submitPlan(event)}
      >
        <label class="compose-target app-install-url">
          <span>Git URL</span>
          <input
            name="app-git-url"
            type="url"
            value={gitUrl()}
            placeholder="https://github.com/example/app.git"
            disabled={Boolean(action())}
            onInput={(event) => {
              setGitUrl(event.currentTarget.value);
              resetPlan();
            }}
          />
        </label>
        <label class="compose-target">
          <span>Ref</span>
          <input
            name="app-ref"
            value={ref()}
            placeholder="main"
            disabled={Boolean(action())}
            onInput={(event) => {
              setRef(event.currentTarget.value);
              resetPlan();
            }}
          />
        </label>
        <label class="compose-target">
          <span>Path</span>
          <input
            name="app-module-path"
            value={modulePath()}
            placeholder="."
            disabled={Boolean(action())}
            onInput={(event) => {
              setModulePath(event.currentTarget.value);
              resetPlan();
            }}
          />
        </label>
        <div class="compose-footer app-install-footer">
          <button
            type="button"
            class="text-button"
            onClick={() => void props.openHostRoute("/new")}
          >
            Host Center
          </button>
          <div class="app-install-actions">
            <button type="submit" class="text-button" disabled={!canPlan()}>
              {action() === "plan" ? "Planning" : "Plan"}
            </button>
            <button
              type="button"
              class="primary"
              disabled={!canApply()}
              onClick={() => void applyInstall()}
            >
              {action() === "apply" ? "Installing" : "Install"}
            </button>
          </div>
        </div>
        <Show when={plan()}>
          {(currentPlan) => (
            <div class="app-install-plan" aria-label="Install plan">
              <strong>{currentPlan().title ?? "Planned app"}</strong>
              <small>
                {currentPlan().ref}
                {currentPlan().modulePath
                  ? ` / ${currentPlan().modulePath}`
                  : ""}
              </small>
            </div>
          )}
        </Show>
        <Show when={status()}>
          {(message) => <p class="status">{message()}</p>}
        </Show>
        <Show when={lastInstallationId()}>
          {(installationId) => (
            <button
              type="button"
              class="text-button compose-open"
              onClick={() =>
                void props.openHostRoute(
                  `/installations/${encodeURIComponent(installationId())}`,
                )
              }
            >
              Open install
            </button>
          )}
        </Show>
      </form>
    </section>
  );
}

function AppInstallationsPreview(props: {
  readonly installations?: readonly TakosMobileAppInstallationPreview[];
  readonly session: Parameters<
    typeof planTakosMobileGitAppRevision
  >[0]["session"];
  readonly refreshHome: () => Promise<void>;
  readonly openHostRoute: (path: string) => Promise<void>;
  readonly openExternalUrl: (url: string) => Promise<void>;
}) {
  return (
    <section class="preview-section" aria-label="App installations">
      <div class="preview-section-toolbar">
        <div>
          <h3>App installs</h3>
          <small>{props.installations?.length ?? 0} managed</small>
        </div>
        <button
          type="button"
          class="text-button"
          onClick={() => void props.openHostRoute("/installations")}
        >
          Open installs
        </button>
      </div>
      <ul class="preview-list">
        <For each={props.installations}>
          {(installation) => (
            <li>
              <AppInstallationLifecycleCard
                installation={installation}
                session={props.session}
                refreshHome={props.refreshHome}
                openHostRoute={props.openHostRoute}
                openExternalUrl={props.openExternalUrl}
              />
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

function AppInstallationLifecycleCard(props: {
  readonly installation: TakosMobileAppInstallationPreview;
  readonly session: Parameters<
    typeof planTakosMobileGitAppRevision
  >[0]["session"];
  readonly refreshHome: () => Promise<void>;
  readonly openHostRoute: (path: string) => Promise<void>;
  readonly openExternalUrl: (url: string) => Promise<void>;
}) {
  const [state, setState] = createSignal<AppInstallationActionState>({});
  const [updateRef, setUpdateRef] = createSignal(
    props.installation.ref ?? "main",
  );
  const [modulePath, setModulePath] = createSignal(
    props.installation.modulePath ?? ".",
  );
  const canPlanUpdate = () =>
    Boolean(props.installation.gitUrl) &&
    canSubmitMobileText({
      value: updateRef(),
      disabled: Boolean(state().loading),
    }) &&
    canSubmitMobileText({
      value: modulePath(),
      disabled: Boolean(state().loading),
    });

  async function planUpdate() {
    const gitUrl = props.installation.gitUrl;
    if (!gitUrl || !canPlanUpdate()) return;
    setState({ loading: "plan" });
    try {
      const plan = await planTakosMobileGitAppRevision({
        session: props.session,
        spaceId: props.installation.spaceId,
        installationId: props.installation.id,
        operation: "upgrade",
        gitUrl,
        ref: updateRef(),
        modulePath: modulePath(),
        reason: "mobile update",
      });
      setState({ plan, message: "Plan ready." });
    } catch (error) {
      setState({
        message: mobileErrorMessage(error, "Failed to plan update."),
      });
    }
  }

  async function applyUpdate() {
    const plan = state().plan;
    if (!plan || state().loading) return;
    setState((current) => ({ ...current, loading: "apply" }));
    try {
      const result = await applyTakosMobileGitAppRevision({
        session: props.session,
        installationId: props.installation.id,
        operation: "upgrade",
        plan,
        reason: "mobile update",
      });
      setState({
        message: result.status
          ? `Update ${formatStatus(result.status)}.`
          : "Update queued.",
      });
      await props.refreshHome();
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: undefined,
        message: mobileErrorMessage(error, "Failed to apply update."),
      }));
    }
  }

  async function removeInstallation() {
    if (state().loading) return;
    if (
      !confirmMobileAction({
        message: `Remove ${props.installation.name}?`,
      })
    ) {
      return;
    }
    setState({ loading: "remove" });
    try {
      const result = await removeTakosMobileAppInstallation({
        session: props.session,
        spaceId: props.installation.spaceId,
        installationId: props.installation.id,
        reason: "mobile remove",
      });
      setState({
        message: result.status
          ? `Remove ${formatStatus(result.status)}.`
          : "Remove queued.",
      });
      await props.refreshHome();
    } catch (error) {
      setState({
        message: mobileErrorMessage(error, "Failed to remove app."),
      });
    }
  }

  return (
    <div class="preview-item app-installation-card">
      <div class="preview-content">
        <strong>{props.installation.name}</strong>
        <div class="preview-inline-meta">
          <Show when={props.installation.appId}>
            {(appId) => <span>{appId()}</span>}
          </Show>
          <Show when={props.installation.gitUrl}>
            {(gitUrl) => <span>{sourceDisplayName(gitUrl())}</span>}
          </Show>
          <Show when={props.installation.launchUrl}>
            {(launchUrl) => <span>{displayUrlHost(launchUrl())}</span>}
          </Show>
        </div>
      </div>
      <div class="preview-badge-stack">
        <Show when={props.installation.status}>
          {(status) => (
            <span class="preview-badge">{formatStatus(status())}</span>
          )}
        </Show>
        <Show when={props.installation.ref}>
          {(ref) => (
            <span class="preview-badge preview-badge-muted">{ref()}</span>
          )}
        </Show>
      </div>
      <Show when={props.installation.gitUrl}>
        <div class="app-installation-update">
          <label class="compose-target">
            <span>Update ref</span>
            <input
              name={`update-ref-${props.installation.id}`}
              value={updateRef()}
              disabled={Boolean(state().loading)}
              onInput={(event) => {
                setUpdateRef(event.currentTarget.value);
                setState((current) => ({ ...current, plan: undefined }));
              }}
            />
          </label>
          <label class="compose-target">
            <span>Path</span>
            <input
              name={`update-path-${props.installation.id}`}
              value={modulePath()}
              disabled={Boolean(state().loading)}
              onInput={(event) => {
                setModulePath(event.currentTarget.value);
                setState((current) => ({ ...current, plan: undefined }));
              }}
            />
          </label>
        </div>
      </Show>
      <div class="app-installation-actions">
        <Show when={props.installation.launchUrl}>
          {(launchUrl) => (
            <button
              type="button"
              class="text-button"
              onClick={() =>
                void openAppInstallationLaunchUrl(
                  launchUrl(),
                  props.session.hostUrl,
                  props.openHostRoute,
                  props.openExternalUrl,
                )
              }
            >
              Open
            </button>
          )}
        </Show>
        <button
          type="button"
          class="text-button"
          onClick={() => void props.openHostRoute(props.installation.routePath)}
        >
          Details
        </button>
        <Show when={props.installation.gitUrl}>
          <button
            type="button"
            class="text-button"
            disabled={!canPlanUpdate()}
            onClick={() => void planUpdate()}
          >
            {state().loading === "plan" ? "Planning" : "Plan update"}
          </button>
          <button
            type="button"
            class="text-button"
            disabled={!state().plan || Boolean(state().loading)}
            onClick={() => void applyUpdate()}
          >
            {state().loading === "apply" ? "Applying" : "Apply update"}
          </button>
        </Show>
        <button
          type="button"
          class="text-button"
          disabled={Boolean(state().loading)}
          onClick={() => void removeInstallation()}
        >
          {state().loading === "remove" ? "Removing" : "Remove"}
        </button>
        <Show when={state().message}>
          {(message) => (
            <small class="app-installation-action-status">{message()}</small>
          )}
        </Show>
      </div>
    </div>
  );
}

function QuickAgentTaskComposer(props: {
  readonly spaceId: string;
  readonly session: Parameters<typeof createTakosMobileAgentTask>[0]["session"];
  readonly refreshHome: () => Promise<void>;
  readonly openHostRoute: (path: string) => Promise<void>;
}) {
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [priority, setPriority] =
    createSignal<TakosMobileAgentTaskPriority>("medium");
  const [status, setStatus] = createSignal("");
  const [lastTaskRoute, setLastTaskRoute] = createSignal<string | undefined>();
  const [submitting, setSubmitting] = createSignal(false);
  const titleRemaining = () => mobileTextRemaining(title(), 240);
  const descriptionRemaining = () => mobileTextRemaining(description(), 4000);
  const canCreate = () =>
    canSubmitMobileText({
      value: title(),
      disabled: submitting(),
      maxLength: 240,
    });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!canCreate()) return;
    setSubmitting(true);
    setStatus("");
    setLastTaskRoute(undefined);
    try {
      const task = await createTakosMobileAgentTask({
        session: props.session,
        spaceId: props.spaceId,
        title: title(),
        description: description(),
        priority: priority(),
        createThread: true,
      });
      setTitle("");
      setDescription("");
      setStatus("Task created.");
      setLastTaskRoute(task.routePath);
      await props.refreshHome();
    } catch (error) {
      setStatus(mobileErrorMessage(error, "Failed to create task."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section class="compose-section" aria-label="Create agent task">
      <h3>Quick task</h3>
      <form
        class="compose-form task-compose-form"
        onSubmit={(event) => void submit(event)}
      >
        <label class="compose-target">
          <span>Task title</span>
          <input
            name="task-title"
            value={title()}
            maxLength={240}
            placeholder="What should the agent work on?"
            disabled={submitting()}
            onInput={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <label class="compose-target">
          <span>Priority</span>
          <select
            name="task-priority"
            value={priority()}
            disabled={submitting()}
            onChange={(event) =>
              setPriority(
                event.currentTarget.value as TakosMobileAgentTaskPriority,
              )
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <textarea
          name="task-description"
          value={description()}
          maxLength={4000}
          placeholder="Add context, constraints, or success criteria"
          disabled={submitting()}
          onInput={(event) => setDescription(event.currentTarget.value)}
        />
        <div class="compose-footer">
          <small>
            {titleRemaining()} title / {descriptionRemaining()} details
          </small>
          <button type="submit" class="primary" disabled={!canCreate()}>
            {submitting() ? "Creating" : "Create"}
          </button>
        </div>
        <Show when={status()}>
          {(message) => <p class="status">{message()}</p>}
        </Show>
        <Show when={lastTaskRoute()}>
          {(routePath) => (
            <button
              type="button"
              class="text-button compose-open"
              onClick={() => void props.openHostRoute(routePath())}
            >
              Open task chat
            </button>
          )}
        </Show>
      </form>
    </section>
  );
}

function QuickMemoryComposer(props: {
  readonly spaceId: string;
  readonly session: Parameters<typeof createTakosMobileMemory>[0]["session"];
  readonly refreshHome: () => Promise<void>;
  readonly openHostRoute: (path: string) => Promise<void>;
}) {
  const [content, setContent] = createSignal("");
  const [category, setCategory] = createSignal("");
  const [type, setType] =
    createSignal<TakosMobileMemoryPreview["type"]>("semantic");
  const [status, setStatus] = createSignal("");
  const [lastMemoryRoute, setLastMemoryRoute] = createSignal<
    string | undefined
  >();
  const [submitting, setSubmitting] = createSignal(false);
  const remaining = () => mobileTextRemaining(content(), 100000);
  const canSave = () =>
    canSubmitMobileText({
      value: content(),
      disabled: submitting(),
      maxLength: 100000,
    });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!canSave()) return;
    setSubmitting(true);
    setStatus("");
    setLastMemoryRoute(undefined);
    try {
      const memory = await createTakosMobileMemory({
        session: props.session,
        spaceId: props.spaceId,
        content: content(),
        category: category(),
        type: type(),
      });
      setContent("");
      setCategory("");
      setStatus("Memory saved.");
      setLastMemoryRoute(memory.routePath);
      await props.refreshHome();
    } catch (error) {
      setStatus(mobileErrorMessage(error, "Failed to save memory."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <MobileComposeSection title="Quick memory" ariaLabel="Save memory">
      <MobileComposeForm
        class="memory-compose-form"
        onSubmit={(event) => void submit(event)}
      >
        <MobileComposeField label="Memory type">
          <select
            name="memory-type"
            value={type()}
            disabled={submitting()}
            onChange={(event) =>
              setType(
                event.currentTarget.value as TakosMobileMemoryPreview["type"],
              )
            }
          >
            <option value="semantic">Knowledge</option>
            <option value="episode">Episode</option>
            <option value="procedural">Procedure</option>
          </select>
        </MobileComposeField>
        <MobileComposeField label="Category">
          <input
            name="memory-category"
            value={category()}
            maxLength={80}
            placeholder="project, preference, procedure"
            disabled={submitting()}
            onInput={(event) => setCategory(event.currentTarget.value)}
          />
        </MobileComposeField>
        <textarea
          name="memory-content"
          value={content()}
          maxLength={100000}
          placeholder="What should Takos remember?"
          disabled={submitting()}
          onInput={(event) => setContent(event.currentTarget.value)}
        />
        <MobileComposeFooter detail={remaining()}>
          <button type="submit" class="primary" disabled={!canSave()}>
            {submitting() ? "Saving" : "Save"}
          </button>
        </MobileComposeFooter>
        <Show when={status()}>
          {(message) => <p class="status">{message()}</p>}
        </Show>
        <Show when={lastMemoryRoute()}>
          {(routePath) => (
            <button
              type="button"
              class="text-button compose-open"
              onClick={() => void props.openHostRoute(routePath())}
            >
              Open memory
            </button>
          )}
        </Show>
      </MobileComposeForm>
    </MobileComposeSection>
  );
}

function QuickChatComposer(props: {
  readonly home: TakosMobileHome | undefined;
  readonly session: Parameters<
    typeof createTakosMobileChatMessage
  >[0]["session"];
  readonly refreshHome: () => Promise<void>;
  readonly openHostRoute: (path: string) => Promise<void>;
}) {
  const newThreadValue = "__new__";
  const [draft, setDraft] = createSignal("");
  const [selectedThreadId, setSelectedThreadId] = createSignal(newThreadValue);
  const [status, setStatus] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [lastThreadRoute, setLastThreadRoute] = createSignal<
    string | undefined
  >();
  const [lastRun, setLastRun] = createSignal<
    TakosMobileRunSummary | undefined
  >();
  const [runEvents, setRunEvents] = createSignal<
    readonly TakosMobileRunEvent[]
  >([]);
  const [runTranscript, setRunTranscript] = createSignal<
    readonly RunTranscriptItem[]
  >([]);
  const [assistantPreview, setAssistantPreview] = createSignal("");
  const [runEventCursor, setRunEventCursor] = createSignal(0);
  const [runStatusMessage, setRunStatusMessage] = createSignal("");
  const [runAction, setRunAction] = createSignal<"refresh" | "cancel">();
  const [watchingRun, setWatchingRun] = createSignal(false);
  let runEventPollInFlight = false;
  const availableThreads = () =>
    props.home?.threadList ?? props.home?.recentThreads ?? [];
  const selectedThread = () =>
    availableThreads().find((thread) => thread.id === selectedThreadId());
  const remaining = () => mobileTextRemaining(draft(), 20000);
  const canSend = () =>
    canSubmitMobileText({
      value: draft(),
      disabled: submitting(),
      maxLength: 20000,
    });
  const targetLabel = () =>
    selectedThread()?.title ?? props.home?.chatTarget?.spaceName ?? "workspace";

  createEffect(() => {
    const threads = availableThreads();
    const selected = selectedThreadId();
    if (
      selected !== newThreadValue &&
      !threads.some((thread) => thread.id === selected)
    ) {
      setSelectedThreadId(newThreadValue);
      return;
    }
    if (selected === newThreadValue && threads[0]) {
      setSelectedThreadId(threads[0].id);
    }
  });

  createEffect(() => {
    const run = lastRun();
    if (!run || isTakosMobileRunTerminalStatus(run.status)) {
      setWatchingRun(false);
      return;
    }
    setWatchingRun(true);
    const controller = new AbortController();
    let fallbackTimer: number | undefined;
    const startPollingFallback = () => {
      if (fallbackTimer !== undefined || controller.signal.aborted) return;
      const poll = () => void pollRunEvents(run.id);
      queueMicrotask(poll);
      fallbackTimer = window.setInterval(poll, 3000);
    };
    void streamRunEvents(run.id, controller.signal, startPollingFallback);
    onCleanup(() => {
      controller.abort();
      if (fallbackTimer !== undefined) {
        window.clearInterval(fallbackTimer);
      }
      setWatchingRun(false);
    });
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!canSend()) return;
    setSubmitting(true);
    setStatus("");
    setLastThreadRoute(undefined);
    setLastRun(undefined);
    setRunEvents([]);
    setRunTranscript([]);
    setAssistantPreview("");
    setRunEventCursor(0);
    setRunStatusMessage("");
    try {
      const result = await createTakosMobileChatMessage({
        session: props.session,
        content: draft(),
        spaceId: props.home?.chatTarget?.spaceId,
        threadId:
          selectedThreadId() === newThreadValue
            ? undefined
            : selectedThreadId(),
      });
      setDraft("");
      setSelectedThreadId(result.threadId);
      setLastThreadRoute(result.routePath);
      if (result.runId) {
        setLastRun({
          id: result.runId,
          threadId: result.threadId,
          status: "queued",
        });
        setStatus("Sent. Run queued.");
      } else {
        setStatus("Sent.");
      }
      await props.refreshHome();
    } catch (error) {
      setStatus(mobileErrorMessage(error, "Failed to send."));
    } finally {
      setSubmitting(false);
    }
  }

  async function pollRunEvents(runId: string) {
    if (runEventPollInFlight || runAction()) return;
    const currentRun = lastRun();
    if (
      !currentRun ||
      currentRun.id !== runId ||
      isTakosMobileRunTerminalStatus(currentRun.status)
    ) {
      return;
    }
    runEventPollInFlight = true;
    try {
      const page = await loadTakosMobileRunEvents({
        session: props.session,
        runId,
        lastEventId: runEventCursor(),
      });
      await applyRunEventBatch(runId, page.events, page.lastEventId);
      await applyRunStatus(runId, page.runStatus);
    } catch (error) {
      if (lastRun()?.id === runId) {
        setRunStatusMessage(mobileErrorMessage(error, "Failed to watch run."));
      }
    } finally {
      runEventPollInFlight = false;
    }
  }

  async function streamRunEvents(
    runId: string,
    signal: AbortSignal,
    startPollingFallback: () => void,
  ) {
    try {
      const result = await watchTakosMobileRunEventStream({
        session: props.session,
        runId,
        lastEventId: runEventCursor(),
        signal,
        onEvent: (event) => applyRunEvent(runId, event),
      });
      if (signal.aborted || lastRun()?.id !== runId) return;
      setRunEventCursor(result.lastEventId);
      if (result.terminalStatus) {
        await applyRunStatus(runId, result.terminalStatus);
        return;
      }
      startPollingFallback();
    } catch (error) {
      if (signal.aborted || lastRun()?.id !== runId) return;
      setRunStatusMessage(
        `${mobileErrorMessage(error, "Run stream unavailable")}. Watching by polling.`,
      );
      startPollingFallback();
    }
  }

  async function applyRunEvent(runId: string, event: TakosMobileRunEvent) {
    await applyRunEventBatch(runId, [event], event.id);
    if (event.status) {
      await applyRunStatus(runId, event.status);
    }
  }

  async function applyRunEventBatch(
    runId: string,
    events: readonly TakosMobileRunEvent[],
    lastEventId: number,
  ) {
    const latestRun = lastRun();
    if (
      events.length === 0 ||
      !latestRun ||
      latestRun.id !== runId ||
      isTakosMobileRunTerminalStatus(latestRun.status)
    ) {
      return;
    }
    setRunEventCursor((cursor) => Math.max(cursor, lastEventId));
    setRunEvents((previous) => mergeRecentRunEvents(previous, events));
    const transcriptItems = events.flatMap(runTranscriptItemFromEvent);
    if (transcriptItems.length > 0) {
      setRunTranscript((previous) =>
        mergeRecentTranscriptItems(previous, transcriptItems),
      );
      const assistantText = [...transcriptItems]
        .reverse()
        .find((item) => item.role === "assistant")?.text;
      if (assistantText) {
        setAssistantPreview(assistantText);
      }
    }
  }

  async function applyRunStatus(
    runId: string,
    status: TakosMobileRunSummary["status"],
  ) {
    const latestRun = lastRun();
    if (!latestRun || latestRun.id !== runId) return;
    if (latestRun.status !== status) {
      setLastRun({ ...latestRun, status });
      setRunStatusMessage(`Run ${formatStatus(status)}.`);
    }
    if (isTakosMobileRunTerminalStatus(status)) {
      await refreshAssistantPreviewFromThread(latestRun.threadId);
      await props.refreshHome();
    }
  }

  async function refreshRun() {
    const run = lastRun();
    if (!run || runAction()) return;
    setRunAction("refresh");
    setRunStatusMessage("");
    try {
      const updated = await loadTakosMobileRunStatus({
        session: props.session,
        runId: run.id,
      });
      setLastRun(updated);
      setRunStatusMessage(`Run ${formatStatus(updated.status)}.`);
      if (isTakosMobileRunTerminalStatus(updated.status)) {
        await refreshAssistantPreviewFromThread(
          updated.threadId ?? run.threadId,
        );
      }
      await props.refreshHome();
    } catch (error) {
      setRunStatusMessage(mobileErrorMessage(error, "Failed to refresh run."));
    } finally {
      setRunAction(undefined);
    }
  }

  async function cancelRun() {
    const run = lastRun();
    if (!run || runAction() || isTakosMobileRunTerminalStatus(run.status)) {
      return;
    }
    setRunAction("cancel");
    setRunStatusMessage("");
    try {
      await cancelTakosMobileRun({
        session: props.session,
        runId: run.id,
      });
      setLastRun({ ...run, status: "cancelled" });
      setRunStatusMessage("Run cancelled.");
      await props.refreshHome();
    } catch (error) {
      setRunStatusMessage(mobileErrorMessage(error, "Failed to cancel run."));
    } finally {
      setRunAction(undefined);
    }
  }

  async function refreshAssistantPreviewFromThread(
    threadId: string | undefined,
  ) {
    if (!threadId) return;
    try {
      const page = await loadTakosMobileThreadMessages({
        session: props.session,
        threadId,
        limit: 6,
        latest: true,
      });
      const assistantMessage = [...page.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      if (assistantMessage) {
        setAssistantPreview(assistantMessage.text);
      }
      setRunTranscript(
        page.messages
          .filter((message) => message.role === "assistant")
          .map(runTranscriptItemFromThreadMessage)
          .slice(-4),
      );
    } catch {
      // Keep the event-derived preview when timeline refresh is unavailable.
    }
  }

  return (
    <section class="compose-section" aria-label="Send chat message">
      <h3>Quick chat</h3>
      <form class="compose-form" onSubmit={(event) => void submit(event)}>
        <Show when={availableThreads().length}>
          <label class="compose-target">
            <span>Chat target</span>
            <select
              name="chat-target"
              value={selectedThreadId()}
              disabled={submitting()}
              onChange={(event) =>
                setSelectedThreadId(event.currentTarget.value)
              }
            >
              <option value={newThreadValue}>New chat</option>
              <For each={availableThreads()}>
                {(thread) => <option value={thread.id}>{thread.title}</option>}
              </For>
            </select>
          </label>
        </Show>
        <textarea
          id="takos-mobile-chat-message"
          name="chat-message"
          value={draft()}
          maxLength={20000}
          placeholder={`Message ${targetLabel()}`}
          disabled={submitting()}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        <div class="compose-footer">
          <small>{remaining()}</small>
          <button type="submit" class="primary" disabled={!canSend()}>
            {submitting() ? "Sending" : "Send"}
          </button>
        </div>
        <Show when={status()}>
          {(message) => <p class="status">{message()}</p>}
        </Show>
        <Show when={lastThreadRoute()}>
          {(routePath) => (
            <button
              type="button"
              class="text-button compose-open"
              onClick={() => void props.openHostRoute(routePath())}
            >
              Open chat
            </button>
          )}
        </Show>
        <Show when={lastRun()}>
          {(run) => (
            <div class="compose-run-status" aria-label="Run status">
              <div>
                <strong>Run {formatStatus(run().status)}</strong>
                <Show when={run().error}>{(error) => <p>{error()}</p>}</Show>
                <Show when={run().output}>{(output) => <p>{output()}</p>}</Show>
                <Show when={run().completedAt ?? run().startedAt}>
                  {(timestamp) => (
                    <small>{formatMobilePreviewDate(timestamp())}</small>
                  )}
                </Show>
                <Show when={watchingRun()}>
                  <small>Watching run events</small>
                </Show>
              </div>
              <Show when={runEvents().length}>
                <ul class="compose-run-events" aria-label="Recent run events">
                  <For each={runEvents()}>
                    {(event) => (
                      <li>
                        <span>{formatRunEventType(event.type)}</span>
                        <Show when={event.status}>
                          {(status) => <em>{formatStatus(status())}</em>}
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={assistantPreview()}>
                {(preview) => (
                  <div class="compose-assistant-preview">
                    <span>Assistant</span>
                    <p>{preview()}</p>
                  </div>
                )}
              </Show>
              <Show when={runTranscript().length > 1}>
                <ol
                  class="compose-transcript"
                  aria-label="Assistant transcript"
                >
                  <For each={runTranscript()}>
                    {(item) => (
                      <li>
                        <span>{formatRunTranscriptRole(item.role)}</span>
                        <p>{item.text}</p>
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
              <div class="compose-run-actions">
                <button
                  type="button"
                  class="text-button"
                  disabled={Boolean(runAction())}
                  onClick={() => void refreshRun()}
                >
                  {runAction() === "refresh" ? "Refreshing" : "Refresh run"}
                </button>
                <Show when={!isTakosMobileRunTerminalStatus(run().status)}>
                  <button
                    type="button"
                    class="text-button"
                    disabled={Boolean(runAction())}
                    onClick={() => void cancelRun()}
                  >
                    {runAction() === "cancel" ? "Cancelling" : "Cancel run"}
                  </button>
                </Show>
                <Show when={runStatusMessage()}>
                  {(message) => (
                    <small class="run-action-status">{message()}</small>
                  )}
                </Show>
              </div>
            </div>
          )}
        </Show>
      </form>
    </section>
  );
}

interface RunTranscriptItem {
  readonly id: string;
  readonly role: TakosMobileRunEventMessageRole;
  readonly text: string;
  readonly createdAt?: string;
}

function mergeRecentRunEvents(
  previous: readonly TakosMobileRunEvent[],
  next: readonly TakosMobileRunEvent[],
): readonly TakosMobileRunEvent[] {
  const byId = new Map<number, TakosMobileRunEvent>();
  for (const event of previous) byId.set(event.id, event);
  for (const event of next) byId.set(event.id, event);
  return Array.from(byId.values())
    .sort((a, b) => a.id - b.id)
    .slice(-4);
}

function runTranscriptItemFromEvent(
  event: TakosMobileRunEvent,
): readonly RunTranscriptItem[] {
  if (!event.messageRole || !event.messageText) return [];
  return [
    {
      id: `event:${event.id}`,
      role: event.messageRole,
      text: event.messageText,
      createdAt: event.createdAt,
    },
  ];
}

function runTranscriptItemFromThreadMessage(
  message: TakosMobileThreadMessagePreview,
): RunTranscriptItem {
  return {
    id: message.id ?? `thread:${message.sequence ?? message.text}`,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
  };
}

function mergeRecentTranscriptItems(
  previous: readonly RunTranscriptItem[],
  next: readonly RunTranscriptItem[],
): readonly RunTranscriptItem[] {
  const byId = new Map<string, RunTranscriptItem>();
  for (const item of previous) byId.set(item.id, item);
  for (const item of next) byId.set(item.id, item);
  return Array.from(byId.values()).slice(-4);
}

function ThreadTranscriptBrowser(props: {
  readonly home: TakosMobileHome | undefined;
  readonly session: Parameters<
    typeof loadTakosMobileThreadTranscript
  >[0]["session"];
  readonly openHostRoute: (path: string) => Promise<void>;
}) {
  const [selectedThreadId, setSelectedThreadId] = createSignal("");
  const [threadDetails, setThreadDetails] = createSignal<
    Record<string, ThreadDetailState>
  >({});
  const [localMessages, setLocalMessages] = createSignal<
    Record<string, readonly TakosMobileThreadMessagePreview[]>
  >({});
  const [replyDraft, setReplyDraft] = createSignal("");
  const [replyStatus, setReplyStatus] = createSignal("");
  const [lastReplyRoute, setLastReplyRoute] = createSignal<
    string | undefined
  >();
  const [submitting, setSubmitting] = createSignal(false);
  const threads = () => props.home?.threadList ?? [];
  const selectedThread = () =>
    threads().find((thread) => thread.id === selectedThreadId());
  const detailState = () => {
    const thread = selectedThread();
    return thread ? (threadDetails()[thread.id] ?? {}) : {};
  };
  const visibleThreadMessages = () => {
    const thread = selectedThread();
    if (!thread) return [];
    return mergeThreadMessages(
      detailState().messages ?? thread.recentMessages ?? [],
      localMessages()[thread.id] ?? [],
    );
  };

  createEffect(() => {
    const available = threads();
    const selected = selectedThreadId();
    if (available.length === 0) {
      if (selected) setSelectedThreadId("");
      return;
    }
    if (!selected || !available.some((thread) => thread.id === selected)) {
      setSelectedThreadId(available[0].id);
    }
  });

  function selectThread(threadId: string) {
    setSelectedThreadId(threadId);
    setReplyDraft("");
    setReplyStatus("");
    setLastReplyRoute(undefined);
  }

  async function loadTranscript(mode: "latest" | "older") {
    const thread = selectedThread();
    if (!thread) return;
    const current = threadDetails()[thread.id] ?? {};
    if (mode === "latest" && current.loading) return;
    if (mode === "older") {
      if (current.loadingOlder || current.nextOlderOffset == null) return;
    }
    setThreadDetails((previous) => ({
      ...previous,
      [thread.id]: {
        ...current,
        status: "",
        loading: mode === "latest",
        loadingOlder: mode === "older",
      },
    }));
    try {
      const page =
        mode === "latest"
          ? await loadTakosMobileThreadTranscript({
              session: props.session,
              threadId: thread.id,
              limit: current.limit,
            })
          : await loadTakosMobileThreadMessages({
              session: props.session,
              threadId: thread.id,
              limit: current.limit ?? 20,
              offset: current.nextOlderOffset,
            });
      setThreadDetails((previous) => {
        const latest = previous[thread.id] ?? {};
        const existing = latest.messages ?? [];
        const messages =
          mode === "older"
            ? mergeThreadMessages(page.messages, existing)
            : page.messages;
        return {
          ...previous,
          [thread.id]: {
            ...latest,
            loading: false,
            loadingOlder: false,
            messages,
            total: page.total,
            offset: page.offset,
            limit: page.limit,
            hasOlder: page.hasOlder,
            nextOlderOffset: page.nextOlderOffset,
          },
        };
      });
    } catch (error) {
      setThreadDetails((previous) => ({
        ...previous,
        [thread.id]: {
          ...(previous[thread.id] ?? current),
          loading: false,
          loadingOlder: false,
          status: mobileErrorMessage(error, "Failed to load messages."),
        },
      }));
    }
  }

  async function submitReply() {
    const thread = selectedThread();
    if (
      !thread ||
      !canSubmitMobileText({
        value: replyDraft(),
        disabled: submitting(),
        maxLength: 20000,
      })
    ) {
      return;
    }
    const content = replyDraft().trim();
    setSubmitting(true);
    setReplyStatus("");
    setLastReplyRoute(undefined);
    try {
      const result = await createTakosMobileChatMessage({
        session: props.session,
        content,
        spaceId: props.home?.chatTarget?.spaceId,
        threadId: thread.id,
      });
      setReplyDraft("");
      setReplyStatus("Sent.");
      setLastReplyRoute(result.routePath);
      setLocalMessages((previous) => ({
        ...previous,
        [thread.id]: [
          ...(previous[thread.id] ?? []),
          {
            role: "user",
            text: content.replace(/\s+/g, " ").slice(0, 180),
            createdAt: new Date().toISOString(),
          },
        ],
      }));
    } catch (error) {
      setReplyStatus(mobileErrorMessage(error, "Failed to send."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      class="preview-section thread-browser"
      aria-label="Chat transcript"
    >
      <div class="preview-section-toolbar">
        <div>
          <h3>Chat transcript</h3>
          <small>{threads().length} active chats</small>
        </div>
        <Show when={selectedThread()}>
          {(thread) => (
            <button
              type="button"
              class="text-button chat-open-button"
              onClick={() => void props.openHostRoute(thread().routePath)}
            >
              Open chat
            </button>
          )}
        </Show>
      </div>
      <label class="compose-target thread-browser-select">
        <span>Thread</span>
        <select
          name="thread-transcript-target"
          value={selectedThreadId()}
          onChange={(event) => selectThread(event.currentTarget.value)}
        >
          <For each={threads()}>
            {(thread) => <option value={thread.id}>{thread.title}</option>}
          </For>
        </select>
      </label>
      <Show when={selectedThread()}>
        {(thread) => (
          <div class="thread-browser-panel">
            <div class="chat-thread-detail-actions">
              <button
                type="button"
                class="text-button chat-load-older-button"
                disabled={detailState().loading}
                onClick={() => void loadTranscript("latest")}
              >
                {detailState().loading ? "Loading" : "Load latest"}
              </button>
              <Show when={detailState().hasOlder}>
                <button
                  type="button"
                  class="text-button chat-load-older-button"
                  disabled={detailState().loadingOlder}
                  onClick={() => void loadTranscript("older")}
                >
                  {detailState().loadingOlder ? "Loading" : "Load older"}
                </button>
              </Show>
              <Show when={typeof detailState().total === "number"}>
                <small>
                  {visibleThreadMessages().length} / {detailState().total}{" "}
                  messages
                </small>
              </Show>
              <Show when={thread().updatedAt}>
                {(updatedAt) => (
                  <small>{formatMobilePreviewDate(updatedAt())}</small>
                )}
              </Show>
            </div>
            <Show
              when={visibleThreadMessages().length}
              fallback={<p class="status">Load the latest transcript.</p>}
            >
              <ol class="thread-message-preview-list thread-browser-message-list">
                <For each={visibleThreadMessages()}>
                  {(message) => (
                    <li class={`thread-message thread-message-${message.role}`}>
                      <span>{formatMessageRole(message.role)}</span>
                      <p>{message.text}</p>
                      <Show when={message.createdAt}>
                        {(createdAt) => (
                          <small>{formatMobilePreviewDate(createdAt())}</small>
                        )}
                      </Show>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
            <Show when={detailState().status}>
              {(message) => <p class="status">{message()}</p>}
            </Show>
            <ThreadInlineReplyComposer
              thread={thread()}
              draft={replyDraft()}
              status={replyStatus()}
              submitting={submitting()}
              setDraft={setReplyDraft}
              submitReply={() => void submitReply()}
              cancel={() => {
                setReplyDraft("");
                setReplyStatus("");
                setLastReplyRoute(undefined);
              }}
            />
            <Show when={lastReplyRoute()}>
              {(routePath) => (
                <button
                  type="button"
                  class="text-button chat-open-button"
                  onClick={() => void props.openHostRoute(routePath())}
                >
                  Open sent chat
                </button>
              )}
            </Show>
          </div>
        )}
      </Show>
    </section>
  );
}

function AgentTasksPreview(props: {
  readonly tasks?: readonly TakosMobileAgentTaskPreview[];
  readonly session: Parameters<
    typeof updateTakosMobileAgentTaskStatus
  >[0]["session"];
  readonly refreshHome: () => Promise<void>;
  readonly openHostRoute: (path: string) => Promise<void>;
}) {
  const [taskStates, setTaskStates] = createSignal<
    Record<string, AgentTaskActionState>
  >({});

  function taskStatus(task: TakosMobileAgentTaskPreview): string | undefined {
    return taskStates()[task.id]?.status ?? task.status;
  }

  function taskMessage(task: TakosMobileAgentTaskPreview): string | undefined {
    return taskStates()[task.id]?.message;
  }

  function taskLoading(
    task: TakosMobileAgentTaskPreview,
  ): TakosMobileAgentTaskStatus | undefined {
    return taskStates()[task.id]?.loading;
  }

  async function updateTask(
    task: TakosMobileAgentTaskPreview,
    status: TakosMobileAgentTaskStatus,
  ) {
    if (taskLoading(task)) return;
    setTaskStates((previous) => ({
      ...previous,
      [task.id]: { ...previous[task.id], loading: status, message: undefined },
    }));
    try {
      const updated = await updateTakosMobileAgentTaskStatus({
        session: props.session,
        taskId: task.id,
        status,
      });
      setTaskStates((previous) => ({
        ...previous,
        [task.id]: {
          status: updated.status as TakosMobileAgentTaskStatus | undefined,
          loading: undefined,
          message: "Task updated.",
        },
      }));
      await props.refreshHome();
    } catch (error) {
      setTaskStates((previous) => ({
        ...previous,
        [task.id]: {
          ...previous[task.id],
          loading: undefined,
          message: mobileErrorMessage(error, "Failed to update task."),
        },
      }));
    }
  }

  return (
    <section class="preview-section" aria-label="Agent tasks">
      <h3>Agent tasks</h3>
      <ul class="preview-list">
        <For each={props.tasks}>
          {(task) => (
            <li>
              <div class="preview-item agent-task-preview-card">
                <button
                  type="button"
                  class="agent-task-open"
                  aria-label={`Open agent task: ${task.title}`}
                  onClick={() => void props.openHostRoute(task.routePath)}
                >
                  <AgentTaskPreviewContent
                    task={task}
                    status={taskStatus(task)}
                  />
                </button>
                <div class="agent-task-actions">
                  <Show
                    when={
                      taskStatus(task) !== "in_progress" &&
                      taskStatus(task) !== "completed" &&
                      taskStatus(task) !== "cancelled"
                    }
                  >
                    <button
                      type="button"
                      class="text-button"
                      disabled={Boolean(taskLoading(task))}
                      onClick={() => void updateTask(task, "in_progress")}
                    >
                      {taskLoading(task) === "in_progress"
                        ? "Starting"
                        : "Start"}
                    </button>
                  </Show>
                  <Show
                    when={
                      taskStatus(task) !== "completed" &&
                      taskStatus(task) !== "cancelled"
                    }
                  >
                    <button
                      type="button"
                      class="text-button"
                      disabled={Boolean(taskLoading(task))}
                      onClick={() => void updateTask(task, "completed")}
                    >
                      {taskLoading(task) === "completed" ? "Saving" : "Done"}
                    </button>
                  </Show>
                  <Show
                    when={
                      taskStatus(task) !== "blocked" &&
                      taskStatus(task) !== "completed" &&
                      taskStatus(task) !== "cancelled"
                    }
                  >
                    <button
                      type="button"
                      class="text-button"
                      disabled={Boolean(taskLoading(task))}
                      onClick={() => void updateTask(task, "blocked")}
                    >
                      {taskLoading(task) === "blocked" ? "Saving" : "Block"}
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="text-button"
                    onClick={() => void props.openHostRoute(task.routePath)}
                  >
                    Open
                  </button>
                  <Show when={taskMessage(task)}>
                    {(message) => (
                      <small class="agent-task-action-status">
                        {message()}
                      </small>
                    )}
                  </Show>
                </div>
              </div>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

function AgentTaskPreviewContent(props: {
  readonly task: TakosMobileAgentTaskPreview;
  readonly status?: string;
}) {
  return (
    <>
      <div class="preview-content">
        <strong>{props.task.title}</strong>
        <Show when={props.task.description}>
          {(description) => <p>{description()}</p>}
        </Show>
        <div class="preview-inline-meta">
          <Show when={props.task.threadTitle}>
            {(threadTitle) => <span>{threadTitle()}</span>}
          </Show>
          <Show when={props.task.updatedAt}>
            {(updatedAt) => <span>{formatMobilePreviewDate(updatedAt())}</span>}
          </Show>
        </div>
      </div>
      <div class="preview-badge-stack" aria-label="Task state">
        <Show when={props.status}>
          {(status) => (
            <span class="preview-badge">{formatStatus(status())}</span>
          )}
        </Show>
        <Show when={props.task.priority}>
          {(priority) => (
            <span class="preview-badge preview-badge-muted">
              {formatStatus(priority())}
            </span>
          )}
        </Show>
        <Show when={props.task.latestRunStatus}>
          {(status) => (
            <span class="preview-badge preview-badge-muted">
              Run {formatStatus(status())}
            </span>
          )}
        </Show>
      </div>
    </>
  );
}

function MemoryPreview(props: {
  readonly memories?: readonly TakosMobileMemoryPreview[];
  readonly session: Parameters<typeof deleteTakosMobileMemory>[0]["session"];
  readonly refreshHome: () => Promise<void>;
  readonly openHostRoute: (path: string) => Promise<void>;
}) {
  const [memoryStates, setMemoryStates] = createSignal<
    Record<string, { readonly message?: string; readonly deleting?: boolean }>
  >({});
  const memoryState = (memory: TakosMobileMemoryPreview) =>
    memoryStates()[memory.id] ?? {};

  async function deleteMemory(memory: TakosMobileMemoryPreview) {
    const state = memoryState(memory);
    if (state.deleting) return;
    setMemoryStates((current) => ({
      ...current,
      [memory.id]: { deleting: true },
    }));
    try {
      await deleteTakosMobileMemory({
        session: props.session,
        memoryId: memory.id,
      });
      setMemoryStates((current) => ({
        ...current,
        [memory.id]: { message: "Deleted." },
      }));
      await props.refreshHome();
    } catch (error) {
      setMemoryStates((current) => ({
        ...current,
        [memory.id]: {
          message: mobileErrorMessage(error, "Failed to delete memory."),
        },
      }));
    }
  }

  return (
    <section class="preview-section" aria-label="Memory">
      <h3>Memory</h3>
      <ul class="preview-list">
        <For each={props.memories}>
          {(memory) => (
            <li>
              <div class="preview-item memory-preview-card">
                <button
                  type="button"
                  class="memory-preview-open"
                  aria-label={`Open memory: ${memory.text}`}
                  onClick={() => void props.openHostRoute(memory.routePath)}
                >
                  <MemoryPreviewContent memory={memory} />
                </button>
                <div class="memory-preview-actions">
                  <button
                    type="button"
                    class="text-button"
                    onClick={() => void props.openHostRoute(memory.routePath)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    class="text-button"
                    disabled={Boolean(memoryState(memory).deleting)}
                    onClick={() => void deleteMemory(memory)}
                  >
                    {memoryState(memory).deleting ? "Deleting" : "Delete"}
                  </button>
                  <Show when={memoryState(memory).message}>
                    {(message) => (
                      <small class="memory-action-status">{message()}</small>
                    )}
                  </Show>
                </div>
              </div>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

function MemoryPreviewContent(props: {
  readonly memory: TakosMobileMemoryPreview;
}) {
  return (
    <>
      <div class="preview-content">
        <strong>{formatMemoryType(props.memory.type)}</strong>
        <p>{props.memory.text}</p>
        <div class="preview-inline-meta">
          <Show when={props.memory.category}>
            {(category) => <span>{category()}</span>}
          </Show>
          <Show when={props.memory.createdAt}>
            {(createdAt) => <span>{formatMobilePreviewDate(createdAt())}</span>}
          </Show>
        </div>
      </div>
      <Show when={props.memory.importance}>
        {(importance) => (
          <span class="preview-badge">{Math.round(importance() * 100)}%</span>
        )}
      </Show>
    </>
  );
}

function RecentChatsPreview(props: {
  readonly home: TakosMobileHome | undefined;
  readonly session: Parameters<
    typeof createTakosMobileChatMessage
  >[0]["session"];
  readonly openHostRoute: (path: string) => Promise<void>;
}) {
  const [replyingToThreadId, setReplyingToThreadId] = createSignal<
    string | undefined
  >();
  const [replyDrafts, setReplyDrafts] = createSignal<Record<string, string>>(
    {},
  );
  const [replyStatuses, setReplyStatuses] = createSignal<
    Record<string, string>
  >({});
  const [lastReplyRoutes, setLastReplyRoutes] = createSignal<
    Record<string, string>
  >({});
  const [submittingThreadId, setSubmittingThreadId] = createSignal<
    string | undefined
  >();
  const [localMessages, setLocalMessages] = createSignal<
    Record<string, readonly TakosMobileThreadMessagePreview[]>
  >({});
  const [threadDetails, setThreadDetails] = createSignal<
    Record<string, ThreadDetailState>
  >({});

  function setReplyDraft(threadId: string, value: string) {
    setReplyDrafts((previous) => ({
      ...previous,
      [threadId]: value,
    }));
  }

  function detailState(thread: TakosMobileThreadPreview): ThreadDetailState {
    return threadDetails()[thread.id] ?? {};
  }

  function visibleThreadMessages(thread: TakosMobileThreadPreview) {
    const detail = detailState(thread);
    const base =
      detail.expanded && detail.messages
        ? detail.messages
        : (thread.recentMessages ?? []);
    return mergeThreadMessages(base, localMessages()[thread.id] ?? []);
  }

  async function toggleThreadDetails(thread: TakosMobileThreadPreview) {
    const current = detailState(thread);
    if (current.expanded) {
      setThreadDetails((previous) => ({
        ...previous,
        [thread.id]: {
          ...current,
          expanded: false,
        },
      }));
      return;
    }
    setThreadDetails((previous) => ({
      ...previous,
      [thread.id]: {
        ...current,
        expanded: true,
      },
    }));
    if (!current.messages?.length) {
      await loadThreadMessages(thread, "latest");
    }
  }

  async function loadThreadMessages(
    thread: TakosMobileThreadPreview,
    mode: "latest" | "older",
  ) {
    const current = detailState(thread);
    if (mode === "latest" && current.loading) return;
    if (mode === "older") {
      if (current.loadingOlder || current.nextOlderOffset == null) return;
    }
    setThreadDetails((previous) => ({
      ...previous,
      [thread.id]: {
        ...current,
        expanded: true,
        status: "",
        loading: mode === "latest",
        loadingOlder: mode === "older",
      },
    }));
    try {
      const page = await loadTakosMobileThreadMessages({
        session: props.session,
        threadId: thread.id,
        limit: current.limit ?? 8,
        offset: mode === "older" ? current.nextOlderOffset : undefined,
        latest: mode === "latest",
      });
      setThreadDetails((previous) => {
        const latest = previous[thread.id] ?? {};
        const existing = latest.messages ?? [];
        const messages =
          mode === "older"
            ? mergeThreadMessages(page.messages, existing)
            : page.messages;
        return {
          ...previous,
          [thread.id]: {
            ...latest,
            expanded: true,
            loading: false,
            loadingOlder: false,
            messages,
            total: page.total,
            offset: page.offset,
            limit: page.limit,
            hasOlder: page.hasOlder,
            nextOlderOffset: page.nextOlderOffset,
          },
        };
      });
    } catch (error) {
      setThreadDetails((previous) => ({
        ...previous,
        [thread.id]: {
          ...(previous[thread.id] ?? current),
          expanded: true,
          loading: false,
          loadingOlder: false,
          status: mobileErrorMessage(error, "Failed to load messages."),
        },
      }));
    }
  }

  async function submitReply(thread: TakosMobileThreadPreview) {
    const draft = replyDrafts()[thread.id] ?? "";
    if (
      !canSubmitMobileText({
        value: draft,
        disabled: submittingThreadId() === thread.id,
        maxLength: 20000,
      })
    ) {
      return;
    }
    const content = draft.trim();
    setSubmittingThreadId(thread.id);
    setReplyStatuses((previous) => ({ ...previous, [thread.id]: "" }));
    setLastReplyRoutes((previous) => {
      const next = { ...previous };
      delete next[thread.id];
      return next;
    });
    try {
      const result = await createTakosMobileChatMessage({
        session: props.session,
        content,
        spaceId: props.home?.chatTarget?.spaceId,
        threadId: thread.id,
      });
      setReplyDraft(thread.id, "");
      setReplyStatuses((previous) => ({
        ...previous,
        [thread.id]: "Sent.",
      }));
      setLastReplyRoutes((previous) => ({
        ...previous,
        [thread.id]: result.routePath,
      }));
      setLocalMessages((previous) => ({
        ...previous,
        [thread.id]: [
          ...(previous[thread.id] ?? []),
          {
            role: "user",
            text: content.replace(/\s+/g, " ").slice(0, 140),
            createdAt: new Date().toISOString(),
          },
        ],
      }));
    } catch (error) {
      setReplyStatuses((previous) => ({
        ...previous,
        [thread.id]: mobileErrorMessage(error, "Failed to send."),
      }));
    } finally {
      setSubmittingThreadId(undefined);
    }
  }

  return (
    <section class="preview-section" aria-label="Recent chats">
      <h3>Recent chats</h3>
      <ul class="preview-list">
        <For each={props.home?.recentThreads}>
          {(thread) => (
            <li>
              <div class="preview-item chat-preview-card">
                <button
                  type="button"
                  class="chat-preview-open"
                  aria-expanded={detailState(thread).expanded ?? false}
                  aria-label={`Show chat messages: ${thread.title}`}
                  onClick={() => void toggleThreadDetails(thread)}
                >
                  <div class="preview-content">
                    <strong>{thread.title}</strong>
                    <Show when={thread.updatedAt}>
                      {(updatedAt) => (
                        <small>{formatMobilePreviewDate(updatedAt())}</small>
                      )}
                    </Show>
                  </div>
                </button>
                <Show when={visibleThreadMessages(thread).length}>
                  <ol class="thread-message-preview-list">
                    <For each={visibleThreadMessages(thread)}>
                      {(message) => (
                        <li
                          class={`thread-message thread-message-${message.role}`}
                        >
                          <span>{formatMessageRole(message.role)}</span>
                          <p>{message.text}</p>
                        </li>
                      )}
                    </For>
                  </ol>
                </Show>
                <Show when={detailState(thread).expanded}>
                  <div class="chat-thread-detail-actions">
                    <Show when={detailState(thread).loading}>
                      <p class="status">Loading messages.</p>
                    </Show>
                    <Show when={detailState(thread).hasOlder}>
                      <button
                        type="button"
                        class="text-button chat-load-older-button"
                        disabled={detailState(thread).loadingOlder}
                        onClick={() => void loadThreadMessages(thread, "older")}
                      >
                        {detailState(thread).loadingOlder
                          ? "Loading"
                          : "Load older"}
                      </button>
                    </Show>
                    <Show when={typeof detailState(thread).total === "number"}>
                      <small>
                        {visibleThreadMessages(thread).length} /{" "}
                        {detailState(thread).total} messages
                      </small>
                    </Show>
                    <Show when={detailState(thread).status}>
                      {(message) => <p class="status">{message()}</p>}
                    </Show>
                  </div>
                </Show>
                <div class="chat-preview-actions">
                  <button
                    type="button"
                    class="text-button chat-reply-button"
                    aria-expanded={replyingToThreadId() === thread.id}
                    onClick={() =>
                      setReplyingToThreadId((current) =>
                        current === thread.id ? undefined : thread.id,
                      )
                    }
                  >
                    Reply
                  </button>
                  <button
                    type="button"
                    class="text-button chat-open-button"
                    onClick={() => void props.openHostRoute(thread.routePath)}
                  >
                    Open chat
                  </button>
                  <Show when={lastReplyRoutes()[thread.id]}>
                    {(routePath) => (
                      <button
                        type="button"
                        class="text-button chat-open-button"
                        onClick={() => void props.openHostRoute(routePath())}
                      >
                        Open chat
                      </button>
                    )}
                  </Show>
                </div>
                <Show when={replyingToThreadId() === thread.id}>
                  <ThreadInlineReplyComposer
                    thread={thread}
                    draft={replyDrafts()[thread.id] ?? ""}
                    status={replyStatuses()[thread.id] ?? ""}
                    submitting={submittingThreadId() === thread.id}
                    setDraft={(value) => setReplyDraft(thread.id, value)}
                    submitReply={() => void submitReply(thread)}
                    cancel={() => setReplyingToThreadId(undefined)}
                  />
                </Show>
              </div>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

function mergeThreadMessages(
  primary: readonly TakosMobileThreadMessagePreview[],
  secondary: readonly TakosMobileThreadMessagePreview[],
): readonly TakosMobileThreadMessagePreview[] {
  return [
    ...appendUniqueMobileItemsByKey(primary, secondary, threadMessageKey),
  ].sort((left, right) => {
    if (
      typeof left.sequence === "number" &&
      typeof right.sequence === "number"
    ) {
      return left.sequence - right.sequence;
    }
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : Number.NaN;
    const rightTime = right.createdAt
      ? Date.parse(right.createdAt)
      : Number.NaN;
    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
      return leftTime - rightTime;
    }
    return 0;
  });
}

function threadMessageKey(message: TakosMobileThreadMessagePreview): string {
  if (message.id) return message.id;
  if (typeof message.sequence === "number") return `seq:${message.sequence}`;
  return `${message.role}:${message.createdAt ?? ""}:${message.text}`;
}

function ThreadInlineReplyComposer(props: {
  readonly thread: TakosMobileThreadPreview;
  readonly draft: string;
  readonly status: string;
  readonly submitting: boolean;
  readonly setDraft: (value: string) => void;
  readonly submitReply: () => void;
  readonly cancel: () => void;
}) {
  const remaining = () => mobileTextRemaining(props.draft, 20000);
  const canReply = () =>
    canSubmitMobileText({
      value: props.draft,
      disabled: props.submitting,
      maxLength: 20000,
    });

  return (
    <form
      class="inline-chat-reply-form"
      aria-label={`Reply to chat: ${props.thread.title}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (canReply()) props.submitReply();
      }}
    >
      <textarea
        name="thread-reply"
        value={props.draft}
        maxLength={20000}
        placeholder={`Reply to ${props.thread.title}`}
        disabled={props.submitting}
        onInput={(event) => props.setDraft(event.currentTarget.value)}
      />
      <div class="inline-chat-reply-footer">
        <small>{remaining()}</small>
        <div>
          <button
            type="button"
            class="text-button"
            disabled={props.submitting}
            onClick={props.cancel}
          >
            Cancel
          </button>
          <button type="submit" class="primary" disabled={!canReply()}>
            {props.submitting ? "Sending" : "Send"}
          </button>
        </div>
      </div>
      <Show when={props.status}>
        {(message) => <p class="status">{message()}</p>}
      </Show>
    </form>
  );
}

type TakosMobileNotificationPreview = NonNullable<
  TakosMobileHome["recentNotifications"]
>[number];

interface NotificationReadState {
  readonly unread: boolean;
  readonly loading?: boolean;
  readonly error?: string;
}

interface NotificationBulkState {
  readonly action?: "read";
  readonly status?: string;
  readonly error?: string;
}

interface ThreadDetailState {
  readonly expanded?: boolean;
  readonly loading?: boolean;
  readonly loadingOlder?: boolean;
  readonly status?: string;
  readonly messages?: readonly TakosMobileThreadMessagePreview[];
  readonly total?: number;
  readonly offset?: number;
  readonly limit?: number;
  readonly hasOlder?: boolean;
  readonly nextOlderOffset?: number;
}

function NotificationsInboxPreview(props: {
  readonly initialNotifications: readonly TakosMobileNotificationPreview[];
  readonly session: Parameters<
    typeof markTakosMobileNotificationRead
  >[0]["session"];
  readonly openHostRoute: (path: string) => Promise<void>;
}) {
  const [notifications, setNotifications] = createSignal<
    readonly TakosMobileNotificationPreview[]
  >([]);
  const [readState, setReadState] = createSignal<
    Record<string, NotificationReadState>
  >({});
  const [cursor, setCursor] = createSignal<
    TakosMobileNotificationsCursor | undefined
  >();
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | undefined>();
  const [bulkState, setBulkState] = createSignal<NotificationBulkState>({});

  createEffect(() => {
    setNotifications(props.initialNotifications);
    setCursor(resolveNotificationCursor(props.initialNotifications, 3));
    setLoadError(undefined);
    setBulkState({});
  });

  function notificationState(
    notification: TakosMobileNotificationPreview,
  ): NotificationReadState {
    const override = readState()[notification.id];
    return {
      unread: override?.unread ?? notification.unread,
      loading: override?.loading ?? false,
      error: override?.error,
    };
  }

  async function markRead(notification: TakosMobileNotificationPreview) {
    const current = notificationState(notification);
    if (!current.unread) return;
    setReadState((previous) => ({
      ...previous,
      [notification.id]: {
        unread: current.unread,
        loading: true,
      },
    }));
    try {
      await markTakosMobileNotificationRead({
        session: props.session,
        notificationId: notification.id,
      });
      setReadState((previous) => ({
        ...previous,
        [notification.id]: {
          unread: false,
          loading: false,
        },
      }));
    } catch (error) {
      setReadState((previous) => ({
        ...previous,
        [notification.id]: {
          unread: current.unread,
          loading: false,
          error: mobileErrorMessage(error, "Failed to mark notification read."),
        },
      }));
    }
  }

  async function markAllRead() {
    if (bulkState().action) return;
    setBulkState({ action: "read" });
    try {
      await markAllTakosMobileNotificationsRead({
        session: props.session,
      });
      setNotifications((previous) =>
        previous.map((notification) => ({
          ...notification,
          unread: false,
        })),
      );
      setReadState({});
      setBulkState({ status: "All notifications marked read" });
    } catch (error) {
      setBulkState({
        error: mobileErrorMessage(error, "Failed to mark notifications read."),
      });
    }
  }

  async function loadMore() {
    const pageCursor = cursor();
    if (!pageCursor || loadingMore()) return;
    setLoadingMore(true);
    setLoadError(undefined);
    try {
      const page = await loadTakosMobileNotificationsPage({
        session: props.session,
        limit: 10,
        cursor: pageCursor,
      });
      setNotifications((previous) =>
        appendUniqueMobileItemsById(previous, page.notifications),
      );
      setCursor(page.nextCursor);
    } catch (error) {
      setLoadError(mobileErrorMessage(error, "Failed to load notifications."));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section class="preview-section" aria-label="Notifications inbox">
      <div class="preview-section-toolbar">
        <div>
          <h3>Notifications</h3>
          <small>{notifications().length} loaded</small>
        </div>
        <div class="notification-inbox-toolbar-actions">
          <button
            type="button"
            class="text-button"
            disabled={Boolean(bulkState().action)}
            onClick={() => void markAllRead()}
          >
            {bulkState().action === "read" ? "Marking" : "Mark all read"}
          </button>
          <button
            type="button"
            class="text-button"
            onClick={() => void props.openHostRoute("/notifications")}
          >
            Open host
          </button>
        </div>
      </div>
      <Show when={bulkState().status}>
        {(message) => <p class="notification-action-status">{message()}</p>}
      </Show>
      <Show when={bulkState().error}>
        {(message) => <p class="notification-action-error">{message()}</p>}
      </Show>
      <Show
        when={notifications().length > 0}
        fallback={<p class="notification-inbox-empty">No notifications</p>}
      >
        <ul class="preview-list">
          <For each={notifications()}>
            {(notification) => (
              <li>
                <div class="preview-item notification-preview-card">
                  <button
                    type="button"
                    class="notification-preview-open"
                    aria-label={`Open notification: ${notification.title}`}
                    onClick={() =>
                      void props.openHostRoute(notification.routePath)
                    }
                  >
                    <NotificationPreviewContent notification={notification} />
                  </button>
                  <div class="notification-preview-actions">
                    <Show when={notificationState(notification).unread}>
                      <span class="preview-badge">Unread</span>
                      <button
                        type="button"
                        class="text-button notification-read-button"
                        disabled={notificationState(notification).loading}
                        onClick={() => void markRead(notification)}
                      >
                        Mark read
                      </button>
                    </Show>
                    <Show when={notificationState(notification).error}>
                      {(message) => (
                        <small class="notification-action-error">
                          {message()}
                        </small>
                      )}
                    </Show>
                  </div>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="notification-inbox-footer">
        <Show when={cursor()}>
          <button
            type="button"
            class="text-button notification-load-more-button"
            disabled={loadingMore()}
            onClick={() => void loadMore()}
          >
            {loadingMore() ? "Loading" : "Load more"}
          </button>
        </Show>
        <Show when={loadError()}>
          {(message) => (
            <small class="notification-action-error">{message()}</small>
          )}
        </Show>
      </div>
    </section>
  );
}

function resolveNotificationCursor(
  notifications: readonly TakosMobileNotificationPreview[],
  pageSize: number,
): TakosMobileNotificationsCursor | undefined {
  if (notifications.length < pageSize) return undefined;
  const lastNotification = notifications[notifications.length - 1];
  if (!lastNotification?.createdAt) return undefined;
  return {
    before: lastNotification.createdAt,
    beforeId: lastNotification.id,
  };
}

interface NotificationSettingsState {
  readonly loading?: boolean;
  readonly savingKey?: string;
  readonly preferences?: TakosMobileNotificationPreferences;
  readonly pushSupportedTypes?: readonly TakosMobileNotificationType[];
  readonly mutedUntil?: string;
  readonly error?: string;
  readonly status?: string;
}

function NotificationSettingsPreview(props: {
  readonly session: Parameters<
    typeof loadTakosMobileNotificationSettings
  >[0]["session"];
  readonly openHostRoute: (path: string) => Promise<void>;
}) {
  const [state, setState] = createSignal<NotificationSettingsState>({
    loading: true,
  });

  createEffect(() => {
    void refreshSettings();
  });

  async function refreshSettings() {
    setState((previous) => ({
      ...previous,
      loading: true,
      error: undefined,
    }));
    try {
      const settings = await loadTakosMobileNotificationSettings({
        session: props.session,
      });
      setState({
        preferences: settings.preferences,
        pushSupportedTypes: settings.pushSupportedTypes,
        mutedUntil: settings.mutedUntil,
      });
    } catch (error) {
      setState((previous) => ({
        ...previous,
        loading: false,
        error: mobileErrorMessage(
          error,
          "Failed to load notification settings.",
        ),
      }));
    }
  }

  async function setMute(minutes: number | null) {
    const mutedUntil =
      minutes === null
        ? undefined
        : new Date(Date.now() + minutes * 60 * 1000).toISOString();
    setState((previous) => ({
      ...previous,
      savingKey: "mute",
      error: undefined,
      status: undefined,
    }));
    try {
      const result = await setTakosMobileNotificationsMutedUntil({
        session: props.session,
        mutedUntil,
      });
      setState((previous) => ({
        ...previous,
        savingKey: undefined,
        mutedUntil: result.mutedUntil,
        status: result.mutedUntil ? "Muted" : "Unmuted",
      }));
    } catch (error) {
      setState((previous) => ({
        ...previous,
        savingKey: undefined,
        error: mobileErrorMessage(error, "Failed to update notification mute."),
      }));
    }
  }

  async function togglePreference(
    type: TakosMobileNotificationType,
    channel: TakosMobileNotificationChannel,
  ) {
    const preferences = state().preferences;
    if (!preferences) return;
    if (channel === "push" && !state().pushSupportedTypes?.includes(type)) {
      return;
    }
    const enabled = !preferences[type][channel];
    const savingKey = `${type}:${channel}`;
    setState((previous) => ({
      ...previous,
      savingKey,
      error: undefined,
      status: undefined,
    }));
    try {
      const nextPreferences = await updateTakosMobileNotificationPreference({
        session: props.session,
        type,
        channel,
        enabled,
      });
      setState((previous) => ({
        ...previous,
        savingKey: undefined,
        preferences: nextPreferences,
        status: "Preferences saved",
      }));
    } catch (error) {
      setState((previous) => ({
        ...previous,
        savingKey: undefined,
        error: mobileErrorMessage(
          error,
          "Failed to update notification preferences.",
        ),
      }));
    }
  }

  return (
    <section class="preview-section" aria-label="Notification settings">
      <div class="preview-section-toolbar">
        <div>
          <h3>Notification settings</h3>
          <Show
            when={state().mutedUntil}
            fallback={<small>Alerts active</small>}
          >
            {(mutedUntil) => (
              <small>Muted until {formatMobilePreviewDate(mutedUntil())}</small>
            )}
          </Show>
        </div>
        <button
          type="button"
          class="text-button"
          onClick={() => void props.openHostRoute("/notifications")}
        >
          Open host
        </button>
      </div>
      <div class="notification-settings-actions">
        <button
          type="button"
          class="text-button"
          disabled={state().savingKey === "mute"}
          onClick={() => void setMute(60)}
        >
          Mute 1h
        </button>
        <button
          type="button"
          class="text-button"
          disabled={state().savingKey === "mute"}
          onClick={() => void setMute(8 * 60)}
        >
          Mute 8h
        </button>
        <button
          type="button"
          class="text-button"
          disabled={state().savingKey === "mute"}
          onClick={() => void setMute(null)}
        >
          Unmute
        </button>
        <button
          type="button"
          class="text-button"
          disabled={state().loading}
          onClick={() => void refreshSettings()}
        >
          Refresh
        </button>
      </div>
      <Show when={state().loading}>
        <p class="notification-settings-status">Loading settings</p>
      </Show>
      <Show when={state().preferences}>
        {(preferences) => (
          <div class="notification-preference-list">
            <For each={takosMobileNotificationTypes}>
              {(type) => (
                <div class="notification-preference-row">
                  <strong>{notificationTypeLabel(type)}</strong>
                  <div class="notification-preference-channels">
                    <For each={takosMobileNotificationChannels}>
                      {(channel) => {
                        const savingKey = () => `${type}:${channel}`;
                        const pushUnavailable = () =>
                          channel === "push" &&
                          !state().pushSupportedTypes?.includes(type);
                        return (
                          <label
                            title={
                              pushUnavailable()
                                ? "Takos push is available only for Agent run results."
                                : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              checked={preferences()[type][channel]}
                              disabled={
                                state().savingKey === savingKey() ||
                                pushUnavailable()
                              }
                              onChange={() =>
                                void togglePreference(type, channel)
                              }
                            />
                            <span>{notificationChannelLabel(channel)}</span>
                          </label>
                        );
                      }}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={state().status}>
        {(message) => <p class="notification-settings-status">{message()}</p>}
      </Show>
      <Show when={state().error}>
        {(message) => <p class="notification-action-error">{message()}</p>}
      </Show>
    </section>
  );
}

function notificationTypeLabel(type: TakosMobileNotificationType): string {
  switch (type) {
    case "deploy.completed":
      return "Deploy completed";
    case "deploy.failed":
      return "Deploy failed";
    case "run.completed":
      return "Agent run completed";
    case "run.failed":
      return "Agent run failed";
    case "pr.review.requested":
      return "Review requested";
    case "pr.comment":
      return "Pull request comment";
    case "workspace.invite":
      return "Workspace invite";
    case "billing.quota_warning":
      return "Quota warning";
    case "security.new_login":
      return "New login";
  }
}

function notificationChannelLabel(
  channel: TakosMobileNotificationChannel,
): string {
  switch (channel) {
    case "in_app":
      return "In-app";
    case "email":
      return "Email";
    case "push":
      return "Push";
  }
}

function NotificationPreviewContent(props: {
  readonly notification: TakosMobileNotificationPreview;
}) {
  return (
    <div class="preview-content">
      <strong>{props.notification.title}</strong>
      <Show when={props.notification.body}>{(body) => <p>{body()}</p>}</Show>
      <Show when={props.notification.createdAt}>
        {(createdAt) => <small>{formatMobilePreviewDate(createdAt())}</small>}
      </Show>
    </div>
  );
}

function InstalledAppsPreview(props: {
  readonly apps: readonly TakosMobileAppPreview[];
  readonly openHostRoute: (path: string) => Promise<void>;
  readonly openExternalUrl: (url: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const visibleApps = () =>
    expanded() ? props.apps : props.apps.slice(0, APP_PREVIEW_LIMIT);
  const hiddenCount = () => Math.max(0, props.apps.length - APP_PREVIEW_LIMIT);

  return (
    <MobilePreviewSection
      title="Installed apps"
      detail={`${props.apps.length} available`}
      actions={
        <button
          type="button"
          class="text-button"
          onClick={() => void props.openHostRoute("/apps")}
        >
          Open launcher
        </button>
      }
    >
      <MobilePreviewList>
        <For each={visibleApps()}>
          {(app) => (
            <li>
              <MobilePreviewCard class="app-preview-card">
                <div class="app-preview-summary">
                  <AppPreviewContent app={app} />
                </div>
                <div class="app-preview-actions">
                  <button
                    type="button"
                    class="text-button"
                    disabled={app.launchTarget.kind === "unavailable"}
                    onClick={() =>
                      void openAppLaunchTarget(
                        app.launchTarget,
                        props.openHostRoute,
                        props.openExternalUrl,
                      )
                    }
                  >
                    {formatAppLaunchAction(app.launchTarget)}
                  </button>
                  <button
                    type="button"
                    class="text-button"
                    onClick={() => void props.openHostRoute(app.launcherPath)}
                  >
                    Details
                  </button>
                </div>
              </MobilePreviewCard>
            </li>
          )}
        </For>
      </MobilePreviewList>
      <Show when={hiddenCount() > 0}>
        <button
          type="button"
          class="text-button app-preview-more"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded() ? "Show fewer" : `Show ${hiddenCount()} more`}
        </button>
      </Show>
    </MobilePreviewSection>
  );
}

function AppPreviewContent(props: { readonly app: TakosMobileAppPreview }) {
  return (
    <>
      <div class="preview-content">
        <strong>{props.app.name}</strong>
        <Show when={props.app.description}>
          {(description) => <p>{description()}</p>}
        </Show>
        <div class="preview-inline-meta">
          <Show when={props.app.spaceName}>
            {(spaceName) => <span>{spaceName()}</span>}
          </Show>
          <Show when={props.app.appType}>
            {(appType) => <span>{formatStatus(appType())}</span>}
          </Show>
          <Show when={props.app.serviceHostname}>
            {(hostname) => <span>{hostname()}</span>}
          </Show>
        </div>
      </div>
      <div class="preview-badge-stack">
        <Show when={props.app.status}>
          {(status) => (
            <span class="preview-badge">{formatStatus(status())}</span>
          )}
        </Show>
        <span
          class={
            props.app.launchTarget.kind === "unavailable"
              ? "preview-badge preview-badge-muted"
              : "preview-badge"
          }
        >
          {formatAppLaunchBadge(props.app.launchTarget)}
        </span>
      </div>
    </>
  );
}

async function openAppLaunchTarget(
  target: TakosMobileAppLaunchTarget,
  openHostRoute: (path: string) => Promise<void>,
  openExternalUrl: (url: string) => Promise<void>,
): Promise<void> {
  switch (target.kind) {
    case "host":
      await openHostRoute(target.path);
      return;
    case "external":
      await openExternalUrl(target.url);
      return;
    case "unavailable":
      return;
  }
}

function formatAppLaunchAction(target: TakosMobileAppLaunchTarget): string {
  switch (target.kind) {
    case "host":
      return "Open";
    case "external":
      return "Open external";
    case "unavailable":
      return "No URL";
  }
}

function formatAppLaunchBadge(target: TakosMobileAppLaunchTarget): string {
  switch (target.kind) {
    case "host":
      return "Host";
    case "external":
      return "External";
    case "unavailable":
      return "No URL";
  }
}

async function openAppInstallationLaunchUrl(
  launchUrl: string,
  hostUrl: string,
  openHostRoute: (path: string) => Promise<void>,
  openExternalUrl: (url: string) => Promise<void>,
): Promise<void> {
  const raw = launchUrl.trim();
  if (!raw) return;
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    await openHostRoute(raw);
    return;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    const host = new URL(hostUrl);
    if (url.origin === host.origin) {
      await openHostRoute(`${url.pathname}${url.search}${url.hash}`);
      return;
    }
    await openExternalUrl(url.toString());
  } catch {
    return;
  }
}

function sourceDisplayName(gitUrl: string): string {
  try {
    const parsed = new URL(gitUrl);
    return parsed.pathname.split("/").filter(Boolean).at(-1) ?? gitUrl;
  } catch {
    return gitUrl;
  }
}

function displayUrlHost(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.host || value;
  } catch {
    return value;
  }
}

function formatStatus(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatRunEventType(value: string): string {
  return value
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatRunTranscriptRole(
  value: TakosMobileRunEventMessageRole,
): string {
  return value === "assistant"
    ? "Assistant"
    : value === "user"
      ? "You"
      : formatStatus(value);
}

function formatMessageRole(value: "assistant" | "user"): string {
  return value === "assistant" ? "Assistant: " : "You: ";
}

function formatMemoryType(value: TakosMobileMemoryPreview["type"]): string {
  switch (value) {
    case "episode":
      return "Episode";
    case "procedural":
      return "Procedure";
    case "semantic":
      return "Knowledge";
  }
}
