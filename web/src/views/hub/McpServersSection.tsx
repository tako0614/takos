import { createSignal, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { useMcpServers } from "../../hooks/useMcpServers.ts";
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
    refresh,
    createExternalServer,
    reauthorizeServer,
    toggleServer,
    deleteServer,
    fetchServerTools,
  } = useMcpServers({
    spaceId: () => props.selectedSpaceId || "",
  });
  const [showCreateModal, setShowCreateModal] = createSignal(false);

  return (
    <Show
      when={props.selectedSpaceId}
      fallback={
        <div class="flex flex-col items-center justify-center h-64 gap-4">
          <div class="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
            <Icons.Server class="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
          </div>
          <p class="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            {t("selectSpace")}
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
            value={props.selectedSpaceId}
            onChange={(e) => props.setSelectedSpaceId(e.currentTarget.value)}
            class="h-10 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm text-zinc-900 dark:text-zinc-100"
          >
            {props.spaces.map((space) => (
              <option value={getSpaceIdentifier(space)}>
                {space.name}
              </option>
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

      {loading()
        ? (
          <div class="flex flex-col items-center justify-center h-64 gap-4">
            <div class="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
            <span class="text-sm text-zinc-400">{t("loading")}</span>
          </div>
        )
        : error()
        ? (
          <div class="flex flex-col items-center justify-center h-64 gap-3 text-center">
            <p class="text-sm text-red-500">{error()}</p>
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors"
              onClick={() => void refresh()}
            >
              {t("retry")}
            </button>
          </div>
        )
        : servers().length === 0
        ? (
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
        )
        : (
          <div class="grid gap-3">
            {servers().map((server: McpServerRecord) => (
              <ServerCard
                server={server}
                onToggle={() => toggleServer(server)}
                onDelete={() => deleteServer(server)}
                onReauthorize={async () => {
                  try {
                    await reauthorizeServer(server.id);
                  } catch (error) {
                    showToast(
                      "error",
                      error instanceof Error
                        ? error.message
                        : t("failedToReauthorizeMcpServer"),
                    );
                  }
                }}
                fetchServerTools={fetchServerTools}
              />
            ))}
          </div>
        )}

      {showCreateModal() && (
        <CreateMcpServerModal
          onClose={() => setShowCreateModal(false)}
          onCreate={async (input) => {
            try {
              const result = await createExternalServer(input);
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
