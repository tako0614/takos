import { For, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { Modal } from "../../components/ui/Modal.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { Icons } from "../../lib/Icons.tsx";
import type { ThreadShare } from "../../hooks/useChatSharing.ts";

export interface ChatShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  sharesLoading: boolean;
  shares: ThreadShare[];
  shareMode: "public" | "password";
  onShareModeChange: (v: "public" | "password") => void;
  sharePassword: string;
  onSharePasswordChange: (v: string) => void;
  shareExpiresInDays: string;
  onShareExpiresInDaysChange: (v: string) => void;
  shareError: string | null;
  creatingShare: boolean;
  onFetchShares: () => void;
  onCreateShare: () => void;
  onRevokeShare: (shareId: string) => void;
}

export function ChatShareModal(props: ChatShareModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t("shareResource")}
      size="lg"
    >
      <div class="space-y-5">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="space-y-1">
            <div class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {t("shareMode")}
            </div>
            <select
              value={props.shareMode}
              onInput={(e) =>
                props.onShareModeChange(
                  e.currentTarget.value === "password" ? "password" : "public",
                )}
              class="w-full min-h-[44px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
            >
              <option value="public">{t("sharePublic")}</option>
              <option value="password">{t("sharePasswordLabel")}</option>
            </select>
          </div>
          <div class="space-y-1">
            <div class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {t("shareExpiresDays")}
            </div>
            <Input
              value={props.shareExpiresInDays}
              onInput={(e: Event & { currentTarget: HTMLInputElement }) =>
                props.onShareExpiresInDaysChange(e.currentTarget.value)}
              placeholder="e.g. 7"
              inputmode="numeric"
            />
          </div>
          <div class="space-y-1">
            <div class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {t("sharePasswordLabel")}
            </div>
            <Input
              type="password"
              value={props.sharePassword}
              onInput={(e: Event & { currentTarget: HTMLInputElement }) =>
                props.onSharePasswordChange(e.currentTarget.value)}
              placeholder={props.shareMode === "password"
                ? "min 8 chars"
                : "(optional)"}
              disabled={props.shareMode !== "password"}
            />
          </div>
        </div>

        <Show when={props.shareError}>
          <div class="text-sm text-red-600 dark:text-red-400">
            {props.shareError}
          </div>
        </Show>

        <div class="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            onClick={props.onFetchShares}
            disabled={props.sharesLoading}
            leftIcon={
              <Icons.Refresh
                class={"w-4 h-4 " + (props.sharesLoading ? "animate-spin" : "")}
              />
            }
          >
            {t("refresh")}
          </Button>
          <Button
            variant="primary"
            onClick={props.onCreateShare}
            disabled={props.creatingShare ||
              (props.shareMode === "password" &&
                props.sharePassword.trim().length < 8)}
            isLoading={props.creatingShare}
            leftIcon={<Icons.Link class="w-4 h-4" />}
          >
            {t("create")}
          </Button>
        </div>

        <div class="border-t border-zinc-200 dark:border-zinc-700 pt-4">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("shareLinks")}
            </h3>
            <Show when={props.sharesLoading}>
              <span class="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                <Icons.Loader class="w-4 h-4 animate-spin" />
                {t("loading")}
              </span>
            </Show>
          </div>

          <Show
            when={props.shares.length > 0}
            fallback={
              <Show when={!props.sharesLoading}>
                <div class="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                  {t("noShareLinks")}
                </div>
              </Show>
            }
          >
            <div class="mt-3 space-y-2">
              <For each={props.shares}>
                {(s) => (
                  <div class="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {s.share_url}
                        </span>
                        <span class="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                          {s.mode}
                        </span>
                        <Show when={s.revoked_at}>
                          <span class="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                            {t("revoked") || "Revoked"}
                          </span>
                        </Show>
                      </div>
                      <div class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {s.expires_at
                          ? t("shareExpiresAt", { date: s.expires_at })
                          : t("shareNoExpiry")}
                        {s.last_accessed_at
                          ? ` \u00B7 ${
                            t("shareLastAccessed", { date: s.last_accessed_at })
                          }`
                          : ""}
                      </div>
                    </div>
                    <div class="flex items-center gap-1">
                      <button
                        type="button"
                        class="min-w-[44px] min-h-[44px] px-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center justify-center"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(s.share_url);
                            showToast("success", t("copied") || "Copied");
                          } catch {
                            showToast("error", t("failedToCopy"));
                          }
                        }}
                        disabled={!!s.revoked_at}
                        title={t("copy")}
                      >
                        <Icons.Copy class="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        class="min-w-[44px] min-h-[44px] px-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-red-700 dark:hover:text-red-300 flex items-center justify-center"
                        onClick={() => props.onRevokeShare(s.id)}
                        disabled={!!s.revoked_at}
                        title={t("revoke") || "Revoke"}
                      >
                        <Icons.Trash class="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </Modal>
  );
}
