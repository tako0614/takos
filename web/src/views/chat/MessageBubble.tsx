import { createMemo, createSignal } from "solid-js";
import { For, Show } from "solid-js";
import type { Message, ToolExecution } from "../../types/index.ts";
import { Icons } from "../../lib/Icons.tsx";
import { MarkdownRenderer } from "./MarkdownRenderer.tsx";
import { PersistedToolCalls } from "./Tooling.tsx";
import { useI18n } from "../../store/i18n.ts";
import { parseChatMessageMetadata } from "./messageMetadata.ts";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard.ts";

interface MessageBubbleProps {
  message: Message;
  showToolExecutions?: boolean;
  spaceId?: string;
}

/**
 * NOTE: `attachment.mime_type` arrives from message metadata and originates
 * from the client at upload time. It is UNTRUSTED for security decisions.
 *
 * The server MUST re-derive / re-check the MIME type when streaming the
 * download (e.g. via magic-byte sniffing or by trusting only the stored
 * object metadata it produced itself). The client only uses `mime_type`
 * for layout hints (e.g. rendering an `<img>` vs an `<AttachmentChip>`),
 * never for authorization.
 *
 * Likewise, the `<img>` `src` points at the authenticated download endpoint
 * and the browser will fall back to the chip on `onError`, so a mislabelled
 * file degrades gracefully rather than being rendered as an arbitrary type.
 */
function AttachmentImage(props: {
  attachment: {
    file_id?: string;
    path?: string;
    name: string;
    mime_type?: string | null;
    size?: number;
  };
  spaceId: string;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = createSignal(false);

  return (
    <Show
      when={!failed() && props.attachment.file_id}
      fallback={<AttachmentChip attachment={props.attachment} />}
    >
      {(() => {
        const src =
          `/api/spaces/${encodeURIComponent(props.spaceId)}/storage/download/${encodeURIComponent(props.attachment.file_id ?? "")}`;
        return (
          <a href={src} target="_blank" rel="noopener noreferrer" class="block">
            <img
              src={src}
              alt={props.attachment.name}
              class="max-w-xs max-h-64 rounded-xl object-contain"
              loading="lazy"
              onError={() =>
                setFailed(true)}
              title={t("imagePreview")}
            />
          </a>
        );
      })()}
    </Show>
  );
}

function AttachmentChip(props: {
  attachment: {
    file_id?: string;
    path?: string;
    name: string;
    mime_type?: string | null;
    size?: number;
  };
}) {
  return (
    <div class="inline-flex max-w-full items-center gap-2 rounded-xl border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      <Icons.Paperclip class="h-4 w-4 flex-shrink-0" />
      <div class="min-w-0">
        <div class="truncate font-medium">{props.attachment.name}</div>
        <div class="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {props.attachment.path || props.attachment.file_id ||
            props.attachment.mime_type || ""}
        </div>
      </div>
    </div>
  );
}

export function MessageBubble(props: MessageBubbleProps) {
  const { t } = useI18n();
  const { copied, copyFailed, copy } = useCopyToClipboard();

  const isUser = () => props.message.role === "user";

  const parsed = createMemo(() => {
    const meta = parseChatMessageMetadata(props.message.metadata);
    return {
      attachments: meta.attachments,
      toolExecutions: isUser() ? [] as ToolExecution[] : meta.toolExecutions,
    };
  });

  // `mime_type` is client-supplied metadata (see AttachmentImage docblock).
  // It is fine to use for layout/display branching, but the server must
  // re-check MIME type when serving the actual bytes.
  const isImage = (att: { mime_type?: string | null }) =>
    att.mime_type?.startsWith("image/");

  return (
    <Show
      when={props.message.role !== "tool" &&
        !(props.message.role === "assistant" && !props.message.content &&
          props.message.tool_calls)}
    >
      <Show
        when={isUser()}
        fallback={
          <div id={`message-${props.message.id}`} class="py-3 px-4">
            <Show
              when={(props.showToolExecutions ?? true) &&
                parsed().toolExecutions.length > 0}
            >
              <PersistedToolCalls toolExecutions={parsed().toolExecutions} />
            </Show>

            <Show when={parsed().attachments.length > 0}>
              <div class="mb-3 flex flex-wrap gap-2">
                <For each={parsed().attachments}>
                  {(attachment, _index) => (
                    <Show
                      when={isImage(attachment) && attachment.file_id
                        ? props.spaceId
                        : undefined}
                      fallback={
                        <div class="inline-flex max-w-full items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                          <Icons.Paperclip class="h-4 w-4 flex-shrink-0" />
                          <div class="min-w-0">
                            <div class="truncate font-medium">
                              {attachment.name}
                            </div>
                            <div class="truncate text-xs text-zinc-500 dark:text-zinc-400">
                              {attachment.path || attachment.file_id ||
                                attachment.mime_type || ""}
                            </div>
                          </div>
                        </div>
                      }
                    >
                      {(spaceId) => (
                        <AttachmentImage
                          attachment={attachment}
                          spaceId={spaceId()}
                        />
                      )}
                    </Show>
                  )}
                </For>
              </div>
            </Show>

            <Show when={props.message.content}>
              {(content) => (
                <div class="prose dark:prose-invert max-w-none text-zinc-900 dark:text-zinc-100">
                  <MarkdownRenderer content={content()} />
                </div>
              )}
            </Show>

            <Show when={props.message.content}>
              {(content) => (
                <div class="flex items-center gap-2 mt-3">
                  <button
                    type="button"
                    class="min-w-[44px] min-h-[44px] px-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 flex items-center justify-center gap-1"
                    onClick={() => copy(content())}
                    aria-label={copyFailed()
                      ? t("copyFailed")
                      : copied()
                      ? t("copied")
                      : t("copy")}
                  >
                    <Show when={copyFailed()}>
                      <span class="text-xs text-red-600 dark:text-red-400">
                        {t("copyFailed")}
                      </span>
                    </Show>
                    <Show when={!copyFailed() && copied()}>
                      <Icons.Check class="w-4 h-4 text-zinc-700 dark:text-zinc-300" />
                      <span class="text-xs text-zinc-700 dark:text-zinc-300">
                        {t("copied")}
                      </span>
                    </Show>
                    <Show when={!copyFailed() && !copied()}>
                      <Icons.Copy class="w-4 h-4" />
                    </Show>
                  </button>
                </div>
              )}
            </Show>
          </div>
        }
      >
        <div id={`message-${props.message.id}`} class="py-3 px-4">
          <div class="flex justify-end">
            <div class="bg-zinc-200 dark:bg-zinc-700 rounded-2xl px-4 py-2 max-w-[80%]">
              <Show when={parsed().attachments.length > 0}>
                <div class="mb-2 flex flex-wrap gap-2">
                  <For each={parsed().attachments}>
                    {(attachment, _index) => (
                      <Show
                        when={isImage(attachment) && attachment.file_id
                          ? props.spaceId
                          : undefined}
                        fallback={<AttachmentChip attachment={attachment} />}
                      >
                        {(spaceId) => (
                          <AttachmentImage
                            attachment={attachment}
                            spaceId={spaceId()}
                          />
                        )}
                      </Show>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={props.message.content}>
                <div class="text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap">
                  {props.message.content}
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </Show>
  );
}
