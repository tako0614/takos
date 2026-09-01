import { createEffect, createSignal, on, Show } from "solid-js";
import { Button, Modal, ModalFooter } from "../../components/ui/index.ts";
import { Icons } from "../../lib/Icons.tsx";
import { apiJson } from "../../lib/rpc.ts";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import {
  type CapsulePlanResponse,
  type CapsulePlanReview,
  CapsulePlanTerminalError,
  CapsulePlanWaitTimeoutError,
  completeCapsuleApply,
  parseCapsuleApplyResponse,
  parseCapsulePlanResponse,
  parseCapsulePlanReviewResponse,
  waitForCapsulePlanReview,
} from "./capsule-plan-response.ts";

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
  onApplied?: (spaceId: string) => void | Promise<void>;
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
  const [review, setReview] = createSignal<CapsulePlanReview | null>(null);
  const [previewSpaceId, setPreviewSpaceId] = createSignal<string | null>(null);
  const [approved, setApproved] = createSignal(false);
  const [previewing, setPreviewing] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);
  const busy = () => previewing() || installing();
  let requestVersion = 0;
  let activePlanAbortController: AbortController | null = null;

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
    review()?.status ??
    currentPreview.run?.status ??
    "plan Run";

  const resetPreview = () => {
    setPreview(null);
    setReview(null);
    setPreviewSpaceId(null);
    setApproved(false);
  };

  const finishClose = () => {
    requestVersion += 1;
    activePlanAbortController?.abort();
    activePlanAbortController = null;
    resetPreview();
    setGitUrl("");
    setRef("");
    setModulePath(".");
    props.onClose();
  };

  createEffect(on(
    () => props.spaceId,
    (nextSpaceId, previousSpaceId) => {
      if (nextSpaceId === previousSpaceId || installing()) return;
      requestVersion += 1;
      activePlanAbortController?.abort();
      activePlanAbortController = null;
      setPreviewing(false);
      resetPreview();
    },
    { defer: true },
  ));

  const close = () => {
    if (installing()) return;
    finishClose();
  };

  const planInstall = async (
    event: Event & { currentTarget: HTMLFormElement },
  ) => {
    event.preventDefault();
    if (busy()) return;
    const spaceId = props.spaceId;
    if (!spaceId) {
      showToast("error", t("selectSpaceFirst"));
      return;
    }
    const version = ++requestVersion;
    const abortController = new AbortController();
    activePlanAbortController?.abort();
    activePlanAbortController = abortController;
    setPreviewing(true);
    try {
      const revision = props.revision;
      const data = parseCapsulePlanResponse(
        await apiJson<unknown>(
        `/api/spaces/${encodeURIComponent(spaceId)}/capsules/git-url${
          revision ? "/revision" : ""
        }/plan`,
        {
          timeoutMs: 240_000,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            signal: abortController.signal,
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
        },
      ),
        props.revision?.capsuleId,
      );
      const planReview = await waitForCapsulePlanReview(
        () =>
          apiJson<unknown>(
            `/api/spaces/${encodeURIComponent(
              spaceId,
            )}/capsules/git-url/plans/${encodeURIComponent(
              data.expected.runId,
            )}`,
            {
              init: {
                credentials: "include",
                signal: abortController.signal,
              },
            },
          ),
        data.expected,
        {
          shouldContinue: () =>
            version === requestVersion &&
            spaceId === props.spaceId &&
            !abortController.signal.aborted,
        },
      );
      if (version !== requestVersion || spaceId !== props.spaceId) return;
      setPreview(data);
      setReview(planReview);
      setPreviewSpaceId(spaceId);
      setApproved(false);
    } catch (err) {
      if (version !== requestVersion) return;
      showToast(
        "error",
        err instanceof CapsulePlanTerminalError
          ? t("capsulePlanEnded", { status: err.status })
          : err instanceof CapsulePlanWaitTimeoutError
          ? t("requestTimedOut")
          : err instanceof Error && err.message
          ? err.message
          : t("installPlanFailed"),
      );
    } finally {
      if (activePlanAbortController === abortController) {
        activePlanAbortController = null;
      }
      if (version === requestVersion) setPreviewing(false);
    }
  };

  const applyInstall = async () => {
    if (busy()) return;
    const spaceId = props.spaceId;
    const currentPreview = preview();
    const currentReview = review();
    if (
      !spaceId ||
      !currentPreview ||
      !currentReview ||
      previewSpaceId() !== spaceId
    ) {
      resetPreview();
      showToast("error", t("selectSpaceFirst"));
      return;
    }
    setInstalling(true);
    try {
      const revision = props.revision;
      const expected = currentPreview.expected;
      const requestBody = revision
        ? {
            capsule_id: revision.capsuleId,
            operation: revision.operation,
            expected,
          }
        : { expected };
      if (currentReview.status === "waiting_approval") {
        const approvedReview = parseCapsulePlanReviewResponse(
          await apiJson<unknown>(
            `/api/spaces/${encodeURIComponent(
              spaceId,
            )}/capsules/git-url/plans/${encodeURIComponent(
              expected.runId,
            )}/approve`,
            {
              init: {
                method: "POST",
                credentials: "include",
              },
            },
          ),
          expected,
        );
        if (approvedReview.status !== "succeeded") {
          throw new TypeError("Capsule plan approval did not succeed");
        }
        setReview(approvedReview);
      }
      parseCapsuleApplyResponse(
        await apiJson<unknown>(
          `/api/spaces/${encodeURIComponent(
            spaceId,
          )}/capsules/git-url${revision ? "/revision" : ""}/apply`,
          {
            init: {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(requestBody),
            },
          },
        ),
        expected,
      );
      const refreshError = await completeCapsuleApply(
        props.onApplied,
        finishClose,
        spaceId,
      );
      showToast(
        refreshError ? "error" : "success",
        refreshError
          ? t("gitUrlInstallQueuedRefreshFailed", {
              name: previewTitle(currentPreview),
            })
          : t("gitUrlInstallQueued", {
              name: previewTitle(currentPreview),
            }),
      );
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
      showCloseButton={!installing()}
      closeOnOverlayClick={!installing()}
      closeOnEscape={!installing()}
    >
      <form onSubmit={planInstall} class="space-y-4">
        <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem_12rem]">
          <label class="block space-y-1.5">
            <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("gitUrlLabel")}
            </span>
            <input
              type="url"
              id="capsule-git-url"
              name="capsule-git-url"
              value={gitUrl()}
              onInput={(event) => {
                setGitUrl(event.currentTarget.value);
                resetPreview();
              }}
              placeholder="https://github.com/example/app.git"
              class="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100"
              required
              autofocus
              disabled={busy()}
            />
          </label>
          <label class="block space-y-1.5">
            <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("gitRefLabel")}
            </span>
            <input
              type="text"
              id="capsule-git-ref"
              name="capsule-git-ref"
              value={ref()}
              onInput={(event) => {
                setRef(event.currentTarget.value);
                resetPreview();
              }}
              placeholder="v1.2.3"
              class="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100"
              required
              disabled={busy()}
            />
          </label>
          <label class="block space-y-1.5">
            <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("gitModulePathLabel")}
            </span>
            <input
              type="text"
              id="capsule-module-path"
              name="capsule-module-path"
              value={modulePath()}
              onInput={(event) => {
                setModulePath(event.currentTarget.value);
                resetPreview();
              }}
              placeholder="."
              class="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100"
              required
              disabled={busy()}
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

              <Show when={review()}>
                {(currentReview) => (
                  <div class="mt-4 space-y-3" aria-live="polite">
                    <div class="grid grid-cols-3 gap-2 text-center text-xs">
                      <div class="rounded-md bg-emerald-50 px-2 py-2 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                        <strong class="block text-sm">
                          {currentReview().summary.add}
                        </strong>
                        {t("capsulePlanAdd")}
                      </div>
                      <div class="rounded-md bg-amber-50 px-2 py-2 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                        <strong class="block text-sm">
                          {currentReview().summary.change}
                        </strong>
                        {t("capsulePlanChange")}
                      </div>
                      <div class="rounded-md bg-red-50 px-2 py-2 text-red-700 dark:bg-red-950/30 dark:text-red-300">
                        <strong class="block text-sm">
                          {currentReview().summary.destroy}
                        </strong>
                        {t("capsulePlanDestroy")}
                      </div>
                    </div>
                    <Show when={currentReview().planResources.length > 0}>
                      <div class="max-h-48 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-700">
                        <ul class="divide-y divide-zinc-200 text-xs dark:divide-zinc-700">
                          {currentReview().planResources.map((resource) => (
                            <li class="flex items-start justify-between gap-3 px-3 py-2">
                              <span class="min-w-0 break-all font-mono text-zinc-700 dark:text-zinc-300">
                                {resource.address}
                              </span>
                              <span class="shrink-0 text-zinc-500 dark:text-zinc-400">
                                {resource.actions.join(" → ")}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </Show>
                    <Show
                      when={
                        currentReview().totalPlanResources >
                        currentReview().planResources.length
                      }
                    >
                      <p class="text-xs text-zinc-500 dark:text-zinc-400">
                        {t("capsulePlanMoreResources", {
                          count:
                            currentReview().totalPlanResources -
                            currentReview().planResources.length,
                        })}
                      </p>
                    </Show>
                    <Show when={currentReview().requiresApproval}>
                      <p class="text-xs font-medium text-amber-700 dark:text-amber-300">
                        {t("capsulePlanRequiresApproval")}
                      </p>
                    </Show>
                  </div>
                )}
              </Show>
              <label class="mt-4 flex items-start gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <input
                  type="checkbox"
                  name="capsule-plan-approved"
                  checked={approved()}
                  onChange={(event) => setApproved(event.currentTarget.checked)}
                  disabled={busy()}
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
          <Button
            type="button"
            variant="secondary"
            onClick={close}
            disabled={installing()}
          >
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
