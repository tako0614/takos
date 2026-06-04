import { type Accessor, createEffect, createSignal, on } from "solid-js";
import { getErrorMessage } from "@takos/worker-platform-utils/errors";
import { useI18n } from "../store/i18n.ts";
import { useToast } from "../store/toast.ts";
import { createLatestRequest } from "../lib/createLatestRequest.ts";
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
  const latestRefresh = createLatestRequest();

  const refresh = async () => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) {
      latestRefresh.next();
      setTools([]);
      setLoading(false);
      return;
    }

    const claim = latestRefresh.claim(() => targetSpaceId === currentSpaceId());
    setLoading(true);
    try {
      const res = await fetch(`/api/spaces/${targetSpaceId}/tools`);
      if (!res.ok) throw new Error(t("failedToFetchTools"));
      const data = await res.json() as { data?: CustomTool[] };
      if (!claim.won()) return;
      setTools(data.data || []);
    } catch {
      if (!claim.won()) return;
      setTools([]);
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
        setTools([]);
        setLoading(false);
      }
    }),
  );

  const getTool = async (toolId: string): Promise<CustomTool | null> => {
    try {
      const res = await fetch(`${basePath()}/${toolId}`);
      if (!res.ok) throw new Error(t("failedToLoadTool"));
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
