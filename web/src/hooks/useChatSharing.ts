import { type Accessor, createEffect, createSignal, on } from "solid-js";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { createLatestRequest } from "../lib/createLatestRequest.ts";
import { useI18n } from "../store/i18n.ts";
import { useToast } from "../store/toast.ts";
import { useConfirmDialog } from "../store/confirm-dialog.ts";
import {
  MAX_THREAD_SHARE_PASSWORD_BYTES,
  MAX_THREAD_SHARE_PASSWORD_CHARACTERS,
  MIN_THREAD_SHARE_PASSWORD_CHARACTERS,
} from "takos-api-contract/thread-share";
import type { ThreadExportDownloadFormat } from "takos-api-contract/thread-export";
import { withTimeout } from "../lib/withTimeout.ts";
import {
  parseContentDispositionFilename,
  readBoundedThreadExportBlob,
} from "../views/chat/thread-export-response.ts";
import {
  parseThreadShareCreateResponse,
  parseThreadShareRevokeResponse,
  parseThreadSharesResponse,
  type ThreadShare,
} from "../views/chat/thread-share-response.ts";

export type { ThreadShare } from "../views/chat/thread-share-response.ts";

const utf8Encoder = new TextEncoder();

export interface UseChatSharingReturn {
  showShareModal: Accessor<boolean>;
  setShowShareModal: (v: boolean) => void;
  showExportModal: Accessor<boolean>;
  setShowExportModal: (v: boolean) => void;
  sharesLoading: Accessor<boolean>;
  shares: Accessor<ThreadShare[]>;
  shareMode: Accessor<"public" | "password">;
  setShareMode: (v: "public" | "password") => void;
  sharePassword: Accessor<string>;
  setSharePassword: (v: string) => void;
  shareExpiresInDays: Accessor<string>;
  setShareExpiresInDays: (v: string) => void;
  shareError: Accessor<string | null>;
  creatingShare: Accessor<boolean>;
  revokingShareId: Accessor<string | null>;
  exportingFormat: Accessor<ThreadExportDownloadFormat | null>;
  fetchShares: () => Promise<void>;
  createShare: () => Promise<void>;
  revokeShare: (shareId: string) => Promise<void>;
  downloadExport: (format: ThreadExportDownloadFormat) => Promise<void>;
}

export function useChatSharing(
  threadId: Accessor<string>,
  spaceRecordId: Accessor<string>,
): UseChatSharingReturn {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [showShareModal, setShowShareModal] = createSignal(false);
  const [showExportModal, setShowExportModal] = createSignal(false);
  const [sharesLoading, setSharesLoading] = createSignal(false);
  const [shares, setShares] = createSignal<ThreadShare[]>([]);
  const [shareMode, setShareMode] = createSignal<"public" | "password">(
    "public",
  );
  const [sharePassword, setSharePassword] = createSignal("");
  const [shareExpiresInDays, setShareExpiresInDays] = createSignal<string>("");
  const [shareError, setShareError] = createSignal<string | null>(null);
  const [shareMutation, setShareMutation] = createSignal<
    | { kind: "create"; generation: number }
    | { kind: "revoke"; generation: number; shareId: string }
    | null
  >(null);
  const creatingShare = () => shareMutation()?.kind === "create";
  const revokingShareId = () => {
    const operation = shareMutation();
    return operation?.kind === "revoke" ? operation.shareId : null;
  };
  const [exportingFormat, setExportingFormat] =
    createSignal<ThreadExportDownloadFormat | null>(null);
  const latestShares = createLatestRequest();
  let mutationGeneration = 0;
  let exportController: AbortController | null = null;

  const currentOrigin = () => globalThis.location?.origin ?? "http://localhost";
  const isCurrentTarget = (targetThreadId: string, targetSpaceId: string) =>
    threadId() === targetThreadId && spaceRecordId() === targetSpaceId;
  const isCurrentMutation = (
    generation: number,
    targetThreadId: string,
    targetSpaceId: string,
  ) => generation === mutationGeneration &&
    isCurrentTarget(targetThreadId, targetSpaceId);

  const resetShareDraft = () => {
    setShares([]);
    setShareError(null);
    setShareMode("public");
    setSharePassword("");
    setShareExpiresInDays("");
    setSharesLoading(false);
  };

  const fetchShares = async () => {
    const targetThreadId = threadId();
    const targetSpaceId = spaceRecordId();
    if (!targetThreadId || !targetSpaceId) {
      latestShares.next();
      setShares([]);
      setShareError(null);
      setSharesLoading(false);
      return;
    }
    const claim = latestShares.claim(() =>
      isCurrentTarget(targetThreadId, targetSpaceId)
    );
    setSharesLoading(true);
    setShareError(null);
    try {
      const res = await rpc.threads[":id"].shares.$get({
        param: { id: targetThreadId },
      });
      const nextShares = parseThreadSharesResponse(
        await rpcJson<unknown>(res),
        {
          threadId: targetThreadId,
          spaceId: targetSpaceId,
          origin: currentOrigin(),
        },
      );
      if (!claim.won()) return;
      setShares(nextShares);
    } catch (err) {
      if (!claim.won()) return;
      setShareError(
        err instanceof Error ? err.message : t("failedToLoadShares"),
      );
    } finally {
      if (claim.won()) setSharesLoading(false);
    }
  };

  createEffect(
    on(
      () => [threadId(), spaceRecordId()] as const,
      () => {
        latestShares.next();
        mutationGeneration += 1;
        setShareMutation(null);
        resetShareDraft();
        if (showShareModal()) void fetchShares();
      },
    ),
  );

  createEffect(
    on(showShareModal, (isOpen) => {
      latestShares.next();
      setShares([]);
      setShareError(null);
      setSharesLoading(false);
      if (isOpen) void fetchShares();
    }),
  );

  createEffect(
    on(
      () => [threadId(), spaceRecordId()] as const,
      () => {
        exportController?.abort();
        exportController = null;
        setExportingFormat(null);
      },
    ),
  );

  const createShare = async () => {
    if (shareMutation()) return;
    const targetThreadId = threadId();
    const targetSpaceId = spaceRecordId();
    if (!targetThreadId || !targetSpaceId) return;
    const expiresStr = shareExpiresInDays().trim();
    if (expiresStr && !/^[0-9]{1,3}$/u.test(expiresStr)) {
      setShareError(t("shareExpiryDaysInvalid"));
      return;
    }
    const expires_in_days = expiresStr ? Number(expiresStr) : undefined;
    if (
      expires_in_days !== undefined &&
      (!Number.isSafeInteger(expires_in_days) ||
        expires_in_days < 1 ||
        expires_in_days > 365)
    ) {
      setShareError(t("shareExpiryDaysInvalid"));
      return;
    }
    const mode = shareMode();
    const password = sharePassword();
    if (
      mode === "password" &&
      (password.trim().length < MIN_THREAD_SHARE_PASSWORD_CHARACTERS ||
        password.length > MAX_THREAD_SHARE_PASSWORD_CHARACTERS ||
        utf8Encoder.encode(password).byteLength >
          MAX_THREAD_SHARE_PASSWORD_BYTES)
    ) {
      setShareError(t("sharePasswordRequirements"));
      return;
    }
    const generation = ++mutationGeneration;
    setShareMutation({ kind: "create", generation });
    setShareError(null);
    try {
      const res = await rpc.threads[":id"].share.$post({
        param: { id: targetThreadId },
        json: {
          mode,
          password: mode === "password" ? password : undefined,
          expires_in_days,
        },
      });
      const share = parseThreadShareCreateResponse(
        await rpcJson<unknown>(res),
        {
          threadId: targetThreadId,
          spaceId: targetSpaceId,
          origin: currentOrigin(),
        },
      );
      if (!isCurrentMutation(generation, targetThreadId, targetSpaceId)) return;
      showToast("success", t("created"));
      try {
        await navigator.clipboard.writeText(share.share_url);
        if (isCurrentMutation(generation, targetThreadId, targetSpaceId)) {
          showToast("success", t("copied"));
        }
      } catch {
        /* Clipboard availability does not change the accepted share. */
      }
      if (!isCurrentMutation(generation, targetThreadId, targetSpaceId)) return;
      setSharePassword("");
      setShareExpiresInDays("");
      if (showShareModal()) await fetchShares();
    } catch (err) {
      if (!isCurrentMutation(generation, targetThreadId, targetSpaceId)) return;
      setShareError(
        err instanceof Error ? err.message : t("failedToCreateShare"),
      );
    } finally {
      if (generation === mutationGeneration) setShareMutation(null);
    }
  };

  const revokeShare = async (shareId: string) => {
    if (shareMutation()) return;
    const targetThreadId = threadId();
    const targetSpaceId = spaceRecordId();
    if (
      !targetThreadId || !targetSpaceId ||
      !shares().some((share) => share.id === shareId && !share.revoked_at)
    ) return;
    const confirmed = await confirm({
      title: t("revoke"),
      message: t("confirmRevokeShare"),
      confirmText: t("revoke"),
      danger: true,
    });
    if (
      !confirmed || shareMutation() ||
      !isCurrentTarget(targetThreadId, targetSpaceId) ||
      !shares().some((share) => share.id === shareId && !share.revoked_at)
    ) return;
    const generation = ++mutationGeneration;
    setShareMutation({ kind: "revoke", generation, shareId });
    setShareError(null);
    try {
      const res = await rpc.threads[":id"].shares[":shareId"].revoke.$post({
        param: { id: targetThreadId, shareId },
      });
      parseThreadShareRevokeResponse(await rpcJson<unknown>(res));
      if (!isCurrentMutation(generation, targetThreadId, targetSpaceId)) return;
      showToast("success", t("revoked"));
      if (showShareModal()) await fetchShares();
    } catch (err) {
      if (isCurrentMutation(generation, targetThreadId, targetSpaceId)) {
        setShareError(
          err instanceof Error ? err.message : t("failedToRevoke"),
        );
      }
    } finally {
      if (generation === mutationGeneration) setShareMutation(null);
    }
  };

  const downloadExport = async (format: ThreadExportDownloadFormat) => {
    if (exportingFormat() !== null) return;
    const controller = new AbortController();
    exportController = controller;
    setExportingFormat(format);
    try {
      const currentThreadId = threadId();
      const res = await withTimeout(
        (timeoutSignal) =>
          fetch(
            `/api/threads/${encodeURIComponent(currentThreadId)}/export?format=${encodeURIComponent(format)}`,
            {
              method: "GET",
              headers: { Accept: "application/octet-stream" },
              signal: AbortSignal.any([controller.signal, timeoutSignal]),
            },
          ),
        30_000,
        t("requestTimedOut"),
      );
      if (!res.ok) {
        if (res.status === 413) {
          throw new Error(t("threadExportRequiresAssistance"));
        }
        if (res.status === 503) {
          throw new Error(t("threadExportUnavailable"));
        }
        await rpcJson<never>(res);
        throw new Error(t("exportFailed"));
      }
      const filename =
        parseContentDispositionFilename(
          res.headers.get("Content-Disposition"),
        ) ||
        (/^[A-Za-z0-9_-]{1,256}$/u.test(currentThreadId)
          ? `thread-${currentThreadId}.${format === "markdown" ? "md" : format}`
          : `thread-export.${format === "markdown" ? "md" : format}`);
      const blob = await readBoundedThreadExportBlob(res, format);
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      showToast("success", t("download"));
      setShowExportModal(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      showToast(
        "error",
        err instanceof Error ? err.message : t("exportFailed"),
      );
    } finally {
      if (exportController === controller) {
        exportController = null;
        setExportingFormat(null);
      }
    }
  };

  return {
    showShareModal,
    setShowShareModal,
    showExportModal,
    setShowExportModal,
    sharesLoading,
    shares,
    shareMode,
    setShareMode,
    sharePassword,
    setSharePassword,
    shareExpiresInDays,
    setShareExpiresInDays,
    shareError,
    creatingShare,
    revokingShareId,
    exportingFormat,
    fetchShares,
    createShare,
    revokeShare,
    downloadExport,
  };
}
