import { createSignal, For, Show } from "solid-js";
import { Button, Modal, ModalFooter } from "../../components/ui/index.ts";
import { Icons } from "../../lib/Icons.tsx";
import { rpcJson } from "../../lib/rpc.ts";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";

interface GitUrlInstallModalProps {
  isOpen: boolean;
  spaceId: string | null;
  initialGitUrl?: string | null;
  initialRef?: string | null;
  revision?: {
    installationId: string;
    operation: "upgrade" | "rollback";
  } | null;
  onClose: () => void;
  onApplied?: () => void | Promise<void>;
}

interface InstallDryRunResponse {
  appSpec?: {
    metadata?: {
      id?: string;
      name?: string;
    };
  };
  source?: {
    url?: string;
    ref?: string;
    commit?: string;
  };
  expected?: {
    commit?: string;
    manifestDigest?: string;
  };
  changes?: Array<{
    op?: string;
    component?: string;
    kind?: string;
  }>;
  cost?: {
    meteredBindingCount?: number;
  };
}

interface InstallCatalogDryRunResponse {
  app?: {
    id?: string;
    name?: string;
    description?: string;
    homepage?: string;
  };
  publisher?: {
    id?: string;
    verified?: boolean;
  };
  source?: {
    git?: string;
    ref?: string;
    commit?: string;
    manifestPath?: string;
  };
  runtime?: {
    modes?: string[];
  };
  bindings?: Array<{
    name: string;
    type: string;
    required?: boolean;
  }>;
  permissions?: {
    requested?: string[];
  };
  cost?: {
    meteredBindingCount?: number;
  };
  risk?: {
    level?: string;
    reasons?: string[];
  };
}

interface RevisionPreviewResponse {
  preview: {
    operation: "upgrade" | "rollback";
    next: {
      appId?: string;
      source: {
        ref?: string;
        commit?: string;
      };
    };
    diff?: {
      permissions?: {
        added?: string[];
        removed?: string[];
        unchanged?: string[];
      };
      bindings?: {
        added?: string[];
        removed?: string[];
        unchanged?: string[];
      };
    };
  };
}

type GitUrlPreviewResponse =
  | InstallDryRunResponse
  | InstallCatalogDryRunResponse
  | RevisionPreviewResponse;

function isRevisionPreview(
  value: GitUrlPreviewResponse,
): value is RevisionPreviewResponse {
  return "preview" in value;
}

export function GitUrlInstallModal(props: GitUrlInstallModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [gitUrl, setGitUrl] = createSignal(props.initialGitUrl ?? "");
  const [ref, setRef] = createSignal(props.initialRef ?? "");
  const [mode, setMode] = createSignal("");
  const [preview, setPreview] = createSignal<GitUrlPreviewResponse | null>(
    null,
  );
  const [approved, setApproved] = createSignal(false);
  const [previewing, setPreviewing] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);

  const previewTitle = (currentPreview: GitUrlPreviewResponse): string => {
    if (isRevisionPreview(currentPreview)) {
      return currentPreview.preview.next.appId ?? t("unknownApp");
    }
    if ("app" in currentPreview) {
      return currentPreview.app?.name ?? currentPreview.app?.id ??
        t("unknownApp");
    }
    const dryRun = currentPreview as InstallDryRunResponse;
    return dryRun.appSpec?.metadata?.name ??
      dryRun.appSpec?.metadata?.id ?? t("unknownApp");
  };

  const previewSourceLabel = (
    currentPreview: GitUrlPreviewResponse,
  ): string =>
    isRevisionPreview(currentPreview)
      ? currentPreview.preview.next.source.commit ??
        currentPreview.preview.next.source.ref ??
        ref()
      : currentPreview.source?.commit ?? currentPreview.source?.ref ?? ref();

  const previewRiskLabel = (currentPreview: GitUrlPreviewResponse): string =>
    isRevisionPreview(currentPreview)
      ? currentPreview.preview.operation
      : "risk" in currentPreview
      ? currentPreview.risk?.level ?? "low"
      : "dry-run";

  const previewBindingLabels = (
    currentPreview: GitUrlPreviewResponse,
  ): string[] =>
    isRevisionPreview(currentPreview)
      ? [
        ...(currentPreview.preview.diff?.bindings?.added ?? []).map((value) =>
          `+${value}`
        ),
        ...(currentPreview.preview.diff?.bindings?.removed ?? []).map((
          value,
        ) => `-${value}`),
      ]
      : "bindings" in currentPreview
      ? (currentPreview.bindings ?? []).map((binding) => binding.name)
      : "changes" in currentPreview
      ? (currentPreview.changes ?? []).map((change) =>
        `${change.op ?? "change"} ${change.component ?? "component"}`
      )
      : [];

  const previewPermissionLabels = (
    currentPreview: GitUrlPreviewResponse,
  ): string[] =>
    isRevisionPreview(currentPreview)
      ? [
        ...(currentPreview.preview.diff?.permissions?.added ?? []).map((
          value,
        ) => `+${value}`),
        ...(currentPreview.preview.diff?.permissions?.removed ?? []).map((
          value,
        ) => `-${value}`),
      ]
      : "permissions" in currentPreview
      ? currentPreview.permissions?.requested ?? []
      : [];

  const resetPreview = () => {
    setPreview(null);
    setApproved(false);
    setMode("");
  };

  const close = () => {
    resetPreview();
    setGitUrl("");
    setRef("");
    props.onClose();
  };

  const dryRunInstall = async (
    event: Event & { currentTarget: HTMLFormElement },
  ) => {
    event.preventDefault();
    const spaceId = props.spaceId;
    if (!spaceId) {
      showToast("error", t("selectSpaceFirst"));
      return;
    }
    setPreviewing(true);
    try {
      const revision = props.revision;
      const response = await fetch(
        `/api/spaces/${encodeURIComponent(spaceId)}/app-installations/git-url${
          revision ? "/revision" : ""
        }/dry-run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            git_url: gitUrl().trim(),
            ref: ref().trim(),
            ...(revision
              ? {
                installation_id: revision.installationId,
                operation: revision.operation,
              }
              : {}),
          }),
        },
      );
      const data = await rpcJson<GitUrlPreviewResponse>(response);
      setPreview(data);
      setMode(
        !isRevisionPreview(data) && "runtime" in data
          ? data.runtime?.modes?.[0] ?? ""
          : "",
      );
      setApproved(false);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error && err.message
          ? err.message
          : t("installDryRunFailed"),
      );
    } finally {
      setPreviewing(false);
    }
  };

  const applyInstall = async () => {
    const spaceId = props.spaceId;
    const currentPreview = preview();
    if (!spaceId || !currentPreview) return;
    setInstalling(true);
    try {
      const revision = props.revision;
      const sourceCommit = isRevisionPreview(currentPreview)
        ? currentPreview.preview.next.source.commit
        : currentPreview.source?.commit;
      const expected = isRevisionPreview(currentPreview) ||
          !("expected" in currentPreview)
        ? undefined
        : currentPreview.expected;
      const requestBody = revision
        ? {
          git_url: gitUrl().trim(),
          ref: ref().trim(),
          installation_id: revision.installationId,
          operation: revision.operation,
          ...(sourceCommit ? { source_commit: sourceCommit } : {}),
        }
        : isRevisionPreview(currentPreview)
        ? null
        : {
          git_url: gitUrl().trim(),
          ref: ref().trim(),
          ...(mode() ? { mode: mode() } : {}),
          expected_commit: expected?.commit ?? sourceCommit,
          expected_manifest_digest: expected?.manifestDigest,
          cost_ack: true,
        };
      if (!requestBody) return;
      await rpcJson(
        await fetch(
          `/api/spaces/${
            encodeURIComponent(spaceId)
          }/app-installations/git-url${revision ? "/revision" : ""}/apply`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          },
        ),
      );
      showToast(
        "success",
        t("gitUrlInstallQueued", {
          name: previewTitle(currentPreview),
        }),
      );
      await props.onApplied?.();
      close();
    } catch (err) {
      showToast(
        "error",
        err instanceof Error && err.message ? err.message : t("installFailed"),
      );
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={close}
      title={t("installFromGitUrl")}
      size="lg"
    >
      <form onSubmit={dryRunInstall} class="space-y-4">
        <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem]">
          <label class="block space-y-1.5">
            <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("gitUrlLabel")}
            </span>
            <input
              type="url"
              value={gitUrl()}
              onInput={(event) => {
                setGitUrl(event.currentTarget.value);
                resetPreview();
              }}
              placeholder="https://github.com/example/app.git"
              class="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100"
              required
              autofocus
            />
          </label>
          <label class="block space-y-1.5">
            <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("gitRefLabel")}
            </span>
            <input
              type="text"
              value={ref()}
              onInput={(event) => {
                setRef(event.currentTarget.value);
                resetPreview();
              }}
              placeholder="v1.2.3"
              class="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100"
              required
            />
          </label>
        </div>

        <Show when={preview()}>
          {(currentPreview) => (
            <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {previewTitle(currentPreview())}
                  </div>
                  <div class="mt-1 text-xs text-zinc-500 dark:text-zinc-400 break-all">
                    {previewSourceLabel(currentPreview())}
                  </div>
                </div>
                <span class="shrink-0 rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {previewRiskLabel(currentPreview())}
                </span>
              </div>

              <Show
                when={!isRevisionPreview(currentPreview()) &&
                  "runtime" in currentPreview() &&
                  ((currentPreview() as InstallCatalogDryRunResponse).runtime
                      ?.modes?.length ?? 0) > 0}
              >
                <label class="mt-4 block space-y-1.5">
                  <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {t("runtimeModeLabel")}
                  </span>
                  <select
                    value={mode()}
                    onChange={(event) => setMode(event.currentTarget.value)}
                    class="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100"
                  >
                    <For
                      each={(currentPreview() as InstallCatalogDryRunResponse)
                        .runtime?.modes ?? []}
                    >
                      {(runtimeMode) => (
                        <option value={runtimeMode}>{runtimeMode}</option>
                      )}
                    </For>
                  </select>
                </label>
              </Show>

              <div class="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                  <div class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {t("bindingsLabel")}
                  </div>
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    <For each={previewBindingLabels(currentPreview())}>
                      {(binding) => (
                        <span class="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          {binding}
                        </span>
                      )}
                    </For>
                  </div>
                </div>
                <div>
                  <div class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {t("permissionsLabel")}
                  </div>
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    <For each={previewPermissionLabels(currentPreview())}>
                      {(permission) => (
                        <span class="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          {permission}
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              </div>

              <label class="mt-4 flex items-start gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <input
                  type="checkbox"
                  checked={approved()}
                  onChange={(event) => setApproved(event.currentTarget.checked)}
                  class="mt-0.5 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span class="text-sm text-zinc-700 dark:text-zinc-300">
                  {t("approveGitUrlDryRun")}
                </span>
              </label>
            </div>
          )}
        </Show>

        <ModalFooter class="gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            {t("cancel")}
          </Button>
          <Show
            when={preview()}
            fallback={
              <Button
                type="submit"
                isLoading={previewing()}
                disabled={!gitUrl().trim() || !ref().trim()}
                leftIcon={<Icons.Search class="h-4 w-4" />}
              >
                {t("dryRunInstall")}
              </Button>
            }
          >
            <Button
              type="button"
              isLoading={installing()}
              disabled={!approved()}
              leftIcon={<Icons.Download class="h-4 w-4" />}
              onClick={applyInstall}
            >
              {t("installApp")}
            </Button>
          </Show>
        </ModalFooter>
      </form>
    </Modal>
  );
}
