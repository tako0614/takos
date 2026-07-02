import { createSignal, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { CreateRepoModal } from "../shared/repos/CreateRepoModal.tsx";
import type { Space } from "../../types/index.ts";
import { GitUrlInstallModal } from "./GitUrlInstallModal.tsx";
import { AppsPage } from "../apps/AppsPage.tsx";
import { rpc, rpcJson } from "../../lib/rpc.ts";

interface SourcePageProps {
  spaces: Space[];
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

/**
 * "Apps / Install" surface. Two tabs: the installed-apps launcher, and the
 * Store catalog — browse listings from one or more TCS store servers and install
 * a Capsule into this Space. Manual Git-URL install + create-repo stay available.
 */
export function SourcePage(props: SourcePageProps) {
  const i18n = useI18n();
  const t = i18n.t;
  const { showToast } = useToast();
  const [tab, setTab] = createSignal<"installed" | "store">("installed");
  const [showGitUrlInstallModal, setShowGitUrlInstallModal] =
    createSignal(false);
  const [showCreateModal, setShowCreateModal] = createSignal(false);

  const spaceId = () => props.spaces[0]?.id ?? null;
  const ja = () => i18n.lang === "ja";

  const requireAuth = (): boolean => {
    if (!props.isAuthenticated) {
      props.onRequireLogin();
      return false;
    }
    return true;
  };

  const createRepo = async (
    name: string,
    description: string,
    visibility: "public" | "private",
  ) => {
    const id = spaceId();
    if (!id) return;
    try {
      const res = await rpc.spaces[":spaceId"].repos.$post({
        param: { spaceId: id },
        json: { name, description, visibility },
      });
      await rpcJson(res);
      setShowCreateModal(false);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error && err.message ? err.message : t("failedToCreate"),
      );
    }
  };

  const tabBtn = (key: "installed" | "store", label: string) => (
    <button
      type="button"
      class={`px-3 py-1.5 text-sm rounded-md transition-colors ${
        tab() === key
          ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 shadow-sm"
          : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
      }`}
      onClick={() => setTab(key)}
    >
      {label}
    </button>
  );

  return (
    <div class="h-full flex flex-col bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
      <div class="flex-shrink-0 px-4 pt-4 pb-3 md:pt-5">
        <div class="max-w-6xl mx-auto w-full flex items-center justify-between">
          <h1 class="text-xl md:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("install")}
          </h1>
          <div class="flex items-center gap-2">
            <button
              type="button"
              title={t("installFromGitUrl")}
              aria-label={t("installFromGitUrl")}
              class="w-10 h-10 md:w-8 md:h-8 flex items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
              onClick={() => {
                if (requireAuth()) setShowGitUrlInstallModal(true);
              }}
            >
              <Icons.Download class="w-4 h-4" />
            </button>
            <button
              type="button"
              title={t("newRepository")}
              aria-label={t("newRepository")}
              class="w-10 h-10 md:w-8 md:h-8 flex items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
              onClick={() => {
                if (requireAuth()) setShowCreateModal(true);
              }}
            >
              <Icons.Plus class="w-4 h-4" />
            </button>
          </div>
        </div>
        <div class="max-w-6xl mx-auto w-full mt-3">
          <div class="inline-flex gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 p-1">
            {tabBtn("installed", ja() ? "インストール済み" : "Installed")}
            {tabBtn("store", ja() ? "ストア" : "Store")}
          </div>
        </div>
      </div>

      <div class="flex-1 min-h-0">
        <Show
          when={tab() === "installed"}
          fallback={
            <div class="h-full overflow-auto">
              <div class="mx-auto grid w-full max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div class="rounded-lg border border-zinc-200 bg-white px-5 py-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                  <div class="flex items-start gap-4">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                      <Icons.Download class="h-5 w-5" />
                    </div>
                    <div class="min-w-0">
                      <h2 class="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                        {t("installFromGitUrl")}
                      </h2>
                      <div class="mt-3 flex flex-wrap gap-2 text-xs">
                        <span class="rounded-md bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                          Git URL
                        </span>
                        <span class="rounded-md bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                          OpenTofu
                        </span>
                        <span class="rounded-md bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                          Takosumi Run
                        </span>
                      </div>
                      <button
                        type="button"
                        class="mt-4 inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                        onClick={() => {
                          if (requireAuth()) setShowGitUrlInstallModal(true);
                        }}
                      >
                        <Icons.Download class="h-4 w-4" />
                        {t("installFromGitUrl")}
                      </button>
                    </div>
                  </div>
                </div>

                <div class="rounded-lg border border-zinc-200 bg-white px-5 py-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                  <div class="flex items-start gap-3">
                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                      <Icons.Package class="h-5 w-5" />
                    </div>
                    <div class="min-w-0">
                      <h2 class="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {t("appsCapsulesTitle")}
                      </h2>
                      <div class="mt-3 flex flex-wrap gap-2 text-xs">
                        <span class="rounded-md bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                          Launch URL
                        </span>
                        <span class="rounded-md bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                          MCP
                        </span>
                        <span class="rounded-md bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                          Outputs
                        </span>
                      </div>
                      <button
                        type="button"
                        class="mt-4 inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        onClick={() => setTab("installed")}
                      >
                        <Icons.Grid class="h-4 w-4" />
                        {ja() ? "インストール済みを見る" : "View installed"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          }
        >
          <Show
            when={spaceId()}
            fallback={
              <div class="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                {t("appsInstalledEmptyDesc")}
              </div>
            }
          >
            {(id) => (
              <AppsPage
                spaceId={id()}
                onNavigateToStore={() => setTab("store")}
              />
            )}
          </Show>
        </Show>
      </div>

      {showCreateModal() && (
        <CreateRepoModal
          onClose={() => setShowCreateModal(false)}
          onCreate={createRepo}
        />
      )}

      {showGitUrlInstallModal() && (
        <GitUrlInstallModal
          isOpen={showGitUrlInstallModal()}
          spaceId={spaceId()}
          onClose={() => setShowGitUrlInstallModal(false)}
        />
      )}
    </div>
  );
}
