import { createEffect, createSignal, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import {
  isMcpScopeChangedError,
  useMcpServers,
} from "../../hooks/useMcpServers.ts";
import { getSpaceIdentifier } from "../../lib/spaces.ts";
import { Button } from "../../components/ui/Button.tsx";
import type { McpServerRecord, Space } from "../../types/index.ts";
import { ServerCard } from "./ServerCard.tsx";
import { CreateMcpServerModal } from "./CreateMcpServerModal.tsx";

interface McpServersSectionProps {
  spaces: Space[];
  selectedSpaceId: string | null;
  setSelectedSpaceId: (id: string) => void;
}

export function McpServersSection(props: McpServersSectionProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const {
    servers,
    loading,
    error,
    hasVerifiedInventory,
    refresh,
    createExternalServer,
    reauthorizeServer,
    toggleServer,
    deleteServer,
    fetchServerTools,
    updateServerToolPolicy,
  } = useMcpServers({
    spaceId: () => props.selectedSpaceId || "",
  });
  const [showCreateModal, setShowCreateModal] = createSignal(false);
  let modalSpaceId = props.selectedSpaceId;

  createEffect(() => {
    const nextSpaceId = props.selectedSpaceId;
    if (nextSpaceId === modalSpaceId) return;
    modalSpaceId = nextSpaceId;
    setShowCreateModal(false);
  });

  return (
    <Show
      when={props.selectedSpaceId}
      fallback={
        <div class="flex flex-col items-center justify-center h-64 gap-4">
          <div class="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
            <Icons.Server class="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
          </div>
          <p class="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            {t("connectionsSelectWorkspace")}
          </p>
        </div>
      }
    >
      <div class="flex items-center justify-between gap-4 mb-4">
        <div>
          <h4 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t("mcpServers")}
          </h4>
          <p class="text-xs text-zinc-500 dark:text-zinc-400">
            {t("mcpServersDescription")}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <select
            value={props.selectedSpaceId ?? ""}
            onChange={(e) => props.setSelectedSpaceId(e.currentTarget.value)}
            aria-label={t("connectionsSelectWorkspace")}
            class="h-10 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm text-zinc-900 dark:text-zinc-100"
          >
            {props.spaces.map((space) => (
              <option value={getSpaceIdentifier(space)}>{space.name}</option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Icons.Plus class="w-4 h-4" />}
            onClick={() => setShowCreateModal(true)}
          >
            {t("addMcpServer")}
          </Button>
        </div>
      </div>

      {loading() && !hasVerifiedInventory() ? (
        <div class="flex flex-col items-center justify-center h-64 gap-4">
          <div class="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
          <span class="text-sm text-zinc-400">{t("loading")}</span>
        </div>
      ) : (
        <>
          <Show when={error()}>
            {(message) => (
              <div
                role="alert"
                class="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
              >
                <span>{message()}</span>
                <button
                  type="button"
                  disabled={loading()}
                  class="rounded-lg border border-red-200 px-3 py-1.5 text-sm transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-900/40"
                  onClick={() => void refresh()}
                >
                  {loading() ? t("loading") : t("retry")}
                </button>
              </div>
            )}
          </Show>
          <Show when={hasVerifiedInventory() && servers().length === 0}>
            <div class="flex flex-col items-center justify-center h-64 gap-4">
              <div class="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
                <Icons.Server class="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
              </div>
              <div class="text-center">
                <p class="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  {t("noMcpServersYet")}
                </p>
                <p class="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                  {t("managedMcpServersAutoConnected")}
                </p>
              </div>
            </div>
          </Show>
          <Show when={servers().length > 0}>
            <div class="grid gap-3" aria-busy={loading()}>
              {servers().map((server: McpServerRecord) => (
                <ServerCard
                  scopeKey={props.selectedSpaceId ?? ""}
                  server={server}
                  onToggle={() => toggleServer(server)}
                  onDelete={() => deleteServer(server)}
                  onReauthorize={async () => {
                    const targetSpaceId = props.selectedSpaceId;
                    try {
                      const result = await reauthorizeServer(server.id);
                      if (targetSpaceId !== props.selectedSpaceId) return;
                      if (result.auth_url) {
                        globalThis.open(
                          result.auth_url,
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }
                    } catch (error) {
                      if (
                        targetSpaceId !== props.selectedSpaceId ||
                        isMcpScopeChangedError(error)
                      ) return;
                      showToast(
                        "error",
                        error instanceof Error
                          ? error.message
                          : t("failedToReauthorizeMcpServer"),
                      );
                    }
                  }}
                  fetchServerTools={fetchServerTools}
                  updateServerToolPolicy={updateServerToolPolicy}
                />
              ))}
            </div>
          </Show>
        </>
      )}

      {showCreateModal() && (
        <CreateMcpServerModal
          onClose={() => setShowCreateModal(false)}
          onCreate={async (input) => {
            const targetSpaceId = props.selectedSpaceId;
            try {
              const result = await createExternalServer(input);
              if (targetSpaceId !== props.selectedSpaceId) return;
              showToast("success", result.message);
              if (result.auth_url) {
                globalThis.open(
                  result.auth_url,
                  "_blank",
                  "noopener,noreferrer",
                );
              }
              setShowCreateModal(false);
            } catch (err) {
              if (
                targetSpaceId !== props.selectedSpaceId ||
                isMcpScopeChangedError(err)
              ) return;
              // Keep the modal open (setShowCreateModal stays true) so the user
              // can correct input and retry instead of losing it to a silent
              // failure.
              showToast(
                "error",
                err instanceof Error && err.message
                  ? err.message
                  : t("failedToCreateMcpServer"),
              );
            }
          }}
        />
      )}
    </Show>
  );
}
