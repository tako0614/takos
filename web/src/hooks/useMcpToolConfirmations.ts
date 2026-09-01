import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import type { McpToolConfirmation } from "../types/index.ts";
import { getErrorMessage } from "../lib/errors.ts";
import { apiJson } from "../lib/rpc.ts";
import {
  parseMcpToolConfirmationDecisionResponse,
  parseMcpToolConfirmationsResponse,
} from "./mcp-tool-confirmation-response.ts";
import {
  browserSessionStorage,
  storeMcpConfirmationRunGrant,
} from "./mcp-confirmation-run-grants.ts";

const POLL_INTERVAL_MS = 2_000;

export function useMcpToolConfirmations(spaceId: Accessor<string | null>) {
  const [confirmations, setConfirmations] = createSignal<McpToolConfirmation[]>(
    [],
  );
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [decisionError, setDecisionError] = createSignal<
    {
      confirmationId: string;
      message: string;
    } | null
  >(null);
  const error = () => decisionError()?.message ?? loadError();
  const [truncated, setTruncated] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestGeneration = 0;
  let decisionGeneration = 0;

  const stopTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const refresh = async () => {
    const workspaceId = spaceId()?.trim() ?? "";
    if (!workspaceId) {
      setConfirmations([]);
      setLoadError(null);
      setDecisionError(null);
      setTruncated(false);
      return true;
    }
    const generation = ++requestGeneration;
    try {
      const body = await apiJson<unknown>(
        `/api/mcp/tool-confirmations?workspaceId=${
          encodeURIComponent(workspaceId)
        }`,
      );
      const parsed = parseMcpToolConfirmationsResponse(body);
      if (
        generation === requestGeneration &&
        workspaceId === spaceId()?.trim()
      ) {
        for (const confirmation of parsed.confirmations) {
          if (confirmation.status === "approved") {
            storeMcpConfirmationRunGrant(browserSessionStorage(), {
              confirmationGrantId: confirmation.id,
              workspaceId,
              threadId: confirmation.requested_thread_id,
              expiresAt: confirmation.expires_at,
            });
          }
        }
        const pending = parsed.confirmations.filter((confirmation) =>
          confirmation.status === "pending"
        );
        setConfirmations(pending);
        setTruncated(parsed.truncated);
        setLoadError(null);
        setDecisionError((current) =>
          current &&
            pending.some((confirmation) =>
              confirmation.id === current.confirmationId
            )
            ? current
            : null
        );
      }
      return true;
    } catch (cause) {
      if (
        generation === requestGeneration &&
        workspaceId === spaceId()?.trim()
      ) {
        setLoadError(
          getErrorMessage(cause, "Failed to load MCP confirmations"),
        );
      }
      return false;
    }
  };

  const schedule = () => {
    stopTimer();
    if (globalThis.document?.visibilityState === "hidden") return;
    timer = setTimeout(async () => {
      await refresh();
      schedule();
    }, POLL_INTERVAL_MS);
  };

  createEffect(
    on(spaceId, () => {
      requestGeneration += 1;
      decisionGeneration += 1;
      stopTimer();
      setBusyId(null);
      setDecisionError(null);
      void refresh().finally(schedule);
    }),
  );
  const handleVisibilityChange = () => {
    requestGeneration += 1;
    stopTimer();
    if (globalThis.document?.visibilityState !== "hidden") {
      void refresh().finally(schedule);
    }
  };
  globalThis.document?.addEventListener(
    "visibilitychange",
    handleVisibilityChange,
  );
  onCleanup(() => {
    requestGeneration += 1;
    stopTimer();
    globalThis.document?.removeEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
  });

  const decide = async (
    confirmationId: string,
    decision: "approve" | "deny",
  ) => {
    const workspaceId = spaceId()?.trim() ?? "";
    if (!workspaceId || busyId()) return;
    const confirmation = confirmations().find((item) =>
      item.id === confirmationId
    );
    if (!confirmation) return;
    const generation = ++decisionGeneration;
    setBusyId(confirmationId);
    setDecisionError(null);
    try {
      const body = await apiJson<unknown>(
        `/api/mcp/tool-confirmations/${
          encodeURIComponent(confirmationId)
        }/decision?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision }),
          },
        },
      );
      const grant = parseMcpToolConfirmationDecisionResponse(body, decision, {
        confirmationId,
        workspaceId,
        threadId: confirmation.requested_thread_id,
        expiresAt: confirmation.expires_at,
      });
      if (
        generation !== decisionGeneration ||
        workspaceId !== spaceId()?.trim()
      ) {
        return;
      }
      if (grant) {
        storeMcpConfirmationRunGrant(browserSessionStorage(), grant);
      }
      setConfirmations((current) =>
        current.filter((item) => item.id !== confirmationId)
      );
      await refresh();
    } catch (cause) {
      if (
        generation === decisionGeneration &&
        workspaceId === spaceId()?.trim()
      ) {
        setDecisionError({
          confirmationId,
          message: cause instanceof Error
            ? cause.message
            : "Failed to record MCP confirmation",
        });
      }
    } finally {
      if (generation === decisionGeneration) setBusyId(null);
    }
  };

  return { confirmations, busyId, error, truncated, refresh, decide };
}
