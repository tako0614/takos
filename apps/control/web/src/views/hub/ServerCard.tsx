import { createEffect, createSignal } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { Button } from "../../components/ui/Button.tsx";
import type { McpServerRecord } from "../../types/index.ts";

export type ServerStatus =
  | "connected"
  | "disabled"
  | "token_expired"
  | "no_token";

export function getServerStatus(server: McpServerRecord): ServerStatus {
  if (!server.enabled) return "disabled";
  if (server.auth_mode === "oauth_pkce") {
    if (
      server.token_expires_at && new Date(server.token_expires_at) < new Date()
    ) return "token_expired";
    if (!server.token_expires_at && server.source_type === "external") {
      return "no_token";
    }
  }
  return "connected";
}

export const statusColors: Record<ServerStatus, string> = {
  connected: "bg-green-500",
  disabled: "bg-zinc-400",
  token_expired: "bg-amber-500",
  no_token: "bg-amber-500",
};

export function ServerCard(props: {
  server: McpServerRecord;
  onToggle: () => void;
  onDelete: () => void;
  fetchServerTools: (
    serverId: string,
  ) => Promise<{ name: string; description: string }[]>;
}) {
  const { t } = useI18n();
  const status = () => getServerStatus(props.server);
  const [expanded, setExpanded] = createSignal(false);
  const [tools, setTools] = createSignal<
    { name: string; description: string }[] | null
  >(null);
  const [toolsLoading, setToolsLoading] = createSignal(false);
  const [toolsError, setToolsError] = createSignal<string | null>(null);
  let previousServerId = props.server.id;

  createEffect(() => {
    const nextServerId = props.server.id;
    if (nextServerId === previousServerId) return;
    previousServerId = nextServerId;
    setExpanded(false);
    setTools(null);
    setToolsError(null);
  });

  const handleToggleExpand = async () => {
    if (!expanded() && tools() === null && !toolsLoading()) {
      setToolsLoading(true);
      setToolsError(null);
      try {
        const result = await props.fetchServerTools(props.server.id);
        setTools(result);
      } catch (err) {
        setToolsError(
          err instanceof Error ? err.message : t("mcpFetchToolsFailed"),
        );
      } finally {
        setToolsLoading(false);
      }
    }
    setExpanded((prev) => !prev);
  };

  const handleRefreshTools = async () => {
    setToolsLoading(true);
    setToolsError(null);
    try {
      const result = await props.fetchServerTools(props.server.id);
      setTools(result);
    } catch (err) {
      setToolsError(
        err instanceof Error ? err.message : t("mcpFetchToolsFailed"),
      );
    } finally {
      setToolsLoading(false);
    }
  };

  const statusLabel: Record<ServerStatus, string> = {
    connected: t("mcpStatusConnected"),
    disabled: t("mcpStatusDisabled"),
    token_expired: t("mcpStatusTokenExpired"),
    no_token: t("mcpStatusNoToken"),
  };

  return (
    <div class="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
      <div class="flex items-center gap-4 p-4">
        {/* Server icon with status dot */}
        <div class="relative w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 flex-shrink-0">
          <Icons.Server class="w-5 h-5" />
          <span
            class={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 ${
              statusColors[status()]
            }`}
            title={statusLabel[status()]}
          />
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {props.server.name}
            </h4>
            <span class="px-2 py-0.5 text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded">
              {props.server.source_type}
            </span>
            <span class="px-2 py-0.5 text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded">
              {props.server.auth_mode}
            </span>
            {tools() && !toolsLoading() && (
              <span class="text-[10px] text-zinc-400 dark:text-zinc-500">
                {t("mcpToolCount", { count: tools()!.length })}
              </span>
            )}
          </div>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
            {props.server.url}
          </p>
        </div>

        <div class="flex items-center gap-2">
          {/* Expand toggle */}
          <button
            type="button"
            onClick={handleToggleExpand}
            class="p-2 rounded-lg bg-transparent border-none cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 dark:text-zinc-500"
            title={t("mcpServerTools")}
          >
            {expanded()
              ? <Icons.ChevronDown class="w-4 h-4" />
              : <Icons.ChevronRight class="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={props.onToggle}
            class="p-2 rounded-lg bg-transparent border-none cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title={props.server.enabled ? t("disable") : t("enable")}
          >
            {props.server.enabled
              ? <Icons.ToggleOn class="w-6 h-6 text-emerald-500" />
              : (
                <Icons.ToggleOff class="w-6 h-6 text-zinc-300 dark:text-zinc-600" />
              )}
          </button>
          {props.server.managed
            ? null
            : (
              <Button variant="ghost" size="sm" onClick={props.onDelete}>
                {t("remove")}
              </Button>
            )}
        </div>
      </div>

      {/* Tools section */}
      {expanded() && (
        <div class="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {t("mcpServerTools")}
            </span>
            <button
              type="button"
              onClick={handleRefreshTools}
              disabled={toolsLoading()}
              class="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-400 dark:text-zinc-500 disabled:opacity-50"
              title={t("mcpRefreshTools")}
            >
              <Icons.RefreshCw
                class={`w-3.5 h-3.5 ${toolsLoading() ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          {toolsLoading() && !tools() && (
            <p class="text-xs text-zinc-400 dark:text-zinc-500 italic">
              {t("mcpFetchingTools")}
            </p>
          )}

          {toolsError() && (
            <div class="flex items-center gap-2">
              <p class="text-xs text-red-500">{toolsError()}</p>
              <button
                type="button"
                onClick={handleRefreshTools}
                class="text-xs text-blue-500 hover:underline"
              >
                {t("retry")}
              </button>
            </div>
          )}

          {status() === "token_expired" && (
            <p class="text-xs text-amber-500 mb-2">{t("mcpReauthorize")}</p>
          )}

          {tools() && tools()!.length === 0 && !toolsLoading() && (
            <p class="text-xs text-zinc-400 dark:text-zinc-500">
              {t("mcpNoTools")}
            </p>
          )}

          {tools() && tools()!.length > 0 && (
            <div class="space-y-1.5 max-h-64 overflow-y-auto">
              {tools()!.map((tool: { name: string; description: string }) => (
                <div class="flex items-start gap-2 py-1">
                  <Icons.Wrench class="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 mt-0.5 flex-shrink-0" />
                  <div class="min-w-0">
                    <span class="text-xs font-mono font-medium text-zinc-700 dark:text-zinc-300">
                      {tool.name}
                    </span>
                    {tool.description && (
                      <p class="text-xs text-zinc-400 dark:text-zinc-500 line-clamp-2 mt-0.5">
                        {tool.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
