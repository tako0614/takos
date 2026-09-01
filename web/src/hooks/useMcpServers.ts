import {
  type Accessor,
  createComputed,
  createEffect,
  createSignal,
  on,
} from "solid-js";
import { useToast } from "../store/toast.ts";
import { useI18n } from "../store/i18n.ts";
import { getErrorMessage } from "../lib/errors.ts";
import { useConfirmDialog } from "../store/confirm-dialog.ts";
import { createLatestRequest } from "../lib/createLatestRequest.ts";
import type { McpServerRecord, McpServerTool } from "../types/index.ts";
import {
  buildMcpToolPolicyPatch,
  buildMcpToolPolicyPath,
} from "./mcp-server-paths.ts";
import {
  parseConnectionsImportResponse,
  parseConnectionsExportResponse,
  parseMcpServerActionResponse,
  parseMcpServerDeleteResponse,
  parseMcpServerResponse,
  parseMcpServerToolResponse,
  parseMcpServersResponse,
  parseMcpServerToolsResponse,
  serializeConnectionsExportDocument,
} from "../views/connections/mcp-response.ts";
import { parseMcpConnectionsDocument } from "takos-api-contract/mcp-connections";

interface UseMcpServersOptions {
  spaceId: Accessor<string>;
}

interface McpServerInventoryState {
  spaceId: string;
  servers: McpServerRecord[];
  error: string | null;
  verified: boolean;
}

interface McpScopeClaim {
  spaceId: string;
  generation: number;
}

export class McpScopeChangedError extends Error {
  constructor() {
    super("MCP Workspace changed while the request was in progress");
    this.name = "McpScopeChangedError";
  }
}

export function isMcpScopeChangedError(
  value: unknown,
): value is McpScopeChangedError {
  return value instanceof McpScopeChangedError;
}

export function useMcpServers({ spaceId }: UseMcpServersOptions) {
  const { showToast } = useToast();
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const currentSpaceId = () => spaceId().trim();
  const [inventory, setInventory] = createSignal<McpServerInventoryState>({
    spaceId: "",
    servers: [],
    error: null,
    verified: false,
  });
  const servers = () => inventory().servers;
  const error = () => inventory().error;
  const hasVerifiedInventory = () => inventory().verified;
  const [loading, setLoading] = createSignal(true);
  const latestRefresh = createLatestRequest();
  const deletingServers = new Set<string>();
  let observedSpaceId = currentSpaceId();
  let scopeGeneration = 0;

  const observeCurrentScope = (): McpScopeClaim => {
    const nextSpaceId = currentSpaceId();
    if (nextSpaceId !== observedSpaceId) {
      observedSpaceId = nextSpaceId;
      scopeGeneration += 1;
    }
    return { spaceId: nextSpaceId, generation: scopeGeneration };
  };

  // createComputed runs synchronously when the accessor changes. The request
  // fence therefore remembers A -> B -> A even when no request is started in B.
  createComputed(() => {
    observeCurrentScope();
  });

  const isCurrentScope = (claim: McpScopeClaim): boolean => {
    const current = observeCurrentScope();
    return (
      claim.spaceId === current.spaceId &&
      claim.generation === current.generation
    );
  };

  const assertCurrentScope = (claim: McpScopeClaim): void => {
    if (!isCurrentScope(claim)) throw new McpScopeChangedError();
  };

  const inventoryStillContains = (
    claim: McpScopeClaim,
    server: McpServerRecord,
  ): boolean => {
    if (!isCurrentScope(claim)) return false;
    const current = inventory();
    return (
      current.verified &&
      current.spaceId === claim.spaceId &&
      current.servers.some(
        (entry) =>
          entry.id === server.id &&
          entry.name === server.name &&
          entry.url === server.url,
      )
    );
  };

  const refresh = async () => {
    const target = observeCurrentScope();
    const targetSpaceId = target.spaceId;
    if (inventory().spaceId !== targetSpaceId) {
      latestRefresh.next();
      setInventory({
        spaceId: targetSpaceId,
        servers: [],
        error: null,
        verified: false,
      });
    }
    if (!targetSpaceId) {
      latestRefresh.next();
      setLoading(false);
      return;
    }

    const claim = latestRefresh.claim(() => isCurrentScope(target));
    setLoading(true);
    setInventory((current) =>
      current.spaceId === targetSpaceId
        ? { ...current, error: null }
        : current,
    );
    try {
      const res = await fetch(
        `/api/mcp/servers?workspaceId=${encodeURIComponent(targetSpaceId)}`,
      );
      if (!res.ok) throw new Error(t("failedToFetchMcpServers"));
      const data = await res.json();
      if (!claim.won()) return;
      try {
        const nextServers = parseMcpServersResponse(data);
        setInventory((current) =>
          current.spaceId === targetSpaceId
            ? {
                spaceId: targetSpaceId,
                servers: nextServers,
                error: null,
                verified: true,
              }
            : current,
        );
      } catch {
        throw new Error(t("failedToFetchMcpServers"));
      }
    } catch (err) {
      if (!claim.won()) return;
      // Surface load failures with a retry instead of rendering an empty
      // "no servers connected" state that hides the error.
      const message = err instanceof Error && err.message
        ? err.message
        : t("failedToFetchMcpServers");
      setInventory((current) =>
        current.spaceId === targetSpaceId
          ? { ...current, error: message }
          : current,
      );
    } finally {
      if (claim.won()) {
        setLoading(false);
      }
    }
  };

  createEffect(
    on(currentSpaceId, () => {
      observeCurrentScope();
      void refresh();
    }),
  );

  const createExternalServer = async (input: {
    name: string;
    url: string;
    scope?: string;
  }) => {
    const target = observeCurrentScope();
    const targetSpaceId = target.spaceId;
    if (!targetSpaceId) {
      throw new Error(t("missingSpaceId"));
    }
    const res = await fetch(
      `/api/mcp/servers?workspaceId=${encodeURIComponent(targetSpaceId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      error?: unknown;
    };
    assertCurrentScope(target);
    if (!res.ok) {
      throw new Error(
        getErrorMessage(data.error, t("failedToCreateMcpServer")),
      );
    }
    let result;
    try {
      result = parseMcpServerActionResponse(
        data,
        globalThis.location?.origin,
        input,
      );
    } catch {
      throw new Error(t("failedToCreateMcpServer"));
    }
    assertCurrentScope(target);
    await refresh();
    assertCurrentScope(target);
    return result;
  };

  const reauthorizeServer = async (serverId: string) => {
    const target = observeCurrentScope();
    const targetSpaceId = target.spaceId;
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
    const data = (await res.json().catch(() => ({}))) as {
      error?: unknown;
    };
    assertCurrentScope(target);
    if (!res.ok) {
      throw new Error(
        getErrorMessage(data.error, t("failedToReauthorizeMcpServer")),
      );
    }
    let result;
    try {
      result = parseMcpServerActionResponse(data, globalThis.location?.origin);
    } catch {
      throw new Error(t("failedToReauthorizeMcpServer"));
    }
    assertCurrentScope(target);
    await refresh();
    assertCurrentScope(target);
    return result;
  };

  const updateServer = async (
    serverId: string,
    input: { enabled?: boolean; name?: string },
  ) => {
    const target = observeCurrentScope();
    const targetSpaceId = target.spaceId;
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
    const data = (await res.json().catch(() => ({}))) as {
      error?: unknown;
    };
    assertCurrentScope(target);
    if (!res.ok) {
      throw new Error(
        getErrorMessage(data.error, t("failedToUpdateMcpServer")),
      );
    }
    let result;
    try {
      result = parseMcpServerResponse(data, serverId);
    } catch {
      throw new Error(t("failedToUpdateMcpServer"));
    }
    assertCurrentScope(target);
    await refresh();
    assertCurrentScope(target);
    return result;
  };

  const toggleServer = async (server: McpServerRecord) => {
    const target = observeCurrentScope();
    try {
      await updateServer(server.id, { enabled: !server.enabled });
      return true;
    } catch (error) {
      if (isCurrentScope(target) && !isMcpScopeChangedError(error)) {
        showToast(
          "error",
          getErrorMessage(error, t("failedToUpdateMcpServer")),
        );
      }
      return false;
    }
  };

  const deleteServer = async (server: McpServerRecord) => {
    const target = observeCurrentScope();
    const targetSpaceId = target.spaceId;
    if (!targetSpaceId) return false;
    if (!inventoryStillContains(target, server)) return false;
    const deleteKey = `${target.generation}:${targetSpaceId}:${server.id}`;
    if (deletingServers.has(deleteKey)) return false;
    deletingServers.add(deleteKey);
    try {
      const confirmed = await confirm({
        title: t("removeMcpServer"),
        message: t("removeMcpServerConfirm", { name: server.name }),
        confirmText: t("remove"),
        cancelText: t("cancel"),
        danger: true,
      });
      if (!confirmed || !inventoryStillContains(target, server)) return false;

      const res = await fetch(
        `/api/mcp/servers/${server.id}?workspaceId=${encodeURIComponent(
          targetSpaceId,
        )}`,
        {
          method: "DELETE",
        },
      );
      const data = await res.json().catch(() => ({}));
      assertCurrentScope(target);
      if (!res.ok) {
        throw new Error(
          getErrorMessage(
            (data as { error?: unknown }).error,
            t("failedToRemoveMcpServer"),
          ),
        );
      }
      try {
        parseMcpServerDeleteResponse(data);
      } catch {
        throw new Error(t("failedToRemoveMcpServer"));
      }
      assertCurrentScope(target);
      await refresh();
      assertCurrentScope(target);
      return true;
    } catch (error) {
      if (isCurrentScope(target) && !isMcpScopeChangedError(error)) {
        showToast(
          "error",
          getErrorMessage(error, t("failedToRemoveMcpServer")),
        );
      }
      return false;
    } finally {
      deletingServers.delete(deleteKey);
    }
  };

  const fetchServerTools = async (
    serverId: string,
  ): Promise<McpServerTool[]> => {
    const target = observeCurrentScope();
    const targetSpaceId = target.spaceId;
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
      assertCurrentScope(target);
      throw new Error(data.error || t("failedToFetchTools"));
    }
    const data = (await res.json()) as unknown;
    assertCurrentScope(target);
    let tools: McpServerTool[];
    try {
      tools = parseMcpServerToolsResponse(data);
    } catch {
      throw new Error(t("failedToFetchTools"));
    }
    assertCurrentScope(target);
    return tools;
  };

  const updateServerToolPolicy = async (
    serverId: string,
    toolName: string,
    enabled: boolean,
    schemaHash: string,
    invocationPolicy: "automatic" | "confirm_each_time",
  ): Promise<McpServerTool> => {
    const target = observeCurrentScope();
    const targetSpaceId = target.spaceId;
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
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    assertCurrentScope(target);
    if (res.status === 409) {
      throw new Error(t("mcpToolPolicyRefreshRequired"));
    }
    if (!res.ok) {
      throw new Error(
        getErrorMessage(data.error, t("failedToUpdateMcpToolPolicy")),
      );
    }
    let tool: McpServerTool;
    try {
      tool = parseMcpServerToolResponse(data, { toolName, schemaHash });
    } catch {
      throw new Error(t("failedToUpdateMcpToolPolicy"));
    }
    assertCurrentScope(target);
    return tool;
  };

  const exportConnections = async (): Promise<string> => {
    const target = observeCurrentScope();
    const targetSpaceId = target.spaceId;
    if (!targetSpaceId) throw new Error(t("missingSpaceId"));
    const response = await fetch(
      `/api/mcp/connections/export?workspaceId=${encodeURIComponent(targetSpaceId)}`,
    );
    const body = (await response.json().catch(() => ({}))) as {
      data?: unknown;
      error?: unknown;
    };
    assertCurrentScope(target);
    if (!response.ok) {
      throw new Error(
        getErrorMessage(body.error, t("connectionsExportFailed")),
      );
    }
    let serialized: string;
    try {
      serialized = serializeConnectionsExportDocument(
        parseConnectionsExportResponse(body),
      );
    } catch {
      throw new Error(t("connectionsExportFailed"));
    }
    assertCurrentScope(target);
    return serialized;
  };

  const importConnections = async (document: unknown) => {
    const target = observeCurrentScope();
    const targetSpaceId = target.spaceId;
    if (!targetSpaceId) throw new Error(t("missingSpaceId"));
    let requestDocument;
    try {
      requestDocument = parseMcpConnectionsDocument(document);
    } catch {
      throw new Error(t("connectionsImportFailed"));
    }
    const response = await fetch(
      `/api/mcp/connections/import?workspaceId=${encodeURIComponent(targetSpaceId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestDocument),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      error?: unknown;
    };
    assertCurrentScope(target);
    if (!response.ok) {
      throw new Error(
        getErrorMessage(body.error, t("connectionsImportFailed")),
      );
    }
    let result;
    try {
      result = parseConnectionsImportResponse(
        body,
        globalThis.location?.origin,
        requestDocument,
      );
    } catch {
      throw new Error(t("connectionsImportFailed"));
    }
    assertCurrentScope(target);
    await refresh();
    assertCurrentScope(target);
    return result;
  };

  return {
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
    exportConnections,
    importConnections,
  };
}
