import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from "solid-js";
import {
  Badge,
  Button,
  Input,
  Modal,
  ModalFooter,
} from "../../components/ui/index.ts";
import { Icons } from "../../lib/Icons.tsx";
import { rpc, rpcJson, rpcPath } from "../../lib/rpc.ts";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import type {
  DeploymentGroup,
  DeploymentGroupDetail,
  GroupInventoryItem,
} from "../../types/index.ts";

interface GroupsPageProps {
  spaceId: string;
  groupId?: string;
  embedded?: boolean;
  onGroupSelect?: (groupId: string | null) => void;
  onNavigateToDeploy?: () => void;
}

type BadgeVariant = "default" | "success" | "warning" | "error" | "info";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function getString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
}

function countDesired(group: DeploymentGroup, keys: string[]): number {
  const desired = group.desiredSpecJson;
  if (!isRecord(desired)) return 0;

  for (const key of keys) {
    const value = desired[key];
    if (Array.isArray(value)) return value.length;
    if (isRecord(value)) return Object.keys(value).length;
  }

  return 0;
}

function statusVariant(status: string | null | undefined): BadgeVariant {
  const normalized = (status ?? "").toLowerCase();
  if (
    ["applied", "active", "healthy", "ready", "success", "synced"].includes(
      normalized,
    )
  ) {
    return "success";
  }
  if (
    ["pending", "running", "reconciling", "planning", "in_progress"].includes(
      normalized,
    )
  ) {
    return "warning";
  }
  if (["failed", "error", "degraded"].includes(normalized)) {
    return "error";
  }
  return normalized ? "info" : "default";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sourceLabel(group: DeploymentGroup): string {
  if (!group.sourceRepositoryUrl) return "-";
  if (group.sourceRef) {
    return `${group.sourceRepositoryUrl}#${group.sourceRef}`;
  }
  return group.sourceRepositoryUrl;
}

async function listGroups(spaceId: string): Promise<DeploymentGroup[]> {
  const res = await rpcPath(rpc, "spaces", ":spaceId", "groups").$get({
    param: { spaceId },
  });
  const data = await rpcJson<{ groups: DeploymentGroup[] }>(res);
  return data.groups;
}

async function getGroup(
  spaceId: string,
  groupId: string,
): Promise<DeploymentGroupDetail> {
  const res = await rpcPath(rpc, "spaces", ":spaceId", "groups", ":groupId")
    .$get({
      param: { spaceId, groupId },
    });
  return await rpcJson<DeploymentGroupDetail>(res);
}

async function createGroup(
  spaceId: string,
  input: { name: string; env?: string; appVersion?: string },
): Promise<{ id: string; name: string }> {
  const json: Record<string, unknown> = { name: input.name };
  if (input.env) json.env = input.env;
  if (input.appVersion) json.appVersion = input.appVersion;

  const res = await rpcPath(rpc, "spaces", ":spaceId", "groups").$post({
    param: { spaceId },
    json,
  });
  return await rpcJson<{ id: string; name: string }>(res);
}

function EmptyState(props: {
  onCreate: () => void;
  onNavigateToDeploy?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div class="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <h2 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {t("noGroups")}
      </h2>
      <p class="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        {t("noGroupsDescription")}
      </p>
      <div class="mt-4 flex flex-wrap justify-center gap-2">
        <Button
          size="sm"
          leftIcon={<Icons.Plus class="h-4 w-4" />}
          onClick={props.onCreate}
        >
          {t("createGroup")}
        </Button>
        <Show when={props.onNavigateToDeploy}>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Icons.Server class="h-4 w-4" />}
            onClick={props.onNavigateToDeploy}
          >
            {t("deployNav")}
          </Button>
        </Show>
      </div>
    </div>
  );
}

function GroupCard(props: {
  group: DeploymentGroup;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const desiredWorkloads = () =>
    countDesired(props.group, ["workloads", "workers", "services"]);
  const desiredResources = () => countDesired(props.group, ["resources"]);

  return (
    <button
      type="button"
      class={`w-full border-b px-3 py-3 text-left transition-colors last:border-b-0 dark:border-zinc-800 ${
        props.active
          ? "bg-zinc-100 dark:bg-zinc-800/70"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
      }`}
      onClick={props.onSelect}
    >
      <div class="flex min-w-0 items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {props.group.name}
          </h2>
          <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{t("workloads")}: {desiredWorkloads()}</span>
            <span>{t("resources")}: {desiredResources()}</span>
            <Show when={props.group.env}>
              <span>{props.group.env}</span>
            </Show>
          </div>
        </div>
        <Badge size="sm" variant={statusVariant(props.group.reconcileStatus)}>
          {props.group.reconcileStatus || t("unknownError")}
        </Badge>
      </div>
    </button>
  );
}

function InventorySection(props: {
  title: string;
  items: GroupInventoryItem[];
}) {
  const { t } = useI18n();

  return (
    <section class="space-y-2">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {props.title}
        </h3>
        <span class="text-xs text-zinc-500 dark:text-zinc-400">
          {props.items.length}
        </span>
      </div>
      <Show
        when={props.items.length > 0}
        fallback={
          <div class="border-t border-zinc-200 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {t("noItems")}
          </div>
        }
      >
        <div class="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          <For each={props.items}>
            {(item) => {
              const title = () =>
                getString(item, [
                  "name",
                  "serviceName",
                  "resourceName",
                  "routeRef",
                  "slug",
                  "id",
                ]) ?? "-";
              const type = () =>
                getString(item, [
                  "type",
                  "resourceType",
                  "serviceType",
                  "category",
                  "kind",
                ]);
              const status = () => getString(item, ["status", "state"]);
              return (
                <div class="flex items-center gap-2 py-2">
                  <h4 class="min-w-0 flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100">
                    {title()}
                  </h4>
                  <Show when={type()}>
                    <span class="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {type()}
                    </span>
                  </Show>
                  <Show when={status()}>
                    <Badge size="sm" variant={statusVariant(status())}>
                      {status()}
                    </Badge>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </section>
  );
}

function GroupDetail(props: {
  group: DeploymentGroupDetail | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const desiredJson = createMemo(() =>
    props.group?.desiredSpecJson
      ? JSON.stringify(props.group.desiredSpecJson, null, 2)
      : null
  );

  return (
    <section class="min-h-[420px] rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <Switch>
        <Match when={props.loading}>
          <div class="flex h-64 flex-col items-center justify-center gap-3">
            <div class="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700 dark:border-zinc-700 dark:border-t-zinc-200" />
            <p class="text-sm text-zinc-500 dark:text-zinc-400">
              {t("loading")}
            </p>
          </div>
        </Match>
        <Match when={props.error}>
          <div class="space-y-4">
            <div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {props.error}
            </div>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Icons.Refresh class="h-4 w-4" />}
              onClick={props.onRefresh}
            >
              {t("refresh")}
            </Button>
          </div>
        </Match>
        <Match when={props.group}>
          {(group) => (
            <div class="space-y-6">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <button
                    type="button"
                    class="mb-2 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 lg:hidden"
                    onClick={props.onBack}
                  >
                    <Icons.ChevronLeft class="h-4 w-4" />
                    {t("groups")}
                  </button>
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="min-w-0 truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      {group().name}
                    </h2>
                    <Badge
                      size="sm"
                      variant={statusVariant(group().reconcileStatus)}
                    >
                      {group().reconcileStatus || t("unknownError")}
                    </Badge>
                  </div>
                  <Show when={sourceLabel(group()) !== "-"}>
                    <p class="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">
                      {sourceLabel(group())}
                    </p>
                  </Show>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<Icons.Refresh class="h-4 w-4" />}
                  onClick={props.onRefresh}
                >
                  {t("refresh")}
                </Button>
              </div>

              <dl class="grid gap-x-6 gap-y-3 border-y border-zinc-200 py-3 sm:grid-cols-2 xl:grid-cols-4 dark:border-zinc-800">
                <MetaTile label={t("environment")} value={group().env ?? "-"} />
                <MetaTile
                  label={t("version")}
                  value={group().appVersion ?? "-"}
                />
                <MetaTile
                  label={t("lastApplied")}
                  value={formatDate(group().lastAppliedAt)}
                />
                <MetaTile
                  label={t("updated")}
                  value={formatDate(group().updatedAt)}
                />
              </dl>

              <div class="grid gap-6 xl:grid-cols-3">
                <InventorySection
                  title={t("workloads")}
                  items={group().inventory.workloads}
                />
                <InventorySection
                  title={t("resources")}
                  items={group().inventory.resources}
                />
                <InventorySection
                  title={t("routes")}
                  items={group().inventory.routes}
                />
              </div>

              <details class="group border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <summary class="cursor-pointer text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {t("desiredState")}
                </summary>
                <pre class="mt-3 max-h-72 overflow-auto rounded-lg bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                  {desiredJson() ?? t("noDesiredState")}
                </pre>
              </details>
            </div>
          )}
        </Match>
        <Match when>
          <div class="flex h-64 flex-col items-center justify-center text-center">
            <div class="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
              <Icons.Users class="h-6 w-6" />
            </div>
            <p class="text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {t("noGroupSelected")}
            </p>
          </div>
        </Match>
      </Switch>
    </section>
  );
}

function MetaTile(props: { label: string; value: string }) {
  return (
    <div class="min-w-0">
      <dt class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {props.label}
      </dt>
      <dd class="mt-1 truncate text-sm text-zinc-900 dark:text-zinc-100">
        {props.value}
      </dd>
    </div>
  );
}

function CreateGroupModal(props: {
  isOpen: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (
    input: { name: string; env?: string; appVersion?: string },
  ) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = createSignal("");
  const [env, setEnv] = createSignal("");
  const [appVersion, setAppVersion] = createSignal("");

  createEffect(() => {
    if (!props.isOpen) {
      setName("");
      setEnv("");
      setAppVersion("");
    }
  });

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const trimmedName = name().trim();
    if (!trimmedName || props.loading) return;
    props.onSubmit({
      name: trimmedName,
      env: env().trim() || undefined,
      appVersion: appVersion().trim() || undefined,
    });
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t("createGroup")}
      size="sm"
    >
      <form onSubmit={handleSubmit} class="space-y-4">
        <div class="space-y-1.5">
          <label
            for="group-name"
            class="text-sm font-medium text-zinc-700 dark:text-zinc-200"
          >
            {t("groupName")}
          </label>
          <Input
            id="group-name"
            value={name()}
            placeholder={t("groupNamePlaceholder")}
            onInput={(event) => setName(event.currentTarget.value)}
            autofocus
          />
        </div>
        <div class="space-y-1.5">
          <label
            for="group-env"
            class="text-sm font-medium text-zinc-700 dark:text-zinc-200"
          >
            {t("environment")}
          </label>
          <Input
            id="group-env"
            value={env()}
            placeholder="production"
            onInput={(event) => setEnv(event.currentTarget.value)}
          />
        </div>
        <div class="space-y-1.5">
          <label
            for="group-version"
            class="text-sm font-medium text-zinc-700 dark:text-zinc-200"
          >
            {t("version")}
          </label>
          <Input
            id="group-version"
            value={appVersion()}
            placeholder="1.0.0"
            onInput={(event) => setAppVersion(event.currentTarget.value)}
          />
        </div>
        <Show when={props.error}>
          <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {props.error}
          </div>
        </Show>
        <ModalFooter
          style={{ margin: "0 -1.5rem -1.5rem", padding: "1rem 1.5rem" }}
        >
          <Button
            type="button"
            variant="secondary"
            onClick={props.onClose}
            disabled={props.loading}
          >
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            isLoading={props.loading}
            disabled={props.loading || !name().trim()}
          >
            {props.loading ? t("creating") : t("create")}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

export function GroupsPage(props: GroupsPageProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [groups, setGroups] = createSignal<DeploymentGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = createSignal(false);
  const [groupsError, setGroupsError] = createSignal<string | null>(null);
  const [detail, setDetail] = createSignal<DeploymentGroupDetail | null>(null);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");
  const [showCreateModal, setShowCreateModal] = createSignal(false);
  const [creatingGroup, setCreatingGroup] = createSignal(false);
  const [createError, setCreateError] = createSignal<string | null>(null);
  let groupListRequest = 0;
  let detailRequest = 0;

  const filteredGroups = createMemo(() => {
    const trimmed = query().trim().toLowerCase();
    if (!trimmed) return groups();
    return groups().filter((group) =>
      [group.name, group.env, group.appVersion, group.sourceRepositoryUrl]
        .some((value) => value?.toLowerCase().includes(trimmed))
    );
  });

  const loadGroups = async (spaceId: string) => {
    const requestId = ++groupListRequest;
    setGroupsLoading(true);
    setGroupsError(null);
    try {
      const nextGroups = await listGroups(spaceId);
      if (requestId !== groupListRequest) return;
      setGroups(nextGroups);
    } catch (error) {
      if (requestId !== groupListRequest) return;
      setGroupsError(
        error instanceof Error ? error.message : t("failedToLoadGroups"),
      );
    } finally {
      if (requestId === groupListRequest) {
        setGroupsLoading(false);
      }
    }
  };

  const loadDetail = async (spaceId: string, groupId: string) => {
    const requestId = ++detailRequest;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const nextDetail = await getGroup(spaceId, groupId);
      if (requestId !== detailRequest) return;
      setDetail(nextDetail);
    } catch (error) {
      if (requestId !== detailRequest) return;
      setDetail(null);
      setDetailError(
        error instanceof Error ? error.message : t("failedToLoadGroups"),
      );
    } finally {
      if (requestId === detailRequest) {
        setDetailLoading(false);
      }
    }
  };

  createEffect(() => {
    void loadGroups(props.spaceId);
  });

  createEffect(() => {
    if (!props.groupId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    void loadDetail(props.spaceId, props.groupId);
  });

  const handleCreateGroup = async (
    input: { name: string; env?: string; appVersion?: string },
  ) => {
    setCreatingGroup(true);
    setCreateError(null);
    try {
      const created = await createGroup(props.spaceId, input);
      await loadGroups(props.spaceId);
      setShowCreateModal(false);
      showToast("success", t("groupCreated"));
      props.onGroupSelect?.(created.id);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : t("failedToCreateGroup"),
      );
    } finally {
      setCreatingGroup(false);
    }
  };

  return (
    <div
      class={props.embedded
        ? "space-y-4"
        : "flex h-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900"}
    >
      <div class={props.embedded ? "space-y-4" : "flex-1 overflow-auto"}>
        <div
          class={props.embedded
            ? "space-y-4"
            : "mx-auto w-full max-w-6xl space-y-4 px-4 pb-10 pt-8"}
        >
          <Show when={!props.embedded}>
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div class="min-w-0">
                <h1 class="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {t("groups")}
                </h1>
                <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {t("groupsDescription")}
                </p>
              </div>
            </div>
          </Show>

          <div class="flex flex-wrap items-center gap-2">
            <div class="relative min-w-[220px] flex-1">
              <Icons.Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                class="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
                placeholder={t("searchGroups")}
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
            <span class="px-2 text-sm text-zinc-500 dark:text-zinc-400">
              {groups().length}
            </span>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Icons.Refresh class="h-4 w-4" />}
              onClick={() => void loadGroups(props.spaceId)}
              isLoading={groupsLoading()}
            >
              {t("refresh")}
            </Button>
            <Button
              size="sm"
              leftIcon={<Icons.Plus class="h-4 w-4" />}
              onClick={() => setShowCreateModal(true)}
            >
              {t("createGroup")}
            </Button>
          </div>

          <Show when={groupsError()}>
            <div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              <div class="flex items-start justify-between gap-3">
                <p>{groupsError()}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadGroups(props.spaceId)}
                >
                  {t("refresh")}
                </Button>
              </div>
            </div>
          </Show>

          <Switch>
            <Match when={groupsLoading() && groups().length === 0}>
              <div class="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center dark:border-zinc-800 dark:bg-zinc-950">
                <div class="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent dark:border-zinc-500" />
                <p class="text-sm text-zinc-500 dark:text-zinc-400">
                  {t("loading")}
                </p>
              </div>
            </Match>
            <Match
              when={!groupsLoading() && !groupsError() && groups().length === 0}
            >
              <EmptyState
                onCreate={() => setShowCreateModal(true)}
                onNavigateToDeploy={props.onNavigateToDeploy}
              />
            </Match>
            <Match when>
              <div class="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
                <section class="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                  <Show
                    when={filteredGroups().length > 0}
                    fallback={
                      <div class="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                        {t("noGroups")}
                      </div>
                    }
                  >
                    <For each={filteredGroups()}>
                      {(group) => (
                        <GroupCard
                          group={group}
                          active={props.groupId === group.id}
                          onSelect={() => props.onGroupSelect?.(group.id)}
                        />
                      )}
                    </For>
                  </Show>
                </section>
                <GroupDetail
                  group={detail()}
                  loading={detailLoading()}
                  error={detailError()}
                  onBack={() => props.onGroupSelect?.(null)}
                  onRefresh={() => {
                    if (props.groupId) {
                      void loadDetail(props.spaceId, props.groupId);
                    }
                  }}
                />
              </div>
            </Match>
          </Switch>
        </div>
      </div>

      <CreateGroupModal
        isOpen={showCreateModal()}
        loading={creatingGroup()}
        error={createError()}
        onClose={() => {
          if (creatingGroup()) return;
          setShowCreateModal(false);
          setCreateError(null);
        }}
        onSubmit={(input) => void handleCreateGroup(input)}
      />
    </div>
  );
}
