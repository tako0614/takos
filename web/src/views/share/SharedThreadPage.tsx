import { createEffect, createMemo, createSignal } from "solid-js";
import { rpc } from "../../lib/rpc.ts";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { Input } from "../../components/ui/Input.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { MessageBubble } from "../chat/MessageBubble.tsx";
import type { Message } from "../../types/index.ts";
import {
  DEFAULT_PUBLIC_THREAD_SHARE_PAGE_SIZE,
  MAX_THREAD_SHARE_PASSWORD_CHARACTERS,
} from "takos-api-contract/thread-share";
import {
  appendSharedThreadPage,
  parseSharedThreadError,
  parseSharedThreadPayload,
  type SharedThreadPayload,
} from "./shared-thread-response.ts";

function formatIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function SharedThreadPage(props: { token: string }) {
  const { t } = useI18n();
  const [loading, setLoading] = createSignal(true);
  const [requiresPassword, setRequiresPassword] = createSignal(false);
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [data, setData] = createSignal<SharedThreadPayload | null>(null);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [accessPassword, setAccessPassword] = createSignal<string | null>(null);
  let requestSequence = 0;

  const mappedMessages = createMemo((): Message[] => {
    const d = data();
    if (!d) return [];
    return d.messages.map((m): Message => ({
      id: m.id,
      thread_id: d.thread.id,
      role: m.role,
      content: m.content,
      metadata: "",
      created_at: m.created_at,
      sequence: m.sequence,
    }));
  });

  const responseErrorMessage = (status: number, value: unknown): string => {
    const parsed = parseSharedThreadError(value);
    if (status === 403 || parsed.invalidPassword) {
      return t("invalidSharePassword");
    }
    if (status === 429 || parsed.code === "RATE_LIMITED") {
      return t("sharePasswordRateLimited", {
        seconds: parsed.retryAfter ?? 60,
      });
    }
    return (
      parsed.message ||
      (status === 404 ? t("shareNotAvailable") : t("operationFailed"))
    );
  };

  const loadPage = async (
    token: string,
    offset: number,
    passwordForAccess: string | null,
    replace: boolean,
  ) => {
    const requestId = ++requestSequence;
    if (replace) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const res =
        passwordForAccess === null
          ? await rpc.public["thread-shares"][":token"].$get({
              param: { token },
              query: {
                limit: DEFAULT_PUBLIC_THREAD_SHARE_PAGE_SIZE,
                offset,
              },
            })
          : await rpc.public["thread-shares"][":token"].access.$post({
              param: { token },
              json: {
                password: passwordForAccess,
                limit: DEFAULT_PUBLIC_THREAD_SHARE_PAGE_SIZE,
                offset,
              },
            });
      const body = await res.json().catch(() => null);
      if (requestId !== requestSequence) return;
      if (res.status === 401) {
        const parsed = parseSharedThreadError(body);
        if (parsed.requiresPassword) {
          setRequiresPassword(true);
          if (replace) setData(null);
          return;
        }
        setError(responseErrorMessage(res.status, body));
        if (replace) setData(null);
        return;
      }
      if (!res.ok) {
        if (res.status === 403) setRequiresPassword(true);
        setError(responseErrorMessage(res.status, body));
        if (replace) setData(null);
        return;
      }
      const payload = parseSharedThreadPayload(body, {
        token,
        limit: DEFAULT_PUBLIC_THREAD_SHARE_PAGE_SIZE,
        offset,
      });
      if (replace) {
        setData(payload);
      } else {
        setData((current) =>
          current ? appendSharedThreadPage(current, payload) : payload,
        );
      }
      setRequiresPassword(false);
      if (passwordForAccess !== null) {
        setAccessPassword(passwordForAccess);
        setPassword("");
      }
    } catch (err) {
      if (requestId !== requestSequence) return;
      setError(err instanceof Error ? err.message : t("failedToLoadShares"));
      if (replace) setData(null);
    } finally {
      if (requestId === requestSequence) {
        if (replace) setLoading(false);
        else setLoadingMore(false);
      }
    }
  };

  const loadShare = async (token = props.token) => {
    await loadPage(token, 0, null, true);
  };

  const unlock = async () => {
    const pw = password();
    if (!pw.trim()) return;
    await loadPage(props.token, 0, pw, true);
  };

  createEffect(() => {
    const token = props.token;
    requestSequence += 1;
    setData(null);
    setError(null);
    setRequiresPassword(false);
    setAccessPassword(null);
    setPassword("");
    void loadShare(token);
  });

  const loadMore = async () => {
    const current = data();
    const nextOffset = current?.page.next_offset;
    if (!current || typeof nextOffset !== "number" || loadingMore()) return;
    await loadPage(
      props.token,
      nextOffset,
      current.share.mode === "password" ? accessPassword() : null,
      false,
    );
  };

  const renderContent = () => {
    if (loading() && !data() && !requiresPassword()) {
      return (
        <div class="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
          <Icons.Loader class="w-8 h-8 animate-spin text-zinc-500 dark:text-zinc-400" />
        </div>
      );
    }

    if (requiresPassword()) {
      return (
        <div class="min-h-screen bg-white dark:bg-zinc-900 flex items-center justify-center p-6">
          <div class="w-full max-w-md bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-6">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center">
                <Icons.Lock class="w-5 h-5 text-zinc-600 dark:text-zinc-200" />
              </div>
              <div class="min-w-0">
                <h1 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {t("passwordRequired")}
                </h1>
                <p class="text-sm text-zinc-600 dark:text-zinc-300">
                  {t("enterPasswordToView")}
                </p>
              </div>
            </div>

            <div class="mt-5 space-y-3">
              <Input
                type="password"
                name="shared-thread-password"
                autocomplete="current-password"
                aria-label={t("sharePasswordLabel")}
                maxlength={MAX_THREAD_SHARE_PASSWORD_CHARACTERS}
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                placeholder={t("sharePasswordLabel")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void unlock();
                }}
              />
              <Button
                variant="primary"
                onClick={unlock}
                disabled={loading() || !password().trim()}
                isLoading={loading()}
                class="w-full"
              >
                {t("unlock")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void loadShare()}
                disabled={loading()}
                class="w-full"
              >
                {t("refresh")}
              </Button>
            </div>

            {error() && (
              <div
                role="alert"
                class="mt-4 text-sm text-red-600 dark:text-red-400"
              >
                {error()}
              </div>
            )}
          </div>
        </div>
      );
    }

    const shareData = data();
    if (!shareData) {
      return (
        <div class="min-h-screen bg-white dark:bg-zinc-900 flex items-center justify-center p-6">
          <div class="text-center">
            <div class="mx-auto w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <Icons.AlertTriangle class="w-6 h-6 text-zinc-600 dark:text-zinc-300" />
            </div>
            <h1 class="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {t("notFound")}
            </h1>
            <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              {error() || t("shareNotAvailable")}
            </p>
            <div class="mt-4">
              <Button variant="secondary" onClick={() => void loadShare()}>
                {t("refresh")}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    const expiresAt = shareData.share.expires_at;
    return (
      <div class="min-h-screen bg-white dark:bg-zinc-900">
        <div class="border-b border-zinc-100 dark:border-zinc-800">
          <div class="max-w-4xl mx-auto px-4 py-5">
            <h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {shareData.thread.title || t("untitledThread")}
            </h1>
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{t("shareLabel", { mode: shareData.share.mode })}</span>
              {expiresAt && (
                <span>
                  {t("expiresDate", {
                    date: formatIso(expiresAt),
                  })}
                </span>
              )}
              <span>
                {t("updatedLabel", {
                  date: formatIso(shareData.thread.updated_at),
                })}
              </span>
            </div>
            {error() && (
              <div
                role="alert"
                class="mt-3 text-sm text-red-600 dark:text-red-400"
              >
                {error()}
              </div>
            )}
          </div>
        </div>

        <div class="max-w-4xl mx-auto">
          {shareData.page.message_data_truncated && (
            <div
              role="status"
              class="mx-4 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
            >
              {t("sharedMessageDataTruncated")}
            </div>
          )}
          {mappedMessages().length === 0 ? (
            <div class="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t("noMessages")}
            </div>
          ) : (
            mappedMessages().map((m) => <MessageBubble message={m} />)
          )}
          {shareData.page.has_more && (
            <div class="flex justify-center px-4 py-6">
              <Button
                variant="secondary"
                onClick={() => void loadMore()}
                disabled={
                  loadingMore() ||
                  (shareData.share.mode === "password" && !accessPassword())
                }
                isLoading={loadingMore()}
              >
                {t("loadMore")}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return <>{renderContent()}</>;
}
