import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../store/toast';
import { useI18n } from '../store/i18n';
import { getErrorMessage } from '@takoserver/common/errors';
import { useConfirmDialog } from '../store/confirm-dialog';
import type { McpServerRecord } from '../types';

interface UseMcpServersOptions {
  spaceId: string;
}

export function useMcpServers({ spaceId }: UseMcpServersOptions) {
  const { showToast } = useToast();
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const [servers, setServers] = useState<McpServerRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const basePath = `/api/mcp/servers?spaceId=${encodeURIComponent(spaceId)}`;

  const refresh = useCallback(async () => {
    if (!spaceId) {
      setServers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(basePath);
      if (!res.ok) throw new Error('Failed to fetch MCP servers');
      const data = await res.json();
      setServers(data.data || []);
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, [basePath, spaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createExternalServer = useCallback(async (input: { name: string; url: string; scope?: string }) => {
    const res = await fetch(basePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create MCP server');
    }
    await refresh();
    return data.data as {
      status: string;
      name: string;
      url: string;
      auth_url?: string;
      message: string;
    };
  }, [basePath, refresh]);

  const updateServer = useCallback(async (serverId: string, input: { enabled?: boolean; name?: string }) => {
    const res = await fetch(`/api/mcp/servers/${serverId}?spaceId=${encodeURIComponent(spaceId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update MCP server');
    }
    await refresh();
    return data.data as McpServerRecord;
  }, [refresh, spaceId]);

  const toggleServer = useCallback(async (server: McpServerRecord) => {
    try {
      await updateServer(server.id, { enabled: !server.enabled });
      return true;
    } catch (error) {
      showToast('error', getErrorMessage(error, t('failedToUpdateMcpServer')));
      return false;
    }
  }, [showToast, updateServer]);

  const deleteServer = useCallback(async (server: McpServerRecord) => {
    const confirmed = await confirm({
      title: t('removeMcpServer'),
      message: t('removeMcpServerConfirm', { name: server.name }),
      confirmText: t('remove'),
      cancelText: t('cancel'),
      danger: true,
    });
    if (!confirmed) return false;

    try {
      const res = await fetch(`/api/mcp/servers/${server.id}?spaceId=${encodeURIComponent(spaceId)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to remove MCP server');
      }
      await refresh();
      return true;
    } catch (error) {
      showToast('error', getErrorMessage(error, t('failedToRemoveMcpServer')));
      return false;
    }
  }, [confirm, refresh, showToast, spaceId]);

  const fetchServerTools = useCallback(async (serverId: string): Promise<{ name: string; description: string }[]> => {
    const res = await fetch(`/api/mcp/servers/${serverId}/tools?spaceId=${encodeURIComponent(spaceId)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error || 'Failed to fetch tools');
    }
    const data = await res.json() as { data: { tools: { name: string; description: string }[] } };
    return data.data.tools;
  }, [spaceId]);

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
