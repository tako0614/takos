import { type Accessor, createEffect, createSignal, on } from "solid-js";
import { useToast } from "../store/toast.ts";
import { useI18n } from "../store/i18n.ts";
import { getErrorMessage } from "@takos/worker-platform-utils/errors";
import { useConfirmDialog } from "../store/confirm-dialog.ts";
import { createLatestRequest } from "../lib/createLatestRequest.ts";
import type { McpServerRecord, McpServerTool } from "../types/index.ts";
import {
  buildMcpToolPolicyPatch,
  buildMcpToolPolicyPath,
} from "./mcp-server-paths.ts";

interface UseMcpServersOptions {
  spaceId: Accessor<string>;
}

export function useMcpServers({ spaceId }: UseMcpServersOptions) {
  const { showToast } = useToast();
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const currentSpaceId = () => spaceId().trim();
  const basePath = () =>
    `/api/mcp/servers?workspaceId=${encodeURIComponent(currentSpaceId())}`;
  const [servers, setServers] = createSignal<McpServerRecord[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const latestRefresh = createLatestRequest();

  const refresh = async () => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) {
      latestRefresh.next();
      setServers([]);
      setError(null);
      setLoading(false);
      return;
    }

    const claim = latestRefresh.claim(() => targetSpaceId === currentSpaceId());
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/mcp/servers?workspaceId=${encodeURIComponent(targetSpaceId)}`,
      );
      if (!res.ok) throw new Error(t("failedToFetchMcpServers"));
      const data = await res.json();
      if (!claim.won()) return;
      setServers(data.data || []);
    } catch (err) {
      if (!claim.won()) return;
      // Surface load failures with a retry instead of rendering an empty
      // "no servers connected" state that hides the error.
      setServers([]);
      setError(
        err instanceof Error && err.message
          ? err.message
          : t("failedToFetchMcpServers"),
      );
    } finally {
      if (claim.won()) {
        setLoading(false);
      }
    }
  };

  createEffect(
    on(spaceId, (nextSpaceId) => {
      if (nextSpaceId.trim()) {
        void refresh();
      } else {
        setServers([]);
        setLoading(false);
      }
    }),
  );

  const createExternalServer = async (input: {
    name: string;
    url: string;
    scope?: string;
  }) => {
    if (!currentSpaceId()) {
      throw new Error(t("missingSpaceId"));
    }
    const res = await fetch(basePath(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || t("failedToCreateMcpServer"));
    }
    await refresh();
    return data.data as {
      status: string;
      name: string;
      url: string;
      auth_url?: string;
      message: string;
    };
  };

  const reauthorizeServer = async (serverId: string) => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) {
      throw new Error(t("missingSpaceId"));
    }
    const res = await fetch(
      `/api/mcp/servers/${serverId}/reauthorize?workspaceId=${encodeURIComponent(
        targetSpaceId,
      )}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || t("failedToReauthorizeMcpServer"));
    }
    const result = data.data as { auth_url?: string; message?: string };
    if (result.auth_url) {
      globalThis.open(result.auth_url, "_blank", "noopener,noreferrer");
    }
    await refresh();
    return result;
  };

  const updateServer = async (
    serverId: string,
    input: { enabled?: boolean; name?: string },
  ) => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) {
      throw new Error(t("missingSpaceId"));
    }
    const res = await fetch(
      `/api/mcp/servers/${serverId}?workspaceId=${encodeURIComponent(
        targetSpaceId,
      )}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || t("failedToUpdateMcpServer"));
    }
    await refresh();
    return data.data as McpServerRecord;
  };

  const toggleServer = async (server: McpServerRecord) => {
    try {
      await updateServer(server.id, { enabled: !server.enabled });
      return true;
    } catch (error) {
      showToast("error", getErrorMessage(error, t("failedToUpdateMcpServer")));
      return false;
    }
  };

  const deleteServer = async (server: McpServerRecord) => {
    const confirmed = await confirm({
      title: t("removeMcpServer"),
      message: t("removeMcpServerConfirm", { name: server.name }),
      confirmText: t("remove"),
      cancelText: t("cancel"),
      danger: true,
    });
    if (!confirmed) return false;
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) return false;

    try {
      const res = await fetch(
        `/api/mcp/servers/${server.id}?workspaceId=${encodeURIComponent(
          targetSpaceId,
        )}`,
        {
          method: "DELETE",
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t("failedToRemoveMcpServer"));
      }
      await refresh();
      return true;
    } catch (error) {
      showToast("error", getErrorMessage(error, t("failedToRemoveMcpServer")));
      return false;
    }
  };

  const fetchServerTools = async (
    serverId: string,
  ): Promise<McpServerTool[]> => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) {
      throw new Error(t("missingSpaceId"));
    }
    const res = await fetch(
      `/api/mcp/servers/${serverId}/tools?workspaceId=${encodeURIComponent(
        targetSpaceId,
      )}`,
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || t("failedToFetchTools"));
    }
    const data = (await res.json()) as {
      data: { tools: McpServerTool[] };
    };
    return data.data.tools;
  };

  const updateServerToolPolicy = async (
    serverId: string,
    toolName: string,
    enabled: boolean,
    schemaHash: string,
    invocationPolicy: "automatic" | "confirm_each_time",
  ): Promise<McpServerTool> => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) {
      throw new Error(t("missingSpaceId"));
    }
    const res = await fetch(
      buildMcpToolPolicyPath(serverId, toolName, targetSpaceId),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildMcpToolPolicyPatch(enabled, schemaHash, invocationPolicy),
        ),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      data?: McpServerTool;
      error?: unknown;
    };
    if (res.status === 409) {
      throw new Error(t("mcpToolPolicyRefreshRequired"));
    }
    if (!res.ok || !data.data) {
      throw new Error(
        getErrorMessage(data.error, t("failedToUpdateMcpToolPolicy")),
      );
    }
    return data.data;
  };

  const exportConnections = async (): Promise<unknown> => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) throw new Error(t("missingSpaceId"));
    const response = await fetch(
      `/api/mcp/connections/export?workspaceId=${encodeURIComponent(targetSpaceId)}`,
    );
    const body = (await response.json().catch(() => ({}))) as {
      data?: unknown;
      error?: unknown;
    };
    if (!response.ok || body.data === undefined) {
      throw new Error(
        getErrorMessage(body.error, t("connectionsExportFailed")),
      );
    }
    return body.data;
  };

  const importConnections = async (document: unknown) => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) throw new Error(t("missingSpaceId"));
    const response = await fetch(
      `/api/mcp/connections/import?workspaceId=${encodeURIComponent(targetSpaceId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(document),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      data?: {
        registry_sources: Array<{ status: string }>;
        connections: Array<{
          name: string;
          status: string;
          authorization_url?: string;
          tool_policies_require_review: number;
          message?: string;
        }>;
      };
      error?: unknown;
    };
    if (!response.ok || !body.data) {
      throw new Error(
        getErrorMessage(body.error, t("connectionsImportFailed")),
      );
    }
    await refresh();
    return body.data;
  };

  return {
    servers,
    loading,
    error,
    refresh,
    createExternalServer,
    reauthorizeServer,
    toggleServer,
    deleteServer,
    fetchServerTools,
    updateServerToolPolicy,
    exportConnections,
    importConnections,
  };
}
