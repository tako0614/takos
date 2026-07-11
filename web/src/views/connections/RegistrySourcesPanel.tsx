import { createSignal, Show } from "solid-js";
import { Badge, Button, Input } from "../../components/ui/index.ts";
import type {
  McpRegistrySource,
  McpRegistryAuthType,
  McpRegistrySourceKind,
} from "../../types/index.ts";
import type {
  McpRegistrySourceInput,
  McpRegistrySourcePatch,
} from "../../hooks/useMcpRegistry.ts";
import { Icons } from "../../lib/Icons.tsx";
import { useConfirmDialog } from "../../store/confirm-dialog.ts";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import {
  isValidRegistryBaseUrl,
  registrySourceKindLabelKey,
} from "./registry-helpers.ts";

type CustomSourceKind = Exclude<McpRegistrySourceKind, "official">;

interface RegistrySourcesPanelProps {
  sources: McpRegistrySource[];
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onCreate: (input: McpRegistrySourceInput) => Promise<McpRegistrySource>;
  onUpdate: (
    sourceId: string,
    patch: McpRegistrySourcePatch,
  ) => Promise<McpRegistrySource>;
  onDelete: (sourceId: string) => Promise<void>;
}

interface SourceDraft {
  name: string;
  base_url: string;
  source_kind: CustomSourceKind;
  priority: string;
  auth_type: McpRegistryAuthType;
  auth_header_name: string;
  auth_secret: string;
  credential_configured: boolean;
}

const EMPTY_DRAFT: SourceDraft = {
  name: "",
  base_url: "",
  source_kind: "custom",
  priority: "0",
  auth_type: "none",
  auth_header_name: "X-Registry-Token",
  auth_secret: "",
  credential_configured: false,
};

function toSourceInput(draft: SourceDraft): McpRegistrySourceInput | null {
  const name = draft.name.trim();
  const baseUrl = draft.base_url.trim();
  const priority = Number(draft.priority);
  const credentialAvailable =
    draft.auth_type === "none" ||
    draft.auth_secret.length > 0 ||
    draft.credential_configured;
  if (
    !name ||
    !isValidRegistryBaseUrl(baseUrl) ||
    !Number.isInteger(priority) ||
    priority < -1000 ||
    priority > 1000 ||
    !credentialAvailable ||
    (draft.auth_type === "header" && !draft.auth_header_name.trim())
  ) {
    return null;
  }
  return {
    name,
    base_url: baseUrl,
    source_kind: draft.source_kind,
    priority,
    auth_type: draft.auth_type,
    ...(draft.auth_type === "header"
      ? { auth_header_name: draft.auth_header_name.trim() }
      : {}),
    ...(draft.auth_secret ? { auth_secret: draft.auth_secret } : {}),
  };
}

export function RegistrySourcesPanel(props: RegistrySourcesPanelProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [addOpen, setAddOpen] = createSignal(false);
  const [addDraft, setAddDraft] = createSignal<SourceDraft>({ ...EMPTY_DRAFT });
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editDraft, setEditDraft] = createSignal<SourceDraft>({
    ...EMPTY_DRAFT,
  });
  const [mutationId, setMutationId] = createSignal<string | null>(null);

  const createInput = () => toSourceInput(addDraft());
  const editInput = () => toSourceInput(editDraft());

  const handleCreate = async () => {
    const input = createInput();
    if (!input) return;
    setMutationId("create");
    try {
      await props.onCreate(input);
      setAddDraft({ ...EMPTY_DRAFT });
      setAddOpen(false);
      showToast("success", t("registrySourceCreated"));
    } catch (cause) {
      showToast(
        "error",
        cause instanceof Error && cause.message
          ? cause.message
          : t("registrySourceCreateFailed"),
      );
    } finally {
      setMutationId(null);
    }
  };

  const beginEdit = (source: McpRegistrySource) => {
    if (source.read_only || source.source_kind === "official") return;
    setEditingId(source.id);
    setEditDraft({
      name: source.name,
      base_url: source.base_url,
      source_kind: source.source_kind,
      priority: String(source.priority),
      auth_type: source.auth_type,
      auth_header_name: source.auth_header_name ?? "X-Registry-Token",
      auth_secret: "",
      credential_configured: source.credential_configured,
    });
  };

  const handleUpdate = async (sourceId: string) => {
    const input = editInput();
    if (!input) return;
    setMutationId(sourceId);
    try {
      await props.onUpdate(sourceId, input);
      setEditingId(null);
      showToast("success", t("registrySourceUpdated"));
    } catch (cause) {
      showToast(
        "error",
        cause instanceof Error && cause.message
          ? cause.message
          : t("registrySourceUpdateFailed"),
      );
    } finally {
      setMutationId(null);
    }
  };

  const handleToggle = async (source: McpRegistrySource) => {
    if (source.read_only && source.source_kind !== "official") return;
    setMutationId(source.id);
    try {
      await props.onUpdate(source.id, { enabled: !source.enabled });
      showToast(
        "success",
        source.enabled
          ? t("registrySourceDisabled")
          : t("registrySourceEnabled"),
      );
    } catch (cause) {
      showToast(
        "error",
        cause instanceof Error && cause.message
          ? cause.message
          : t("registrySourceUpdateFailed"),
      );
    } finally {
      setMutationId(null);
    }
  };

  const handleDelete = async (source: McpRegistrySource) => {
    if (source.read_only) return;
    const accepted = await confirm({
      title: t("registrySourceDelete"),
      message: t("registrySourceDeleteConfirm", { name: source.name }),
      confirmText: t("remove"),
      cancelText: t("cancel"),
      danger: true,
    });
    if (!accepted) return;
    setMutationId(source.id);
    try {
      await props.onDelete(source.id);
      showToast("success", t("registrySourceDeleted"));
    } catch (cause) {
      showToast(
        "error",
        cause instanceof Error && cause.message
          ? cause.message
          : t("registrySourceDeleteFailed"),
      );
    } finally {
      setMutationId(null);
    }
  };

  return (
    <details class="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/50">
      <summary class="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {t("registrySources")}
      </summary>
      <div class="border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <p class="max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            {t("registrySourcesDescription")}
          </p>
          <div class="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Icons.RefreshCw class="h-4 w-4" />}
              onClick={() => void props.onRefresh()}
            >
              {t("refresh")}
            </Button>
            <Button size="sm" onClick={() => setAddOpen((value) => !value)}>
              {t("registrySourceAdd")}
            </Button>
          </div>
        </div>

        <Show when={addOpen()}>
          <div class="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900">
            <h3 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("registrySourceAdd")}
            </h3>
            <SourceFields draft={addDraft()} onChange={setAddDraft} />
            <div class="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAddOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                size="sm"
                isLoading={mutationId() === "create"}
                disabled={!createInput()}
                onClick={() => void handleCreate()}
              >
                {t("add")}
              </Button>
            </div>
          </div>
        </Show>

        <Show when={props.loading}>
          <div class="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500 dark:text-zinc-400">
            <Icons.Loader class="h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        </Show>

        <Show when={!props.loading && props.error}>
          <div class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {props.error}
          </div>
        </Show>

        <Show when={!props.loading && !props.error}>
          <div class="mt-4 grid gap-3">
            {props.sources.map((source) => (
              <div class="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                <Show
                  when={editingId() === source.id}
                  fallback={
                    <SourceSummary
                      source={source}
                      busy={mutationId() === source.id}
                      onEdit={() => beginEdit(source)}
                      onToggle={() => void handleToggle(source)}
                      onDelete={() => void handleDelete(source)}
                    />
                  }
                >
                  <SourceFields draft={editDraft()} onChange={setEditDraft} />
                  <div class="mt-3 flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(null)}
                    >
                      {t("cancel")}
                    </Button>
                    <Button
                      size="sm"
                      isLoading={mutationId() === source.id}
                      disabled={!editInput()}
                      onClick={() => void handleUpdate(source.id)}
                    >
                      {t("save")}
                    </Button>
                  </div>
                </Show>
              </div>
            ))}
          </div>
        </Show>
      </div>
    </details>
  );
}

function SourceFields(props: {
  draft: SourceDraft;
  onChange: (draft: SourceDraft) => void;
}) {
  const { t } = useI18n();
  return (
    <div class="mt-3 grid gap-3 sm:grid-cols-2">
      <label>
        <span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {t("registrySourceName")}
        </span>
        <Input
          value={props.draft.name}
          onInput={(event) =>
            props.onChange({ ...props.draft, name: event.currentTarget.value })
          }
        />
      </label>
      <label>
        <span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {t("registrySourceAuthentication")}
        </span>
        <select
          value={props.draft.auth_type}
          onChange={(event) =>
            props.onChange({
              ...props.draft,
              auth_type: event.currentTarget.value as McpRegistryAuthType,
              auth_secret:
                event.currentTarget.value === "none"
                  ? ""
                  : props.draft.auth_secret,
            })
          }
          class="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        >
          <option value="none">{t("registrySourceAuthNone")}</option>
          <option value="bearer">{t("registrySourceAuthBearer")}</option>
          <option value="header">{t("registrySourceAuthHeader")}</option>
        </select>
      </label>
      <Show when={props.draft.auth_type === "header"}>
        <label>
          <span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {t("registrySourceAuthHeaderName")}
          </span>
          <Input
            value={props.draft.auth_header_name}
            onInput={(event) =>
              props.onChange({
                ...props.draft,
                auth_header_name: event.currentTarget.value,
              })
            }
          />
        </label>
      </Show>
      <Show when={props.draft.auth_type !== "none"}>
        <label>
          <span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {t("registrySourceCredential")}
          </span>
          <Input
            type="password"
            autocomplete="new-password"
            value={props.draft.auth_secret}
            placeholder={
              props.draft.credential_configured
                ? t("registrySourceCredentialKeep")
                : undefined
            }
            onInput={(event) =>
              props.onChange({
                ...props.draft,
                auth_secret: event.currentTarget.value,
              })
            }
          />
        </label>
      </Show>
      <label>
        <span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {t("registrySourceBaseUrl")}
        </span>
        <Input
          type="url"
          value={props.draft.base_url}
          placeholder="https://registry.example.com"
          onInput={(event) =>
            props.onChange({
              ...props.draft,
              base_url: event.currentTarget.value,
            })
          }
        />
      </label>
      <label>
        <span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {t("registrySourceKind")}
        </span>
        <select
          value={props.draft.source_kind}
          onChange={(event) =>
            props.onChange({
              ...props.draft,
              source_kind: event.currentTarget.value as CustomSourceKind,
            })
          }
          class="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        >
          <option value="organization">
            {t("registrySourceKindOrganization")}
          </option>
          <option value="community">{t("registrySourceKindCommunity")}</option>
          <option value="custom">{t("registrySourceKindCustom")}</option>
        </select>
      </label>
      <label>
        <span class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {t("registrySourcePriority")}
        </span>
        <Input
          type="number"
          min="-1000"
          max="1000"
          step="1"
          value={props.draft.priority}
          onInput={(event) =>
            props.onChange({
              ...props.draft,
              priority: event.currentTarget.value,
            })
          }
        />
      </label>
      {!toSourceInput(props.draft) &&
      (props.draft.name || props.draft.base_url) ? (
        <p class="text-xs text-red-600 dark:text-red-300 sm:col-span-2">
          {t("registrySourceValidation")}
        </p>
      ) : null}
    </div>
  );
}

function SourceSummary(props: {
  source: McpRegistrySource;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium text-zinc-900 dark:text-zinc-100">
            {props.source.name}
          </span>
          <Badge>
            {t(registrySourceKindLabelKey(props.source.source_kind))}
          </Badge>
          <Badge variant={props.source.enabled ? "success" : "default"}>
            {props.source.enabled
              ? t("registrySourceStatusEnabled")
              : t("registrySourceStatusDisabled")}
          </Badge>
          {props.source.read_only ? (
            <Badge>{t("registrySourceReadOnly")}</Badge>
          ) : null}
          {props.source.preview ? (
            <Badge variant="warning">{t("registryPreview")}</Badge>
          ) : null}
          {props.source.best_effort ? (
            <Badge variant="warning">{t("registryBestEffort")}</Badge>
          ) : null}
          <Badge variant="warning">{t("registryNoSafetyAssertion")}</Badge>
          {props.source.auth_type !== "none" ? (
            <Badge
              variant={
                props.source.credential_configured ? "success" : "warning"
              }
            >
              {props.source.credential_configured
                ? t("registrySourceCredentialConfigured")
                : t("registrySourceCredentialMissing")}
            </Badge>
          ) : null}
        </div>
        <p class="mt-1 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {props.source.base_url}
        </p>
        <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t("registrySourcePriority")}: {props.source.priority} ·{" "}
          {t("registryHigherPriorityFirst")}
        </p>
      </div>
      <div class="flex flex-wrap gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={props.busy}
          onClick={props.onToggle}
        >
          {props.source.enabled ? t("disable") : t("enable")}
        </Button>
        {!props.source.read_only ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={props.busy}
              onClick={props.onEdit}
            >
              {t("edit")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={props.busy}
              onClick={props.onDelete}
            >
              {t("remove")}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
