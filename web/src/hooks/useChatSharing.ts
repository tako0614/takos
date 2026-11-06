import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { useI18n } from "../store/i18n.ts";
import { useToast } from "../store/toast.ts";

export type ThreadShare = {
  id: string;
  thread_id: string;
  space_id: string;
  created_by: string | null;
  token: string;
  mode: "public" | "password";
  expires_at: string | null;
  revoked_at: string | null;
  last_accessed_at: string | null;
  created_at: string;
  share_path: string;
  share_url: string;
};

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
  fetchShares: () => Promise<void>;
  createShare: () => Promise<void>;
  revokeShare: (shareId: string) => Promise<void>;
  downloadExport: (format: "markdown" | "json" | "pdf") => Promise<void>;
}

function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(value);
  return plain?.[1] || null;
}

export function useChatSharing(
  threadId: Accessor<string>,
): UseChatSharingReturn {
  const { t } = useI18n();
  const { showToast } = useToast();

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
  const [creatingShare, setCreatingShare] = createSignal(false);
  let contextSequence = 0;
  let listSequence = 0;
  let retired = false;

  // A→B→A and closing/reopening the dialog create new contexts even when the
  // thread id matches again. Old server operations may finish, but their UI
  // continuations cannot act on the new context.
  const captureContext = () => {
    const sequence = contextSequence;
    const id = threadId();
    return {
      id,
      isCurrent: () => !retired && sequence === contextSequence &&
        id === threadId() && showShareModal(),
    };
  };
  onCleanup(() => {
    retired = true;
    contextSequence++;
  });

  const resetShareState = () => {
    setShares([]);
    setSharesLoading(false);
    setShareError(null);
    setShareMode("public");
    setSharePassword("");
    setShareExpiresInDays("");
    setCreatingShare(false);
  };

  const fetchShares = async () => {
    const context = captureContext();
    if (!context.isCurrent()) return;
    const request = ++listSequence;
    const isCurrent = () => context.isCurrent() && request === listSequence;
    setSharesLoading(true);
    setShareError(null);
    try {
      const res = await rpc.threads[":id"].shares.$get({
        param: { id: context.id },
      });
      if (!isCurrent()) return;
      const data = await rpcJson<{ shares: ThreadShare[] }>(res, { isCurrent });
      if (!isCurrent()) return;
      setShares(data.shares || []);
    } catch (err) {
      if (!isCurrent()) return;
      setShareError(
        err instanceof Error ? err.message : t("failedToLoadShares"),
      );
    } finally {
      if (isCurrent()) {
        setSharesLoading(false);
      }
    }
  };

  createEffect(() => {
    threadId();
    const open = showShareModal();
    contextSequence++;
    resetShareState();
    if (open) {
      void fetchShares();
    }
  });

  const createShare = async () => {
    const context = captureContext();
    if (!context.isCurrent() || creatingShare()) return;
    const mode = shareMode();
    const password = sharePassword();
    const expiry = shareExpiresInDays();
    setCreatingShare(true);
    setShareError(null);
    try {
      const expiresStr = expiry.trim();
      const expires_in_days = expiresStr
        ? Number.parseInt(expiresStr, 10)
        : undefined;
      const res = await rpc.threads[":id"].share.$post({
        param: { id: context.id },
        json: {
          mode,
          password: mode === "password" ? password : undefined,
          expires_in_days: typeof expires_in_days === "number" &&
              Number.isFinite(expires_in_days)
            ? expires_in_days
            : undefined,
        },
      });
      if (!context.isCurrent()) return;
      const data = await rpcJson<{ share: ThreadShare; share_url: string }>(
        res,
        { isCurrent: context.isCurrent },
      );
      if (!context.isCurrent()) return;
      showToast("success", t("created"));
      if (data.share_url) {
        try {
          await navigator.clipboard.writeText(data.share_url);
          if (!context.isCurrent()) return;
          showToast("success", t("copied"));
        } catch { /* ignored */ }
      }
      if (!context.isCurrent()) return;
      if (sharePassword() === password) setSharePassword("");
      if (shareExpiresInDays() === expiry) setShareExpiresInDays("");
      await fetchShares();
    } catch (err) {
      if (!context.isCurrent()) return;
      setShareError(
        err instanceof Error ? err.message : t("failedToCreateShare"),
      );
    } finally {
      if (context.isCurrent()) setCreatingShare(false);
    }
  };

  const revokeShare = async (shareId: string) => {
    const context = captureContext();
    if (!context.isCurrent()) return;
    try {
      const res = await rpc.threads[":id"].shares[":shareId"].revoke.$post({
        param: { id: context.id, shareId },
      });
      if (!context.isCurrent()) return;
      await rpcJson(res, { isCurrent: context.isCurrent });
      if (!context.isCurrent()) return;
      showToast("success", t("revoked"));
      await fetchShares();
    } catch (err) {
      if (!context.isCurrent()) return;
      showToast(
        "error",
        err instanceof Error ? err.message : t("failedToRevoke"),
      );
    }
  };

  const downloadExport = async (format: "markdown" | "json" | "pdf") => {
    try {
      const currentThreadId = threadId();
      const res = await rpc.threads[":id"].export.$get({
        param: { id: currentThreadId },
        query: { format },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || t("exportFailed"));
      }
      const filename = parseContentDispositionFilename(
        res.headers.get("Content-Disposition"),
      ) ||
        `thread-${currentThreadId}.${format === "markdown" ? "md" : format}`;
      const blob = await res.blob();
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
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : t("exportFailed"),
      );
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
    fetchShares,
    createShare,
    revokeShare,
    downloadExport,
  };
}
