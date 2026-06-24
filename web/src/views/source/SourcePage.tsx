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
 * Minimal "Apps / Install" surface.
 *
 * Takos is a single-owner personal product: there is no public store catalog
 * to browse. This view keeps the two reachable install entry points — install
 * from a Git URL and create a local repository — plus the installed-apps list.
 */
export function SourcePage(props: SourcePageProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [showGitUrlInstallModal, setShowGitUrlInstallModal] = createSignal(
    false,
  );
  const [showCreateModal, setShowCreateModal] = createSignal(false);

  const spaceId = () => props.spaces[0]?.id ?? null;

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
      // CreateRepoModal fires onCreate without awaiting and shows no error of
      // its own, so surface the failure here and keep the modal open.
      showToast(
        "error",
        err instanceof Error && err.message ? err.message : t("failedToCreate"),
      );
    }
  };

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
      </div>

      <div class="flex-1 min-h-0">
        <Show
          when={spaceId()}
          fallback={
            <div class="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
              {t("appsInstalledEmptyDesc")}
            </div>
          }
        >
          {(id) => <AppsPage spaceId={id()} />}
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
