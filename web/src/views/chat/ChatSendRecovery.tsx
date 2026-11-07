import { createEffect, For, on, onCleanup, Show } from "solid-js";
import type { ChatSendRecovery as Recovery } from "../../hooks/useChatMessages.ts";
import { useI18n } from "../../store/i18n.ts";
import { useConfirmDialog } from "../../store/confirm-dialog.ts";
import { createLatestRequest } from "../../lib/createLatestRequest.ts";

interface Props {
  recovery: Recovery | null;
  busy: boolean;
  canRestore: boolean;
  onRetry: (expected: Recovery, confirmedNew?: boolean) => Promise<void>;
  onCheck: (expected: Recovery) => Promise<void>;
  onRestore: (expected: Recovery) => void;
  onDismiss: (expected: Recovery, confirmed?: boolean) => void;
}

export function ChatSendRecovery(props: Props) {
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const intents = createLatestRequest();
  createEffect(on([() => props.recovery, () => props.busy], () => { intents.next(); }));
  onCleanup(() => { intents.next(); });
  const busy = () => props.busy || props.recovery?.pending === true;
  const dismiss = async (expected: Recovery) => {
    const claim = intents.claim(() => props.recovery === expected);
    const uncertain = ["unsent", "message-unknown", "reply-unknown"].includes(expected.kind);
    if (!uncertain || await confirm({ title: t("writeNewMessage"), message: t("dismissSendRecoveryWarning"),
      confirmText: t("writeNewMessage"), cancelText: t("cancel") })) {
      if (claim.won()) props.onDismiss(expected, uncertain);
    }
  };
  const confirmNew = async (expected: Recovery, restore: boolean) => {
    const claim = intents.claim(() => props.recovery === expected);
    if (await confirm({ title: t(restore ? "restoreAsNewMessage" : "startAnotherReply"),
      message: t(restore ? "messageNewAttemptWarning" : "replyNewAttemptWarning"),
      confirmText: t(restore ? "restoreAsNewMessage" : "startAnotherReply"), cancelText: t("cancel") })) {
      if (!claim.won()) return;
      if (restore) props.onRestore(expected);
      else await props.onRetry(expected, true);
    }
  };
  const button = "rounded-lg border border-zinc-300 dark:border-zinc-600 px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed";
  return <Show when={props.recovery}>{(receipt) => <div role="status" class="mx-4 mb-2 p-3 rounded-lg border border-amber-300 dark:border-amber-800 text-zinc-800 dark:text-zinc-200">
    <p class="text-sm">{t(receipt().pending ? "sendAttemptPending" : receipt().kind === "reply-rejected" ? "messageSavedReplyRejected"
      : receipt().kind === "reply-known" ? "replyCreatedReconnect"
      : receipt().kind === "reply-unknown" ? "replyStatusUnknown"
      : receipt().kind === "message-unknown" ? "messageSaveUnknown" : "unsentDraftAvailable")}</p>
    <Show when={receipt().kind === "unsent" || receipt().kind === "message-unknown"}>
      <p class="mt-1 text-sm whitespace-pre-wrap break-words max-h-28 overflow-auto">{receipt().text}</p>
      <For each={receipt().files}>{(file) => <p class="text-xs break-all">{file.name}</p>}</For>
    </Show>
    <div class="mt-2 flex flex-wrap gap-2">
      <Show when={receipt().kind === "reply-rejected" || receipt().kind === "reply-known"}>
        <button type="button" class={button} disabled={busy()} aria-label={t(receipt().kind === "reply-known" ? "reconnectReply" : "retryReply")}
          onClick={() => void props.onRetry(receipt())}>{t(receipt().kind === "reply-known" ? "reconnectReply" : "retryReply")}</button>
      </Show>
      <Show when={receipt().kind !== "unsent"}>
        <button type="button" class={button} disabled={busy()} onClick={() => void props.onCheck(receipt())}>{t("checkReplyStatus")}</button>
      </Show>
      <Show when={receipt().kind === "reply-unknown" && receipt().checked}>
        <button type="button" class={button} disabled={busy()} onClick={() => void confirmNew(receipt(), false)}>{t("startAnotherReply")}</button>
      </Show>
      <Show when={receipt().kind === "unsent" || receipt().kind === "message-unknown"}>
        <button type="button" class={button} disabled={busy() || !props.canRestore}
          onClick={() => receipt().kind === "unsent" ? props.onRestore(receipt()) : void confirmNew(receipt(), true)}>{t(receipt().kind === "unsent" ? "restoreDraft" : "restoreAsNewMessage")}</button>
      </Show>
      <button type="button" class={button} disabled={busy()} onClick={() => void dismiss(receipt())}>{t("writeNewMessage")}</button>
    </div>
  </div>}</Show>;
}
