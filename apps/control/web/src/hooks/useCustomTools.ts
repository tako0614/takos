import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../store/toast';
import { useI18n } from '../store/i18n';
import { getErrorMessage } from '@takos/common/errors';
import { useConfirmDialog } from '../store/confirm-dialog';
import type { CustomTool } from '../types';

interface UseCustomToolsOptions {
  spaceId: string;
}

interface CreateToolInput {
  name: string;
  description: string;
  inputSchema: object;
  workerId: string;
}

interface UpdateToolInput {
  description?: string;
  inputSchema?: object;
  enabled?: boolean;
}

export function useCustomTools({ spaceId }: UseCustomToolsOptions) {
  const { showToast } = useToast();
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();

  const [tools, setTools] = useState<CustomTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTool, setSelectedTool] = useState<CustomTool | null>(null);

  const basePath = `/api/spaces/${spaceId}/tools`;

  const refresh = useCallback(async () => {
    if (!spaceId) return;

    setLoading(true);
    try {
      const res = await fetch(basePath);
      if (!res.ok) throw new Error('Failed to fetch tools');
      const data = await res.json();
      setTools(data.data || []);
    } catch {
      setTools([]);
    } finally {
      setLoading(false);
    }
  }, [spaceId, basePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const getTool = useCallback(async (toolId: string): Promise<CustomTool | null> => {
    try {
      const res = await fetch(`${basePath}/${toolId}`);
      if (!res.ok) throw new Error('Failed to fetch tool');
      const data = await res.json();
      return data.data as CustomTool;
    } catch {
      showToast('error', t('failedToLoadTool'));
      return null;
    }
  }, [basePath, showToast]);

  const createTool = useCallback(async (input: CreateToolInput) => {
    try {
      const res = await fetch(basePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: input.name,
          description: input.description,
          input_schema: input.inputSchema,
          type: 'worker',
          worker_id: input.workerId,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create tool');
      }

      const data = await res.json();
      showToast('success', t('toolCreated'));
      await refresh();
      return data.data;
    } catch (error) {
      showToast('error', getErrorMessage(error, t('failedToCreateTool')));
      throw error;
    }
  }, [basePath, refresh, showToast]);

  const updateTool = useCallback(async (toolId: string, input: UpdateToolInput): Promise<boolean> => {
    try {
      const res = await fetch(`${basePath}/${toolId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: input.description,
          input_schema: input.inputSchema,
          enabled: input.enabled,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update tool');
      }

      showToast('success', t('toolUpdated'));
      await refresh();
      return true;
    } catch (error) {
      showToast('error', getErrorMessage(error, t('failedToUpdateTool')));
      return false;
    }
  }, [basePath, refresh, showToast]);

  const deleteTool = useCallback(async (toolId: string, name: string): Promise<boolean> => {
    const confirmed = await confirm({
      title: t('deleteToolTitle'),
      message: t('deleteToolConfirm', { name }),
      confirmText: t('delete'),
      cancelText: t('cancel'),
      danger: true,
    });

    if (!confirmed) return false;

    try {
      const res = await fetch(`${basePath}/${toolId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete tool');

      showToast('success', t('toolDeleted'));
      setSelectedTool(null);
      await refresh();
      return true;
    } catch {
      showToast('error', t('failedToDeleteTool'));
      return false;
    }
  }, [basePath, confirm, refresh, showToast]);

  const toggleTool = useCallback(async (toolId: string, enabled: boolean): Promise<boolean> => {
    try {
      const res = await fetch(`${basePath}/${toolId}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle tool');

      await refresh();
      return true;
    } catch {
      showToast('error', t('failedToToggleTool'));
      return false;
    }
  }, [basePath, refresh, showToast]);

  const executeTool = useCallback(async (toolName: string, input: unknown) => {
    try {
      const res = await fetch(`${basePath}/${toolName}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Execution failed');

      return data.data.result;
    } catch (error) {
      showToast('error', getErrorMessage(error, 'Execution failed'));
      throw error;
    }
  }, [basePath, showToast]);

  return {
    tools,
    loading,
    selectedTool,
    setSelectedTool,
    refresh,
    getTool,
    createTool,
    updateTool,
    deleteTool,
    toggleTool,
    executeTool,
  };
}
