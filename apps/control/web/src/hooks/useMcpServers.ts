import { type Accessor, createEffect, createSignal, on } from "solid-js";
import { useToast } from "../store/toast.ts";
import { useI18n } from "../store/i18n.ts";
import { getErrorMessage } from "takos-common/errors";
import { useConfirmDialog } from "../store/confirm-dialog.ts";
import type { McpServerRecord } from "../types/index.ts";

interface UseMcpServersOptions {
  spaceId: Accessor<string>;
}

export function useMcpServers({ spaceId }: UseMcpServersOptions) {
  const { showToast } = useToast();
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const currentSpaceId = () => spaceId().trim();
  const basePath = () =>
    `/api/mcp/servers?spaceId=${encodeURIComponent(currentSpaceId())}`;
  const [servers, setServers] = createSignal<McpServerRecord[]>([]);
  const [loading, setLoading] = createSignal(true);

  const refresh = async () => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) {
      setServers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(basePath());
      if (!res.ok) throw new Error("Failed to fetch MCP servers");
      const data = await res.json();
      setServers(data.data || []);
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  };

  createEffect(on(spaceId, (nextSpaceId) => {
    if (nextSpaceId.trim()) {
      void refresh();
    } else {
      setServers([]);
      setLoading(false);
    }
  }));

  const createExternalServer = async (
    input: { name: string; url: string; scope?: string },
  ) => {
    if (!currentSpaceId()) {
      throw new Error("Missing space id");
    }
    const res = await fetch(basePath(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Failed to create MCP server");
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

  const updateServer = async (
    serverId: string,
    input: { enabled?: boolean; name?: string },
  ) => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) {
      throw new Error("Missing space id");
    }
    const res = await fetch(
      `/api/mcp/servers/${serverId}?spaceId=${
        encodeURIComponent(targetSpaceId)
      }`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Failed to update MCP server");
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
        `/api/mcp/servers/${server.id}?spaceId=${
          encodeURIComponent(targetSpaceId)
        }`,
        {
          method: "DELETE",
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to remove MCP server");
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
  ): Promise<{ name: string; description: string }[]> => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) {
      throw new Error("Missing space id");
    }
    const res = await fetch(
      `/api/mcp/servers/${serverId}/tools?spaceId=${
        encodeURIComponent(targetSpaceId)
      }`,
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error || "Failed to fetch tools");
    }
    const data = await res.json() as {
      data: { tools: { name: string; description: string }[] };
    };
    return data.data.tools;
  };

  return {
    servers,
    loading,
    refresh,
    createExternalServer,
    toggleServer,
    deleteServer,
    fetchServerTools,
  };
}
