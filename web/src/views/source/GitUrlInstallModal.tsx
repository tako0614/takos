import { createSignal, Show } from "solid-js";
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
  initialModulePath?: string | null;
  revision?: {
    capsuleId: string;
    operation: "upgrade" | "rollback";
  } | null;
  onClose: () => void;
  onApplied?: () => void | Promise<void>;
}

interface ExactRunReference {
  workspaceId: string;
  capsuleId: string;
  runId: string;
  sourceId?: string;
}

interface CapsulePlanResponse {
  source?: {
    id?: string;
    name?: string;
    url?: string;
    defaultRef?: string;
  };
  capsule?: {
    id?: string;
    name?: string;
    status?: string;
  };
  run?: {
    id?: string;
    status?: string;
  };
  expected?: ExactRunReference;
}

type GitUrlPreviewResponse = CapsulePlanResponse;

export function GitUrlInstallModal(props: GitUrlInstallModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [gitUrl, setGitUrl] = createSignal(props.initialGitUrl ?? "");
  const [ref, setRef] = createSignal(props.initialRef ?? "");
  const [modulePath, setModulePath] = createSignal(
    props.initialModulePath ?? ".",
  );
  const [preview, setPreview] = createSignal<GitUrlPreviewResponse | null>(
    null,
  );
  const [approved, setApproved] = createSignal(false);
  const [previewing, setPreviewing] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);

  const previewTitle = (currentPreview: GitUrlPreviewResponse): string => {
    return (
      currentPreview.capsule?.name ??
      currentPreview.capsule?.id ??
      currentPreview.source?.name ??
      t("unknownApp")
    );
  };

  const previewSourceLabel = (currentPreview: GitUrlPreviewResponse): string =>
    currentPreview.source?.url ??
    currentPreview.source?.defaultRef ??
    ref();

  const previewRiskLabel = (currentPreview: GitUrlPreviewResponse): string =>
    props.revision?.operation ??
    currentPreview.run?.status ??
    "plan Run";

  const resetPreview = () => {
    setPreview(null);
    setApproved(false);
  };

  const close = () => {
    resetPreview();
    setGitUrl("");
    setRef("");
    setModulePath(".");
    props.onClose();
  };

  const planInstall = async (
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
        `/api/spaces/${encodeURIComponent(spaceId)}/capsules/git-url${
          revision ? "/revision" : ""
        }/plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            git_url: gitUrl().trim(),
            ref: ref().trim(),
            module_path: modulePath().trim() || ".",
            ...(revision
              ? {
                  capsule_id: revision.capsuleId,
                  operation: revision.operation,
                }
              : {}),
          }),
        },
      );
      const data = await rpcJson<GitUrlPreviewResponse>(response);
      setPreview(data);
      setApproved(false);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error && err.message
          ? err.message
          : t("installPlanFailed"),
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
      const expected = currentPreview.expected;
      if (!expected) {
        throw new Error("Capsule plan response is missing its exact Run reference");
      }
      const requestBody = revision
        ? {
            capsule_id: revision.capsuleId,
            operation: revision.operation,
            expected,
          }
        : { expected };
      await rpcJson(
        await fetch(
          `/api/spaces/${encodeURIComponent(
            spaceId,
          )}/capsules/git-url${revision ? "/revision" : ""}/apply`,
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
      <form onSubmit={planInstall} class="space-y-4">
        <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem_12rem]">
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
          <label class="block space-y-1.5">
            <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("gitModulePathLabel")}
            </span>
            <input
              type="text"
              value={modulePath()}
              onInput={(event) => {
                setModulePath(event.currentTarget.value);
                resetPreview();
              }}
              placeholder="."
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

              <label class="mt-4 flex items-start gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <input
                  type="checkbox"
                  checked={approved()}
                  onChange={(event) => setApproved(event.currentTarget.checked)}
                  class="mt-0.5 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span class="text-sm text-zinc-700 dark:text-zinc-300">
                  {t("approveGitUrlPlan")}
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
                {t("planInstall")}
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
