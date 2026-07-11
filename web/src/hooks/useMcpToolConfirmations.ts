import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import type { McpToolConfirmation } from "../types/index.ts";
import { getErrorMessage } from "../lib/errors.ts";

const POLL_INTERVAL_MS = 2_000;

export function useMcpToolConfirmations(spaceId: Accessor<string | null>) {
  const [confirmations, setConfirmations] = createSignal<McpToolConfirmation[]>(
    [],
  );
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestGeneration = 0;

  const stopTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const refresh = async () => {
    const workspaceId = spaceId()?.trim() ?? "";
    if (!workspaceId) {
      setConfirmations([]);
      setError(null);
      return;
    }
    const generation = ++requestGeneration;
    const response = await fetch(
      `/api/mcp/tool-confirmations?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    if (!response.ok) return;
    const body = (await response.json()) as {
      data?: McpToolConfirmation[];
    };
    if (generation === requestGeneration && workspaceId === spaceId()?.trim()) {
      setConfirmations(body.data ?? []);
    }
  };

  const schedule = () => {
    stopTimer();
    timer = setTimeout(async () => {
      await refresh().catch(() => undefined);
      schedule();
    }, POLL_INTERVAL_MS);
  };

  createEffect(
    on(spaceId, () => {
      requestGeneration += 1;
      stopTimer();
      void refresh().finally(schedule);
    }),
  );
  onCleanup(() => {
    requestGeneration += 1;
    stopTimer();
  });

  const decide = async (
    confirmationId: string,
    decision: "approve" | "deny",
  ) => {
    const workspaceId = spaceId()?.trim() ?? "";
    if (!workspaceId || busyId()) return;
    setBusyId(confirmationId);
    setError(null);
    try {
      const response = await fetch(
        `/api/mcp/tool-confirmations/${encodeURIComponent(confirmationId)}/decision?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: unknown;
        };
        throw new Error(
          getErrorMessage(body.error, "Failed to record MCP confirmation"),
        );
      }
      setConfirmations((current) =>
        current.filter((item) => item.id !== confirmationId),
      );
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to record MCP confirmation",
      );
    } finally {
      setBusyId(null);
    }
  };

  return { confirmations, busyId, error, refresh, decide };
}
