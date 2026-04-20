import { type Accessor, createEffect, createSignal, on } from "solid-js";
import { getErrorMessage } from "takos-common/errors";
import { useI18n } from "../store/i18n.ts";
import { useToast } from "../store/toast.ts";
import type { CustomTool } from "../types/index.ts";

interface UseCustomToolsOptions {
  spaceId: Accessor<string>;
}

export function useCustomTools({ spaceId }: UseCustomToolsOptions) {
  const { showToast } = useToast();
  const { t } = useI18n();
  const currentSpaceId = () => spaceId().trim();
  const basePath = () => `/api/spaces/${currentSpaceId()}/tools`;

  const [tools, setTools] = createSignal<CustomTool[]>([]);
  const [loading, setLoading] = createSignal(true);

  const refresh = async () => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) {
      setTools([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(basePath());
      if (!res.ok) throw new Error("Failed to fetch tools");
      const data = await res.json() as { data?: CustomTool[] };
      setTools(data.data || []);
    } catch {
      setTools([]);
    } finally {
      setLoading(false);
    }
  };

  createEffect(
    on(spaceId, (nextSpaceId) => {
      if (nextSpaceId.trim()) {
        void refresh();
      } else {
        setTools([]);
        setLoading(false);
      }
    }),
  );

  const getTool = async (toolId: string): Promise<CustomTool | null> => {
    try {
      const res = await fetch(`${basePath()}/${toolId}`);
      if (!res.ok) throw new Error("Failed to fetch tool");
      const data = await res.json() as { data?: CustomTool };
      return data.data || null;
    } catch (error) {
      showToast("error", getErrorMessage(error, t("failedToLoadTool")));
      return null;
    }
  };

  return {
    tools,
    loading,
    refresh,
    getTool,
  };
}
