import { createEffect, createSignal, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import type { McpServerRecord, McpServerTool } from "../../types/index.ts";
import {
  canUpdateToolPolicy,
  getServerAuthLabelKey,
  getServerSourceLabelKey,
  getServerStatus,
  type ServerStatus,
} from "./server-card-policy.ts";

export const statusColors: Record<ServerStatus, string> = {
  connected: "bg-green-500",
  disabled: "bg-zinc-400",
  token_expired: "bg-amber-500",
  no_token: "bg-amber-500",
};

function endpointHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function ServerCard(props: {
  server: McpServerRecord;
  onToggle: () => void;
  onDelete: () => void;
  onReauthorize?: () => void;
  fetchServerTools: (serverId: string) => Promise<McpServerTool[]>;
  updateServerToolPolicy: (
    serverId: string,
    toolName: string,
    enabled: boolean,
    schemaHash: string,
    invocationPolicy: "automatic" | "confirm_each_time",
  ) => Promise<McpServerTool>;
}) {
  const { t } = useI18n();
  const status = () => getServerStatus(props.server);
  const [expanded, setExpanded] = createSignal(false);
  const [tools, setTools] = createSignal<McpServerTool[] | null>(null);
  const [toolsLoading, setToolsLoading] = createSignal(false);
  const [toolsError, setToolsError] = createSignal<string | null>(null);
  const [toolPolicyError, setToolPolicyError] = createSignal<string | null>(
    null,
  );
  const [updatingToolName, setUpdatingToolName] = createSignal<string | null>(
    null,
  );
  let previousServerId = props.server.id;

  createEffect(() => {
    const nextServerId = props.server.id;
    if (nextServerId === previousServerId) return;
    previousServerId = nextServerId;
    setExpanded(false);
    setTools(null);
    setToolsError(null);
    setToolPolicyError(null);
    setUpdatingToolName(null);
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
    setToolPolicyError(null);
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

  const handleToolPolicyUpdate = async (
    tool: McpServerTool,
    enabled: boolean,
    invocationPolicy = tool.invocation_policy,
  ) => {
    if (updatingToolName() !== null || !canUpdateToolPolicy(props.server, tool))
      return;
    setUpdatingToolName(tool.name);
    setToolPolicyError(null);
    try {
      const updated = await props.updateServerToolPolicy(
        props.server.id,
        tool.name,
        enabled,
        tool.schema_hash,
        invocationPolicy,
      );
      setTools(
        (current) =>
          current?.map((entry) =>
            entry.name === updated.name ? updated : entry,
          ) ?? null,
      );
    } catch (error) {
      setToolPolicyError(
        error instanceof Error && error.message
          ? error.message
          : t("failedToUpdateMcpToolPolicy"),
      );
    } finally {
      setUpdatingToolName(null);
    }
  };

  const statusLabel: Record<ServerStatus, string> = {
    connected: t("mcpStatusConnected"),
    disabled: t("mcpStatusDisabled"),
    token_expired: t("mcpStatusTokenExpired"),
    no_token: t("mcpStatusNoToken"),
  };
  const sourceLabel = () =>
    t(getServerSourceLabelKey(props.server.source_type));
  const authLabel = () => t(getServerAuthLabelKey(props.server.auth_mode));
  const toolRiskLabel = (tool: McpServerTool): string | null => {
    const risk = tool.risk_level;
    switch (risk) {
      case "high":
        return t("connectionToolRiskHigh");
      case "medium":
        return t("connectionToolRiskMedium");
      case "low":
        return t("connectionToolRiskLow");
      default:
        return risk && risk !== "none" ? risk : null;
    }
  };

  return (
    <div class="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
      <div class="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
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
            <Badge>{sourceLabel()}</Badge>
            <Badge>{authLabel()}</Badge>
            <Show when={props.server.source_type === "external"}>
              <Badge variant="warning">{t("connectionTrustUnverified")}</Badge>
            </Show>
            <Show when={!toolsLoading() ? tools() : null}>
              {(loadedTools) => (
                <span class="text-[10px] text-zinc-400 dark:text-zinc-500">
                  {t("mcpToolCount", { count: loadedTools().length })}
                </span>
              )}
            </Show>
          </div>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
            {props.server.url}
          </p>
          <p class="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            {t("connectionEndpointDomain")}:{" "}
            {endpointHostname(props.server.url)}
            {props.server.source_type === "external"
              ? ` · ${t("connectionDataSentTo")}: ${endpointHostname(
                  props.server.url,
                )}`
              : ` · ${t("connectionAvailableInWorkspace")}`}
          </p>
        </div>

        <div class="flex items-center gap-2 self-end sm:self-auto">
          {/* Expand toggle */}
          <button
            type="button"
            onClick={handleToggleExpand}
            class="p-2 rounded-lg bg-transparent border-none cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 dark:text-zinc-500"
            title={t("mcpServerTools")}
            aria-label={t("mcpServerTools")}
            aria-expanded={expanded()}
          >
            {expanded() ? (
              <Icons.ChevronDown class="w-4 h-4" />
            ) : (
              <Icons.ChevronRight class="w-4 h-4" />
            )}
          </button>

          <Show when={props.server.source_type !== "publication"}>
            <button
              type="button"
              onClick={props.onToggle}
              class="p-2 rounded-lg bg-transparent border-none cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title={props.server.enabled ? t("disable") : t("enable")}
              aria-label={props.server.enabled ? t("disable") : t("enable")}
              aria-pressed={props.server.enabled}
            >
              {props.server.enabled ? (
                <Icons.ToggleOn class="w-6 h-6 text-emerald-500" />
              ) : (
                <Icons.ToggleOff class="w-6 h-6 text-zinc-300 dark:text-zinc-600" />
              )}
            </button>
          </Show>
          {props.server.managed ? null : (
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
              aria-label={t("mcpRefreshTools")}
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

          {toolPolicyError() && (
            <p class="mb-2 text-xs text-red-500">{toolPolicyError()}</p>
          )}

          {(status() === "token_expired" || status() === "no_token") &&
            props.onReauthorize && (
              <div class="flex items-center gap-2 mb-2">
                <p class="text-xs text-amber-500">{t("mcpReauthorize")}</p>
                <button
                  type="button"
                  onClick={() => props.onReauthorize?.()}
                  class="text-xs text-blue-500 hover:underline"
                >
                  {t("mcpReauthorizeAction")}
                </button>
              </div>
            )}

          <Show when={tools()}>
            {(loadedTools) => (
              <>
                <Show when={loadedTools().length === 0 && !toolsLoading()}>
                  <p class="text-xs text-zinc-400 dark:text-zinc-500">
                    {t("mcpNoTools")}
                  </p>
                </Show>
                <Show when={loadedTools().length > 0}>
                  <Show
                    when={
                      loadedTools().filter(
                        (tool) =>
                          canUpdateToolPolicy(props.server, tool) &&
                          tool.review_required,
                      ).length
                    }
                  >
                    {(count) => (
                      <div class="mb-2 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                        <Icons.AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          {t("mcpToolsReviewRequiredSummary", {
                            count: count(),
                          })}
                        </span>
                      </div>
                    )}
                  </Show>
                  <div class="space-y-1.5 max-h-64 overflow-y-auto">
                    {loadedTools().map((tool: McpServerTool) => (
                      <div
                        class={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${
                          canUpdateToolPolicy(props.server, tool) &&
                          !tool.enabled
                            ? "bg-zinc-50 dark:bg-zinc-800/50"
                            : ""
                        }`}
                      >
                        <Icons.Wrench class="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 mt-0.5 flex-shrink-0" />
                        <div class="min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-1.5">
                            <span class="text-xs font-mono font-medium text-zinc-700 dark:text-zinc-300">
                              {tool.annotations?.title ?? tool.name}
                            </span>
                            <Show when={tool.annotations?.title}>
                              <span class="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
                                {tool.name}
                              </span>
                            </Show>
                            <Show when={toolRiskLabel(tool)}>
                              {(label) => (
                                <Badge
                                  variant={
                                    tool.risk_level === "high"
                                      ? "error"
                                      : "warning"
                                  }
                                >
                                  {label()}
                                </Badge>
                              )}
                            </Show>
                            <Show
                              when={tool.annotations?.readOnlyHint === true}
                            >
                              <Badge variant="info">
                                {t("connectionToolReadOnly")}
                              </Badge>
                            </Show>
                            <Show
                              when={tool.annotations?.destructiveHint === true}
                            >
                              <Badge variant="error">
                                {t("connectionToolDestructive")}
                              </Badge>
                            </Show>
                            <Show
                              when={
                                tool.side_effects === true &&
                                tool.annotations?.destructiveHint !== true
                              }
                            >
                              <Badge variant="warning">
                                {t("connectionToolMayChangeData")}
                              </Badge>
                            </Show>
                            <Show
                              when={tool.annotations?.openWorldHint === true}
                            >
                              <Badge>{t("connectionToolExternalAccess")}</Badge>
                            </Show>
                            <Show when={!tool.supported}>
                              <Badge variant="warning">
                                {t("connectionToolTaskUnsupported")}
                              </Badge>
                            </Show>
                            <Show
                              when={canUpdateToolPolicy(props.server, tool)}
                            >
                              <Badge
                                variant={tool.enabled ? "success" : "default"}
                              >
                                {tool.enabled
                                  ? t("mcpToolEnabled")
                                  : t("mcpToolDisabled")}
                              </Badge>
                            </Show>
                            <Show
                              when={
                                canUpdateToolPolicy(props.server, tool) &&
                                tool.review_required
                              }
                            >
                              <Badge variant="warning">
                                {t("mcpToolReviewRequired")}
                              </Badge>
                            </Show>
                          </div>
                          {tool.description && (
                            <p class="text-xs text-zinc-400 dark:text-zinc-500 line-clamp-2 mt-0.5">
                              {tool.description}
                            </p>
                          )}
                        </div>
                        <Show when={canUpdateToolPolicy(props.server, tool)}>
                          <div class="flex shrink-0 items-center gap-1">
                            <select
                              value={tool.invocation_policy}
                              disabled={
                                updatingToolName() !== null || !tool.enabled
                              }
                              aria-label={t("mcpToolInvocationPolicy")}
                              class="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                              onChange={(event) =>
                                void handleToolPolicyUpdate(
                                  tool,
                                  tool.enabled,
                                  event.currentTarget.value as
                                    "automatic" | "confirm_each_time",
                                )
                              }
                            >
                              <option value="confirm_each_time">
                                {t("mcpToolConfirmEachTime")}
                              </option>
                              <option value="automatic">
                                {t("mcpToolAutomatic")}
                              </option>
                            </select>
                            <Show when={tool.review_required}>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={updatingToolName() !== null}
                                onClick={() =>
                                  void handleToolPolicyUpdate(tool, false)
                                }
                              >
                                {t("mcpToolKeepDisabled")}
                              </Button>
                            </Show>
                            <button
                              type="button"
                              disabled={updatingToolName() !== null}
                              onClick={() =>
                                void handleToolPolicyUpdate(tool, !tool.enabled)
                              }
                              class="rounded-lg bg-transparent p-1 text-zinc-400 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-500 dark:hover:bg-zinc-800"
                              title={
                                tool.enabled
                                  ? t("mcpToolDisable")
                                  : t("mcpToolEnable")
                              }
                              aria-label={
                                tool.enabled
                                  ? t("mcpToolDisable")
                                  : t("mcpToolEnable")
                              }
                              aria-pressed={tool.enabled}
                            >
                              {updatingToolName() === tool.name ? (
                                <Icons.Loader class="h-4 w-4 animate-spin" />
                              ) : tool.enabled ? (
                                <Icons.ToggleOn class="h-5 w-5 text-emerald-500" />
                              ) : (
                                <Icons.ToggleOff class="h-5 w-5 text-zinc-300 dark:text-zinc-600" />
                              )}
                            </button>
                          </div>
                        </Show>
                      </div>
                    ))}
                  </div>
                </Show>
              </>
            )}
          </Show>
        </div>
      )}
    </div>
  );
}
