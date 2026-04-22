import { createEffect, createMemo, createSignal } from "solid-js";
import { rpc } from "../../lib/rpc.ts";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { Input } from "../../components/ui/Input.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { MessageBubble } from "../chat/MessageBubble.tsx";
import type { Message } from "../../types/index.ts";

type SharedThreadPayload = {
  token: string;
  share: {
    mode: "public" | "password";
    expires_at: string | null;
    created_at: string;
  };
  thread: {
    id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
  };
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    sequence: number;
    created_at: string;
  }>;
};

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
      sequence: 0,
    }));
  });

  const loadShare = async () => {
    setLoading(true);
    setError(null);
    setRequiresPassword(false);
    try {
      const res = await rpc.public["thread-shares"][":token"].$get({
        param: { token: props.token },
      });
      if (res.status === 401) {
        const body = await res.json().catch(() => ({})) as {
          requires_password?: boolean;
          error?: string;
        };
        if (body.requires_password) {
          setRequiresPassword(true);
          setData(null);
          return;
        }
        setError(body.error || t("operationFailed"));
        setData(null);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error || t("notFound"));
        setData(null);
        return;
      }
      const payload = await res.json() as SharedThreadPayload;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToLoadShares"));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const unlock = async () => {
    const pw = password();
    if (!pw.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await rpc.public["thread-shares"][":token"].access.$post({
        param: { token: props.token },
        json: { password: pw },
      });
      if (res.status === 401) {
        setRequiresPassword(true);
        setError(null);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error || t("operationFailed"));
        return;
      }
      const payload = await res.json() as SharedThreadPayload;
      setData(payload);
      setRequiresPassword(false);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("operationFailed"));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    loadShare();
  });

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
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                placeholder={t("password")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") unlock();
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
                onClick={loadShare}
                disabled={loading()}
                class="w-full"
              >
                {t("refresh")}
              </Button>
            </div>

            {error() && (
              <div class="mt-4 text-sm text-red-600 dark:text-red-400">
                {error()}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (!data()) {
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
              <Button variant="secondary" onClick={loadShare}>
                {t("refresh")}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div class="min-h-screen bg-white dark:bg-zinc-900">
        <div class="border-b border-zinc-100 dark:border-zinc-800">
          <div class="max-w-4xl mx-auto px-4 py-5">
            <h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {data()!.thread.title || t("untitledThread")}
            </h1>
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{t("shareLabel", { mode: data()!.share.mode })}</span>
              {data()!.share.expires_at && (
                <span>
                  {t("expiresDate", {
                    date: formatIso(data()!.share.expires_at!),
                  })}
                </span>
              )}
              <span>
                {t("updatedLabel", {
                  date: formatIso(data()!.thread.updated_at),
                })}
              </span>
            </div>
            {error() && (
              <div class="mt-3 text-sm text-red-600 dark:text-red-400">
                {error()}
              </div>
            )}
          </div>
        </div>

        <div class="max-w-4xl mx-auto">
          {mappedMessages().length === 0
            ? (
              <div class="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
                {t("noMessages")}
              </div>
            )
            : (
              mappedMessages().map((m) => (
                <MessageBubble
                  message={m}
                />
              ))
            )}
        </div>
      </div>
    );
  };

  return <>{renderContent()}</>;
}
